#!/usr/bin/env python3
"""
RunPod Serverless handler for OneTrainer Flux LoRA training.

Required env vars (set in RunPod endpoint config):
  R2_ENDPOINT           - Cloudflare R2 endpoint URL
  R2_ACCESS_KEY_ID      - R2 access key
  R2_SECRET_ACCESS_KEY  - R2 secret key
  R2_BUCKET_NAME        - Bucket name

Input JSON shape:
  {
    "run_name":           str,
    "config":             dict,   # OneTrainer config (paths will be overwritten)
    "concepts":           list,   # [{name, r2_dataset_key, repeats, prompt_source}]
    "checkpoint_r2_key":  str,    # e.g. "training/checkpoints/flux1dev.safetensors"
    "output_r2_key":      str     # optional, e.g. "training/loras/my-lora.safetensors"
  }
"""

import gc
import os
import sys
import re
import json
import time
import zipfile
import subprocess
import shutil
import glob
import tempfile

import types

import runpod
import boto3
from botocore.config import Config

# basicsr (used by realesrgan + gfpgan) imports torchvision.transforms.functional_tensor
# which was removed in torchvision>=0.15. Install a compat shim at module load so it
# applies regardless of whether ESRGAN or GFPGAN is the first feature to run.
try:
    import torchvision.transforms.functional_tensor  # noqa: F401
except ModuleNotFoundError:
    import torchvision.transforms.functional as _tvf
    _compat = types.ModuleType('torchvision.transforms.functional_tensor')
    for _attr in dir(_tvf):
        setattr(_compat, _attr, getattr(_tvf, _attr))
    sys.modules['torchvision.transforms.functional_tensor'] = _compat
    del _tvf, _compat, _attr

HANDLER_VERSION = '2026-06-02-v67'

import importlib

# Must be set before any CUDA allocations — prevents fragmentation OOM on warm workers
os.environ.setdefault('PYTORCH_CUDA_ALLOC_CONF', 'expandable_segments:True')

_PIPE_CACHE:   dict = {}   # ckpt_path → FluxPipeline (reused across jobs on warm workers)
_YOLO_CACHE:  dict = {}   # model_path → YOLO instance
_GFPGAN_CACHE: dict = {}   # model_path → GFPGANer instance
_CN_CACHE:    dict = {}   # 'union' → FluxControlNetModel (cached in VRAM after first load)
print(f'[handler] loaded — version {HANDLER_VERSION}', flush=True)

OT_DIR     = '/workspace/OneTrainer'
MODELS_DIR = '/workspace/models'
WORK_DIR   = '/workspace/runs'

# OneTrainer saves Flux LoRAs with the prefix 'lora_transformer_' (underscore).
# Block paths use dots within the path component:
#   e.g. 'lora_transformer_double_blocks.0.img_attn.qkv.0.lora_down.weight'
# Top-level names use underscores to join multi-word names:
#   e.g. 'lora_transformer_norm_out_linear.lora_down.weight'
#
# _DOUBLE_BLOCK_US / _SINGLE_BLOCK_US kept for potential legacy files only.
_DOUBLE_BLOCK_US = {
    'img_attn_qkv_0':  'attn.to_q',
    'img_attn_qkv_1':  'attn.to_k',
    'img_attn_qkv_2':  'attn.to_v',
    'img_attn_proj':   'attn.to_out.0',
    'img_mlp_0':       'ff.net.0.proj',
    'img_mlp_2':       'ff.net.2',
    'img_mod_lin':     'norm1.linear',
    'txt_attn_qkv_0':  'attn.add_q_proj',
    'txt_attn_qkv_1':  'attn.add_k_proj',
    'txt_attn_qkv_2':  'attn.add_v_proj',
    'txt_attn_proj':   'attn.to_add_out',
    'txt_mlp_0':       'ff_context.net.0.proj',
    'txt_mlp_2':       'ff_context.net.2',
    'txt_mod_lin':     'norm1_context.linear',
}

_SINGLE_BLOCK_US = {
    'linear1_0':      'attn.to_q',
    'linear1_1':      'attn.to_k',
    'linear1_2':      'attn.to_v',
    'linear1_3':      'proj_mlp',
    'linear2':        'proj_out',
    'modulation_lin': 'norm.linear',
}

# Top-level transformer layers (no block index)
_TOP_LEVEL_US = {
    'context_embedder':  'context_embedder',
    'proj_out':          'proj_out',
    'norm_out_linear':   'norm_out.linear',
    'x_embedder':        'x_embedder',
    'time_text_embed_timestep_embedder_linear_1': 'time_text_embed.timestep_embedder.linear_1',
    'time_text_embed_timestep_embedder_linear_2': 'time_text_embed.timestep_embedder.linear_2',
    'time_text_embed_guidance_embedder_linear_1': 'time_text_embed.guidance_embedder.linear_1',
    'time_text_embed_guidance_embedder_linear_2': 'time_text_embed.guidance_embedder.linear_2',
    'time_text_embed_text_embedder_linear_1':     'time_text_embed.text_embedder.linear_1',
    'time_text_embed_text_embedder_linear_2':     'time_text_embed.text_embedder.linear_2',
}

# Legacy dot format (kept for compatibility with older LoRA files)
_DOUBLE_BLOCK_DOT = {
    'img_attn.qkv.0':  'attn.to_q',
    'img_attn.qkv.1':  'attn.to_k',
    'img_attn.qkv.2':  'attn.to_v',
    'img_attn.proj':   'attn.to_out.0',
    'img_mlp.0':       'ff.net.0.proj',
    'img_mlp.2':       'ff.net.2',
    'img_mod.lin':     'norm1.linear',
    'txt_attn.qkv.0':  'attn.add_q_proj',
    'txt_attn.qkv.1':  'attn.add_k_proj',
    'txt_attn.qkv.2':  'attn.add_v_proj',
    'txt_attn.proj':   'attn.to_add_out',
    'txt_mlp.0':       'ff_context.net.0.proj',
    'txt_mlp.2':       'ff_context.net.2',
    'txt_mod.lin':     'norm1_context.linear',
}

_SINGLE_BLOCK_DOT = {
    'linear1.0':      'attn.to_q',
    'linear1.1':      'attn.to_k',
    'linear1.2':      'attn.to_v',
    'linear1.3':      'proj_mlp',
    'linear2':        'proj_out',
    'modulation.lin': 'norm.linear',
}

# Diffusers naming with ALL dots replaced by underscores
# (e.g. lora_transformer_transformer_blocks_0_attn_to_q)
_DIFFUSERS_DOUBLE_US = {
    'attn_to_q':             'attn.to_q',
    'attn_to_k':             'attn.to_k',
    'attn_to_v':             'attn.to_v',
    'attn_to_out_0':         'attn.to_out.0',
    'attn_add_q_proj':       'attn.add_q_proj',
    'attn_add_k_proj':       'attn.add_k_proj',
    'attn_add_v_proj':       'attn.add_v_proj',
    'attn_to_add_out':       'attn.to_add_out',
    'ff_net_0_proj':         'ff.net.0.proj',
    'ff_net_2':              'ff.net.2',
    'ff_context_net_0_proj': 'ff_context.net.0.proj',
    'ff_context_net_2':      'ff_context.net.2',
    'norm1_linear':          'norm1.linear',
    'norm1_context_linear':  'norm1_context.linear',
}

_DIFFUSERS_SINGLE_US = {
    'attn_to_q':   'attn.to_q',
    'attn_to_k':   'attn.to_k',
    'attn_to_v':   'attn.to_v',
    'proj_mlp':    'proj_mlp',
    'proj_out':    'proj_out',
    'norm_linear': 'norm.linear',
}


def _kohya_key_to_module_path(base_key: str) -> str | None:
    """Convert an OT/kohya LoRA base key to a diffusers transformer module path.

    Tries every known format OneTrainer may produce:
      A) BFL naming, dots:       lora_transformer_double_blocks.0.img_attn.qkv.0
      B) BFL naming, underscores: lora_transformer_double_blocks_0_img_attn_qkv_0
      C) Diffusers naming, dots: lora_transformer_transformer_blocks.0.attn.to_q
      D) Diffusers naming, US:   lora_transformer_transformer_blocks_0_attn_to_q
      E) Top-level underscore:   lora_transformer_norm_out_linear
      Legacy: lora_transformer.double_blocks.0.img_attn.qkv.0
    """
    if base_key.startswith('lora_transformer_'):
        rest = base_key[len('lora_transformer_'):]

        # A) BFL naming with dots
        m = re.match(r'^double_blocks\.(\d+)\.(.+)$', rest)
        if m:
            sub = _DOUBLE_BLOCK_DOT.get(m.group(2))
            return f'transformer_blocks.{m.group(1)}.{sub}' if sub else None

        m = re.match(r'^single_blocks\.(\d+)\.(.+)$', rest)
        if m:
            sub = _SINGLE_BLOCK_DOT.get(m.group(2))
            return f'single_transformer_blocks.{m.group(1)}.{sub}' if sub else None

        # B) BFL naming with underscores
        m = re.match(r'^double_blocks_(\d+)_(.+)$', rest)
        if m:
            sub = _DOUBLE_BLOCK_US.get(m.group(2))
            return f'transformer_blocks.{m.group(1)}.{sub}' if sub else None

        m = re.match(r'^single_blocks_(\d+)_(.+)$', rest)
        if m:
            sub = _SINGLE_BLOCK_US.get(m.group(2))
            return f'single_transformer_blocks.{m.group(1)}.{sub}' if sub else None

        # C) Diffusers naming with dots — rest IS already the module path
        m = re.match(r'^(transformer_blocks|single_transformer_blocks)\.(\d+)\..+$', rest)
        if m:
            return rest

        # D) Diffusers naming with underscores
        m = re.match(r'^transformer_blocks_(\d+)_(.+)$', rest)
        if m:
            sub = _DIFFUSERS_DOUBLE_US.get(m.group(2))
            return f'transformer_blocks.{m.group(1)}.{sub}' if sub else None

        m = re.match(r'^single_transformer_blocks_(\d+)_(.+)$', rest)
        if m:
            sub = _DIFFUSERS_SINGLE_US.get(m.group(2))
            return f'single_transformer_blocks.{m.group(1)}.{sub}' if sub else None

        # E) Top-level layers (underscore-joined names)
        return _TOP_LEVEL_US.get(rest)

    # ── Legacy dot format ──────────────────────────────────────────────────
    if base_key.startswith('lora_transformer.'):
        rest = base_key[len('lora_transformer.'):]

        m = re.match(r'^double_blocks\.(\d+)\.(.+)$', rest)
        if m:
            sub = _DOUBLE_BLOCK_DOT.get(m.group(2))
            return f'transformer_blocks.{m.group(1)}.{sub}' if sub else None

        m = re.match(r'^single_blocks\.(\d+)\.(.+)$', rest)
        if m:
            sub = _SINGLE_BLOCK_DOT.get(m.group(2))
            return f'single_transformer_blocks.{m.group(1)}.{sub}' if sub else None

    return None

# Flux1-dev component configs embedded directly so inference never depends on
# finding config files at a specific container path.
_VAE_CONFIG = {
    "_class_name": "AutoencoderKL",
    "_diffusers_version": "0.30.0.dev0",
    "act_fn": "silu",
    "block_out_channels": [128, 256, 512, 512],
    "down_block_types": ["DownEncoderBlock2D", "DownEncoderBlock2D", "DownEncoderBlock2D", "DownEncoderBlock2D"],
    "force_upcast": True,
    "in_channels": 3,
    "latent_channels": 16,
    "layers_per_block": 2,
    "norm_num_groups": 32,
    "out_channels": 3,
    "sample_size": 1024,
    "scaling_factor": 0.3611,
    "shift_factor": 0.1159,
    "up_block_types": ["UpDecoderBlock2D", "UpDecoderBlock2D", "UpDecoderBlock2D", "UpDecoderBlock2D"],
    "use_post_quant_conv": False,
    "use_quant_conv": False,
}

_TRANSFORMER_CONFIG = {
    "_class_name": "FluxTransformer2DModel",
    "_diffusers_version": "0.30.0.dev0",
    "attention_head_dim": 128,
    "axes_dims_rope": [16, 56, 56],
    "guidance_embeds": True,
    "in_channels": 64,
    "joint_attention_dim": 4096,
    "num_attention_heads": 24,
    "num_layers": 19,
    "num_single_layers": 38,
    "patch_size": 1,
    "pooled_projection_dim": 768,
}

_EMBEDDED_CONFIGS_DIR = None  # populated on first call to _get_embedded_config_dir()

def _get_embedded_config_dir(name: str, config_dict: dict) -> str:
    """Write an embedded config dict to a temp dir and return the path."""
    global _EMBEDDED_CONFIGS_DIR
    if _EMBEDDED_CONFIGS_DIR is None:
        _EMBEDDED_CONFIGS_DIR = tempfile.mkdtemp(prefix='flux_configs_')
    cfg_dir = os.path.join(_EMBEDDED_CONFIGS_DIR, name)
    os.makedirs(cfg_dir, exist_ok=True)
    cfg_file = os.path.join(cfg_dir, 'config.json')
    if not os.path.exists(cfg_file):
        with open(cfg_file, 'w') as f:
            json.dump(config_dict, f)
    return cfg_dir


def _r2():
    return boto3.client(
        's3',
        endpoint_url=os.environ['R2_ENDPOINT'],
        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
        config=Config(signature_version='s3v4'),
        region_name='auto',
    )


IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.bmp'}

def _find_image_dir(base_dir: str) -> str:
    """Return the directory that actually contains images.

    Handles the common case where the zip had a root folder, so extraction
    produces base_dir/some_folder/img.jpg instead of base_dir/img.jpg.
    Searches up to 2 levels deep and returns the first directory with images.
    """
    def has_images(d: str) -> bool:
        return any(os.path.splitext(f)[1].lower() in IMAGE_EXTS for f in os.listdir(d) if os.path.isfile(os.path.join(d, f)))

    if has_images(base_dir):
        return base_dir
    for entry in sorted(os.listdir(base_dir)):
        sub = os.path.join(base_dir, entry)
        if not os.path.isdir(sub):
            continue
        if has_images(sub):
            return sub
        # one more level
        for entry2 in sorted(os.listdir(sub)):
            sub2 = os.path.join(sub, entry2)
            if os.path.isdir(sub2) and has_images(sub2):
                return sub2
    return base_dir  # fall back to original, error will surface below


def _find_config_dir(name: str) -> str:
    """Find a bundled config directory, checking multiple candidate locations.

    Handles both old images (OneTrainer/OneTrainer/...) and new ones (OneTrainer/...).
    """
    candidates = [
        f'/workspace/OneTrainer/{name}',
        f'/workspace/OneTrainer/OneTrainer/{name}',
        f'/workspace/{name}',
    ]
    for path in candidates:
        if os.path.isdir(path) and os.path.exists(os.path.join(path, 'config.json')):
            return path
    return candidates[0]  # fall back; missing dir error surfaces below


def _count_images(directory: str) -> int:
    return len([
        f for f in glob.glob(os.path.join(directory, '**', '*'), recursive=True)
        if os.path.isfile(f) and os.path.splitext(f)[1].lower() in IMAGE_EXTS
    ])


def _flush_logs(r2, bucket: str, job_id: str, logs: list) -> None:
    try:
        r2.put_object(
            Bucket=bucket,
            Key=f'training/logs/{job_id}.txt',
            Body='\n'.join(logs).encode('utf-8'),
            ContentType='text/plain',
        )
    except Exception:
        pass


def _download(r2, key: str, dest: str, label: str, logs: list) -> bool:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    logs.append(f'[runpod] Downloading {label}...')
    try:
        r2.download_file(os.environ['R2_BUCKET_NAME'], key, dest)
        size = os.path.getsize(dest) / 1e9
        logs.append(f'[runpod] {label} ready ({size:.2f} GB)')
        return True
    except Exception as e:
        logs.append(f'[runpod] ERROR downloading {label}: {e}')
        return False


INFERENCE_CACHE = '/workspace/inference_cache'


def _adetailer_fix_faces(pipe_i2i, image_pil, prompt: str, strength: float,
                         steps: int, guidance: float, seed, logs: list):
    """
    Detect faces with YOLO, run a targeted img2img detail pass on each one,
    and blend back with feathered edges. Same approach as A1111 ADetailer.
    """
    from PIL import Image, ImageFilter
    import numpy as np
    import torch

    global _YOLO_CACHE
    MODEL_PATH   = '/workspace/models/adetailer/face_yolov8n.pt'
    INPAINT_SIZE = 512
    PADDING      = 0.25   # expand each bbox side by 25 %
    FEATHER      = 20     # edge blend width in pixels

    if MODEL_PATH not in _YOLO_CACHE:
        from ultralytics import YOLO
        _YOLO_CACHE[MODEL_PATH] = YOLO(MODEL_PATH)
    yolo = _YOLO_CACHE[MODEL_PATH]

    results = yolo(image_pil, verbose=False, conf=0.35)
    if not results or len(results[0].boxes) == 0:
        logs.append('[adetailer] No faces detected — skipping.')
        return image_pil

    boxes = results[0].boxes.xyxy.cpu().numpy()
    logs.append(f'[adetailer] Detected {len(boxes)} face(s).')
    W, H  = image_pil.size
    output = image_pil.copy()

    for i, box in enumerate(boxes):
        x1, y1, x2, y2 = [float(v) for v in box]
        bw, bh = x2 - x1, y2 - y1
        # Expand bbox
        px1 = max(0.0, x1 - bw * PADDING)
        py1 = max(0.0, y1 - bh * PADDING)
        px2 = min(float(W), x2 + bw * PADDING)
        py2 = min(float(H), y2 + bh * PADDING)
        rw, rh = int(px2 - px1), int(py2 - py1)

        # Crop → resize to INPAINT_SIZE for detail pass
        face_crop    = output.crop((int(px1), int(py1), int(px2), int(py2)))
        face_resized = face_crop.resize((INPAINT_SIZE, INPAINT_SIZE), Image.LANCZOS)

        gen = torch.Generator('cuda').manual_seed(int(seed) + 100 + i) if seed is not None else None
        fixed_resized = pipe_i2i(
            prompt=prompt,
            image=face_resized,
            strength=strength,
            num_inference_steps=steps,
            guidance_scale=guidance,
            generator=gen,
            width=INPAINT_SIZE,
            height=INPAINT_SIZE,
        ).images[0]

        # Resize fixed face back to original region size
        fixed_back = fixed_resized.resize((rw, rh), Image.LANCZOS)

        # Feathered paste mask — gradient edges so the blend isn't sharp
        mask_arr = np.ones((rh, rw), dtype=np.float32)
        for f in range(FEATHER):
            a = f / FEATHER
            if f < rh:       mask_arr[f, :]       *= a
            if rh-f-1 >= 0:  mask_arr[rh-f-1, :]  *= a
            if f < rw:       mask_arr[:, f]         *= a
            if rw-f-1 >= 0:  mask_arr[:, rw-f-1]   *= a
        mask = Image.fromarray((mask_arr * 255).astype(np.uint8), 'L')
        mask = mask.filter(ImageFilter.GaussianBlur(radius=FEATHER // 2))

        output.paste(fixed_back, (int(px1), int(py1)), mask=mask)
        logs.append(f'[adetailer] Face {i+1}/{len(boxes)} fixed.')

    return output


def _esrgan_load_state_dict(model_path: str, logs: list):
    """
    Load an ESRGAN .pth file and return (state_dict, has_conv_hr).

    has_conv_hr=True  → use basicsr RRDBNet (conv_body/up1/up2/hr/last)
    has_conv_hr=False → use LegacyRRDBNet (conv_body/up1/up2/last, no hr layer)

    Handled formats:
      1. Real-ESRGAN  — top-level 'params_ema' / 'params' wrapper
      2. basicsr      — conv_first / body.N / conv_body / conv_hr / conv_last
      3. orig ESRGAN  — RRDB_trunk / trunk_conv / upconv1 / HRconv / conv_last
      4. sequential   — model.0 / model.1.sub.N.RDBN.convK.0 / model.M…
    """
    import torch
    import re as _re

    loadnet = torch.load(model_path, map_location=torch.device('cpu'), weights_only=False)

    # Print raw top keys to stdout for diagnosis
    if isinstance(loadnet, dict):
        _top_keys = list(loadnet.keys())
        print(f'[esrgan-diag] raw checkpoint top-level keys ({len(_top_keys)} total): {_top_keys[:15]}', flush=True)
    else:
        print(f'[esrgan-diag] checkpoint is not a dict — type: {type(loadnet)}', flush=True)

    # Format 1 — Real-ESRGAN wrapper (always has conv_hr in basicsr weights)
    if isinstance(loadnet, dict):
        if 'params_ema' in loadnet:
            print('[esrgan-diag] Format 1a detected: params_ema wrapper', flush=True)
            return loadnet['params_ema'], True
        if 'params' in loadnet:
            print('[esrgan-diag] Format 1b detected: params wrapper', flush=True)
            return loadnet['params'], True

    # Format 2 — already basicsr keys
    if isinstance(loadnet, dict) and 'conv_first.weight' in loadnet and 'body.0.rdb1.conv1.weight' in loadnet:
        has_hr = 'conv_hr.weight' in loadnet
        print(f'[esrgan-diag] Format 2 detected: basicsr keys (has_conv_hr={has_hr})', flush=True)
        return loadnet, has_hr

    # Format 3 — original ESRGAN class (RRDB_trunk / trunk_conv / upconv / HRconv)
    # Try both with and without the .0. Sequential wrapper inside RRDB blocks
    _has_rrdb_trunk = any(k.startswith('RRDB_trunk.') for k in (loadnet if isinstance(loadnet, dict) else []))
    _has_seq_conv   = 'RRDB_trunk.0.RDB1.conv1.0.weight' in (loadnet if isinstance(loadnet, dict) else {})
    _has_direct_conv = 'RRDB_trunk.0.RDB1.conv1.weight' in (loadnet if isinstance(loadnet, dict) else {})
    if _has_rrdb_trunk:
        print(f'[esrgan-diag] Format 3 detected: RRDB_trunk (seq_wrapper={_has_seq_conv} direct={_has_direct_conv})', flush=True)
        logs.append('[esrgan] Converting original-ESRGAN format → basicsr format')
        sd = {}
        has_hr = 'HRconv.weight' in loadnet
        for k, v in loadnet.items():
            if 'res_scale' in k:
                continue
            # Try with .0. Sequential wrapper
            m = _re.match(r'^RRDB_trunk\.(\d+)\.(RDB\d+)\.conv(\d+)\.0\.(.+)$', k)
            if m:
                sd[f'body.{m.group(1)}.{m.group(2).lower()}.conv{m.group(3)}.{m.group(4)}'] = v
                continue
            # Try without .0. wrapper (direct Conv2d)
            m = _re.match(r'^RRDB_trunk\.(\d+)\.(RDB\d+)\.conv(\d+)\.(.+)$', k)
            if m:
                sd[f'body.{m.group(1)}.{m.group(2).lower()}.conv{m.group(3)}.{m.group(4)}'] = v
                continue
            m = _re.match(r'^trunk_conv\.(.+)$', k)
            if m:
                sd[f'conv_body.{m.group(1)}'] = v
                continue
            m = _re.match(r'^upconv(\d)\.(.+)$', k)
            if m:
                sd[f'conv_up{m.group(1)}.{m.group(2)}'] = v
                continue
            m = _re.match(r'^HRconv\.(.+)$', k)
            if m:
                sd[f'conv_hr.{m.group(1)}'] = v
                continue
            sd[k] = v  # conv_first, conv_last map 1-to-1
        print(f'[esrgan-diag] Format 3 conversion: {len(sd)} keys produced, has_conv_hr={has_hr}', flush=True)
        return sd, has_hr

    # Format 4 — sequential wrapper (model.0 / model.1.sub.N.RDBN / model.M…)
    # In some ESRGAN forks the trunk conv lives INSIDE the ShortcutBlock as model.1.sub.N
    # (the last element of the sub-sequential, after the 23 RRDB blocks).  Those checkpoints
    # produce model.1.sub.23.weight/.bias as plain Conv2d keys — not matching any RRDB pattern.
    # The remaining model.N (N≥2) layers are then: upconv1, upconv2, HRconv, conv_last (4 total).
    if isinstance(loadnet, dict) and 'model.0.weight' in loadnet:
        print('[esrgan-diag] Format 4 detected: sequential model.0', flush=True)
        logs.append('[esrgan] Converting sequential-ESRGAN format → basicsr format')
        sd = {}
        extra = {}           # model index → {param_suffix: tensor}
        unmatched = []
        trunk_conv_in_sub = False   # True when trunk conv is model.1.sub.last

        for k, v in loadnet.items():
            if 'res_scale' in k:
                continue
            m = _re.match(r'^model\.0\.(.+)$', k)
            if m:
                sd[f'conv_first.{m.group(1)}'] = v
                continue
            # RRDB body — with .0. Sequential wrapper around each Conv2d
            m = _re.match(r'^model\.1\.sub\.(\d+)\.(RDB\d+)\.conv(\d+)\.0\.(.+)$', k)
            if m:
                sd[f'body.{m.group(1)}.{m.group(2).lower()}.conv{m.group(3)}.{m.group(4)}'] = v
                continue
            # RRDB body — direct Conv2d (no .0. wrapper)
            m = _re.match(r'^model\.1\.sub\.(\d+)\.(RDB\d+)\.conv(\d+)\.(.+)$', k)
            if m:
                sd[f'body.{m.group(1)}.{m.group(2).lower()}.conv{m.group(3)}.{m.group(4)}'] = v
                continue
            # Trunk conv stored inside ShortcutBlock's sub-sequential (plain Conv2d, no RRDB pattern)
            # e.g. model.1.sub.23.weight / model.1.sub.23.bias
            m = _re.match(r'^model\.1\.sub\.(\d+)\.(.+)$', k)
            if m:
                sd[f'conv_body.{m.group(2)}'] = v
                trunk_conv_in_sub = True
                continue
            m = _re.match(r'^model\.(\d+)\.(.+)$', k)
            if m and int(m.group(1)) > 1:
                extra.setdefault(int(m.group(1)), {})[m.group(2)] = v
                continue
            unmatched.append(k)

        num_extra = len(extra)
        if unmatched:
            print(f'[esrgan-diag] Format 4: {len(unmatched)} unmatched keys: {unmatched[:5]}', flush=True)

        if trunk_conv_in_sub:
            # conv_body already populated from sub.N.  Remaining model.N layers are the
            # upsample convs: upconv1, upconv2, HRconv (if present), conv_last.
            if num_extra >= 4:
                targets = ['conv_up1', 'conv_up2', 'conv_hr', 'conv_last']
                has_hr  = True
            else:
                targets = ['conv_up1', 'conv_up2', 'conv_last']
                has_hr  = False
        else:
            # trunk_conv is the first of the extra model.N layers
            if num_extra >= 5:
                targets = ['conv_body', 'conv_up1', 'conv_up2', 'conv_hr', 'conv_last']
                has_hr  = True
            else:
                targets = ['conv_body', 'conv_up1', 'conv_up2', 'conv_last']
                has_hr  = False

        for i, idx in enumerate(sorted(extra.keys())):
            if i < len(targets):
                for param, v in extra[idx].items():
                    sd[f'{targets[i]}.{param}'] = v

        print(f'[esrgan-diag] Format 4: trunk_in_sub={trunk_conv_in_sub}, {num_extra} extra layers, has_conv_hr={has_hr}, sd_keys={len(sd)}', flush=True)
        return sd, has_hr

    # Unknown format — return raw; load_state_dict will surface the real error
    top = list(loadnet.keys())[:10] if isinstance(loadnet, dict) else str(type(loadnet))
    print(f'[esrgan-diag] UNKNOWN FORMAT — top keys: {top}', flush=True)
    logs.append(f'[esrgan] WARNING: unrecognised checkpoint format, top keys: {top}')
    return loadnet, True


def _esrgan_upscale(image_pil, model_name: str, outscale: float, logs: list):
    """
    ESRGAN upscale — custom tiled inference, no RealESRGANer dependency.
    model_name: 'x4plus' | 'x2plus' | 'ultrasharp'
    outscale:   target output scale (float; model runs at native scale, output resized)
    """
    import math
    import numpy as np
    import cv2
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    from PIL import Image
    from basicsr.archs.rrdbnet_arch import RRDBNet, RRDB

    if model_name == 'ultrasharp':
        model_path  = '/workspace/models/esrgan/4x-UltraSharp.pth'
        model_scale = 4
    elif model_name == 'x2plus':
        model_path  = '/workspace/models/esrgan/RealESRGAN_x2plus.pth'
        model_scale = 2
    elif model_name == 'x4plus':
        model_path  = '/workspace/models/esrgan/RealESRGAN_x4plus.pth'
        model_scale = 4
    else:
        # Custom R2 model — filename stored under training/models/esrgan/ in the bucket.
        # Scale is parsed from the filename prefix (e.g. '4x_Remacri.pth' → 4).
        model_path  = f'/workspace/models/esrgan/{model_name}'
        _sm = re.match(r'^(\d+)[xX]', model_name)
        model_scale = int(_sm.group(1)) if _sm else 4
        if not os.path.exists(model_path) or os.path.getsize(model_path) < 1_000_000:
            _r2c = _r2()
            _r2b = os.environ['R2_BUCKET_NAME']
            _r2k = f'training/models/esrgan/{model_name}'
            logs.append(f'[esrgan] Downloading custom model {model_name} from R2...')
            print(f'[esrgan] Downloading {_r2k}...', flush=True)
            os.makedirs('/workspace/models/esrgan', exist_ok=True)
            if not _download(_r2c, _r2k, model_path, model_name, logs):
                raise RuntimeError(f'Custom ESRGAN model not found in R2: {_r2k}')
            print(f'[esrgan] Downloaded {model_name} OK', flush=True)

    if outscale <= 0:
        outscale = float(model_scale)
        logs.append(f'[esrgan] Warning: outscale was ≤0, using native model scale {model_scale}')
    logs.append(f'[esrgan] {outscale:.2f}× upscale ({model_name})...')

    state_dict, has_conv_hr = _esrgan_load_state_dict(model_path, logs)

    print(f'[esrgan-diag] has_conv_hr={has_conv_hr} model_scale={model_scale} model_name={model_name}', flush=True)
    if has_conv_hr:
        print('[esrgan-diag] Using basicsr RRDBNet (with conv_hr)', flush=True)
        model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64,
                        num_block=23, num_grow_ch=32, scale=model_scale)
    else:
        # Legacy ESRGAN (sequential format, e.g. 4x-UltraSharp) — no conv_hr layer.
        class LegacyRRDBNet(nn.Module):
            def __init__(self, scale):
                super().__init__()
                nf = 64
                self.conv_first = nn.Conv2d(3, nf, 3, 1, 1)
                self.body       = nn.Sequential(*[RRDB(nf, num_grow_ch=32) for _ in range(23)])
                self.conv_body  = nn.Conv2d(nf, nf, 3, 1, 1)
                self.conv_up1   = nn.Conv2d(nf, nf, 3, 1, 1)
                self.conv_up2   = nn.Conv2d(nf, nf, 3, 1, 1)
                self.conv_last  = nn.Conv2d(nf, 3,  3, 1, 1)
                self.lrelu      = nn.LeakyReLU(negative_slope=0.2, inplace=True)
            def forward(self, x):
                feat = self.conv_first(x)
                feat = self.conv_body(self.body(feat)) + feat
                feat = self.lrelu(self.conv_up1(F.interpolate(feat, scale_factor=2, mode='nearest')))
                feat = self.lrelu(self.conv_up2(F.interpolate(feat, scale_factor=2, mode='nearest')))
                return self.conv_last(feat)
        print('[esrgan-diag] Using LegacyRRDBNet (no conv_hr)', flush=True)
        model = LegacyRRDBNet(scale=model_scale)

    incompatible = model.load_state_dict(state_dict, strict=False)
    if incompatible.missing_keys:
        print(f'[esrgan-diag] MISSING keys ({len(incompatible.missing_keys)}): {incompatible.missing_keys[:10]}', flush=True)
    if incompatible.unexpected_keys:
        print(f'[esrgan-diag] UNEXPECTED keys ({len(incompatible.unexpected_keys)}): {incompatible.unexpected_keys[:10]}', flush=True)
    if not incompatible.missing_keys and not incompatible.unexpected_keys:
        print('[esrgan-diag] load_state_dict: all keys matched perfectly', flush=True)
    model.eval()
    model = model.cuda().float()   # float32 — fp16 causes precision artifacts on ESRGAN

    # All ESRGAN variants expect RGB input.
    # Original ESRGAN test.py does img[:, :, [2, 1, 0]] to convert BGR→RGB before the model,
    # so sequential-format checkpoints (4x-UltraSharp) are also RGB-trained — no channel swap needed.
    # pixel_unshuffle(scale=2) inside RRDBNet requires H and W both divisible by 2.
    # Round odd dimensions up by 1px — imperceptible at typical resolutions.
    if image_pil.width % 2 != 0 or image_pil.height % 2 != 0:
        _ew = image_pil.width  + (image_pil.width  % 2)
        _eh = image_pil.height + (image_pil.height % 2)
        image_pil = image_pil.resize((_ew, _eh), Image.LANCZOS)
        logs.append(f'[esrgan] Padded to even dims: {_ew}×{_eh}')
        print(f'[esrgan] Padded odd-dim input to {_ew}×{_eh}', flush=True)

    img = np.array(image_pil, dtype=np.float32)  # HWC, RGB, 0-255
    img /= 255.0
    img_t = torch.from_numpy(np.transpose(img, (2, 0, 1))).float().unsqueeze(0).cuda()

    h, w   = img_t.shape[2], img_t.shape[3]
    TILE   = 512
    PAD    = 32
    out_h  = h * model_scale
    out_w  = w * model_scale
    output = torch.zeros(1, 3, out_h, out_w, dtype=torch.float32, device='cuda')

    tiles_x = math.ceil(w / TILE)
    tiles_y = math.ceil(h / TILE)
    logs.append(f'[esrgan] {tiles_x * tiles_y} tile(s) ({tiles_x}×{tiles_y})...')

    for ty in range(tiles_y):
        for tx in range(tiles_x):
            x1 = tx * TILE;  x2 = min(x1 + TILE, w)
            y1 = ty * TILE;  y2 = min(y1 + TILE, h)
            x1p = max(x1 - PAD, 0);  x2p = min(x2 + PAD, w)
            y1p = max(y1 - PAD, 0);  y2p = min(y2 + PAD, h)
            tile_in = img_t[:, :, y1p:y2p, x1p:x2p]
            with torch.no_grad():
                tile_out = model(tile_in)
            ox = (x1 - x1p) * model_scale;  tw = (x2 - x1) * model_scale
            oy = (y1 - y1p) * model_scale;  th = (y2 - y1) * model_scale
            output[:, :, y1*model_scale:y2*model_scale,
                         x1*model_scale:x2*model_scale] = tile_out[:, :, oy:oy+th, ox:ox+tw]

    out = output.squeeze().cpu().clamp_(0, 1).numpy()
    out = np.transpose(out, (1, 2, 0))          # CHW → HWC
    _stats = f'min={out.min():.4f} max={out.max():.4f} mean={out.mean():.4f} nans={int(np.isnan(out).sum())}'
    logs.append(f'[esrgan] Output stats: {_stats}')
    print(f'[esrgan-diag] Output stats (post-clamp, pre-uint8): {_stats}', flush=True)
    out = (out * 255.0).round().astype(np.uint8)

    # Resize to the requested outscale (model ran at native scale, e.g. 4×)
    if abs(outscale - model_scale) > 0.01:
        interp = cv2.INTER_AREA if outscale < model_scale else cv2.INTER_LANCZOS4
        _ow = int(round(w * outscale))
        _oh = int(round(h * outscale))
        # Round up to even — pixel_unshuffle(scale=2) in the NEXT ESRGAN step would
        # crash on an odd-dimension tile if we leave fractional-outscale results odd.
        if _ow % 2 != 0: _ow += 1
        if _oh % 2 != 0: _oh += 1
        out = cv2.resize(out, (_ow, _oh), interpolation=interp)

    result = Image.fromarray(out)
    logs.append(f'[esrgan] Done — {result.width}×{result.height}')
    return result


def _gfpgan_restore(image_pil, weight: float, logs: list):
    """
    GFPGAN v1.4 face restoration — adds realistic skin pores, fine texture,
    and micro-detail that diffusion models typically smooth away.
    weight: blend factor between original (0) and fully restored (1).
    """
    import numpy as np
    import cv2
    from PIL import Image

    global _GFPGAN_CACHE
    MODEL_PATH = '/workspace/models/gfpgan/GFPGANv1.4.pth'

    if MODEL_PATH not in _GFPGAN_CACHE:
        logs.append('[gfpgan] Loading GFPGANv1.4 (first use on this worker)...')
        from gfpgan import GFPGANer
        _GFPGAN_CACHE[MODEL_PATH] = GFPGANer(
            model_path=MODEL_PATH,
            upscale=1,           # we handle upscaling separately
            arch='clean',
            channel_multiplier=2,
            bg_upsampler=None,
        )

    restorer = _GFPGAN_CACHE[MODEL_PATH]
    img_bgr  = cv2.cvtColor(np.array(image_pil), cv2.COLOR_RGB2BGR)

    try:
        _, _, restored_bgr = restorer.enhance(
            img_bgr, has_aligned=False, only_center_face=False, paste_back=True
        )
    except Exception as _ge:
        logs.append(f'[gfpgan] Warning: restore failed ({_ge}). Returning original.')
        return image_pil

    if restored_bgr is None:
        logs.append('[gfpgan] No faces detected — skipping.')
        return image_pil

    restored_pil = Image.fromarray(cv2.cvtColor(restored_bgr, cv2.COLOR_BGR2RGB))
    if weight < 1.0:
        restored_pil = Image.blend(image_pil.resize(restored_pil.size), restored_pil, weight)
    logs.append(f'[gfpgan] Done (weight={weight:.2f}) — {restored_pil.width}×{restored_pil.height}')
    return restored_pil


# OpenPose-18 skeleton constants — this is the exact format ControlNet Union
# (and most ControlNet pose models) were trained on.
#
# COCO-17 → OpenPose-18 mapping (None = computed, not directly from YOLO).
# OP: 0=Nose 1=Neck 2=R-Shld 3=R-Elbow 4=R-Wrist 5=L-Shld 6=L-Elbow 7=L-Wrist
#     8=R-Hip 9=R-Knee 10=R-Ankle 11=L-Hip 12=L-Knee 13=L-Ankle
#     14=R-Eye 15=L-Eye 16=R-Ear 17=L-Ear
_COCO_TO_OP18 = [0, None, 6, 8, 10, 5, 7, 9, 12, 14, 16, 11, 13, 15, 2, 1, 4, 3]

# 17 limb connections between OP-18 joint indices (matches draw_bodypose)
_OP_LIMBS = [
    (1, 2), (1, 5), (2, 3), (3, 4), (5, 6), (6, 7),
    (1, 8), (8, 9), (9, 10), (1, 11), (11, 12), (12, 13),
    (1, 0), (0, 14), (14, 16), (0, 15), (15, 17),
]

# Per-limb RGB colors — exactly matches controlnet_aux draw_bodypose
_OP_LIMB_COLORS = [
    (255, 0, 0),   (255, 85, 0),  (255, 170, 0), (255, 255, 0), (170, 255, 0),
    (85, 255, 0),  (0, 255, 0),   (0, 255, 85),  (0, 255, 170), (0, 255, 255),
    (0, 170, 255), (0, 85, 255),  (0, 0, 255),   (85, 0, 255),  (170, 0, 255),
    (255, 0, 255), (255, 0, 170),
]

# Per-joint RGB colors for 18 keypoints
_OP_KP_COLORS = [
    (255, 0, 85),  (255, 0, 0),   (255, 85, 0),  (255, 170, 0), (255, 255, 0),
    (170, 255, 0), (85, 255, 0),  (0, 255, 0),   (0, 255, 85),  (0, 255, 170),
    (0, 255, 255), (0, 170, 255), (0, 85, 255),  (0, 0, 255),   (85, 0, 255),
    (170, 0, 255), (255, 0, 255), (255, 0, 170),
]


def _yolo_pose_skeleton(image_pil, target_w: int, target_h: int, logs: list):
    """Extract OpenPose-18 skeleton on a black canvas using YOLO pose.

    Converts COCO-17 keypoints (YOLO output) to OpenPose-18 format and draws
    with the exact colors/style that ControlNet Union pose mode was trained on.
    Raises RuntimeError if no person is detected."""
    import cv2
    import math
    import numpy as np
    from PIL import Image
    from ultralytics import YOLO

    model_key = 'yolov8n-pose'
    if model_key not in _YOLO_CACHE:
        print('[controlnet] Loading yolov8n-pose model...', flush=True)
        logs.append('[controlnet] Loading yolov8n-pose model...')
        _YOLO_CACHE[model_key] = YOLO('yolov8n-pose.pt')

    model  = _YOLO_CACHE[model_key]
    img_np = np.array(image_pil.convert('RGB'))
    results = model(img_np, verbose=False)

    canvas = np.zeros((target_h, target_w, 3), dtype=np.uint8)
    orig_h, orig_w = img_np.shape[:2]

    # Letterbox: scale uniformly so the skeleton maintains the reference image's
    # aspect ratio inside the target canvas (no stretching).
    _kp_scale  = min(target_w / orig_w, target_h / orig_h)
    _kp_off_x  = (target_w  - orig_w * _kp_scale) / 2.0
    _kp_off_y  = (target_h  - orig_h * _kp_scale) / 2.0

    def _kp_to_canvas(x, y):
        return float(x * _kp_scale + _kp_off_x), float(y * _kp_scale + _kp_off_y)

    n_people = 0
    if results and results[0].keypoints is not None:
        kps_all = results[0].keypoints.data.cpu().numpy()  # (N, 17, 3): x, y, conf
        n_people = kps_all.shape[0]
        print(f'[controlnet] YOLO detected {n_people} person(s)', flush=True)
        logs.append(f'[controlnet] YOLO detected {n_people} person(s)')

        # DWPose reference output is at detect_resolution=512; stickwidth=4 at 512px.
        # Scale proportionally so skeleton thickness matches training data at any resolution.
        _ref_res   = 512
        _cur_res   = min(target_w, target_h)
        stickwidth = max(2, round(4 * _cur_res / _ref_res))
        kp_radius  = max(2, round(4 * _cur_res / _ref_res))
        _CONF_THRESH = 0.25  # same as original COCO-17 code; 0.1 let in noisy detections

        _COCO_KP_NAMES = [
            'Nose','L-Eye','R-Eye','L-Ear','R-Ear',
            'L-Shld','R-Shld','L-Elbow','R-Elbow','L-Wrist','R-Wrist',
            'L-Hip','R-Hip','L-Knee','R-Knee','L-Ankle','R-Ankle',
        ]

        for kps in kps_all:
            # Log low-confidence joints so we can diagnose missing skeleton parts
            _low = [_COCO_KP_NAMES[i] for i in range(17) if kps[i, 2] < _CONF_THRESH]
            if _low:
                msg = f'[controlnet] Low-conf joints (not drawn): {", ".join(_low)}'
                print(msg, flush=True)
                logs.append(msg)

            # Build OpenPose-18 keypoints from COCO-17 using letterbox mapping
            op: list = []
            for op_i, coco_i in enumerate(_COCO_TO_OP18):
                if coco_i is None:
                    # Neck = midpoint of L-Shoulder (COCO 5) and R-Shoulder (COCO 6)
                    ls, rs = kps[5], kps[6]
                    if ls[2] > _CONF_THRESH and rs[2] > _CONF_THRESH:
                        cx, cy = _kp_to_canvas((ls[0]+rs[0])/2, (ls[1]+rs[1])/2)
                        op.append((cx, cy, min(ls[2], rs[2])))
                    elif ls[2] > _CONF_THRESH:
                        cx, cy = _kp_to_canvas(ls[0], ls[1])
                        op.append((cx, cy, float(ls[2]) * 0.5))
                    elif rs[2] > _CONF_THRESH:
                        cx, cy = _kp_to_canvas(rs[0], rs[1])
                        op.append((cx, cy, float(rs[2]) * 0.5))
                    else:
                        op.append((0.0, 0.0, 0.0))
                else:
                    x, y, c = kps[coco_i]
                    cx, cy = _kp_to_canvas(x, y)
                    op.append((cx, cy, float(c)))

            # Draw limbs as thick ovals (matches draw_bodypose visual style exactly)
            for limb_i, (a, b) in enumerate(_OP_LIMBS):
                xa, ya, ca = op[a]
                xb, yb, cb = op[b]
                if ca < _CONF_THRESH or cb < _CONF_THRESH:
                    continue
                xa, ya, xb, yb = int(xa), int(ya), int(xb), int(yb)
                mx, my = (xa+xb)//2, (ya+yb)//2
                length = int(((xa-xb)**2 + (ya-yb)**2)**0.5)
                if length < 3:
                    continue
                half_len = max(1, length // 2)
                angle    = int(math.degrees(math.atan2(ya-yb, xa-xb)))
                poly     = cv2.ellipse2Poly((mx, my), (half_len, stickwidth), angle, 0, 360, 1)
                if poly is None or len(poly) < 3:
                    continue
                cur    = canvas.copy()
                cv2.fillConvexPoly(cur, poly, _OP_LIMB_COLORS[limb_i])
                canvas = cv2.addWeighted(canvas, 0.4, cur, 0.6, 0)

            # Draw keypoint circles
            for ki, (x, y, c) in enumerate(op):
                if c < _CONF_THRESH:
                    continue
                cv2.circle(canvas, (int(x), int(y)), kp_radius, _OP_KP_COLORS[ki], -1, cv2.LINE_AA)

    if n_people == 0:
        msg = '[controlnet] YOLO: no person detected in reference image — skipping pose condition'
        print(msg, flush=True)
        logs.append(msg)
        raise RuntimeError('YOLO detected no person in the pose reference image. Use a clearer photo of a person.')

    return Image.fromarray(canvas)


def _extract_control_image(image_pil, mode: str, target_w: int, target_h: int, logs: list):
    """
    Extract a ControlNet condition image from a PIL RGB image.
      pose  → YOLO-based OpenPose-style skeleton (black canvas)
      depth → MiDaS depth map via controlnet_aux
      canny → Canny edge map (OpenCV, no model)
    Returns a PIL RGB image sized target_w × target_h.
    """
    from PIL import Image
    import numpy as np

    logs.append(f'[controlnet] Extracting {mode} condition ({image_pil.width}×{image_pil.height})...')
    print(f'[controlnet] Extracting {mode}...', flush=True)

    detect_res = 512
    out_res    = max(target_w, target_h)

    if mode == 'pose':
        result = None

        # Try DWposeDetector.from_pretrained if ever available (properly rebuilt image)
        try:
            from controlnet_aux import DWposeDetector as _DWP
            if hasattr(_DWP, 'from_pretrained'):
                print('[controlnet] Using DWPose (from_pretrained)...', flush=True)
                _det  = _DWP.from_pretrained('yzd-v/DWPose', det_filename='yolox_l.onnx', pose_filename='dw-ll_ucoco_384.onnx')
                result = _det(image_pil, detect_resolution=512, image_resolution=out_res)
                logs.append('[controlnet] DWPose skeleton extracted.')
                print('[controlnet] DWPose done.', flush=True)
        except Exception as _dw_err:
            print(f'[controlnet] DWPose failed ({_dw_err}), using YOLO OpenPose-18...', flush=True)

        # Fallback: YOLO → OpenPose-18 format (correct skeleton format for ControlNet)
        if result is None:
            logs.append('[controlnet] Using YOLO → OpenPose-18 skeleton.')
            result = _yolo_pose_skeleton(image_pil, target_w, target_h, logs)

        if not isinstance(result, Image.Image):
            result = Image.fromarray(np.array(result))
        result = result.convert('RGB').resize((target_w, target_h), Image.LANCZOS)
        logs.append(f'[controlnet] Pose condition ready: {result.width}×{result.height}')
        return result

    elif mode == 'depth':
        try:
            from controlnet_aux import MidasDetector
            if hasattr(MidasDetector, 'from_pretrained'):
                det = MidasDetector.from_pretrained('lllyasviel/Annotators')
            else:
                det = MidasDetector()
            result = det(image_pil, detect_resolution=detect_res, image_resolution=out_res)
        except Exception as _depth_err:
            raise RuntimeError(f'MiDaS depth extraction failed: {_depth_err}')

    elif mode == 'canny':
        import cv2
        img_cv = cv2.cvtColor(np.array(image_pil.convert('RGB')), cv2.COLOR_RGB2BGR)
        edges  = cv2.Canny(img_cv, 100, 200)
        result = Image.fromarray(cv2.cvtColor(edges, cv2.COLOR_GRAY2RGB))

    else:
        raise ValueError(f'[controlnet] Unknown mode: {mode}')

    if not isinstance(result, Image.Image):
        result = Image.fromarray(np.array(result))

    result = result.convert('RGB').resize((target_w, target_h), Image.LANCZOS)
    logs.append(f'[controlnet] Condition ready: {result.width}×{result.height}')
    return result


def _tiled_img2img(pipe_i2i, image_pil, prompt: str, upscale_factor: int,
                   strength: float, steps: int, guidance: float,
                   seed, logs: list, target_px: int = 0):
    """
    Lanczos upscale then tiled img2img for detail enhancement.
    Tiles are 1024×1024 (Flux native resolution) with 128px feathered overlap.
    If target_px > 0, scales so the long side equals target_px (aspect-ratio safe).
    Otherwise multiplies dimensions by upscale_factor.
    """
    from PIL import Image
    import numpy as np
    import torch

    TILE = 1024
    OVER = 128
    STEP = TILE - OVER

    if target_px > 0:
        _long  = max(image_pil.width, image_pil.height)
        _scale = target_px / _long
        new_w  = max(1, round(image_pil.width  * _scale))
        new_h  = max(1, round(image_pil.height * _scale))
    else:
        new_w = image_pil.width  * upscale_factor
        new_h = image_pil.height * upscale_factor
    logs.append(f'[upscale] Lanczos {image_pil.width}×{image_pil.height} → {new_w}×{new_h}')
    big = image_pil.resize((new_w, new_h), Image.LANCZOS)

    canvas  = np.zeros((new_h, new_w, 3), dtype=np.float32)
    weights = np.zeros((new_h, new_w, 1), dtype=np.float32)

    def _feather_1d(size, over):
        w    = np.ones(size, dtype=np.float32)
        ramp = np.linspace(0.0, 1.0, over + 2)[1:-1]
        w[:over]  = ramp
        w[-over:] = ramp[::-1]
        return w

    xs = list(range(0, max(new_w - OVER, 1), STEP))
    ys = list(range(0, max(new_h - OVER, 1), STEP))
    if not xs: xs = [0]
    if not ys: ys = [0]

    n_tiles = len(xs) * len(ys)
    logs.append(f'[upscale] Processing {n_tiles} tiles ({len(xs)} cols × {len(ys)} rows)...')

    tile_idx = 0
    for y_start in ys:
        for x_start in xs:
            # Clamp so last tiles always reach the image edge
            x1 = min(x_start, max(0, new_w - TILE))
            y1 = min(y_start, max(0, new_h - TILE))
            x2 = min(x1 + TILE, new_w)
            y2 = min(y1 + TILE, new_h)
            tw, th = x2 - x1, y2 - y1

            tile_crop = big.crop((x1, y1, x2, y2))
            if tw < TILE or th < TILE:
                padded = Image.new('RGB', (TILE, TILE))
                padded.paste(tile_crop, (0, 0))
                tile_in = padded
            else:
                tile_in = tile_crop

            tile_seed = (int(seed) + tile_idx) if seed is not None else None
            gen = torch.Generator('cuda').manual_seed(tile_seed) if tile_seed is not None else None

            out = pipe_i2i(
                prompt=prompt,
                image=tile_in,
                strength=strength,
                num_inference_steps=steps,
                guidance_scale=guidance,
                generator=gen,
                width=TILE,
                height=TILE,
            ).images[0]

            tile_arr = np.array(out, dtype=np.float32)[:th, :tw]
            wx = _feather_1d(tw, min(OVER, tw // 2))
            wy = _feather_1d(th, min(OVER, th // 2))
            w  = (wy[:, None] * wx[None, :])[:, :, None]

            canvas[y1:y2, x1:x2]  += tile_arr * w
            weights[y1:y2, x1:x2] += w

            tile_idx += 1
            logs.append(f'[upscale] Tile {tile_idx}/{n_tiles} ({x1},{y1})→({x2},{y2})')

    result_arr = (canvas / np.maximum(weights, 1e-8)).clip(0, 255).astype(np.uint8)
    from PIL import Image as _Img
    return _Img.fromarray(result_arr)


def _handle_inference(job_id: str, inp: dict) -> dict:
    """Run Flux image inference with optional LoRAs."""
    # OneTrainer's bundled diffusers has the QK-norm patch for transformer-only checkpoints
    sys.path.insert(0, '/workspace/OneTrainer/src/diffusers/src')

    import torch
    from diffusers import (FluxPipeline, FluxTransformer2DModel,
                           AutoencoderKL, FlowMatchEulerDiscreteScheduler)
    from transformers import CLIPTextModel, CLIPTokenizer, T5EncoderModel, T5Config, AutoTokenizer

    logs: list = []
    r2     = _r2()
    bucket = os.environ['R2_BUCKET_NAME']
    run_dir = os.path.join(WORK_DIR, job_id)
    os.makedirs(run_dir, exist_ok=True)
    os.makedirs(INFERENCE_CACHE, exist_ok=True)
    os.makedirs(MODELS_DIR, exist_ok=True)

    prompt          = inp.get('prompt', '')
    ckpt_key        = inp['checkpoint_r2_key']
    loras           = inp.get('loras', [])
    width           = int(inp.get('width', 1024))
    height          = int(inp.get('height', 1024))
    steps           = int(inp.get('steps', 20))
    guidance        = float(inp.get('guidance', 3.5))
    seed            = inp.get('seed')
    out_key         = inp.get('output_r2_key') or f'inference/outputs/{job_id}.png'
    # Post-processing options
    refine          = bool(inp.get('refine', False))
    refine_strength = float(inp.get('refine_strength', 0.3))
    upscale          = inp.get('upscale', 'none')
    upscale_strength = float(inp.get('upscale_strength', 0.3))
    _up              = str(upscale).lower()
    _FLUX_TARGET_PX  = {'2k': 2048, '4k': 4096, '5k': 5120, '6k': 6144, '8k': 8192}
    flux_target_px   = _FLUX_TARGET_PX.get(_up, 0)   # target long-side px; 0 = not flux-tiling mode
    upscale_factor   = flux_target_px                  # kept for pipe_i2i load gate (non-zero = needs flux)
    esrgan_factor    = {'2k-esrgan': 2, '4k-esrgan': 4}.get(_up, 0)
    do_combo         = (_up == 'combo')
    pipeline_steps   = inp.get('pipeline_steps', [])        # list of {type, ...} dicts
    do_pipeline      = bool(pipeline_steps) and _up == 'pipeline'
    esrgan_model     = inp.get('esrgan_model', 'x4plus')   # 'x4plus' | 'x2plus' | 'ultrasharp'
    combo_order      = inp.get('combo_order', 'flux-first') # 'flux-first' | 'esrgan-first'
    # ADetailer
    adetailer          = bool(inp.get('adetailer', False))
    adetailer_strength = float(inp.get('adetailer_strength', 0.35))
    # GFPGAN face restoration
    gfpgan_enabled = bool(inp.get('gfpgan', False))
    gfpgan_weight  = float(inp.get('gfpgan_weight', 0.8))
    # IP-Adapter
    ip_image_keys = inp.get('ip_adapter_images', [])   # list of base64 data URLs or R2 keys
    ip_scale      = float(inp.get('ip_adapter_scale', 0.6))
    # img2img from reference image
    img2img_image_b64 = inp.get('img2img_image', '')
    img2img_strength  = float(inp.get('img2img_strength', 0.65))
    # Inpainting — region-selective regeneration with a mask
    inpaint_image_b64 = inp.get('inpaint_image', '')
    inpaint_mask_b64  = inp.get('inpaint_mask',  '')
    inpaint_strength  = float(inp.get('inpaint_strength', 0.85))
    use_flux_fill     = bool(inp.get('use_flux_fill', False))
    # ControlNet — multi-condition
    controlnet_enabled    = bool(inp.get('controlnet', False))
    controlnet_conditions = inp.get('controlnet_conditions', [])             # [{mode, scale, image}]
    # Backward compat: single-condition legacy format
    if controlnet_enabled and not controlnet_conditions:
        _old_img = str(inp.get('controlnet_image', ''))
        if _old_img:
            controlnet_conditions = [{
                'mode':  inp.get('controlnet_mode', 'pose'),
                'scale': float(inp.get('controlnet_scale', 0.7)),
                'image': _old_img,
            }]
    # Unconditional debug
    print(f'[debug] upscale={upscale} do_pipeline={do_pipeline} n_pipeline_steps={len(pipeline_steps)} esrgan_model={esrgan_model} combo_order={combo_order} gfpgan={gfpgan_enabled} img2img={bool(img2img_image_b64)} ip_images={len(ip_image_keys)} controlnet={controlnet_enabled}/{len(controlnet_conditions)} conds width={width} height={height}', flush=True)

    print(f'[inference] Starting job {job_id} — handler {HANDLER_VERSION}', flush=True)
    logs.append(f'[inference] Starting job {job_id}')
    _flush_logs(r2, bucket, job_id, logs)

    # Decode img2img source image if provided
    img2img_pil = None
    if img2img_image_b64 and str(img2img_image_b64).startswith('data:image/'):
        try:
            from PIL import Image as _PIL_i2i, ImageOps as _IOP_i2i
            from io import BytesIO as _BIO_i2i
            import base64 as _b64_i2i
            _b64_data_i2i = img2img_image_b64.split(',', 1)[1]
            img2img_pil = _PIL_i2i.open(_BIO_i2i(_b64_i2i.b64decode(_b64_data_i2i))).convert('RGB')
            # ImageOps.fit scales proportionally then center-crops — no aspect ratio distortion
            img2img_pil = _IOP_i2i.fit(img2img_pil, (width, height), _PIL_i2i.LANCZOS)
            logs.append(f'[img2img] Source image decoded and fitted to {width}×{height} (center-crop, no stretch).')
        except Exception as _i2i_dec_err:
            logs.append(f'[img2img] Warning: failed to decode source image ({_i2i_dec_err}). Falling back to text2img.')
            img2img_pil = None

    # Decode inpaint source image and mask
    inpaint_pil      = None
    inpaint_mask_pil = None
    if inpaint_image_b64 and str(inpaint_image_b64).startswith('data:image/') and \
       inpaint_mask_b64  and str(inpaint_mask_b64).startswith('data:image/'):
        try:
            from PIL import Image as _PIL_ip
            from io import BytesIO as _BIO_ip
            import base64 as _b64_ip
            _img_data  = inpaint_image_b64.split(',', 1)[1]
            _mask_data = inpaint_mask_b64.split(',', 1)[1]
            inpaint_pil      = _PIL_ip.open(_BIO_ip(_b64_ip.b64decode(_img_data))).convert('RGB')
            inpaint_mask_pil = _PIL_ip.open(_BIO_ip(_b64_ip.b64decode(_mask_data))).convert('L')
            logs.append(f'[inpaint] Source {inpaint_pil.width}×{inpaint_pil.height}, mask {inpaint_mask_pil.width}×{inpaint_mask_pil.height} decoded.')
        except Exception as _ip_dec_err:
            logs.append(f'[inpaint] Warning: failed to decode inpaint images ({_ip_dec_err}) — skipping.')
            inpaint_pil = None; inpaint_mask_pil = None

    # Decode ControlNet source images (one per condition)
    _decoded_cn_conditions = []   # [{mode, scale, pil}]
    if controlnet_enabled and controlnet_conditions:
        from PIL import Image as _PIL_cn
        from io import BytesIO as _BIO_cn
        import base64 as _b64_cn
        for _ci, _cond in enumerate(controlnet_conditions):
            _cond_mode  = str(_cond.get('mode', 'pose')).lower()
            _cond_scale = float(_cond.get('scale', 0.7))
            _cond_b64   = str(_cond.get('image', ''))
            if not _cond_b64:
                logs.append(f'[controlnet] Condition {_ci + 1} has no image — skipped.')
                continue
            try:
                _raw_cn = _cond_b64.split(',', 1)[1] if ',' in _cond_b64 else _cond_b64
                _pil_cn = _PIL_cn.open(_BIO_cn(_b64_cn.b64decode(_raw_cn))).convert('RGB')
                _cond_mirror = bool(_cond.get('mirror', False))
                if _cond_mirror:
                    _pil_cn = _pil_cn.transpose(_PIL_cn.FLIP_LEFT_RIGHT)
                    logs.append(f'[controlnet] Condition {_ci + 1} mirrored horizontally.')
                logs.append(f'[controlnet] Condition {_ci + 1} decoded: mode={_cond_mode} scale={_cond_scale} mirror={_cond_mirror} size={_pil_cn.width}×{_pil_cn.height}')
                _decoded_cn_conditions.append({'mode': _cond_mode, 'scale': _cond_scale, 'pil': _pil_cn})
            except Exception as _cn_dec_err:
                logs.append(f'[controlnet] Warning: condition {_ci + 1} decode failed ({_cn_dec_err}) — skipped.')
        if not _decoded_cn_conditions:
            controlnet_enabled = False
            logs.append('[controlnet] No valid images decoded — ControlNet disabled.')

    # 1. Checkpoint — cached by filename so warm workers skip the download
    ckpt_filename = ckpt_key.split('/')[-1]
    ckpt_path = os.path.join(INFERENCE_CACHE, ckpt_filename)
    if not os.path.exists(ckpt_path):
        logs.append(f'[inference] Downloading checkpoint {ckpt_filename}...')
        _flush_logs(r2, bucket, job_id, logs)
        if not _download(r2, ckpt_key, ckpt_path, 'checkpoint', logs):
            _flush_logs(r2, bucket, job_id, logs)
            return {'success': False, 'error': 'Checkpoint download failed', 'logs': logs}
    else:
        logs.append(f'[inference] Checkpoint cached: {ckpt_filename}')
    _flush_logs(r2, bucket, job_id, logs)

    # 2. LoRAs (job-specific, not cached)
    lora_paths = []
    for i, lora in enumerate(loras):
        lora_path = os.path.join(run_dir, f'lora_{i}.safetensors')
        if not _download(r2, lora['r2_key'], lora_path, f"LoRA {i+1}", logs):
            _flush_logs(r2, bucket, job_id, logs)
            return {'success': False, 'error': f"LoRA {i+1} download failed", 'logs': logs}
        lora_paths.append({'path': lora_path, 'strength': float(lora.get('strength', 1.0))})
    _flush_logs(r2, bucket, job_id, logs)

    # 3. Load pipeline — cache by checkpoint path so warm workers skip the reload.
    # LoRA weights are saved before each job and restored after, so the cached
    # pipeline is always clean at the start of a new job.
    # FluxFillPipeline has a different transformer architecture (extra inpaint channels)
    # so it gets its own cache slot even for the same checkpoint file.
    global _PIPE_CACHE
    ckpt_cache_key = f'{ckpt_path}::fill' if use_flux_fill else ckpt_path

    if ckpt_cache_key in _PIPE_CACHE:
        pipe = _PIPE_CACHE[ckpt_cache_key]
        logs.append('[inference] Pipeline cache hit — reusing loaded model.')
        _flush_logs(r2, bucket, job_id, logs)
    else:
        # Evict any previously cached pipeline (different checkpoint) to free VRAM
        if _PIPE_CACHE:
            logs.append('[inference] Evicting previous pipeline from VRAM cache...')
            _PIPE_CACHE.clear()
            torch.cuda.empty_cache()
            gc.collect()

        logs.append('[inference] Loading Flux pipeline...')
        _flush_logs(r2, bucket, job_id, logs)

        try:
            # Happy path: checkpoint includes all components.
            # FluxFillPipeline has a different transformer architecture (extra input channels
            # for the masked image) — it must be loaded with its own pipeline class.
            if use_flux_fill:
                from diffusers import FluxFillPipeline as _FluxFillPipeline
                pipe = _FluxFillPipeline.from_single_file(ckpt_path, torch_dtype=torch.bfloat16)
                logs.append('[inference] Full FluxFillPipeline loaded from checkpoint.')
            else:
                pipe = FluxPipeline.from_single_file(ckpt_path, torch_dtype=torch.bfloat16)
                logs.append('[inference] Full pipeline loaded from checkpoint.')

        except Exception as _first_err:
            if use_flux_fill:
                raise  # Fill requires a full pipeline checkpoint; no transformer-only fallback
            _COMPONENT_ERRORS = ('CLIPTextModel', 'AutoencoderKL', 'T5EncoderModel', 'SingleFileComponentError')
            if not any(x in str(_first_err) for x in _COMPONENT_ERRORS):
                raise  # unexpected error — surface it

            # Transformer-only checkpoint (common with community Flux models).
            logs.append('[inference] Checkpoint is transformer-only — fetching CLIP/T5/VAE from R2...')
            _flush_logs(r2, bucket, job_id, logs)

            clip_path = os.path.join(MODELS_DIR, 'clip_l.safetensors')
            t5_path   = os.path.join(MODELS_DIR, 't5xxl_fp8_e4m3fn.safetensors')
            vae_path  = os.path.join(MODELS_DIR, 'flux_vae.safetensors')

            for _r2key, _local, _label in [
                ('training/models/clip_l.safetensors',            clip_path, 'CLIP'),
                ('training/models/t5xxl_fp8_e4m3fn.safetensors',  t5_path,   'T5'),
                ('training/models/flux_vae.safetensors',           vae_path,  'VAE'),
            ]:
                if not os.path.exists(_local):
                    logs.append(f'[inference] Downloading {_label}...')
                    if not _download(r2, _r2key, _local, _label, logs):
                        _flush_logs(r2, bucket, job_id, logs)
                        return {'success': False, 'error': f'{_label} download failed', 'logs': logs}
                else:
                    logs.append(f'[inference] {_label} cached')
            _flush_logs(r2, bucket, job_id, logs)

            # CLIP text encoder
            logs.append('[inference] Loading CLIP...')
            try:
                clip = CLIPTextModel.from_single_file(clip_path, torch_dtype=torch.bfloat16)
            except Exception:
                clip = CLIPTextModel.from_pretrained('openai/clip-vit-large-patch14', torch_dtype=torch.bfloat16)
            tokenizer = CLIPTokenizer.from_pretrained('openai/clip-vit-large-patch14')

            # T5 text encoder — fp8 file, convert weights to bfloat16 at load time
            logs.append('[inference] Loading T5 (fp8 → bf16)...')
            _flush_logs(r2, bucket, job_id, logs)
            from safetensors.torch import load_file as _sf_load
            _t5_sd = _sf_load(t5_path)
            _t5_sd = {k: v.to(torch.bfloat16) for k, v in _t5_sd.items()}
            _t5_cfg = T5Config.from_pretrained('google/t5-v1_1-xxl')
            t5 = T5EncoderModel(_t5_cfg)
            t5.load_state_dict(_t5_sd, strict=False)
            t5 = t5.to(torch.bfloat16)
            tokenizer_2 = AutoTokenizer.from_pretrained('google/t5-v1_1-xxl')

            # Use embedded configs written to a temp dir — works on any image version.
            _vae_cfg_dir   = _get_embedded_config_dir('flux1dev_vae_config', _VAE_CONFIG)
            _trans_cfg_dir = _get_embedded_config_dir('flux1dev_transformer_config', _TRANSFORMER_CONFIG)
            logs.append(f'[inference] VAE config dir: {_vae_cfg_dir}')
            logs.append(f'[inference] Transformer config dir: {_trans_cfg_dir}')
            _flush_logs(r2, bucket, job_id, logs)

            # VAE — pass local config dir so from_single_file never hits HF
            logs.append('[inference] Loading VAE...')
            vae = AutoencoderKL.from_single_file(vae_path, config=_vae_cfg_dir, torch_dtype=torch.bfloat16)

            # Transformer from the custom checkpoint
            logs.append('[inference] Loading transformer from checkpoint...')
            _flush_logs(r2, bucket, job_id, logs)
            transformer = FluxTransformer2DModel.from_single_file(
                ckpt_path, config=_trans_cfg_dir, torch_dtype=torch.bfloat16
            )

            # Scheduler — hardcode Flux Dev params, no HF download needed
            scheduler = FlowMatchEulerDiscreteScheduler(
                num_train_timesteps=1000, shift=3.0, use_dynamic_shifting=True
            )

            logs.append('[inference] Assembling FluxPipeline from components...')
            pipe = FluxPipeline(
                scheduler=scheduler,
                text_encoder=clip,
                tokenizer=tokenizer,
                text_encoder_2=t5,
                tokenizer_2=tokenizer_2,
                vae=vae,
                transformer=transformer,
            )

        # Clear any fragmentation from previous failed jobs before moving to VRAM
        gc.collect()
        torch.cuda.empty_cache()
        logs.append(f'[inference] VRAM free before .to(cuda): {torch.cuda.mem_get_info()[0] / 1024**3:.2f} GB')
        _flush_logs(r2, bucket, job_id, logs)
        try:
            pipe = pipe.to('cuda')
        except torch.cuda.OutOfMemoryError as _oom:
            # Partial load may have consumed VRAM — purge and surface the error
            _PIPE_CACHE.pop(ckpt_cache_key, None)
            gc.collect()
            torch.cuda.empty_cache()
            raise RuntimeError(
                f'CUDA OOM moving pipeline to GPU: {_oom}. '
                f'VRAM free after cleanup: {torch.cuda.mem_get_info()[0] / 1024**3:.2f} GB'
            ) from _oom
        _PIPE_CACHE[ckpt_cache_key] = pipe
        logs.append('[inference] Pipeline ready (cached for reuse).')
        _flush_logs(r2, bucket, job_id, logs)

    # 4. Load LoRAs — manual weight merge.
    # Saved weights are stored on CPU so they don't consume VRAM.
    # LoRA deltas are also computed on CPU (A/B matrices are small) and only
    # the final result is moved to the GPU weight, avoiding large temporaries.
    _saved_weights: dict = {}  # mod_path → CPU tensor (original weight)
    if lora_paths:
        from safetensors.torch import load_file as _sf_load
        _module_dict = dict(pipe.transformer.named_modules())
        torch.cuda.empty_cache()

        for i, li in enumerate(lora_paths):
            logs.append(f'[inference] Applying LoRA {i+1} (strength {li["strength"]})...')
            _flush_logs(r2, bucket, job_id, logs)

            lora_sd = _sf_load(li['path'])

            # Log top-level + block key samples to confirm exact format
            _sample_top = [k for k in lora_sd if ('lora_down' in k or 'lora_A' in k)
                           and not re.search(r'\d', k)][:3]
            _sample_blk = [k for k in lora_sd if ('lora_down' in k or 'lora_A' in k)
                           and re.search(r'\d', k)][:3]
            print(f'[inference] LoRA {i+1} top-level key sample: {_sample_top}', flush=True)
            print(f'[inference] LoRA {i+1} block key sample:     {_sample_blk}', flush=True)
            logs.append(f'[inference] LoRA top-level key sample: {_sample_top}')
            logs.append(f'[inference] LoRA block key sample: {_sample_blk}')

            # Group A/B pairs — support both kohya (lora_down/up) and diffusers (lora_A/B)
            _pairs: dict = {}
            for _k, _v in lora_sd.items():
                for _sfx, _side in [('.lora_down.weight', 'A'), ('.lora_up.weight', 'B'),
                                     ('.lora_A.weight',    'A'), ('.lora_B.weight',  'B')]:
                    if _k.endswith(_sfx):
                        _pairs.setdefault(_k[:-len(_sfx)], {})[_side] = _v
                        break

            _applied = _skipped = 0
            _first_skipped: str | None = None
            for _base, _pair in _pairs.items():
                if 'A' not in _pair or 'B' not in _pair:
                    continue

                # Resolve to diffusers module path
                _mod_path = _kohya_key_to_module_path(_base)
                if _mod_path is None and _base.startswith('transformer.'):
                    _mod_path = _base[len('transformer.'):]
                # Direct fallback: if rest of lora_transformer_ key is already a valid path
                if _mod_path is None and _base.startswith('lora_transformer_'):
                    _cand = _base[len('lora_transformer_'):]
                    if _cand in _module_dict:
                        _mod_path = _cand

                if not _mod_path:
                    if _first_skipped is None:
                        _first_skipped = _base
                    _skipped += 1
                    continue

                _mod = _module_dict.get(_mod_path)
                if not isinstance(_mod, torch.nn.Linear):
                    if _first_skipped is None:
                        _first_skipped = _base
                    _skipped += 1
                    continue

                _alpha_key = _base + '.alpha'
                if _alpha_key in lora_sd:
                    _rank = _pair['A'].shape[0]
                    _scale = li['strength'] * float(lora_sd[_alpha_key]) / _rank
                else:
                    _scale = li['strength']

                # Save original weight on CPU — keeps VRAM free for inference
                if _mod_path not in _saved_weights:
                    _saved_weights[_mod_path] = _mod.weight.data.cpu()

                # Compute delta on CPU to avoid allocating a large GPU temporary.
                # A/B are small (rank × dim), so CPU matmul is negligible overhead.
                _A_cpu = _pair['A'].to(torch.float32)
                _B_cpu = _pair['B'].to(torch.float32)
                _delta = (_scale * (_B_cpu @ _A_cpu)).to(
                    device=_mod.weight.device, dtype=_mod.weight.dtype
                )
                with torch.no_grad():
                    _mod.weight.data += _delta
                del _delta, _A_cpu, _B_cpu
                _applied += 1

            print(f'[inference] LoRA {i+1}: {_applied} pairs merged, {_skipped} skipped', flush=True)
            logs.append(f'[inference] LoRA {i+1}: {_applied} pairs merged, {_skipped} skipped')
            if _first_skipped is not None:
                print(f'[inference] LoRA {i+1} first skipped key: {_first_skipped}', flush=True)
                logs.append(f'[inference] LoRA {i+1} first skipped key: {_first_skipped}')
            _flush_logs(r2, bucket, job_id, logs)

    # Load FluxImg2ImgPipeline for img2img/refine/tiled upscale/combo/adetailer (shares weights — no extra VRAM)
    pipe_i2i = None
    _pipeline_needs_flux = do_pipeline and any(str(s.get('type', '')).lower() == 'flux' for s in pipeline_steps)
    # Fill pipeline handles inpainting natively — no separate img2img pipeline needed for that.
    _needs_i2i = refine or upscale_factor > 0 or adetailer or img2img_pil is not None or do_combo or _pipeline_needs_flux
    if not use_flux_fill:
        _needs_i2i = _needs_i2i or (inpaint_pil is not None)
    if _needs_i2i:
        try:
            from diffusers import FluxImg2ImgPipeline
            pipe_i2i = FluxImg2ImgPipeline(**pipe.components)
            logs.append('[inference] FluxImg2ImgPipeline ready.')
        except Exception as _i2i_err:
            logs.append(f'[inference] Warning: FluxImg2ImgPipeline unavailable ({_i2i_err}). Refine/upscale skipped.')
        _flush_logs(r2, bucket, job_id, logs)

    # Inpaint uses pipe_i2i (img2img + numpy mask composite) — no separate pipeline needed

    # 5. Load IP-Adapter if reference images provided
    ip_adapter_loaded = False
    ip_ref_image      = None
    if ip_image_keys:
        try:
            from PIL import Image as _PilImg
            from io import BytesIO as _BytesIO
            import base64 as _b64mod
            _ref_imgs = []
            for _ik in ip_image_keys[:3]:
                try:
                    if str(_ik).startswith('data:image/'):
                        # Base64 data URL — decode directly (no R2 download needed)
                        _b64_data = _ik.split(',', 1)[1]
                        _ref_imgs.append(_PilImg.open(_BytesIO(_b64mod.b64decode(_b64_data))).convert('RGB'))
                    else:
                        # R2 key — download file
                        _rp = os.path.join(run_dir, f'ref_{len(_ref_imgs)}.png')
                        if _download(r2, _ik, _rp, 'ref image', logs):
                            _ref_imgs.append(_PilImg.open(_rp).convert('RGB'))
                except Exception as _re:
                    logs.append(f'[ip_adapter] Warning: could not load ref image: {_re}')

            if _ref_imgs:
                IP_ADAPTER_PATH = os.path.join(MODELS_DIR, 'ip_adapter')
                CLIP_PATH       = os.path.join(MODELS_DIR, 'clip_vision')

                # Download IP-Adapter weights on first use (cached in MODELS_DIR)
                ip_bin = os.path.join(IP_ADAPTER_PATH, 'ip_adapter.bin')
                if not os.path.exists(ip_bin):  # noqa
                    logs.append('[ip_adapter] First use — downloading IP-Adapter weights...')
                    _flush_logs(r2, bucket, job_id, logs)
                    from huggingface_hub import hf_hub_download as _hf_dl
                    os.makedirs(IP_ADAPTER_PATH, exist_ok=True)
                    _hf_dl('InstantX/FLUX.1-dev-IP-Adapter', 'ip_adapter.bin',
                           local_dir=IP_ADAPTER_PATH)
                    logs.append('[ip_adapter] IP-Adapter weights cached.')

                # Download CLIP vision encoder on first use (~650 MB, one-time)
                if not os.path.exists(os.path.join(CLIP_PATH, 'config.json')):
                    logs.append('[ip_adapter] First use — downloading CLIP vision encoder (~650 MB)...')
                    _flush_logs(r2, bucket, job_id, logs)
                    from transformers import CLIPVisionModelWithProjection as _CLIP
                    _clip_model = _CLIP.from_pretrained('openai/clip-vit-large-patch14')
                    _clip_model.save_pretrained(CLIP_PATH)
                    del _clip_model
                    logs.append('[ip_adapter] CLIP vision encoder cached.')

                logs.append(f'[ip_adapter] Loading with scale={ip_scale}, {len(_ref_imgs)} ref image(s)...')
                _flush_logs(r2, bucket, job_id, logs)
                pipe.load_ip_adapter(
                    IP_ADAPTER_PATH,
                    weight_name='ip_adapter.bin',
                    image_encoder_pretrained_model_name_or_path=CLIP_PATH,
                )
                pipe.set_ip_adapter_scale(ip_scale)
                if pipe_i2i is not None:
                    pipe_i2i.set_ip_adapter_scale(ip_scale)
                ip_ref_image      = _ref_imgs[0] if len(_ref_imgs) == 1 else _ref_imgs
                ip_adapter_loaded = True
                logs.append('[ip_adapter] Ready.')
                _flush_logs(r2, bucket, job_id, logs)
        except Exception as _ip_err:
            logs.append(f'[ip_adapter] Warning: failed to load ({_ip_err}). Continuing without IP-Adapter.')
            _flush_logs(r2, bucket, job_id, logs)

    # 5b. Load ControlNet if requested (only applies to t2i base generation — not img2img)
    pipe_cn     = None
    ctrl_images = []
    ctrl_modes  = []
    ctrl_scales = []
    _CN_MODE_INT = {'canny': 0, 'depth': 2, 'pose': 4}
    if controlnet_enabled and _decoded_cn_conditions:
        try:
            CN_LOCAL_DIR = '/workspace/models/controlnet/flux-union'
            CN_MODEL_ID  = 'InstantX/FLUX.1-dev-Controlnet-Union'

            if 'union' not in _CN_CACHE:
                from diffusers import FluxControlNetModel
                from huggingface_hub import snapshot_download
                import os as _os_cn
                logs.append('[controlnet] Loading ControlNet Union model...')
                _flush_logs(r2, bucket, job_id, logs)
                if not _os_cn.path.exists(_os_cn.path.join(CN_LOCAL_DIR, 'config.json')):
                    logs.append(f'[controlnet] Downloading {CN_MODEL_ID} (~3.5 GB)...')
                    _flush_logs(r2, bucket, job_id, logs)
                    print(f'[controlnet] Downloading {CN_MODEL_ID}...', flush=True)
                    snapshot_download(CN_MODEL_ID, local_dir=CN_LOCAL_DIR)
                    print('[controlnet] Download complete.', flush=True)
                logs.append('[controlnet] Loading model weights...')
                _flush_logs(r2, bucket, job_id, logs)
                _cn_model = FluxControlNetModel.from_pretrained(CN_LOCAL_DIR, torch_dtype=torch.bfloat16).to('cuda')
                _CN_CACHE['union'] = _cn_model
                logs.append('[controlnet] ControlNet Union loaded and cached in VRAM.')
            else:
                _cn_model = _CN_CACHE['union']
                logs.append('[controlnet] Using cached ControlNet Union model.')

            # Use from_pipe() — properly inherits LoRA processors, IP-Adapter state, and
            # all other transformer hooks from the existing pipeline. Using **pipe.components
            # reinitializes attention processors and can overwrite LoRA adapters, causing
            # the fuzzy textures and quality degradation seen with **pipe.components.
            from diffusers import FluxControlNetPipeline
            try:
                pipe_cn = FluxControlNetPipeline.from_pipe(pipe, controlnet=_cn_model)
                logs.append('[controlnet] Pipeline created via from_pipe (LoRA state preserved).')
            except (AttributeError, TypeError) as _fp_err:
                logs.append(f'[controlnet] from_pipe unavailable ({_fp_err}), falling back to **components.')
                pipe_cn = FluxControlNetPipeline(**pipe.components, controlnet=_cn_model)

            # Free PyTorch's reserved-but-unallocated pool before the joint
            # Flux+ControlNet forward pass (fixes border-case CUDA OOM where
            # ~38 MiB is reserved but not yet allocated — empty_cache releases it).
            gc.collect()
            torch.cuda.empty_cache()
            try:
                pipe_cn.enable_attention_slicing(1)
                logs.append('[controlnet] Attention slicing enabled (reduces peak VRAM).')
            except Exception as _as_err:
                logs.append(f'[controlnet] Attention slicing not available: {_as_err}')
            _free_mb = (torch.cuda.get_device_properties(0).total_memory - torch.cuda.memory_allocated()) / 1e6
            logs.append(f'[controlnet] Free VRAM before inference: ~{_free_mb:.0f} MB')
            _flush_logs(r2, bucket, job_id, logs)

            # Extract condition map from each decoded source image
            import io as _io_cn
            for _cond in _decoded_cn_conditions:
                try:
                    _ci_img = _extract_control_image(_cond['pil'], _cond['mode'], width, height, logs)
                    ctrl_images.append(_ci_img)
                    ctrl_modes.append(_CN_MODE_INT.get(_cond['mode'], 4))
                    ctrl_scales.append(_cond['scale'])
                    _sc = _cond['scale']
                    logs.append(f"[controlnet] Extracted {_cond['mode']} condition — scale={_sc}")
                    if _sc > 0.5:
                        logs.append(f"[controlnet] WARNING: scale={_sc} is high — quality degrades above 0.5 (especially with LoRA). Try 0.2–0.4.")
                        print(f"[controlnet] WARNING: high scale={_sc}", flush=True)

                    # Save condition image to R2 so it can be inspected
                    try:
                        _ci_buf = _io_cn.BytesIO()
                        _ci_img.save(_ci_buf, format='WEBP', quality=90)
                        _ci_buf.seek(0)
                        _ci_dbg_key = f'debug/cn_{_cond["mode"]}_{job_id}.webp'
                        r2.upload_fileobj(_ci_buf, bucket, _ci_dbg_key,
                                          ExtraArgs={'ContentType': 'image/webp'})
                        logs.append(f"[controlnet] Condition image saved → R2 key: {_ci_dbg_key}")
                        print(f'[controlnet] Skeleton saved to R2: {_ci_dbg_key}', flush=True)
                    except Exception as _ci_sv_err:
                        logs.append(f'[controlnet] Could not save condition preview: {_ci_sv_err}')

                except Exception as _cond_err:
                    print(f"[controlnet] Skipping {_cond['mode']} condition: {_cond_err}", flush=True)
                    logs.append(f"[controlnet] Skipped {_cond['mode']} condition: {_cond_err}")

            logs.append(f'[controlnet] Ready — {len(ctrl_images)} condition(s)')
            _flush_logs(r2, bucket, job_id, logs)

        except Exception as _cn_err:
            logs.append(f'[controlnet] Warning: setup failed ({_cn_err}) — falling back to standard generation.')
            print(f'[controlnet] ERROR: {_cn_err}', flush=True)
            import traceback as _cn_tb; _cn_tb.print_exc()
            pipe_cn     = None
            ctrl_images = []
            ctrl_modes  = []
            ctrl_scales = []
            _flush_logs(r2, bucket, job_id, logs)

    _inf_error: Exception | None = None
    try:
        # 6. Base generation (img2img or text2img)
        gen = torch.Generator('cuda').manual_seed(int(seed)) if seed is not None else None
        if inpaint_pil is not None and inpaint_mask_pil is not None:
            if use_flux_fill:
                # FluxFillPipeline: trained for inpainting — sees context around the mask
                # and fills the masked region coherently. No composite step needed.
                logs.append(f'[inpaint] FluxFillPipeline native fill — {steps} steps, guidance={guidance}...')
                _flush_logs(r2, bucket, job_id, logs)
                image = pipe(
                    prompt=prompt,
                    image=inpaint_pil,
                    mask_image=inpaint_mask_pil,
                    height=inpaint_pil.height,
                    width=inpaint_pil.width,
                    num_inference_steps=steps,
                    guidance_scale=guidance,
                    generator=gen,
                ).images[0]
                logs.append(f'[inpaint] FluxFill done — {image.width}×{image.height}.')
            elif pipe_i2i is not None:
                # Flux Dev / non-Fill: img2img the crop then composite with the lasso mask.
                # white (255) = replace with generated, black (0) = keep original pixel.
                logs.append(f'[inpaint] img2img crop + mask composite — strength={inpaint_strength} ({steps} steps)...')
                _flush_logs(r2, bucket, job_id, logs)
                _inpainted_raw = pipe_i2i(
                    prompt=prompt,
                    image=inpaint_pil,
                    strength=inpaint_strength,
                    num_inference_steps=steps,
                    guidance_scale=guidance,
                    generator=gen,
                    width=inpaint_pil.width,
                    height=inpaint_pil.height,
                ).images[0]
                import numpy as _np_ip
                _img_arr  = _np_ip.array(_inpainted_raw).astype(_np_ip.float32)
                _orig_arr = _np_ip.array(inpaint_pil).astype(_np_ip.float32)
                _mask_f   = _np_ip.array(inpaint_mask_pil).astype(_np_ip.float32) / 255.0
                _mask_rgb = _np_ip.stack([_mask_f, _mask_f, _mask_f], axis=-1)
                _result   = _img_arr * _mask_rgb + _orig_arr * (1.0 - _mask_rgb)
                image     = Image.fromarray(_result.astype(_np_ip.uint8))
                logs.append(f'[inpaint] Done — {image.width}×{image.height}.')
        elif img2img_pil is not None and pipe_i2i is not None:
            logs.append(f'[img2img] Starting from reference image — strength={img2img_strength} ({steps} steps)...')
            _flush_logs(r2, bucket, job_id, logs)
            _base_kwargs: dict = dict(prompt=prompt, image=img2img_pil,
                                      strength=img2img_strength, num_inference_steps=steps,
                                      guidance_scale=guidance, generator=gen,
                                      width=width, height=height)
            if ip_ref_image is not None:
                _base_kwargs['ip_adapter_image'] = ip_ref_image
            image = pipe_i2i(**_base_kwargs).images[0]
            logs.append(f'[img2img] Done — {image.width}×{image.height}.')
        else:
            logs.append(f'[inference] Generating {width}×{height} ({steps} steps)...')
            _flush_logs(r2, bucket, job_id, logs)
            _pipe_kwargs: dict = dict(prompt=prompt, width=width, height=height,
                                      num_inference_steps=steps, guidance_scale=guidance, generator=gen)
            if ip_ref_image is not None:
                _pipe_kwargs['ip_adapter_image'] = ip_ref_image
            if pipe_cn is not None and ctrl_images:
                _n = len(ctrl_images)
                _pipe_kwargs['control_image']                 = ctrl_images[0] if _n == 1 else ctrl_images
                _pipe_kwargs['control_mode']                  = ctrl_modes[0]  if _n == 1 else ctrl_modes
                _pipe_kwargs['controlnet_conditioning_scale'] = ctrl_scales[0] if _n == 1 else ctrl_scales
                logs.append(f'[controlnet] Generating with {_n} ControlNet condition(s)...')
                _flush_logs(r2, bucket, job_id, logs)
                # control_guidance_start=0.25, end=0.75: ControlNet only guides the
                # middle 50% of steps. First 25% = LoRA establishes character.
                # Last 25% = LoRA/prompt-only refinement for sharpness/detail.
                try:
                    import diffusers as _dif_ver
                    logs.append(f'[controlnet] diffusers version: {_dif_ver.__version__}')
                    image = pipe_cn(**_pipe_kwargs,
                                   control_guidance_start=0.25,
                                   control_guidance_end=0.75).images[0]
                    logs.append('[controlnet] Used control_guidance_start=0.25, end=0.75.')
                except TypeError as _cg_err:
                    logs.append(f'[controlnet] control_guidance params not supported ({_cg_err}) — running full steps.')
                    image = pipe_cn(**_pipe_kwargs).images[0]
            else:
                image = pipe(**_pipe_kwargs).images[0]
            logs.append('[inference] Base generation done.')
        _flush_logs(r2, bucket, job_id, logs)

        # 5a. Optional refine pass (img2img at same resolution, low denoise)
        if refine and pipe_i2i is not None:
            logs.append(f'[inference] Refine pass — strength={refine_strength}...')
            _flush_logs(r2, bucket, job_id, logs)
            gen_r = torch.Generator('cuda').manual_seed(int(seed) + 1) if seed is not None else None
            image = pipe_i2i(
                prompt=prompt,
                image=image,
                strength=refine_strength,
                num_inference_steps=steps,
                guidance_scale=guidance,
                generator=gen_r,
                width=width,
                height=height,
            ).images[0]
            logs.append('[inference] Refine done.')
            _flush_logs(r2, bucket, job_id, logs)

        # 5b. Pre-fetch UltraSharp from R2 if it will be used and isn't cached locally.
        # HuggingFace repo Kim2091/4x-UltraSharp is private — R2 is the reliable source.
        _pipeline_uses_ultrasharp = do_pipeline and any(
            str(s.get('model', '')).lower() == 'ultrasharp' for s in pipeline_steps
            if str(s.get('type', '')).lower() == 'esrgan'
        )
        if esrgan_model == 'ultrasharp' and (do_combo or esrgan_factor > 0) or _pipeline_uses_ultrasharp:
            _us_local = '/workspace/models/esrgan/4x-UltraSharp.pth'
            if not os.path.exists(_us_local) or os.path.getsize(_us_local) < 10_000_000:
                _us_r2_key = 'training/models/esrgan/4x-UltraSharp.pth'
                logs.append(f'[esrgan] 4x-UltraSharp not cached — downloading from R2 ({_us_r2_key})...')
                _flush_logs(r2, bucket, job_id, logs)
                os.makedirs(os.path.dirname(_us_local), exist_ok=True)
                if not _download(r2, _us_r2_key, _us_local, '4x-UltraSharp', logs):
                    raise RuntimeError(
                        '4x-UltraSharp model not found in R2. '
                        f'Upload the file to your R2 bucket at: {_us_r2_key}'
                    )
                logs.append('[esrgan] 4x-UltraSharp cached locally.')
                _flush_logs(r2, bucket, job_id, logs)

        # 5b2. Pre-fetch any custom R2 ESRGAN models used in pipeline steps.
        if do_pipeline:
            _builtin_models = {'ultrasharp', 'x4plus', 'x2plus'}
            for _ps in pipeline_steps:
                if str(_ps.get('type', '')).lower() == 'esrgan':
                    _pm = str(_ps.get('model', ''))
                    if _pm and _pm not in _builtin_models:
                        _pm_path = f'/workspace/models/esrgan/{_pm}'
                        if not os.path.exists(_pm_path) or os.path.getsize(_pm_path) < 1_000_000:
                            _pm_key = f'training/models/esrgan/{_pm}'
                            logs.append(f'[esrgan] Pre-fetching custom model {_pm}...')
                            _flush_logs(r2, bucket, job_id, logs)
                            os.makedirs('/workspace/models/esrgan', exist_ok=True)
                            if not _download(r2, _pm_key, _pm_path, _pm, logs):
                                raise RuntimeError(f'Custom ESRGAN model not found in R2: {_pm_key}')
                            logs.append(f'[esrgan] {_pm} cached.')
                            print(f'[esrgan] Pre-fetched custom model {_pm}', flush=True)
                            _flush_logs(r2, bucket, job_id, logs)

        # 5c. Upscaling (Flux tiling, ESRGAN, or Combo)
        # ESRGAN target resolutions: '2k-esrgan' → 2048px long side, '4k-esrgan' → 3840px long side.
        # outscale is computed dynamically so the output always hits the target regardless of base size.
        _ESRGAN_TARGET_PX = {'2k-esrgan': 2160, '4k-esrgan': 4096}

        def _esrgan_target_outscale(img, upscale_key: str) -> float:
            target = _ESRGAN_TARGET_PX.get(upscale_key, 0)
            if not target:
                return float(esrgan_factor)  # fallback to fixed factor
            long_side = max(img.width, img.height)
            return max(1.0, target / long_side)

        if do_combo and pipe_i2i is not None:
            # Combo always targets ~4K (3840px long side) total.
            # flux-first:   Flux 2× → ESRGAN finishes at 3840px long side.
            # esrgan-first: ESRGAN targets 1920px long side → Flux 2× finishes at ~3840px.
            _COMBO_FINAL_PX = 4096
            if combo_order == 'flux-first':
                logs.append(f'[combo] Step 1/2 — Flux 2× tiling (strength={upscale_strength})...')
                _flush_logs(r2, bucket, job_id, logs)
                image = _tiled_img2img(pipe_i2i, image, prompt, 2, upscale_strength, steps, guidance, seed, logs)
                _esc = max(1.0, _COMBO_FINAL_PX / max(image.width, image.height))
                logs.append(f'[combo] Step 2/2 — ESRGAN to {_COMBO_FINAL_PX}px (outscale={_esc:.2f})...')
                _flush_logs(r2, bucket, job_id, logs)
                image = _esrgan_upscale(image, esrgan_model, _esc, logs)
            else:  # esrgan-first
                _esrgan_target = _COMBO_FINAL_PX // 2   # 1920px — Flux 2× will finish at ~3840px
                _esc = max(1.0, _esrgan_target / max(image.width, image.height))
                logs.append(f'[combo] Step 1/2 — ESRGAN to {_esrgan_target}px (outscale={_esc:.2f})...')
                _flush_logs(r2, bucket, job_id, logs)
                image = _esrgan_upscale(image, esrgan_model, _esc, logs)
                logs.append(f'[combo] Step 2/2 — Flux 2× tiling (strength={upscale_strength})...')
                _flush_logs(r2, bucket, job_id, logs)
                image = _tiled_img2img(pipe_i2i, image, prompt, 2, upscale_strength, steps, guidance, seed, logs)
            logs.append(f'[combo] Done — {image.width}×{image.height}')
            _flush_logs(r2, bucket, job_id, logs)

        elif flux_target_px > 0 and pipe_i2i is not None:
            logs.append(f'[inference] Flux tiled → {flux_target_px}px long side (strength={upscale_strength})...')
            _flush_logs(r2, bucket, job_id, logs)
            image = _tiled_img2img(pipe_i2i, image, prompt, 1, upscale_strength, steps, guidance, seed, logs, target_px=flux_target_px)
            logs.append(f'[inference] Tiling done — {image.width}×{image.height}')
            _flush_logs(r2, bucket, job_id, logs)

        elif esrgan_factor > 0:
            _outscale = _esrgan_target_outscale(image, _up)
            _target_px = _ESRGAN_TARGET_PX.get(_up, 0)
            logs.append(f'[inference] ESRGAN → {_target_px}px long-side (outscale={_outscale:.2f}, model={esrgan_model})...')
            _flush_logs(r2, bucket, job_id, logs)
            image = _esrgan_upscale(image, esrgan_model, _outscale, logs)
            logs.append(f'[inference] ESRGAN done — {image.width}×{image.height}')
            _flush_logs(r2, bucket, job_id, logs)

        elif do_pipeline:
            # Custom multi-step pipeline: each step is {type, ...}
            # Flux step:  {type:'flux',   upscale_factor:1|2, strength:float}
            # ESRGAN step:{type:'esrgan', model:str,          target_px:int}
            _n_steps = len(pipeline_steps)
            logs.append(f'[pipeline] Starting {_n_steps}-step custom pipeline...')
            _flush_logs(r2, bucket, job_id, logs)
            for _step_i, _step in enumerate(pipeline_steps):
                _step_type = str(_step.get('type', 'flux')).lower()
                _step_num  = _step_i + 1
                if _step_type == 'flux':
                    if pipe_i2i is None:
                        logs.append(f'[pipeline] Step {_step_num}/{_n_steps} — Flux skipped (no img2img pipeline)')
                        continue
                    _sf = max(1, int(_step.get('upscale_factor', 2)))
                    _ss = max(0.05, min(0.95, float(_step.get('strength', 0.35))))
                    logs.append(f'[pipeline] Step {_step_num}/{_n_steps} — Flux {_sf}× tiling (strength={_ss:.2f})')
                    _flush_logs(r2, bucket, job_id, logs)
                    image = _tiled_img2img(pipe_i2i, image, prompt, _sf, _ss, steps, guidance, seed, logs)
                    logs.append(f'[pipeline] Step {_step_num} done — {image.width}×{image.height}')
                elif _step_type == 'esrgan':
                    _sm  = str(_step.get('model', 'ultrasharp'))
                    _tp  = int(_step.get('target_px', 0))
                    _long = max(image.width, image.height)
                    _native = 2.0 if _sm == 'x2plus' else 4.0
                    _esc  = max(1.0, _tp / _long) if _tp > 0 else _native
                    logs.append(f'[pipeline] Step {_step_num}/{_n_steps} — ESRGAN ({_sm}) target={_tp}px outscale={_esc:.2f}')
                    _flush_logs(r2, bucket, job_id, logs)
                    image = _esrgan_upscale(image, _sm, _esc, logs)
                    logs.append(f'[pipeline] Step {_step_num} done — {image.width}×{image.height}')
                else:
                    logs.append(f'[pipeline] Step {_step_num}/{_n_steps} — unknown type "{_step_type}", skipping')
                _flush_logs(r2, bucket, job_id, logs)
            logs.append(f'[pipeline] All {_n_steps} steps complete — final: {image.width}×{image.height}')
            _flush_logs(r2, bucket, job_id, logs)

        # 6d. Optional ADetailer face fix
        if adetailer and pipe_i2i is not None:
            logs.append(f'[inference] ADetailer — strength={adetailer_strength}...')
            _flush_logs(r2, bucket, job_id, logs)
            image = _adetailer_fix_faces(pipe_i2i, image, prompt, adetailer_strength, steps, guidance, seed, logs)
            _flush_logs(r2, bucket, job_id, logs)

        # 6e. Optional GFPGAN face restoration (runs after ADetailer for best results)
        if gfpgan_enabled:
            logs.append(f'[inference] GFPGAN restoration (weight={gfpgan_weight:.2f})...')
            _flush_logs(r2, bucket, job_id, logs)
            image = _gfpgan_restore(image, gfpgan_weight, logs)
            _flush_logs(r2, bucket, job_id, logs)

        # 7. Upload result
        out_path = os.path.join(run_dir, 'output.png')
        print(f'[inference] Saving output — {image.width}×{image.height}', flush=True)
        image.save(out_path, format='PNG')
        print(f'[inference] Uploading to R2 ({out_key})...', flush=True)
        logs.append(f'[inference] Uploading to R2 ({out_key})...')
        r2.upload_file(out_path, bucket, out_key)
        logs.append('[inference] Done.')
        print('[inference] Upload complete.', flush=True)

    except Exception as e:
        import traceback as _tb
        print(f'[inference] *** EXCEPTION: {e}', flush=True)
        _tb.print_exc()
        _inf_error = e

    finally:
        # Unload IP-Adapter so the cached pipeline is clean for the next job
        if ip_adapter_loaded:
            try:
                pipe.unload_ip_adapter()
                logs.append('[ip_adapter] Unloaded.')
            except Exception as _ipe:
                logs.append(f'[ip_adapter] Warning: unload error: {_ipe}')

        # Restore LoRA-modified weights from CPU storage so the cached pipeline is clean
        if _saved_weights:
            try:
                _rm = dict(pipe.transformer.named_modules())
                for _rp, _rw in _saved_weights.items():
                    _rm_mod = _rm.get(_rp)
                    if _rm_mod is not None:
                        _rm_mod.weight.data.copy_(
                            _rw.to(device=_rm_mod.weight.device, dtype=_rm_mod.weight.dtype)
                        )
                del _saved_weights
                torch.cuda.empty_cache()
                logs.append(f'[inference] LoRA weights restored.')
            except Exception as _re:
                logs.append(f'[inference] Warning: weight restore error: {_re}')
        _flush_logs(r2, bucket, job_id, logs)

    if _inf_error:
        return {'success': False, 'error': str(_inf_error), 'logs': logs}

    shutil.rmtree(run_dir, ignore_errors=True)
    return {'success': True, 'output_r2_key': out_key, 'logs': logs}


def _handle_download_to_r2(job_id: str, inp: dict):
    """
    Download a URL and upload the bytes directly to R2.
    Input: { action, url, r2_key, civitai_token? }
    """
    import io
    import urllib.parse
    import requests as _req

    url            = inp.get('url', '')
    r2_key         = inp.get('r2_key', '')
    civitai_token  = inp.get('civitai_token', '') or ''
    bucket  = os.environ['R2_BUCKET_NAME']
    r2      = _r2()

    if not url or not r2_key:
        return {'success': False, 'error': 'url and r2_key are required'}

    # Append token as query param (civitai.com and mirrors authenticate this way)
    if civitai_token:
        sep = '&' if '?' in url else '?'
        url = f'{url}{sep}token={urllib.parse.quote(civitai_token)}'

    # Build a base URL for logging (strip token value)
    log_url = url.split('token=')[0] + ('token=***' if civitai_token else '')
    print(f'[download] Fetching: {log_url}', flush=True)
    print(f'[download] Target R2 key: {r2_key}', flush=True)

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': url.split('/api/')[0] + '/' if '/api/' in url else url,
    }

    with _req.get(url, headers=headers, stream=True, timeout=3600, allow_redirects=True) as resp:
        if not resp.ok:
            raise RuntimeError(f'HTTP {resp.status_code} {resp.reason} from {log_url}')

        content_length = resp.headers.get('Content-Length')
        total_mb_str = f'{int(content_length) / 1024**2:.0f} MB' if content_length else 'unknown size'
        print(f'[download] Size: {total_mb_str}', flush=True)

        chunk_size = 16 * 1024 * 1024  # 16 MB
        downloaded = 0
        buf = io.BytesIO()
        for chunk in resp.iter_content(chunk_size=chunk_size):
            if not chunk:
                continue
            buf.write(chunk)
            downloaded += len(chunk)
            if downloaded % (256 * 1024 * 1024) < chunk_size:
                print(f'[download] {downloaded / 1024**2:.0f} MB downloaded...', flush=True)

    total_downloaded = downloaded / 1024**2
    print(f'[download] Download complete: {total_downloaded:.0f} MB', flush=True)

    buf.seek(0)
    print(f'[download] Uploading to R2 at {r2_key}...', flush=True)
    r2.upload_fileobj(buf, bucket, r2_key)
    print(f'[download] Upload complete.', flush=True)

    return {'success': True, 'r2_key': r2_key, 'size_mb': round(total_downloaded, 1)}


def handler(job):
    inp      = job['input']
    job_id   = job['id']
    logs     = []
    r2       = _r2()
    t0       = time.time()

    # dispatch inference jobs
    if inp.get('action') == 'inference':
        return _handle_inference(job['id'], inp)

    # download a URL and store it directly in R2 (bypasses slow home networks)
    if inp.get('action') == 'download_to_r2':
        return _handle_download_to_r2(job['id'], inp)


    run_name = inp.get('run_name', 'Training Run')
    config   = dict(inp['config'])
    concepts = inp['concepts']
    ckpt_key = inp['checkpoint_r2_key']
    out_key  = inp.get('output_r2_key') or f'training/loras/{run_name.replace(" ", "_")}.safetensors'
    bucket   = os.environ['R2_BUCKET_NAME']

    logs.append(f"[runpod] Starting '{run_name}' (job {job_id})")
    _flush_logs(r2, bucket, job_id, logs)

    # ── workspace dirs ──────────────────────────────────────────────────────
    run_dir      = os.path.join(WORK_DIR, job_id)
    dataset_root = os.path.join(run_dir, 'datasets')
    ckpt_path    = os.path.join(run_dir, 'checkpoint.safetensors')
    output_path  = os.path.join(run_dir, 'output.safetensors')
    os.makedirs(dataset_root, exist_ok=True)
    os.makedirs(MODELS_DIR, exist_ok=True)

    # ── 1. checkpoint ───────────────────────────────────────────────────────
    if not _download(r2, ckpt_key, ckpt_path, 'checkpoint', logs):
        _flush_logs(r2, bucket, job_id, logs)
        return {'success': False, 'error': 'Checkpoint download failed', 'logs': logs}
    _flush_logs(r2, bucket, job_id, logs)

    # ── 2. shared model files (cached across runs in MODELS_DIR) ────────────
    model_files = [
        ('training/models/clip_l.safetensors',          os.path.join(MODELS_DIR, 'clip_l.safetensors'),          'CLIP'),
        ('training/models/t5xxl_fp8_e4m3fn.safetensors', os.path.join(MODELS_DIR, 't5xxl_fp8_e4m3fn.safetensors'), 'T5'),
        ('training/models/flux_vae.safetensors',         os.path.join(MODELS_DIR, 'flux_vae.safetensors'),         'VAE'),
    ]
    for key, path, label in model_files:
        if os.path.exists(path):
            logs.append(f'[runpod] {label} already cached')
            continue
        if not _download(r2, key, path, label, logs):
            _flush_logs(r2, bucket, job_id, logs)
            return {'success': False, 'error': f'{label} download failed', 'logs': logs}
        _flush_logs(r2, bucket, job_id, logs)

    # tell FluxModelLoader where the model files are
    os.environ['CLIP_MODEL_DIR'] = MODELS_DIR
    os.environ['VAE_MODEL_DIR']  = MODELS_DIR

    # ── 3. datasets ─────────────────────────────────────────────────────────
    concept_dirs = []
    for c in concepts:
        zip_path    = os.path.join(run_dir, f"{c['name']}.zip")
        extract_dir = os.path.join(dataset_root, c['name'])
        if not _download(r2, c['r2_dataset_key'], zip_path, f"dataset '{c['name']}'", logs):
            _flush_logs(r2, bucket, job_id, logs)
            return {'success': False, 'error': f"Dataset download failed: {c['name']}", 'logs': logs}
        _flush_logs(r2, bucket, job_id, logs)
        os.makedirs(extract_dir, exist_ok=True)
        with zipfile.ZipFile(zip_path, 'r') as z:
            z.extractall(extract_dir)
        os.remove(zip_path)  # free space immediately after extraction

        # Auto-detect actual image directory (handles zip-with-root-folder)
        image_dir   = _find_image_dir(extract_dir)
        image_count = _count_images(image_dir)
        logs.append(f"[runpod] Dataset '{c['name']}': {image_count} images found at {image_dir}")
        if image_count == 0:
            _flush_logs(r2, bucket, job_id, logs)
            return {
                'success': False,
                'error': (
                    f"No images found in dataset '{c['name']}'. "
                    f"Check your zip structure — images must be .jpg/.jpeg/.png/.webp. "
                    f"Extracted to: {extract_dir}"
                ),
                'logs': logs,
            }
        _flush_logs(r2, bucket, job_id, logs)
        concept_dirs.append(image_dir)

    # ── 4. build config ─────────────────────────────────────────────────────
    config['base_model_name']          = ckpt_path
    config['output_model_destination'] = output_path
    config['output_model_format']      = config.get('output_model_format', 'SAFETENSORS')
    config.pop('concepts', None)

    concepts_payload = [
        {
            'name':    c['name'],
            'path':    concept_dirs[i],
            'repeats': c.get('repeats', 1),
            'text': {
                'prompt_source': c.get('prompt_source', 'sample'),
                'prompt_path':   c.get('prompt_path', ''),
            },
        }
        for i, c in enumerate(concepts)
    ]

    # Ensure component sections have weight_dtype so migration_9 doesn't KeyError
    # (Docker OT version uses dict access instead of .get(), and pop() without default)
    for _s in ['unet', 'prior', 'effnet_encoder', 'decoder', 'decoder_text_encoder', 'decoder_vqgan']:
        if _s not in config:
            config[_s] = {'weight_dtype': 'BFLOAT_16'}
        elif isinstance(config[_s], dict) and 'weight_dtype' not in config[_s]:
            config[_s]['weight_dtype'] = 'BFLOAT_16'
    if 'weight_dtype' not in config:
        config['weight_dtype'] = config.get('train_dtype', 'BFLOAT_16')
    config['tensorboard'] = False
    config['samples'] = []

    config_path   = os.path.join(run_dir, 'config.json')
    concepts_path = os.path.join(run_dir, 'concepts.json')
    config['concept_file_name'] = concepts_path

    with open(concepts_path, 'w') as f:
        json.dump(concepts_payload, f, indent=2)
    with open(config_path, 'w') as f:
        json.dump(config, f, indent=2)

    # ── 5. train ────────────────────────────────────────────────────────────
    logs.append('[runpod] Starting OneTrainer...')
    _flush_logs(r2, bucket, job_id, logs)
    env = {**os.environ, 'CUDA_VISIBLE_DEVICES': '0'}

    proc = subprocess.Popen(
        [sys.executable, os.path.join(OT_DIR, 'scripts', 'train.py'), '--config-path', config_path],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        cwd=OT_DIR,
        env=env,
    )
    flush_counter = 0
    for line in proc.stdout:
        line = line.rstrip()
        if line:
            logs.append(line)
            flush_counter += 1
            if flush_counter % 30 == 0:
                _flush_logs(r2, bucket, job_id, logs)
    proc.wait()

    elapsed = round((time.time() - t0) / 60, 1)
    logs.append(f'[runpod] Training finished in {elapsed} min (exit {proc.returncode})')
    _flush_logs(r2, bucket, job_id, logs)

    if proc.returncode != 0:
        return {'success': False, 'error': f'Training exited {proc.returncode}', 'logs': logs}

    # ── 6. upload result ────────────────────────────────────────────────────
    if not os.path.exists(output_path):
        return {'success': False, 'error': 'Output LoRA file not found', 'logs': logs}

    logs.append(f'[runpod] Uploading LoRA to R2 ({out_key})...')
    try:
        r2.upload_file(output_path, os.environ['R2_BUCKET_NAME'], out_key)
        logs.append('[runpod] Upload complete!')
    except Exception as e:
        return {'success': False, 'error': f'Upload failed: {e}', 'logs': logs}

    shutil.rmtree(run_dir, ignore_errors=True)

    return {
        'success':      True,
        'output_r2_key': out_key,
        'elapsed_min':  elapsed,
        'logs':         logs,
    }


if __name__ == '__main__':
    runpod.serverless.start({'handler': handler})
