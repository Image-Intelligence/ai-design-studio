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

import os
import sys
import json
import time
import zipfile
import subprocess
import shutil
import glob
import tempfile

import runpod
import boto3
from botocore.config import Config

OT_DIR     = '/workspace/OneTrainer'
MODELS_DIR = '/workspace/models'
WORK_DIR   = '/workspace/runs'

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

    prompt   = inp.get('prompt', '')
    ckpt_key = inp['checkpoint_r2_key']
    loras    = inp.get('loras', [])
    width    = int(inp.get('width', 1024))
    height   = int(inp.get('height', 1024))
    steps    = int(inp.get('steps', 20))
    guidance = float(inp.get('guidance', 3.5))
    seed     = inp.get('seed')
    out_key  = inp.get('output_r2_key') or f'inference/outputs/{job_id}.png'

    logs.append(f'[inference] Starting job {job_id}')
    _flush_logs(r2, bucket, job_id, logs)

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

    # 3. Load pipeline
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
        # The same CLIP/T5/VAE files used for training are already in R2 under training/models/.
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

    pipe = pipe.to('cuda')
    logs.append('[inference] Pipeline ready.')
    _flush_logs(r2, bucket, job_id, logs)

    # Patch _maybe_expand_lora_state_dict: it assumes the base transformer uses packed
    # single-block weights, but OneTrainer checkpoints use unpacked weights. When the
    # packed key is missing, return the LoRA dict as-is (no expansion needed).
    try:
        _orig_expand = type(pipe)._maybe_expand_lora_state_dict
        def _patched_expand(self, *args, **kwargs):
            try:
                return _orig_expand(self, *args, **kwargs)
            except KeyError:
                # Base transformer uses unpacked weights — no expansion needed, return as-is
                return args[0] if args else kwargs.get('lora_state_dict')
        type(pipe)._maybe_expand_lora_state_dict = _patched_expand
        logs.append('[inference] Patched _maybe_expand_lora_state_dict for unpacked transformer')
    except AttributeError:
        pass  # older diffusers without this method — no patch needed
    _flush_logs(r2, bucket, job_id, logs)

    # 4. Load LoRAs
    for i, li in enumerate(lora_paths):
        name = f'lora_{i}'
        logs.append(f'[inference] Loading LoRA {i+1} (strength {li["strength"]})...')
        pipe.load_lora_weights(li['path'], adapter_name=name)
    if lora_paths:
        names   = [f'lora_{i}' for i in range(len(lora_paths))]
        weights = [li['strength'] for li in lora_paths]
        pipe.set_adapters(names, adapter_weights=weights)
    _flush_logs(r2, bucket, job_id, logs)

    # 5. Generate
    logs.append(f'[inference] Generating {width}×{height} ({steps} steps)...')
    _flush_logs(r2, bucket, job_id, logs)
    gen = torch.Generator('cuda').manual_seed(int(seed)) if seed is not None else None
    result = pipe(prompt=prompt, width=width, height=height,
                  num_inference_steps=steps, guidance_scale=guidance, generator=gen)
    image = result.images[0]

    # 6. Upload result
    out_path = os.path.join(run_dir, 'output.png')
    image.save(out_path, format='PNG')
    logs.append(f'[inference] Uploading to R2 ({out_key})...')
    try:
        r2.upload_file(out_path, bucket, out_key)
        logs.append('[inference] Done.')
    except Exception as e:
        return {'success': False, 'error': f'Upload failed: {e}', 'logs': logs}
    finally:
        _flush_logs(r2, bucket, job_id, logs)

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
