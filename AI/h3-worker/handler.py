"""
MiniMax H3 character-swap worker - RunPod serverless (2026-10-22, admin-only test models).

One ComfyUI install serving two open models built on MiniMax H3 Ref2VA:

  action "viggle"   Viggle-Animate (Viggle, 2026): replaces the person in a
                    clip from ONE repainted frame of that clip - the site makes
                    the repaint (NanoBanana edit: the clip's first frame with
                    the character painted in) and sends it as `ref`.
                    Saganaki22/ComfyUI-Viggle-Animate-H3 nodes, the pruned int8
                    Viggle transformer + its DMD LoRA (3 Euler steps).
  action "h3-swap"  MiniMax H3 + akatz-ai's Character Swap LoRA v1.5: replaces
                    the person in a clip with the character in a picture. The
                    H3 Relay pack (akatz-ai/h3-relay) builds the graph itself
                    (h3_relay/workflows.character_swap_graph): SAM 3.1 masks and
                    tracks the person, 124-frame windows with history, the
                    8-step H3 Turbo LoRA. Its source sound is kept.

LICENSE: both are MiniMax H3 derivatives under the MiniMax H3 Community
License, which does NOT cover use in the USA, EU, UK or South Korea without
a separate licence from MiniMax. The site's owner decided to run them
(admin-only) knowing this.

Endpoint environment (the same R2 variables as the FLUX worker):
  R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
  HF_TOKEN (optional - the weights are public)
Weights download per model on its first job into the network volume
(/runpod-volume/h3-models): Viggle ~30 GB, H3 swap ~47 GB, 77 GB both.

Job input:
  action         "viggle" | "h3-swap"
  video          {"r2_key"} or {"url"}  - the clip (both allowed: the key is tried first)
  ref            {r2_key|url}           - viggle: the REPAINTED first frame; h3-swap: the character picture
  output_r2_key  where the finished MP4 goes
  resolution     h3-swap: "480" | "768" (default; Relay's pixel budgets). viggle: always its 480-class ladder
  max_seconds    how much of the clip to render (viggle default 10, up to 15; h3-swap default 15, up to 30)
  seed, keep_audio (default true)
Output: {success, output_r2_key, width, height, frames, fps, seconds, seed, timings, handler_version}
or {success: false, error}.
"""

import glob
import importlib.util
import json
import math
import os
import random
import shutil
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.request
import uuid

import boto3
import runpod
from botocore.config import Config

HANDLER_VERSION = '2026-10-22-v3'

COMFY_DIR = '/workspace/ComfyUI'
COMFY_MODELS = os.path.join(COMFY_DIR, 'models')
COMFY_URL = 'http://127.0.0.1:8188'
COMFY_IN = '/workspace/comfy-input'
COMFY_OUT = '/workspace/comfy-output'
COMFY_LOG = '/workspace/comfy.log'
WORK = '/workspace/jobs'
VOLUME = '/runpod-volume'
MODELS_ROOT = os.path.join(VOLUME, 'h3-models') if os.path.isdir(VOLUME) else '/workspace/models'
RELAY_WORKFLOWS = os.path.join(COMFY_DIR, 'custom_nodes', 'h3-relay', 'h3_relay', 'workflows.py')

# (Hugging Face repo, file in it, ComfyUI models folder, the name the graph asks for)
VIGGLE_FILES = [
    ('drbaph/Viggle-Animate-ComfyUI', 'diffusion_models/minimax_h3_ref2va_viggle_pruned_int8_convrot.safetensors', 'diffusion_models', 'minimax_h3_ref2va_viggle_pruned_int8_convrot.safetensors'),
    ('drbaph/Viggle-Animate-ComfyUI', 'loras/viggle_animate_dmd_lora.safetensors', 'loras', 'viggle_animate_dmd_lora.safetensors'),
    ('drbaph/Viggle-Animate-ComfyUI', 'text_cond/fixed_embed_fwd_anyframe.safetensors', 'text_cond', 'fixed_embed_fwd_anyframe.safetensors'),
    ('Comfy-Org/MiniMax-H3', 'vae/minimax_h3_video_vae_fp16.safetensors', 'vae', 'minimax_h3_video_vae_fp16.safetensors'),
]
SWAP_LORA = 'h3_character_swap_v1.5.safetensors'
SWAP_FILES = [
    ('Comfy-Org/MiniMax-H3', 'diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors', 'diffusion_models', 'minimax_h3_ref2va_pruned_int8_convrot.safetensors'),
    ('Comfy-Org/MiniMax-H3', 'text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', 'text_encoders', 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'),
    ('Comfy-Org/MiniMax-H3', 'vae/minimax_h3_video_vae_fp16.safetensors', 'vae', 'minimax_h3_video_vae_fp16.safetensors'),
    ('Comfy-Org/MiniMax-H3', 'vae/minimax_h3_audio_vae_fp32.safetensors', 'vae', 'minimax_h3_audio_vae_fp32.safetensors'),
    # lightx2v's ComfyUI-keyed 768p file - Comfy-Org's same-named one without "768p" is a different file
    ('lightx2v/Minimax-h3-Turbo', 'minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors', 'loras', 'minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors'),
    ('akatz-ai/MiniMax-H3-Character-Swap-LoRA', 'h3_character_swap_v1.5.safetensors', 'loras', SWAP_LORA),
    ('Comfy-Org/sam3.1', 'checkpoints/sam3.1_multiplex_fp16.safetensors', 'checkpoints', 'sam3.1_multiplex_fp16.safetensors'),
]

# Viggle-Animate's trained sizes (constant ~400k-pixel area): the clip goes to the nearest shape
VIGGLE_LADDER = [(416, 960), (448, 896), (480, 832), (544, 736), (640, 640), (736, 544), (832, 480), (896, 448), (960, 416)]
MAX_INPUT_BYTES = 1024 * 1024 * 1024
PROMPT_TIMEOUT_S = 80 * 60

_comfy_proc = None


def log(msg):
    print(f'[h3] {msg}', flush=True)


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
    req = urllib.request.Request(url, headers={'User-Agent': 'h3-worker/1'})
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


def ensure_models(files):
    """Download what the volume lacks, and link each file into ComfyUI's models folders under the name the graph uses."""
    cleared = False
    for repo, path, folder, name in files:
        local_dir = os.path.join(MODELS_ROOT, repo.replace('/', '__'))
        target = os.path.join(local_dir, path)
        if not os.path.isfile(target):
            if not cleared:
                _clear_partials()
                cleared = True
            log(f'downloading {repo}/{path}')
            t0 = time.time()
            try:
                _fetch(repo, path, target)
            except Exception as e:
                raise RuntimeError(f'Downloading {path} failed with {_volume_gb()} GB on the volume: {e}') from e
            log(f'  done in {time.time() - t0:.0f}s')
        link = os.path.join(COMFY_MODELS, folder, name)
        os.makedirs(os.path.dirname(link), exist_ok=True)
        if not os.path.exists(link):
            os.symlink(target, link)


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
    log('starting ComfyUI')
    # Default VRAM mode: Relay's memory nodes rely on ComfyUI's offloading
    _comfy_proc = subprocess.Popen(
        [sys.executable, 'main.py', '--listen', '127.0.0.1', '--port', '8188', '--disable-auto-launch',
         '--input-directory', COMFY_IN, '--output-directory', COMFY_OUT, '--preview-method', 'none'],
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


def run_prompt(graph, job):
    # The relay's builder tags nodes with _meta titles; ComfyUI accepts them
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
            raise RuntimeError('the render took longer than 80 minutes')
        if time.time() - last_note > 30:
            runpod.serverless.progress_update(job, f'rendering ({int(time.time() - t0)}s)')
            last_note = time.time()
        time.sleep(2)


def output_video(outputs):
    """
    The video the workflow SAVED: an output node's file of type "output", the
    "save" node's first. LoadVideo reports its INPUT clip in the same shape
    (type "input") - Viggle's first run took that and asked for
    comfy-output/<job>-drive.mp4, which never exists (2026-10-22).
    """
    for node_id in sorted(outputs, key=lambda n: n != 'save'):
        out = outputs[node_id] or {}
        for k in ('images', 'videos', 'gifs', 'animated'):
            for f in out.get(k) or []:
                if not isinstance(f, dict) or (f.get('type') or 'output') != 'output':
                    continue
                if str(f.get('filename', '')).lower().endswith(('.mp4', '.webm', '.mkv')):
                    path = os.path.join(COMFY_OUT, f.get('subfolder') or '', f['filename'])
                    if os.path.isfile(path):
                        return path
    found = sorted(glob.glob(os.path.join(COMFY_OUT, '**', '*.mp4'), recursive=True), key=os.path.getmtime)
    if found:
        return found[-1]
    raise RuntimeError('the workflow finished without a video')


# ---------------------------------------------------------------- media helpers

def run(cmd, timeout=900):
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError(f'{cmd[0]} failed: {p.stderr[-1500:]}')
    return p.stdout


def has_audio(path):
    out = run(['ffprobe', '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', path])
    return bool(out.strip())


def count_frames(path):
    out = run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', path])
    return int(out.strip().split(',')[0])


def display_size(path, work):
    from PIL import Image
    first = os.path.join(work, 'probe-first.png')
    run(['ffmpeg', '-y', '-v', 'error', '-i', path, '-frames:v', '1', first])  # autorotated, as displayed
    with Image.open(first) as im:
        return im.size


def cover(img, w, h):
    """Cover-crop a PIL image to exactly w x h (never stretched)."""
    from PIL import Image
    sw, sh = img.size
    s = max(w / sw, h / sh)
    img = img.convert('RGB').resize((max(w, round(sw * s)), max(h, round(sh * s))), Image.LANCZOS)
    x, y = (img.width - w) // 2, (img.height - h) // 2
    return img.crop((x, y, x + w, y + h))


def mux_audio(video, source, seconds, out):
    """The render's picture with the source clip's sound laid under it (from the start)."""
    run(['ffmpeg', '-y', '-v', 'error', '-i', video, '-i', source, '-map', '0:v', '-map', '1:a:0', '-c:v', 'copy',
         '-c:a', 'aac', '-b:a', '192k', '-t', f'{seconds:.3f}', '-movflags', '+faststart', out])


# ---------------------------------------------------------------- the two models

def viggle_job(inp, job, work, jid):
    ensure_models(VIGGLE_FILES)
    start_comfy()
    src = fetch_media(inp['video'], os.path.join(work, 'source'))
    sw, sh = display_size(src, work)
    # The nearest trained shape to the clip's own
    w, h = min(VIGGLE_LADDER, key=lambda s: abs(math.log((s[0] / s[1]) / (sw / sh))))
    max_sec = max(5.2, min(15.0, float(inp.get('max_seconds') or 10)))
    drive = os.path.join(COMFY_IN, f'{jid}-drive.mp4')
    run(['ffmpeg', '-y', '-v', 'error', '-i', src, '-an', '-t', f'{max_sec:.3f}',
         '-vf', f'fps=24,scale={w}:{h}:force_original_aspect_ratio=increase:flags=lanczos,crop={w}:{h},setsar=1',
         '-c:v', 'libx264', '-crf', '12', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', drive])
    frames = count_frames(drive)
    if frames < 24:
        raise ValueError('the clip is too short - Viggle-Animate needs at least a second (it renders 5 s or more)')
    # 17n+5 frames, at least 124 (its trained minimum - shorter clips are padded and the pad trimmed after)
    length = max(124, math.ceil((frames - 5) / 17) * 17 + 5)
    from PIL import Image
    ref_path = fetch_media(inp['ref'], os.path.join(work, 'ref'))
    ref_name = f'{jid}-ref.png'
    with Image.open(ref_path) as im:
        cover(im, w, h).save(os.path.join(COMFY_IN, ref_name))
    seed = int(inp['seed']) if str(inp.get('seed', '')).strip().isdigit() else random.randint(0, 2**31 - 1)
    graph = {
        'unet': {'class_type': 'UNETLoader', 'inputs': {'unet_name': 'minimax_h3_ref2va_viggle_pruned_int8_convrot.safetensors', 'weight_dtype': 'default'}},
        'lora': {'class_type': 'LoraLoaderModelOnly', 'inputs': {'model': ['unet', 0], 'lora_name': 'viggle_animate_dmd_lora.safetensors', 'strength_model': 1.0}},
        'attn': {'class_type': 'ModelAttentionBackend', 'inputs': {'model': ['lora', 0], 'attention': 'comfy kitchen attention'}},
        'shift': {'class_type': 'MiniMaxH3SigmaShift', 'inputs': {'model': ['attn', 0], 'shift_video': 3.0, 'shift_audio': 3.0}},
        'vae': {'class_type': 'VAELoader', 'inputs': {'vae_name': 'minimax_h3_video_vae_fp16.safetensors'}},
        'tc': {'class_type': 'ViggleTextCondLoader', 'inputs': {'text_cond': 'fixed_embed_fwd_anyframe.safetensors'}},
        'vid': {'class_type': 'LoadVideo', 'inputs': {'file': os.path.basename(drive)}},
        'comp': {'class_type': 'GetVideoComponents', 'inputs': {'video': ['vid', 0]}},
        'ref': {'class_type': 'LoadImage', 'inputs': {'image': ref_name}},
        'cond': {'class_type': 'ViggleAnimateConditioning', 'inputs': {
            'cond_video': ['comp', 0], 'ref_image': ['ref', 0], 'text_cond': ['tc', 0], 'vae': ['vae', 0],
            'width': w, 'height': h, 'length': length}},
        # Viggle's baseline: 4 sigma points = 3 Euler updates, CFG 1 (ManualSigmas - KJ's interpolation NaNs at 4)
        'sig': {'class_type': 'ManualSigmas', 'inputs': {'sigmas': '1.0, 0.8571428571428571, 0.6, 0.0'}},
        'smp': {'class_type': 'KSamplerSelect', 'inputs': {'sampler_name': 'euler'}},
        'noise': {'class_type': 'RandomNoise', 'inputs': {'noise_seed': seed}},
        'guider': {'class_type': 'BasicGuider', 'inputs': {'model': ['shift', 0], 'conditioning': ['cond', 0]}},
        'sample': {'class_type': 'SamplerCustomAdvanced', 'inputs': {'noise': ['noise', 0], 'guider': ['guider', 0], 'sampler': ['smp', 0], 'sigmas': ['sig', 0], 'latent_image': ['cond', 1]}},
        'dec': {'class_type': 'VAEDecode', 'inputs': {'samples': ['sample', 0], 'vae': ['vae', 0]}},
        'mk': {'class_type': 'CreateVideo', 'inputs': {'images': ['dec', 0], 'fps': 24.0}},
        'save': {'class_type': 'SaveVideo', 'inputs': {'video': ['mk', 0], 'filename_prefix': f'viggle/{jid}', 'format': 'mp4',
                 'format.codec': 'h264', 'format.codec.encoding': 're-encode', 'format.codec.encoding.crf': 16}},
    }
    runpod.serverless.progress_update(job, f'viggle: {w}x{h}, {frames} frames (rendering {length})')
    try:
        outputs = run_prompt(graph, job)
    except RuntimeError as e:
        if 'kitchen' not in str(e).lower() and 'attention' not in str(e).lower():
            raise
        log('comfy kitchen attention unavailable - retrying with pytorch attention')
        graph['attn']['inputs']['attention'] = 'pytorch attention'
        outputs = run_prompt(graph, job)
    rendered = output_video(outputs)
    # The pad past the clip's own frames is cut; the source's sound laid under it
    seconds = frames / 24
    out = os.path.join(work, 'out.mp4')
    trimmed = os.path.join(work, 'trim.mp4')
    run(['ffmpeg', '-y', '-v', 'error', '-i', rendered, '-an', '-frames:v', str(frames), '-c:v', 'libx264', '-crf', '16',
         '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', trimmed])
    if inp.get('keep_audio', True) is not False and has_audio(src):
        mux_audio(trimmed, src, seconds, out)
    else:
        shutil.move(trimmed, out)
    os.remove(rendered)
    return out, {'width': w, 'height': h, 'frames': frames, 'fps': 24, 'seconds': round(seconds, 3), 'seed': seed}


def swap_job(inp, job, work, jid):
    ensure_models(SWAP_FILES)
    start_comfy()
    spec = importlib.util.spec_from_file_location('h3_relay_workflows', RELAY_WORKFLOWS)
    wf = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(wf)
    src = fetch_media(inp['video'], os.path.join(work, 'source'))
    max_sec = max(2.0, min(30.0, float(inp.get('max_seconds') or 15)))
    # Relay takes 24 fps constant-rate clips only
    source_name = f'{jid}-source.mp4'
    run(['ffmpeg', '-y', '-v', 'error', '-i', src, '-t', f'{max_sec:.3f}', '-vf', 'fps=24,setsar=1',
         '-c:v', 'libx264', '-crf', '12', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
         os.path.join(COMFY_IN, source_name)])
    from PIL import Image
    ref_path = fetch_media(inp['ref'], os.path.join(work, 'ref'))
    ref_name = f'{jid}-reference.png'
    with Image.open(ref_path) as im:
        im.convert('RGB').save(os.path.join(COMFY_IN, ref_name))
    seed = int(inp['seed']) if str(inp.get('seed', '')).strip().isdigit() else random.randint(0, 2**31 - 1)
    graph = wf.character_swap_graph()
    # What SAM looks for: Relay asks for "person"; the site sends "figure" when
    # SAM finds no person in the first frame (a mannequin, a statue)
    subject = str(inp.get('subject') or '').strip()
    if subject and 'subject' in graph:
        graph['subject']['inputs']['text'] = subject[:60]
    graph['source']['inputs']['file'] = source_name
    graph['reference']['inputs']['image'] = ref_name
    graph['prepare']['inputs']['resolution'] = '480' if str(inp.get('resolution')) == '480' else '768'
    graph['adapter']['inputs']['lora_name'] = SWAP_LORA
    graph['plan']['inputs']['seed'] = seed
    graph['save']['inputs']['filename_prefix'] = f'h3-swap/{jid}'
    runpod.serverless.progress_update(job, 'h3 swap: masking and rendering')
    try:
        outputs = run_prompt(graph, job)
    except RuntimeError as e:
        if 'kitchen' not in str(e).lower() and 'attention' not in str(e).lower():
            raise
        log('comfy kitchen attention unavailable - retrying with pytorch attention')
        graph['attention']['inputs']['attention'] = 'pytorch attention'
        outputs = run_prompt(graph, job)
    rendered = output_video(outputs)
    out = os.path.join(work, 'out.mp4')
    if inp.get('keep_audio', True) is False:
        run(['ffmpeg', '-y', '-v', 'error', '-i', rendered, '-an', '-c:v', 'copy', '-movflags', '+faststart', out])
    else:
        # Relay keeps the source's sound already; faststart for the feed
        run(['ffmpeg', '-y', '-v', 'error', '-i', rendered, '-c', 'copy', '-movflags', '+faststart', out])
    os.remove(rendered)
    w, h = display_size(out, work)
    frames = count_frames(out)
    return out, {'width': w, 'height': h, 'frames': frames, 'fps': 24, 'seconds': round(frames / 24, 3), 'seed': seed}


# ---------------------------------------------------------------- handler

def handler(job):
    inp = job.get('input') or {}
    jid = job.get('id') or uuid.uuid4().hex
    work = os.path.join(WORK, jid)
    os.makedirs(work, exist_ok=True)
    t_all = time.time()
    try:
        action = inp.get('action')
        if action not in ('viggle', 'h3-swap'):
            raise ValueError('action must be "viggle" or "h3-swap"')
        if not inp.get('video'):
            raise ValueError('add the source clip')
        if not inp.get('ref'):
            raise ValueError('add the character picture' if action == 'h3-swap' else 'the repainted frame is missing')
        out_key = inp.get('output_r2_key') or f'runpod/{action}/{jid}.mp4'
        out, meta = (viggle_job if action == 'viggle' else swap_job)(inp, job, work, jid)
        upload(out, out_key, 'video/mp4')
        timings = {'total_s': round(time.time() - t_all, 1)}
        log(f'job {jid} ({action}) done: {meta}, {timings}')
        return {'success': True, 'output_r2_key': out_key, **meta, 'timings': timings, 'handler_version': HANDLER_VERSION}
    except Exception as e:
        traceback.print_exc()
        return {'success': False, 'error': str(e)[:1500], 'handler_version': HANDLER_VERSION}
    finally:
        shutil.rmtree(work, ignore_errors=True)
        for f in glob.glob(os.path.join(COMFY_IN, f'{jid}-*')):
            try:
                os.remove(f)
            except OSError:
                pass


if __name__ == '__main__':
    log(f'handler {HANDLER_VERSION}, models in {MODELS_ROOT}')
    try:
        start_comfy()
    except Exception:
        traceback.print_exc()  # the first job retries and reports it
    runpod.serverless.start({'handler': handler})
