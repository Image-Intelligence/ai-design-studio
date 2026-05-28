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

HANDLER_VERSION = '2026-05-28-v25'

# Must be set before any CUDA allocations — prevents fragmentation OOM on warm workers
os.environ.setdefault('PYTORCH_CUDA_ALLOC_CONF', 'expandable_segments:True')

_PIPE_CACHE:   dict = {}   # ckpt_path → FluxPipeline (reused across jobs on warm workers)
_YOLO_CACHE:  dict = {}   # model_path → YOLO instance
_GFPGAN_CACHE: dict = {}   # model_path → GFPGANer instance
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

    loadnet = torch.load(model_path, map_location=torch.device('cpu'))

    # Format 1 — Real-ESRGAN wrapper (always has conv_hr in basicsr weights)
    if isinstance(loadnet, dict):
        if 'params_ema' in loadnet:
            return loadnet['params_ema'], True
        if 'params' in loadnet:
            return loadnet['params'], True

    # Format 2 — already basicsr keys
    if isinstance(loadnet, dict) and 'conv_first.weight' in loadnet and 'body.0.rdb1.conv1.weight' in loadnet:
        has_hr = 'conv_hr.weight' in loadnet
        return loadnet, has_hr

    # Format 3 — original ESRGAN class (RRDB_trunk / trunk_conv / upconv / HRconv)
    if isinstance(loadnet, dict) and 'RRDB_trunk.0.RDB1.conv1.0.weight' in loadnet:
        logs.append('[esrgan] Converting original-ESRGAN format → basicsr format')
        sd = {}
        has_hr = 'HRconv.weight' in loadnet
        for k, v in loadnet.items():
            if 'res_scale' in k:
                continue
            m = _re.match(r'^RRDB_trunk\.(\d+)\.(RDB\d+)\.conv(\d+)\.0\.(.+)$', k)
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
        return sd, has_hr

    # Format 4 — sequential wrapper (model.0 / model.1.sub.N.RDBN / model.M…)
    if isinstance(loadnet, dict) and 'model.0.weight' in loadnet:
        logs.append('[esrgan] Converting sequential-ESRGAN format → basicsr format')
        sd = {}
        extra = {}  # model index → {param_suffix: tensor}
        for k, v in loadnet.items():
            if 'res_scale' in k:
                continue
            m = _re.match(r'^model\.0\.(.+)$', k)
            if m:
                sd[f'conv_first.{m.group(1)}'] = v
                continue
            m = _re.match(r'^model\.1\.sub\.(\d+)\.(RDB\d+)\.conv(\d+)\.0\.(.+)$', k)
            if m:
                sd[f'body.{m.group(1)}.{m.group(2).lower()}.conv{m.group(3)}.{m.group(4)}'] = v
                continue
            m = _re.match(r'^model\.(\d+)\.(.+)$', k)
            if m and int(m.group(1)) > 1:
                extra.setdefault(int(m.group(1)), {})[m.group(2)] = v

        num_extra = len(extra)
        if num_extra <= 4:
            # Old ESRGAN — no conv_hr layer: conv_body, conv_up1, conv_up2, conv_last
            targets  = ['conv_body', 'conv_up1', 'conv_up2', 'conv_last']
            has_hr   = False
            logs.append(f'[esrgan] {num_extra} extra conv layers — using legacy architecture (no conv_hr)')
        else:
            # Real-ESRGAN / basicsr style — includes conv_hr
            targets  = ['conv_body', 'conv_up1', 'conv_up2', 'conv_hr', 'conv_last']
            has_hr   = True
        for i, idx in enumerate(sorted(extra.keys())):
            if i < len(targets):
                for param, v in extra[idx].items():
                    sd[f'{targets[i]}.{param}'] = v
        return sd, has_hr

    # Unknown format — return raw; load_state_dict will surface the real error
    top = list(loadnet.keys())[:10] if isinstance(loadnet, dict) else str(type(loadnet))
    logs.append(f'[esrgan] WARNING: unrecognised checkpoint format, top keys: {top}')
    return loadnet, True


def _esrgan_upscale(image_pil, model_name: str, outscale: int, logs: list):
    """
    ESRGAN upscale.
    model_name: 'x4plus' | 'x2plus' | 'ultrasharp'
    outscale:   target output scale factor (can differ from model's native scale)
    """
    import numpy as np
    import cv2
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    from PIL import Image
    from basicsr.archs.rrdbnet_arch import RRDBNet, RRDB
    from realesrgan import RealESRGANer

    if model_name == 'ultrasharp':
        model_path  = '/workspace/models/esrgan/4x-UltraSharp.pth'
        model_scale = 4
    elif model_name == 'x2plus':
        model_path  = '/workspace/models/esrgan/RealESRGAN_x2plus.pth'
        model_scale = 2
    else:
        model_path  = '/workspace/models/esrgan/RealESRGAN_x4plus.pth'
        model_scale = 4

    logs.append(f'[esrgan] {outscale}× upscale ({model_name})...')

    state_dict, has_conv_hr = _esrgan_load_state_dict(model_path, logs)

    if has_conv_hr:
        # Standard basicsr RRDBNet (Real-ESRGAN x4plus / x2plus)
        model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64,
                        num_block=23, num_grow_ch=32, scale=model_scale)
    else:
        # Legacy ESRGAN architecture — no conv_hr layer between conv_up2 and conv_last.
        # Defined inline to avoid an extra dependency.
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
                feat = self.lrelu(self.conv_first(x))
                feat = self.conv_body(self.body(feat)) + feat
                feat = self.lrelu(self.conv_up1(F.interpolate(feat, scale_factor=2, mode='nearest')))
                feat = self.lrelu(self.conv_up2(F.interpolate(feat, scale_factor=2, mode='nearest')))
                return self.conv_last(feat)
        model = LegacyRRDBNet(scale=model_scale)

    model.load_state_dict(state_dict, strict=True)
    upsampler = RealESRGANer(
        scale=model_scale, model_path=None, model=model,
        tile=512, tile_pad=32, pre_pad=0, half=True,
    )

    img_bgr = cv2.cvtColor(np.array(image_pil), cv2.COLOR_RGB2BGR)
    output_bgr, _ = upsampler.enhance(img_bgr, outscale=outscale)
    result = Image.fromarray(cv2.cvtColor(output_bgr, cv2.COLOR_BGR2RGB))
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


def _tiled_img2img(pipe_i2i, image_pil, prompt: str, upscale_factor: int,
                   strength: float, steps: int, guidance: float,
                   seed, logs: list):
    """
    Lanczos upscale then tiled img2img for detail enhancement.
    Tiles are 1024×1024 (Flux native resolution) with 128px feathered overlap.
    """
    from PIL import Image
    import numpy as np
    import torch

    TILE = 1024
    OVER = 128
    STEP = TILE - OVER

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
    upscale_factor   = {'2k': 2, '4k': 4}.get(_up, 0)
    esrgan_factor    = {'2k-esrgan': 2, '4k-esrgan': 4}.get(_up, 0)
    do_combo         = (_up == 'combo')
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
    # Unconditional debug
    print(f'[debug] upscale={upscale} esrgan_model={esrgan_model} combo_order={combo_order} gfpgan={gfpgan_enabled} img2img={bool(img2img_image_b64)} ip_images={len(ip_image_keys)} width={width} height={height}', flush=True)

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
    global _PIPE_CACHE

    if ckpt_path in _PIPE_CACHE:
        pipe = _PIPE_CACHE[ckpt_path]
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
            # Happy path: checkpoint includes all components
            pipe = FluxPipeline.from_single_file(ckpt_path, torch_dtype=torch.bfloat16)
            logs.append('[inference] Full pipeline loaded from checkpoint.')

        except Exception as _first_err:
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
            _PIPE_CACHE.pop(ckpt_path, None)
            gc.collect()
            torch.cuda.empty_cache()
            raise RuntimeError(
                f'CUDA OOM moving pipeline to GPU: {_oom}. '
                f'VRAM free after cleanup: {torch.cuda.mem_get_info()[0] / 1024**3:.2f} GB'
            ) from _oom
        _PIPE_CACHE[ckpt_path] = pipe
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
    if refine or upscale_factor > 0 or adetailer or img2img_pil is not None or do_combo:
        try:
            from diffusers import FluxImg2ImgPipeline
            pipe_i2i = FluxImg2ImgPipeline(**pipe.components)
            logs.append('[inference] FluxImg2ImgPipeline ready.')
        except Exception as _i2i_err:
            logs.append(f'[inference] Warning: FluxImg2ImgPipeline unavailable ({_i2i_err}). Refine/upscale skipped.')
        _flush_logs(r2, bucket, job_id, logs)

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

    _inf_error: Exception | None = None
    try:
        # 6. Base generation (img2img or text2img)
        gen = torch.Generator('cuda').manual_seed(int(seed)) if seed is not None else None
        if img2img_pil is not None and pipe_i2i is not None:
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
        if esrgan_model == 'ultrasharp' and (do_combo or esrgan_factor > 0):
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

        # 5c. Upscaling (Flux tiling, ESRGAN, or Combo)
        if do_combo and pipe_i2i is not None:
            if combo_order == 'flux-first':
                logs.append(f'[combo] Step 1/2 — Flux 2× tiling (strength={upscale_strength})...')
                _flush_logs(r2, bucket, job_id, logs)
                image = _tiled_img2img(pipe_i2i, image, prompt, 2, upscale_strength, steps, guidance, seed, logs)
                logs.append('[combo] Step 2/2 — ESRGAN 2×...')
                _flush_logs(r2, bucket, job_id, logs)
                image = _esrgan_upscale(image, esrgan_model, 2, logs)
            else:  # esrgan-first
                logs.append('[combo] Step 1/2 — ESRGAN 2×...')
                _flush_logs(r2, bucket, job_id, logs)
                image = _esrgan_upscale(image, esrgan_model, 2, logs)
                logs.append(f'[combo] Step 2/2 — Flux 2× tiling (strength={upscale_strength})...')
                _flush_logs(r2, bucket, job_id, logs)
                image = _tiled_img2img(pipe_i2i, image, prompt, 2, upscale_strength, steps, guidance, seed, logs)
            logs.append(f'[combo] Done — {image.width}×{image.height}')
            _flush_logs(r2, bucket, job_id, logs)

        elif upscale_factor > 0 and pipe_i2i is not None:
            logs.append(f'[inference] Flux tiled {upscale_factor}× (strength={upscale_strength})...')
            _flush_logs(r2, bucket, job_id, logs)
            image = _tiled_img2img(pipe_i2i, image, prompt, upscale_factor, upscale_strength, steps, guidance, seed, logs)
            logs.append(f'[inference] Tiling done — {image.width}×{image.height}')
            _flush_logs(r2, bucket, job_id, logs)

        elif esrgan_factor > 0:
            logs.append(f'[inference] ESRGAN {esrgan_factor}× ({esrgan_model})...')
            _flush_logs(r2, bucket, job_id, logs)
            image = _esrgan_upscale(image, esrgan_model, esrgan_factor, logs)
            logs.append(f'[inference] ESRGAN done — {image.width}×{image.height}')
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
        image.save(out_path, format='PNG')
        logs.append(f'[inference] Uploading to R2 ({out_key})...')
        r2.upload_file(out_path, bucket, out_key)
        logs.append('[inference] Done.')

    except Exception as e:
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


def handler(job):
    inp      = job['input']
    job_id   = job['id']
    logs     = []
    r2       = _r2()
    t0       = time.time()

    # dispatch inference jobs
    if inp.get('action') == 'inference':
        return _handle_inference(job['id'], inp)

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
