"""
MoCha character-swap worker - RunPod serverless (2026-10-22, admin-only test model).

MoCha (Orange-3DV-Team, CVPR 2026) replaces the person in a video with the
character from 1-2 reference pictures. It needs a mask on ONE frame only - no
pose skeleton, no per-frame tracking - which this worker makes itself (YOLO
person segmentation on the clip's first frame), so a job is just "this clip,
this character".

It runs Kijai's ComfyUI-WanVideoWrapper MoCha path headless (the route the
MoCha authors recommend - their own script is landscape-only, 50 steps and
hard-codes its paths): the fp8 MoCha checkpoint, the lightx2v distill LoRA (6
steps, CFG 1) and MochaEmbeds, exactly as Kijai's example workflow
wanvideo_2_1_14B_MoCha_replace_subject_KJ_02.json wires them - its point-click
SAM2 mask swapped for the automatic one.

Endpoint environment (the same R2 variables as the FLUX worker):
  R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
  HF_TOKEN (optional - the weights are public)
Weights (~27 GB) download on the first start into the network volume
(/runpod-volume/mocha-models) and are reused after that; without a volume
they land in the container and every cold start downloads them again.

Job input:
  video        {"r2_key": "..."} or {"url": "..."}  (both allowed: the key is tried first)
  refs         [ {r2_key|url}, ... ]  1-2 pictures; the 2nd is best a front-facing face close-up
  output_r2_key  where the finished MP4 goes
  resolution   "480p" (default, what MoCha was trained at) | "720p"
  max_frames   81 (default, the trained length) .. 161 - rounded down to 4n+1
  fps          24 (default) | 16 - the clip is re-timed to it first
  mode         "fast" (default: lightx2v, 6 steps, CFG 1) | "full" (no LoRA, 30 steps, CFG 5)
  seed, steps, cfg, shift, prompt, blocks_to_swap  (optional overrides)
  mask         {r2_key|url} optional - a white-on-black first-frame mask instead of the automatic one
  keep_audio   true (default) - the source's sound is laid back under the result
Output: {success, output_r2_key, mask_r2_key, width, height, frames, fps,
seconds, seed, timings, handler_version} or {success: false, error}.
"""

import glob
import json
import os
import random
import shutil
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid

import boto3
import runpod
from botocore.config import Config

HANDLER_VERSION = '2026-10-22-v2'

COMFY_DIR = '/workspace/ComfyUI'
COMFY_URL = 'http://127.0.0.1:8188'
COMFY_IN = '/workspace/comfy-input'
COMFY_OUT = '/workspace/comfy-output'
COMFY_LOG = '/workspace/comfy.log'
WORK = '/workspace/jobs'
VOLUME = '/runpod-volume'
MODELS_ROOT = os.path.join(VOLUME, 'mocha-models') if os.path.isdir(VOLUME) else '/workspace/models'
YOLO_WEIGHTS = '/workspace/yolo11l-seg.pt'

# (Hugging Face repo, file in it) per ComfyUI model folder - the files Kijai's workflow uses
MODEL_FILES = {
    'diffusion_models': ('Kijai/WanVideo_comfy_fp8_scaled', 'MoCha/Wan2_1_mocha-14B-preview_fp8_e4m3fn_scaled_KJ.safetensors'),
    'loras': ('Kijai/WanVideo_comfy', 'Lightx2v/lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16.safetensors'),
    'vae': ('Kijai/WanVideo_comfy', 'Wan2_1_VAE_bf16.safetensors'),
    'text_encoders': ('Kijai/WanVideo_comfy', 'umt5-xxl-enc-bf16.safetensors'),
}

SIZES = {'480p': (832, 480), '720p': (1280, 720)}
MAX_INPUT_BYTES = 1024 * 1024 * 1024
PROMPT_TIMEOUT_S = 50 * 60

_comfy_proc = None
_yolo = None


def log(msg):
    print(f'[mocha] {msg}', flush=True)


# ---------------------------------------------------------------- storage

def _r2():
    if not (os.environ.get('R2_ENDPOINT') and os.environ.get('R2_ACCESS_KEY_ID') and os.environ.get('R2_BUCKET_NAME')):
        return None
    return boto3.client(
        's3',
        endpoint_url=os.environ['R2_ENDPOINT'],
        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
        config=Config(signature_version='s3v4', retries={'max_attempts': 5}),
        region_name='auto',
    )


def fetch_media(item, dest):
    """Fetch one input - {r2_key} through the bucket, else {url} over HTTP."""
    if isinstance(item, str):
        item = {'url': item}
    if not isinstance(item, dict):
        raise ValueError('a media input must be {"r2_key"} or {"url"}')
    key, url = item.get('r2_key'), item.get('url')
    r2 = _r2()
    if key and r2:
        try:
            r2.download_file(os.environ['R2_BUCKET_NAME'], key, dest)
            return dest
        except Exception as e:  # a key from another bucket - the link still works
            log(f'R2 read of {key} failed ({e}); trying the link')
    if not url:
        raise ValueError(f'could not read {key or "an input"} from storage and no link was given')
    req = urllib.request.Request(url, headers={'User-Agent': 'mocha-worker/1'})
    with urllib.request.urlopen(req, timeout=300) as r, open(dest, 'wb') as f:
        total = 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_INPUT_BYTES:
                raise ValueError('an input is larger than 1 GB')
            f.write(chunk)
    return dest


def upload(path, key, content_type):
    r2 = _r2()
    if not r2:
        raise RuntimeError('R2 is not configured on this endpoint (R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME)')
    r2.upload_file(path, os.environ['R2_BUCKET_NAME'], key, ExtraArgs={'ContentType': content_type})


# ---------------------------------------------------------------- models + ComfyUI

def _volume_gb():
    """What the weights folder holds, in GB (for error reports)."""
    total = 0
    for root, _, files in os.walk(MODELS_ROOT):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return round(total / 1e9, 1)


def _clear_partials():
    """
    Drop what an interrupted download left on the volume: our own .part files
    that nobody has written to for 10 minutes (a second worker's live download
    is left alone), and hf_hub_download's old local_dir/.cache folders.
    """
    now = time.time()
    for root, dirs, files in os.walk(MODELS_ROOT):
        if '.cache' in dirs:
            shutil.rmtree(os.path.join(root, '.cache'), ignore_errors=True)
            dirs.remove('.cache')
        for f in files:
            p = os.path.join(root, f)
            try:
                if f.endswith('.part') and now - os.path.getmtime(p) > 600:
                    os.remove(p)
            except OSError:
                pass


def _fetch(repo, path, target):
    """
    One weight file straight onto the volume: streamed to a .part file and
    renamed once it is whole, so the volume holds exactly one copy of it.

    Not hf_hub_download (2026-10-22): MoCha's first job on its 40 GB volume
    died with "Disk quota exceeded" fetching ~27 GB of weights - an
    interrupted attempt leaves its partial download under local_dir/.cache,
    and the newer xet client keeps a chunk cache of its own on top.
    """
    token = os.environ.get('HF_TOKEN')
    os.makedirs(os.path.dirname(target), exist_ok=True)
    part = f'{target}.{os.getpid()}.part'
    req = urllib.request.Request(f'https://huggingface.co/{repo}/resolve/main/{path}',
                                 headers={'Authorization': f'Bearer {token}'} if token else {})
    try:
        with urllib.request.urlopen(req, timeout=300) as r, open(part, 'wb') as f:
            size = int(r.headers.get('content-length') or 0)
            shutil.copyfileobj(r, f, 16 << 20)
        if size and os.path.getsize(part) != size:
            raise RuntimeError(f'{path}: got {os.path.getsize(part)} of {size} bytes')
        os.replace(part, target)
    except BaseException:
        try:
            os.remove(part)
        except OSError:
            pass
        raise


def ensure_models():
    """Download whatever weights the volume is missing; returns {folder: ComfyUI file name}."""
    names = {}
    missing = [(f, r, p) for f, (r, p) in MODEL_FILES.items() if not os.path.isfile(os.path.join(MODELS_ROOT, f, p))]
    if missing:
        _clear_partials()
    for folder, repo, path in missing:
        log(f'downloading {repo}/{path}')
        t0 = time.time()
        try:
            _fetch(repo, path, os.path.join(MODELS_ROOT, folder, path))
        except Exception as e:
            raise RuntimeError(f'Downloading {path} failed with {_volume_gb()} GB on the volume: {e}') from e
        log(f'  done in {time.time() - t0:.0f}s')
    for folder, (repo, path) in MODEL_FILES.items():
        names[folder] = path  # ComfyUI lists files by their path under the folder
    return names


def _comfy_up():
    try:
        with urllib.request.urlopen(f'{COMFY_URL}/system_stats', timeout=5) as r:
            return r.status == 200
    except Exception:
        return False


def start_comfy():
    global _comfy_proc
    if _comfy_proc and _comfy_proc.poll() is None and _comfy_up():
        return
    os.makedirs(COMFY_IN, exist_ok=True)
    os.makedirs(COMFY_OUT, exist_ok=True)
    cfg = '/workspace/extra_model_paths.yaml'
    with open(cfg, 'w') as f:
        f.write('mocha:\n'
                f'  base_path: {MODELS_ROOT}\n'
                '  diffusion_models: diffusion_models\n'
                '  loras: loras\n'
                '  vae: vae\n'
                '  text_encoders: text_encoders\n')
    log('starting ComfyUI')
    _comfy_proc = subprocess.Popen(
        [sys.executable, 'main.py', '--listen', '127.0.0.1', '--port', '8188', '--disable-auto-launch',
         '--extra-model-paths-config', cfg, '--input-directory', COMFY_IN, '--output-directory', COMFY_OUT,
         '--preview-method', 'none'],
        cwd=COMFY_DIR, stdout=open(COMFY_LOG, 'ab'), stderr=subprocess.STDOUT,
    )
    for _ in range(600):
        if _comfy_proc.poll() is not None:
            raise RuntimeError(f'ComfyUI exited on start: {tail(COMFY_LOG)}')
        if _comfy_up():
            log('ComfyUI is up')
            return
        time.sleep(1)
    raise RuntimeError(f'ComfyUI did not come up in 10 minutes: {tail(COMFY_LOG)}')


def tail(path, n=3000):
    try:
        with open(path, 'rb') as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - n))
            return f.read().decode('utf8', 'replace')
    except Exception:
        return ''


def vram_mib():
    try:
        out = subprocess.run(['nvidia-smi', '--query-gpu=memory.total', '--format=csv,noheader,nounits'],
                             capture_output=True, text=True, timeout=20).stdout
        return int(out.strip().splitlines()[0])
    except Exception:
        return 0


def has_sageattention():
    import importlib.util
    return importlib.util.find_spec('sageattention') is not None


# ---------------------------------------------------------------- clip preparation

def run(cmd, timeout=900):
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError(f'{cmd[0]} failed: {p.stderr[-1500:]}')
    return p.stdout


def probe(path):
    out = json.loads(run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,width,height,nb_frames:format=duration',
                          '-of', 'json', path]))
    streams = out.get('streams', [])
    return {
        'has_audio': any(s.get('codec_type') == 'audio' for s in streams),
        'duration': float(out.get('format', {}).get('duration') or 0),
    }


def count_frames(path):
    out = run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames',
               '-of', 'csv=p=0', path])
    return int(out.strip().split(',')[0])


def prepare_clip(src, dst_dir, resolution, fps, max_frames):
    """The clip at MoCha's size (cover-cropped, the clip's own orientation) and frame rate, 4n+1 frames."""
    from PIL import Image
    first = os.path.join(dst_dir, 'src-first.png')
    run(['ffmpeg', '-y', '-v', 'error', '-i', src, '-frames:v', '1', first])  # autorotated, as displayed
    with Image.open(first) as im:
        sw, sh = im.size
    lw, lh = SIZES.get(resolution, SIZES['480p'])
    w, h = (lw, lh) if sw >= sh else (lh, lw)
    prep = os.path.join(dst_dir, 'prep.mp4')
    run(['ffmpeg', '-y', '-v', 'error', '-i', src, '-an',
         '-vf', f'fps={fps},scale={w}:{h}:force_original_aspect_ratio=increase:flags=lanczos,crop={w}:{h},setsar=1',
         '-frames:v', str(max_frames), '-c:v', 'libx264', '-crf', '12', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', prep])
    n = count_frames(prep)
    if n < 17:
        raise ValueError(f'the clip is too short - {n} frames at {fps} fps; MoCha needs at least 17')
    frames = (n - 1) // 4 * 4 + 1
    frame0 = os.path.join(dst_dir, 'frame0.png')
    run(['ffmpeg', '-y', '-v', 'error', '-i', prep, '-frames:v', '1', frame0])
    return prep, frame0, w, h, frames


def person_mask(frame0, out_path):
    """White where the main person is on the first frame (the largest one YOLO finds)."""
    global _yolo
    import numpy as np
    from PIL import Image
    if _yolo is None:
        from ultralytics import YOLO
        _yolo = YOLO(YOLO_WEIGHTS)
    res = _yolo.predict(frame0, classes=[0], conf=0.3, retina_masks=True, device='cpu', verbose=False)[0]
    if res.masks is None or len(res.masks) == 0:
        raise ValueError("couldn't find a person in the clip's first frame - start the clip on a clear shot of them")
    masks = res.masks.data.cpu().numpy()  # (n, H, W) at the frame's size
    best = int(np.argmax(masks.reshape(len(masks), -1).sum(axis=1)))
    m = (masks[best] > 0.5).astype('uint8') * 255
    with Image.open(frame0) as im:
        size = im.size
    mask = Image.fromarray(m).convert('RGB')
    if mask.size != size:
        mask = mask.resize(size)
    mask.save(out_path)
    return out_path


def custom_mask(src, frame0, out_path):
    """A mask the caller drew: thresholded and sized to the prepared first frame."""
    from PIL import Image
    with Image.open(frame0) as f0, Image.open(src) as m:
        g = m.convert('L').resize(f0.size)
        g.point(lambda v: 255 if v > 127 else 0).convert('RGB').save(out_path)
    return out_path


# ---------------------------------------------------------------- the workflow

def build_graph(o):
    """Kijai's MoCha workflow as an API prompt (input names from the node definitions at the pinned commits)."""
    g = {
        'video': {'class_type': 'VHS_LoadVideoPath', 'inputs': {
            'video': o['prep'], 'force_rate': 0, 'custom_width': 0, 'custom_height': 0,
            'frame_load_cap': o['frames'], 'skip_first_frames': 0, 'select_every_nth': 1,
            'format': 'None'}},  # the clip is already at size and frame rate (prepare_clip)
        'mask_img': {'class_type': 'LoadImageMask', 'inputs': {'image': o['mask_name'], 'channel': 'red'}},
        'mask': {'class_type': 'GrowMaskWithBlur', 'inputs': {
            'mask': ['mask_img', 0], 'expand': 5, 'incremental_expandrate': 0.0, 'tapered_corners': True,
            'flip_input': False, 'blur_radius': 0.0, 'lerp_alpha': 1.0, 'decay_factor': 1.0, 'fill_holes': True}},
        'vae': {'class_type': 'WanVideoVAELoader', 'inputs': {'model_name': o['names']['vae'], 'precision': 'bf16'}},
        'text': {'class_type': 'WanVideoTextEncodeCached', 'inputs': {
            'model_name': o['names']['text_encoders'], 'precision': 'bf16',
            'positive_prompt': o['prompt'], 'negative_prompt': o['negative'],
            'quantization': 'disabled', 'use_disk_cache': True, 'device': 'gpu'}},
        'blockswap': {'class_type': 'WanVideoBlockSwap', 'inputs': {
            'blocks_to_swap': o['blocks_to_swap'], 'offload_img_emb': False, 'offload_txt_emb': False,
            'use_non_blocking': True, 'vace_blocks_to_swap': 0, 'prefetch_blocks': 0, 'block_swap_debug': False}},
        'model': {'class_type': 'WanVideoModelLoader', 'inputs': {
            'model': o['names']['diffusion_models'], 'base_precision': 'bf16', 'quantization': 'disabled',
            'load_device': 'offload_device', 'attention_mode': o['attention'], 'block_swap_args': ['blockswap', 0],
            'rms_norm_function': 'default'}},
        'embeds': {'class_type': 'MochaEmbeds', 'inputs': {
            'vae': ['vae', 0], 'force_offload': True, 'input_video': ['video', 0], 'mask': ['mask', 0],
            'ref1': ['ref1', 0], 'tiled_vae': False}},
        'sampler': {'class_type': 'WanVideoSampler', 'inputs': {
            'model': ['model', 0], 'image_embeds': ['embeds', 0], 'text_embeds': ['text', 0],
            'steps': o['steps'], 'cfg': o['cfg'], 'shift': o['shift'], 'seed': o['seed'], 'force_offload': True,
            'scheduler': o['scheduler'], 'riflex_freq_index': 0, 'denoise_strength': 1.0, 'batched_cfg': False,
            'rope_function': 'comfy', 'start_step': 0, 'end_step': -1, 'add_noise_to_samples': False}},
        'decode': {'class_type': 'WanVideoDecode', 'inputs': {
            'vae': ['vae', 0], 'samples': ['sampler', 0], 'enable_vae_tiling': False,
            'tile_x': 272, 'tile_y': 272, 'tile_stride_x': 144, 'tile_stride_y': 128, 'normalization': 'default'}},
        'save': {'class_type': 'SaveImage', 'inputs': {'images': ['decode', 0], 'filename_prefix': o['prefix']}},
    }
    # The pictures, letterboxed onto the clip's canvas in grey (as Kijai's workflow pads them)
    for i, name in enumerate(o['ref_names'][:2], start=1):
        g[f'ref{i}_img'] = {'class_type': 'LoadImage', 'inputs': {'image': name}}
        g[f'ref{i}'] = {'class_type': 'ImageResizeKJv2', 'inputs': {
            'image': [f'ref{i}_img', 0], 'width': o['w'], 'height': o['h'], 'upscale_method': 'lanczos',
            'keep_proportion': 'pad', 'pad_color': '127,127,127', 'crop_position': 'center', 'divisible_by': 16,
            'device': 'cpu'}}
    if len(o['ref_names']) > 1:
        g['embeds']['inputs']['ref2'] = ['ref2', 0]
    if o['lora']:
        g['lora'] = {'class_type': 'WanVideoLoraSelectMulti', 'inputs': {
            'lora_0': o['names']['loras'], 'strength_0': 1.0,
            'lora_1': 'none', 'strength_1': 1.0, 'lora_2': 'none', 'strength_2': 1.0,
            'lora_3': 'none', 'strength_3': 1.0, 'lora_4': 'none', 'strength_4': 1.0,
            'low_mem_load': False, 'merge_loras': True}}
        g['model']['inputs']['lora'] = ['lora', 0]
    return g


def run_prompt(graph, job):
    body = json.dumps({'prompt': graph, 'client_id': str(uuid.uuid4())}).encode()
    req = urllib.request.Request(f'{COMFY_URL}/prompt', data=body, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            pid = json.loads(r.read())['prompt_id']
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'ComfyUI refused the workflow: {e.read().decode("utf8", "replace")[:2000]}')
    t0 = time.time()
    last_note = 0
    while True:
        if _comfy_proc and _comfy_proc.poll() is not None:
            raise RuntimeError(f'ComfyUI crashed: {tail(COMFY_LOG)}')
        with urllib.request.urlopen(f'{COMFY_URL}/history/{pid}', timeout=30) as r:
            hist = json.loads(r.read())
        if pid in hist:
            h = hist[pid]
            st = h.get('status', {})
            if st.get('status_str') == 'error':
                msgs = [m[1] for m in st.get('messages', []) if m and m[0] == 'execution_error']
                detail = msgs[0] if msgs else {}
                raise RuntimeError(f"{detail.get('node_type', 'a node')} failed: {detail.get('exception_message', 'unknown error')}".strip())
            return h.get('outputs', {})
        if time.time() - t0 > PROMPT_TIMEOUT_S:
            raise RuntimeError('the render took longer than 50 minutes')
        if time.time() - last_note > 30:
            runpod.serverless.progress_update(job, f'rendering ({int(time.time() - t0)}s)')
            last_note = time.time()
        time.sleep(2)


# ---------------------------------------------------------------- handler

def handler(job):
    inp = job.get('input') or {}
    jid = job.get('id') or uuid.uuid4().hex
    work = os.path.join(WORK, jid)
    os.makedirs(work, exist_ok=True)
    timings = {}
    t_all = time.time()
    try:
        out_key = inp.get('output_r2_key') or f'runpod/mocha/{jid}.mp4'
        refs = inp.get('refs') or []
        if not inp.get('video'):
            raise ValueError('add the source clip')
        if not refs:
            raise ValueError('add a picture of the character')
        resolution = inp.get('resolution') if inp.get('resolution') in SIZES else '480p'
        fps = 16 if int(inp.get('fps') or 24) == 16 else 24
        max_frames = max(17, min(161, int(inp.get('max_frames') or 81)))
        full = inp.get('mode') == 'full'
        seed = int(inp['seed']) if str(inp.get('seed', '')).strip().lstrip('-').isdigit() else random.randint(0, 2**31 - 1)

        t = time.time()
        names = ensure_models()
        start_comfy()
        timings['ready_s'] = round(time.time() - t, 1)

        # Inputs
        t = time.time()
        src = fetch_media(inp['video'], os.path.join(work, 'source'))
        info = probe(src)
        prep, frame0, w, h, frames = prepare_clip(src, work, resolution, fps, max_frames)
        ref_names = []
        for i, item in enumerate(refs[:2]):
            p = fetch_media(item, os.path.join(work, f'ref{i}'))
            name = f'{jid}-ref{i}.png'
            from PIL import Image
            with Image.open(p) as im:
                im.convert('RGB').save(os.path.join(COMFY_IN, name))
            ref_names.append(name)
        mask_path = os.path.join(work, 'mask.png')
        if inp.get('mask'):
            custom_mask(fetch_media(inp['mask'], os.path.join(work, 'mask-in')), frame0, mask_path)
        else:
            person_mask(frame0, mask_path)
        mask_name = f'{jid}-mask.png'
        shutil.copy(mask_path, os.path.join(COMFY_IN, mask_name))
        timings['inputs_s'] = round(time.time() - t, 1)
        runpod.serverless.progress_update(job, f'clip ready: {w}x{h}, {frames} frames at {fps} fps')

        # Render - on running out of memory, once more with every block swapped
        vram = vram_mib()
        default_swap = 0 if vram >= 70_000 else 20 if vram >= 40_000 else 40
        if resolution == '720p' or frames > 81:
            default_swap = min(40, default_swap + 20)
        o = {
            'prep': prep, 'frames': frames, 'mask_name': mask_name, 'ref_names': ref_names, 'names': names,
            'w': w, 'h': h, 'seed': seed, 'prefix': f'mocha/{jid}',
            'prompt': str(inp.get('prompt') or '').strip()[:800],
            'negative': '' if not full else 'blurry, low quality, distorted face, deformed hands, extra limbs, flicker, watermark, text',
            'lora': not full,
            'steps': int(inp.get('steps') or (30 if full else 6)),
            'cfg': float(inp.get('cfg') or (5.0 if full else 1.0)),
            'shift': float(inp.get('shift') or 5.0),
            'scheduler': 'unipc' if full else 'dpm++_sde',
            'attention': 'sageattn' if has_sageattention() else 'sdpa',
            'blocks_to_swap': max(0, min(40, int(inp['blocks_to_swap']))) if inp.get('blocks_to_swap') is not None else default_swap,
        }
        t = time.time()
        try:
            outputs = run_prompt(build_graph(o), job)
        except RuntimeError as e:
            msg = str(e).lower()
            if 'out of memory' in msg or 'outofmemory' in msg:
                log(f'out of memory with {o["blocks_to_swap"]} blocks swapped - retrying with 40')
                o['blocks_to_swap'] = 40
            elif o['attention'] != 'sdpa' and ('sage' in msg or 'triton' in msg):
                log('sage attention failed - retrying with sdpa')
                o['attention'] = 'sdpa'
            else:
                raise
            outputs = run_prompt(build_graph(o), job)
        timings['render_s'] = round(time.time() - t, 1)

        # Frames -> MP4 (+ the source's sound)
        t = time.time()
        imgs = (outputs.get('save') or {}).get('images') or []
        if not imgs:
            raise RuntimeError('the workflow finished without frames')
        # Moved into the job's folder in render order, numbered for ffmpeg
        frames_dir = os.path.join(work, 'frames')
        os.makedirs(frames_dir, exist_ok=True)
        for n, i in enumerate(imgs):
            shutil.move(os.path.join(COMFY_OUT, i.get('subfolder') or '', i['filename']), os.path.join(frames_dir, f'{n:05d}.png'))
        out_mp4 = os.path.join(work, 'out.mp4')
        seconds = len(imgs) / fps
        cmd = ['ffmpeg', '-y', '-v', 'error', '-framerate', str(fps), '-i', os.path.join(frames_dir, '%05d.png')]
        keep_audio = inp.get('keep_audio', True) is not False and info['has_audio']
        if keep_audio:
            cmd += ['-i', src, '-map', '0:v', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k', '-t', f'{seconds:.3f}']
        cmd += ['-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart', out_mp4]
        run(cmd)
        upload(out_mp4, out_key, 'video/mp4')
        mask_key = out_key.rsplit('.', 1)[0] + '-mask.png'
        upload(mask_path, mask_key, 'image/png')
        timings['encode_upload_s'] = round(time.time() - t, 1)
        timings['total_s'] = round(time.time() - t_all, 1)
        log(f'job {jid} done: {w}x{h} {len(imgs)} frames, {timings}')
        return {
            'success': True, 'output_r2_key': out_key, 'mask_r2_key': mask_key,
            'width': w, 'height': h, 'frames': len(imgs), 'fps': fps, 'seconds': round(seconds, 3),
            'seed': seed, 'blocks_to_swap': o['blocks_to_swap'], 'attention': o['attention'],
            'timings': timings, 'handler_version': HANDLER_VERSION,
        }
    except Exception as e:
        traceback.print_exc()
        return {'success': False, 'error': str(e)[:1500], 'handler_version': HANDLER_VERSION, 'timings': timings}
    finally:
        shutil.rmtree(work, ignore_errors=True)
        for f in glob.glob(os.path.join(COMFY_IN, f'{jid}-*')):
            try:
                os.remove(f)
            except OSError:
                pass


if __name__ == '__main__':
    log(f'handler {HANDLER_VERSION}, models in {MODELS_ROOT}')
    # Warm up before taking jobs: weights on disk, ComfyUI loaded
    try:
        ensure_models()
        start_comfy()
    except Exception:
        traceback.print_exc()  # the first job retries and reports it
    runpod.serverless.start({'handler': handler})
