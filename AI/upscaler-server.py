#!/usr/bin/env python3
"""Upscaler training server (ESRGAN / DRCT) — port 8766"""

import os, sys, json, time, threading, subprocess, re, shutil, base64, tempfile
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT    = 8766
AI_DIR  = Path(__file__).parent   # lives at AI/upscaler-server.py → AI_DIR = AI/

_state = {
    'status':     'idle',   # idle | preparing | training | done | error | cancelled
    'arch':       None,
    'logs':       [],
    'iter':       0,
    'total_iter': 0,
}
_process = None
_lock    = threading.Lock()

# ── Framework definitions ──────────────────────────────────────────────────────

ARCHS = {
    'esrgan': {
        'label':      'Real-ESRGAN',
        'dir':        AI_DIR / 'Real-ESRGAN',
        'scripts':    ['realesrgan/train.py', 'train.py'],
        'desc':       'GAN-based — fast training, good generalisation, no LR folder needed',
        'setup':      'git clone https://github.com/xinntao/Real-ESRGAN.git\ncd Real-ESRGAN\npython -m venv venv\nvenv\\Scripts\\activate\npip install basicsr facexlib gfpgan\npip install -r requirements.txt\npython setup.py develop',
    },
    'drct': {
        'label':      'DRCT',
        'dir':        AI_DIR / 'DRCT',
        'scripts':    ['train.py', 'drct/train.py'],
        'desc':       'Transformer-based — best for fine skin & face detail, auto-generates LR pairs',
        'setup':      'git clone https://github.com/ming053l/DRCT.git\ncd DRCT\npython -m venv venv\nvenv\\Scripts\\activate\npip install -r requirements.txt',
    },
    'neosr': {
        'label':   'neosr',
        'dir':     AI_DIR / 'neosr',
        'scripts': ['train.py'],
        'desc':    'Unified framework — train SPAN, DAT, RRDBNet, SwinIR, HAT and more',
        'setup':   'git clone https://github.com/muslll/neosr\ncd neosr\nC:\\Users\\Owner\\AppData\\Local\\Programs\\Python\\Python311\\python.exe -m pip install -e .',
    },
}

def _find_script(arch_id):
    a = ARCHS[arch_id]
    for s in a['scripts']:
        p = a['dir'] / s
        if p.exists():
            return str(p)
    return None

def _find_python(arch_id):
    a = ARCHS[arch_id]
    candidates = [
        a['dir']  / '.venv' / 'Scripts' / 'python.exe',   # uv-managed venv
        a['dir']  / '.venv' / 'bin'     / 'python',
        a['dir']  / 'venv'  / 'Scripts' / 'python.exe',
        a['dir']  / 'venv'  / 'bin'     / 'python',
        AI_DIR    / 'upscaler-venv' / 'Scripts' / 'python.exe',
        AI_DIR    / 'upscaler-venv' / 'bin'     / 'python',
        Path(r'C:\Users\Owner\AppData\Local\Programs\Python\Python311\python.exe'),
    ]
    for p in candidates:
        if p.exists():
            return str(p)
    return sys.executable

def arch_info(arch_id):
    a    = ARCHS[arch_id]
    scr  = _find_script(arch_id)
    return {
        'id':        arch_id,
        'label':     a['label'],
        'desc':      a['desc'],
        'setup':     a['setup'],
        'installed': scr is not None,
        'path':      str(a['dir']),
    }

# ── Config generation ──────────────────────────────────────────────────────────

def _cfg(c, key, default):
    return c.get(key, default)

def generate_meta_info(hr_dir, work_dir):
    """Generate meta_info.txt listing all images — required by RealESRGANDataset."""
    hr_path   = Path(hr_dir)
    meta_path = Path(work_dir) / 'meta_info.txt'
    exts      = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff'}
    images    = sorted(f.name for f in hr_path.iterdir()
                       if f.is_file() and f.suffix.lower() in exts)
    with open(meta_path, 'w') as f:
        for img in images:
            f.write(f'{img} 1\n')
    return str(meta_path).replace('\\', '/'), len(images)


def latest_state_for(exp_name):
    """Return (iter, abs_path) of the highest-numbered .state file, or (0, None)."""
    states_dir = AI_DIR / 'Real-ESRGAN' / 'experiments' / exp_name / 'training_states'
    if not states_dir.exists():
        return 0, None
    best_iter, best_path = 0, None
    for f in states_dir.glob('*.state'):
        try:
            i = int(f.stem)
            if i > best_iter:
                best_iter, best_path = i, f
        except ValueError:
            pass
    return best_iter, (str(best_path).replace('\\', '/') if best_path else None)


def make_esrgan_config(c, meta_info_path, resume_state_path=None, pretrain_g_path=None):
    scale     = int(_cfg(c, 'scale', 4))
    patch     = int(_cfg(c, 'patchSize', 256))
    batch     = int(_cfg(c, 'batchSize', 4))
    iters     = int(_cfg(c, 'totalIter', 100000))
    save_freq = int(_cfg(c, 'saveFreq', 5000))
    lr        = float(_cfg(c, 'lr', 1e-4))
    hr        = c['datasetPath'].replace('\\', '/')
    out       = c['outputPath'].replace('\\', '/')
    name      = _cfg(c, 'name', 'custom_esrgan')
    milestone = iters // 2
    meta      = meta_info_path.replace('\\', '/')
    resume    = resume_state_path.replace('\\', '/') if resume_state_path else '~'
    pretrain  = pretrain_g_path.replace('\\', '/')   if pretrain_g_path   else '~'
    strict    = 'false' if pretrain_g_path else 'true'

    return f"""name: {name}
model_type: RealESRGANModel
scale: {scale}
num_gpu: 1
manual_seed: 0

l1_gt_usm: True
percep_gt_usm: True
gan_gt_usm: False

resize_prob: [0.2, 0.7, 0.1]
resize_range: [0.15, 1.5]
gaussian_noise_prob: 0.5
noise_range: [1, 30]
poisson_scale_range: [0.05, 3]
gray_noise_prob: 0.4
jpeg_range: [30, 95]

second_blur_prob: 0.8
resize_prob2: [0.3, 0.4, 0.3]
resize_range2: [0.3, 1.2]
gaussian_noise_prob2: 0.5
noise_range2: [1, 25]
poisson_scale_range2: [0.05, 2.5]
gray_noise_prob2: 0.4
jpeg_range2: [30, 95]

gt_size: {patch}
queue_size: 180

datasets:
  train:
    name: CustomHR
    type: RealESRGANDataset
    dataroot_gt: {hr}
    meta_info: {meta}
    io_backend:
      type: disk
    blur_kernel_size: 21
    kernel_list: ['iso','aniso','generalized_iso','generalized_aniso','plateau_iso','plateau_aniso']
    kernel_prob: [0.45,0.25,0.12,0.03,0.12,0.03]
    sinc_prob: 0.1
    blur_sigma: [0.2,3]
    betag_range: [0.5,4]
    betap_range: [1,2]
    blur_kernel_size2: 21
    kernel_list2: ['iso','aniso','generalized_iso','generalized_aniso','plateau_iso','plateau_aniso']
    kernel_prob2: [0.45,0.25,0.12,0.03,0.12,0.03]
    sinc_prob2: 0.1
    blur_sigma2: [0.2,1.5]
    betag_range2: [0.5,4]
    betap_range2: [1,2]
    final_sinc_prob: 0.8
    gt_size: {patch}
    use_hflip: True
    use_rot: False
    num_worker_per_gpu: 4
    batch_size_per_gpu: {batch}
    dataset_enlarge_ratio: 1
    prefetch_mode: ~

network_g:
  type: RRDBNet
  num_in_ch: 3
  num_out_ch: 3
  num_feat: 64
  num_block: 23
  num_grow_ch: 32
  scale: {scale}

network_d:
  type: UNetDiscriminatorSN
  num_in_ch: 3
  num_feat: 64
  skip_connection: True

path:
  pretrain_network_g: {pretrain}
  strict_load_g: {strict}
  resume_state: {resume}
  experiments_root: {out}

train:
  ema_decay: 0.999
  optim_g:
    type: Adam
    lr: !!float {lr}
    weight_decay: 0
    betas: [0.9,0.99]
  optim_d:
    type: Adam
    lr: !!float {lr}
    weight_decay: 0
    betas: [0.9,0.99]
  scheduler:
    type: MultiStepLR
    milestones: [{milestone}]
    gamma: 0.5
  total_iter: {iters}
  warmup_iter: -1
  pixel_opt:
    type: L1Loss
    loss_weight: 1.0
    reduction: mean
  perceptual_opt:
    type: PerceptualLoss
    layer_weights:
      conv1_2: 0.1
      conv2_2: 0.1
      conv3_4: 1
      conv4_4: 1
      conv5_4: 1
    vgg_type: vgg19
    use_input_norm: true
    range_norm: false
    perceptual_weight: 1.0
    style_weight: 0
    criterion: l1
  gan_opt:
    type: GANLoss
    gan_type: vanilla
    real_label_val: 1.0
    fake_label_val: 0.0
    loss_weight: !!float 1e-1
  net_d_iters: 1
  net_d_init_iters: 0

logger:
  print_freq: 100
  save_checkpoint_freq: !!float {save_freq}
  use_tb_logger: false
  wandb:
    project: ~

dist_params:
  backend: gloo
  port: 29501
"""

def make_drct_config(c, lq_path):
    scale     = int(_cfg(c, 'scale', 4))
    patch     = int(_cfg(c, 'patchSize', 256))
    batch     = int(_cfg(c, 'batchSize', 4))
    iters     = int(_cfg(c, 'totalIter', 100000))
    save_freq = int(_cfg(c, 'saveFreq', 5000))
    lr        = float(_cfg(c, 'lr', 2e-4))
    hr        = c['datasetPath'].replace('\\', '/')
    lq        = lq_path.replace('\\', '/')
    out       = c['outputPath'].replace('\\', '/')
    name      = _cfg(c, 'name', 'custom_drct')
    m1, m2, m3 = iters // 2, iters * 3 // 4, iters * 7 // 8

    return f"""name: {name}
model_type: DRCTModel
scale: {scale}
num_gpu: 1
manual_seed: 0

datasets:
  train:
    name: CustomPaired
    type: PairedImageDataset
    dataroot_gt: {hr}
    dataroot_lq: {lq}
    io_backend:
      type: disk
    gt_size: {patch}
    use_hflip: True
    use_rot: True
    num_worker_per_gpu: 4
    batch_size_per_gpu: {batch}
    dataset_enlarge_ratio: 1
    prefetch_mode: ~

network_g:
  type: DRCT
  upscale: {scale}
  in_chans: 3
  img_size: 64
  window_size: 16
  compress_ratio: 3
  squeeze_factor: 30
  conv_scale: 0.01
  overlap_ratio: 0.5
  img_range: 1.
  depths: [6,6,6,6,6,6]
  embed_dim: 180
  num_heads: [6,6,6,6,6,6]
  mlp_ratio: 2
  upsampler: pixelshuffle
  resi_connection: 1conv

path:
  pretrain_network_g: ~
  strict_load_g: true
  resume_state: ~
  experiments_root: {out}

train:
  ema_decay: 0.999
  optim_g:
    type: Adam
    lr: !!float {lr}
    weight_decay: 0
    betas: [0.9,0.99]
  scheduler:
    type: MultiStepLR
    milestones: [{m1},{m2},{m3}]
    gamma: 0.5
  total_iter: {iters}
  warmup_iter: -1
  pixel_opt:
    type: L1Loss
    loss_weight: 1.0
    reduction: mean

logger:
  print_freq: 100
  save_checkpoint_freq: !!float {save_freq}
  use_tb_logger: false
  wandb:
    project: ~

dist_params:
  backend: gloo
  port: 29502
"""

def make_neosr_config(c, net_type, lq_path, pretrain_g_path=None):
    scale     = int(_cfg(c, 'scale', 4))
    hr_patch  = int(_cfg(c, 'patchSize', 256))
    lr_patch  = max(8, hr_patch // scale)   # neosr patch_size = LR crop size
    batch     = int(_cfg(c, 'batchSize', 4))
    iters     = int(_cfg(c, 'totalIter', 100000))
    save_freq = int(_cfg(c, 'saveFreq', 5000))
    lr_g      = float(_cfg(c, 'lr', 1e-3))
    lr_d      = lr_g / 10
    hr        = c['datasetPath'].replace('/', '\\')
    lq        = lq_path.replace('/', '\\')
    name      = _cfg(c, 'name', f'custom_{net_type}')

    path_block = ''
    if pretrain_g_path:
        pretrain_escaped = pretrain_g_path.replace('\\', '\\\\')
        path_block = f'\n[path]\npretrain_network_g = "{pretrain_escaped}"\nstrict_load_g = false\n'

    hr_escaped = hr.replace('\\', '\\\\')
    lq_escaped = lq.replace('\\', '\\\\')

    warmup_g = min(1600, iters // 60)
    warmup_d = min(600,  iters // 160)

    # transformer archs: enable wavelet_guided; CNN archs: skip it
    TRANSFORMER_ARCHS = {'dat_2', 'hat_s', 'drct', 'srformer_light', 'man', 'rgt_s'}
    is_xfm = net_type in TRANSFORMER_ARCHS
    wavelet_block = f'\nwavelet_guided = true\nwavelet_init = {iters // 12}\n' if is_xfm else ''

    return f'''name = "{name}"
model_type = "image"
scale = {scale}
use_amp = true
bfloat16 = true
fast_matmul = true

[datasets.train]
type = "paired"
dataroot_gt = "{hr_escaped}"
dataroot_lq = "{lq_escaped}"
patch_size = {lr_patch}
batch_size = {batch}
augmentation = ["none", "mixup", "cutmix", "resizemix", "cutblur"]
aug_prob = [0.5, 0.1, 0.1, 0.1, 0.5]
{path_block}
[network_g]
type = "{net_type}"

[network_d]
type = "metagan"

[train]
ema = 0.999{wavelet_block}
[train.optim_g]
type = "adan_sf"
lr = {lr_g}
betas = [0.98, 0.92, 0.99]
weight_decay = 0.01
schedule_free = true
warmup_steps = {warmup_g}

[train.optim_d]
type = "adan_sf"
lr = {lr_d}
betas = [0.98, 0.92, 0.99]
weight_decay = 0.01
schedule_free = true
warmup_steps = {warmup_d}

[train.mssim_opt]
type = "mssim_loss"
loss_weight = 1.0

[train.ldl_opt]
type = "ldl_loss"
loss_weight = 1.0

[train.fdl_opt]
type = "fdl_loss"
model = "dinov2"
loss_weight = 0.75

[train.gan_opt]
type = "gan_loss"
gan_type = "bce"
loss_weight = 0.3

[logger]
total_iter = {iters}
save_checkpoint_freq = {save_freq}
use_tb_logger = true
'''

# ── LR generation for DRCT ────────────────────────────────────────────────────

def generate_lr(hr_dir, lr_dir, scale):
    try:
        from PIL import Image
    except ImportError:
        return False, 'Pillow not installed — run: pip install Pillow'

    hr_path = Path(hr_dir)
    lr_path = Path(lr_dir)
    lr_path.mkdir(parents=True, exist_ok=True)

    exts   = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff'}
    images = [f for f in hr_path.iterdir() if f.is_file() and f.suffix.lower() in exts]
    count  = 0

    for img_file in images:
        try:
            img     = Image.open(img_file).convert('RGB')
            w, h    = img.width // scale, img.height // scale
            if w < 1 or h < 1:
                continue
            lr_img  = img.resize((w, h), Image.LANCZOS)
            lr_img.save(lr_path / (img_file.stem + '.png'))
            count  += 1
        except Exception:
            continue

    return True, f'Generated {count} LR images at 1/{scale} scale'

# ── Training thread ───────────────────────────────────────────────────────────

def _log(msg):
    with _lock:
        _state['logs'].append(msg)
        if len(_state['logs']) > 2000:
            _state['logs'] = _state['logs'][-2000:]

ITER_RE = re.compile(r'iter[:\s\[]*(\d[\d,]*)', re.IGNORECASE)

def _train_thread(arch_id, config_text, work_dir, python_exe):
    global _process
    ext         = 'toml' if arch_id == 'neosr' else 'yml'
    config_path = Path(work_dir) / f'train_config.{ext}'
    config_path.write_text(config_text, encoding='utf-8')

    script = _find_script(arch_id)
    if arch_id == 'neosr':
        cmd = [python_exe, script, '-opt', str(config_path)]
    else:
        cmd = [python_exe, script, '-opt', str(config_path), '--launcher', 'none']

    with _lock:
        _state['status'] = 'training'
        _state['logs']   = _state['logs'][-5:] + ['─' * 60]

    try:
        _log(f'Command: {" ".join(cmd)}')
        _process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            cwd=str(ARCHS[arch_id]['dir']),
            text=True,
            bufsize=1,
        )

        for line in _process.stdout:
            line = line.rstrip()
            if not line:
                continue
            _log(line)
            m = ITER_RE.search(line)
            if m:
                with _lock:
                    _state['iter'] = int(m.group(1).replace(',', ''))

        _process.wait()
        code = _process.returncode
        with _lock:
            if _state['status'] == 'training':
                _state['status'] = 'done' if code == 0 else 'error'
        _log(f'─' * 60)
        _log(f'Exit code: {code}')

    except Exception as e:
        _log(f'Error: {e}')
        with _lock:
            _state['status'] = 'error'
    finally:
        _process = None

def _lr_prep_and_train(cfg, arch_id, work_dir, python_exe, net_type=None):
    """Generates LR pairs in the background then starts training. Keeps the HTTP handler non-blocking."""
    scale  = int(cfg.get('scale', 4))
    lr_dir = str(work_dir / 'lr_auto')

    IMG_EXTS = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff'}
    hr_path  = Path(cfg['datasetPath'])
    lr_path  = Path(lr_dir)
    hr_count = sum(1 for f in hr_path.iterdir() if f.is_file() and f.suffix.lower() in IMG_EXTS)
    lr_count = sum(1 for f in lr_path.iterdir() if f.is_file() and f.suffix.lower() in IMG_EXTS) if lr_path.exists() else 0

    if lr_count == hr_count and lr_count > 0:
        _log(f'Reusing existing LR dataset: {lr_dir} ({lr_count} images)')
    else:
        if lr_count > 0:
            _log(f'LR/HR count mismatch ({lr_count} vs {hr_count}) — regenerating LR dataset...')
            import shutil
            shutil.rmtree(lr_dir, ignore_errors=True)
        else:
            _log(f'Generating LR dataset (1/{scale} of HR) — {hr_count} images...')
        ok, msg = generate_lr(cfg['datasetPath'], lr_dir, scale)
        _log(msg)
        if not ok:
            with _lock:
                _state['status'] = 'error'
            return

    if arch_id == 'neosr':
        pretrain_path = cfg.get('pretrainNetworkG') or None
        if pretrain_path:
            _log(f'Fine-tuning {net_type.upper()} from: {pretrain_path}')
        else:
            _log(f'Starting {net_type.upper()} training from scratch')
        config_text = make_neosr_config(cfg, net_type, lr_dir, pretrain_path)
    else:  # drct
        config_text = make_drct_config(cfg, lr_dir)

    _train_thread(arch_id, config_text, work_dir, python_exe)

def _guess_weight_arch(name: str) -> str:
    n = name.lower()
    if any(x in n for x in ['clearreality', 'span']):        return 'SPAN'
    if any(x in n for x in ['nomos8kdat', 'dat']):           return 'DAT'
    if any(x in n for x in ['swinir', 'hat', 'drct']):       return 'Transformer'
    return 'RRDBNet'

def _guess_weight_scale(name: str) -> int:
    m = re.search(r'^(\d)x', name, re.IGNORECASE)
    return int(m.group(1)) if m else 4

# ── HTTP handler ──────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _send(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(n)) if n else {}

    def do_GET(self):
        if self.path == '/health':
            return self._send({'ok': True})
        if self.path == '/status':
            with _lock:
                return self._send(dict(_state))
        if self.path == '/architectures':
            return self._send([arch_info(aid) for aid in ARCHS])
        if self.path.startswith('/latest-state'):
            from urllib.parse import urlparse, parse_qs
            qs   = parse_qs(urlparse(self.path).query)
            name = (qs.get('name') or [''])[0]
            if not name:
                return self._send({'error': 'name required'}, 400)
            it, path = latest_state_for(name)
            return self._send({'iter': it, 'path': path, 'found': path is not None})
        if self.path == '/weights':
            weights_dir = AI_DIR / 'Real-ESRGAN' / 'weights'
            result = []
            if weights_dir.exists():
                for f in sorted(weights_dir.glob('*.pth')):
                    result.append({
                        'name':  f.name,
                        'path':  str(f).replace('\\', '/'),
                        'arch':  _guess_weight_arch(f.name),
                        'scale': _guess_weight_scale(f.name),
                    })
            return self._send(result)
        if self.path == '/checkpoints':
            checkpoints = []
            exp_root = AI_DIR / 'Real-ESRGAN' / 'experiments'
            if exp_root.exists():
                for exp_dir in sorted(exp_root.iterdir()):
                    if not exp_dir.is_dir() or 'archived' in exp_dir.name:
                        continue
                    models_dir = exp_dir / 'models'
                    if not models_dir.exists():
                        continue
                    for pth in sorted(models_dir.glob('net_g_*.pth'),
                                      key=lambda p: int(re.search(r'\d+', p.stem).group() or '0')):
                        m = re.search(r'net_g_(\d+)', pth.name)
                        if m:
                            checkpoints.append({
                                'name':       pth.name,
                                'path':       str(pth).replace('\\', '/'),
                                'iter':       int(m.group(1)),
                                'experiment': exp_dir.name,
                            })
            return self._send(checkpoints)
        self._send({'error': 'not found'}, 404)

    def do_POST(self):
        if self.path == '/shutdown':
            _log('Shutdown requested — exiting.')
            threading.Thread(target=lambda: (time.sleep(0.3), os._exit(0)), daemon=True).start()
            return self._send({'ok': True})

        if self.path == '/cancel':
            global _process
            if _process and _process.poll() is None:
                _process.terminate()
            with _lock:
                if _state['status'] not in ('done', 'error'):
                    _state['status'] = 'cancelled'
            _log('Training cancelled.')
            return self._send({'ok': True})

        if self.path == '/train':
            cfg     = self._body()
            arch_id = cfg.get('arch', 'esrgan')

            if arch_id not in ARCHS:
                return self._send({'error': f'Unknown arch: {arch_id}'}, 400)
            if not arch_info(arch_id)['installed']:
                return self._send({'error': f'{ARCHS[arch_id]["label"]} not installed'}, 400)

            with _lock:
                if _state['status'] == 'training':
                    return self._send({'error': 'Already training'}, 409)
                _state.update({'arch': arch_id, 'iter': 0,
                               'total_iter': int(cfg.get('totalIter', 100000)),
                               'status': 'preparing', 'logs': []})

            python_exe = _find_python(arch_id)
            out_path   = Path(cfg.get('outputPath', str(AI_DIR / 'upscaler-output')))
            work_dir   = out_path / cfg.get('name', 'run')
            work_dir.mkdir(parents=True, exist_ok=True)

            if arch_id == 'esrgan':
                actual_out = ARCHS[arch_id]['dir'] / 'experiments' / cfg.get('name', 'run')
                _log(f'Models will save to: {actual_out / "models"}')
                resume_path   = cfg.get('resumeStatePath')  or None
                pretrain_path = cfg.get('pretrainNetworkG') or None
                if resume_path:
                    _log(f'Resuming from state:  {resume_path}')
                elif pretrain_path:
                    _log(f'Fine-tuning from:     {pretrain_path}')
                else:
                    _log('Starting fresh (random init)')
                _log('Scanning HR dataset and generating meta_info.txt...')
                meta_path, img_count = generate_meta_info(cfg['datasetPath'], work_dir)
                _log(f'Found {img_count} images → {meta_path}')
                config_text = make_esrgan_config(cfg, meta_path, resume_path, pretrain_path)
                threading.Thread(
                    target=_train_thread,
                    args=(arch_id, config_text, work_dir, python_exe),
                    daemon=True,
                ).start()
            elif arch_id == 'neosr':
                # LR generation can take minutes for large datasets — run non-blocking
                net_type = cfg.get('netType', 'span')
                threading.Thread(
                    target=_lr_prep_and_train,
                    args=(cfg, arch_id, work_dir, python_exe, net_type),
                    daemon=True,
                ).start()
            else:  # drct
                threading.Thread(
                    target=_lr_prep_and_train,
                    args=(cfg, arch_id, work_dir, python_exe, None),
                    daemon=True,
                ).start()

            return self._send({'ok': True, 'arch': arch_id})

        if self.path == '/infer':
            import urllib.request
            cfg        = self._body()
            image_url  = cfg.get('imageUrl', '')
            model_path = cfg.get('modelPath', '')
            scale      = int(cfg.get('scale', 4))

            if not image_url or not model_path:
                return self._send({'error': 'imageUrl and modelPath required'}, 400)
            if not Path(model_path).exists():
                return self._send({'error': f'Model not found: {model_path}'}, 400)

            tmp_in  = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
            tmp_in.close()
            tmp_out = Path(tempfile.mkdtemp())
            try:
                urllib.request.urlretrieve(image_url, tmp_in.name)

                python_exe = _find_python('esrgan')
                script     = AI_DIR / 'Real-ESRGAN' / 'inference_realesrgan.py'
                cmd = [
                    python_exe, str(script),
                    '--model_path', model_path,
                    '-i', tmp_in.name,
                    '-o', str(tmp_out),
                    '--outscale', str(scale),
                    '--fp32',
                ]
                result = subprocess.run(cmd, capture_output=True, text=True,
                                        cwd=str(AI_DIR / 'Real-ESRGAN'), timeout=300)

                if result.returncode != 0:
                    err = (result.stderr or result.stdout or 'Inference failed')[-600:]
                    return self._send({'error': err}, 500)

                out_files = list(tmp_out.glob('*'))
                if not out_files:
                    return self._send({'error': 'No output file generated'}, 500)

                with open(out_files[0], 'rb') as f:
                    out_b64 = 'data:image/png;base64,' + base64.b64encode(f.read()).decode()

                return self._send({'output': out_b64})

            except subprocess.TimeoutExpired:
                return self._send({'error': 'Inference timed out (5-min limit)'}, 504)
            except Exception as e:
                return self._send({'error': str(e)}, 500)
            finally:
                try: os.unlink(tmp_in.name)
                except: pass
                shutil.rmtree(tmp_out, ignore_errors=True)

        self._send({'error': 'not found'}, 404)


if __name__ == '__main__':
    server = HTTPServer(('localhost', PORT), Handler)
    print(f'Upscaler server on port {PORT}', flush=True)
    server.serve_forever()
