FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

RUN apt-get update && apt-get install -y \
    git unzip wget curl \
    libglib2.0-0 libsm6 libxext6 libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Clone OneTrainer pinned to the same commit as local installation
RUN git clone https://github.com/Nerogar/OneTrainer.git && \
    cd OneTrainer && git checkout 423c3b3

# Install OneTrainer deps (torch already in base image, skip reinstall)
WORKDIR /workspace/OneTrainer
RUN pip install --no-cache-dir -r requirements.txt

# Install worker deps
RUN pip install --no-cache-dir runpod boto3 tensorboard peft "diffusers>=0.31.0" \
    realesrgan opencv-python-headless ultralytics huggingface_hub gfpgan timm

# Force-install ONNX-based controlnet_aux (>=0.0.7) in a separate step so it wins
# over any older version pinned by OneTrainer's requirements.txt above.
RUN pip install --no-cache-dir --upgrade "controlnet_aux>=0.0.7"

# Pre-download DWPose and MiDaS models so cold starts don't pay the download cost.
# These are small ONNX/checkpoint files (~1.2 GB total).
RUN python -c "\
from controlnet_aux import DWposeDetector, MidasDetector; \
print('Pre-downloading DWPose...', flush=True); \
DWposeDetector.from_pretrained('yzd-v/DWPose', det_filename='yolox_l.onnx', pose_filename='dw-ll_ucoco_384.onnx'); \
print('Pre-downloading MiDaS...', flush=True); \
MidasDetector.from_pretrained('lllyasviel/Annotators'); \
print('Pre-download complete.', flush=True);" || echo "Warning: controlnet_aux pre-download failed — will retry at runtime"

# Download Real-ESRGAN model weights
RUN mkdir -p /workspace/models/esrgan && \
    wget -q -O /workspace/models/esrgan/RealESRGAN_x4plus.pth \
        https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth && \
    wget -q -O /workspace/models/esrgan/RealESRGAN_x2plus.pth \
        https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth

# 4x-UltraSharp is downloaded at runtime from the user's R2 bucket
# (training/models/esrgan/4x-UltraSharp.pth) — the HuggingFace repo is private.

# Download ADetailer face detection model (same model used by A1111 ADetailer extension)
RUN mkdir -p /workspace/models/adetailer && \
    wget -q -O /workspace/models/adetailer/face_yolov8n.pt \
        https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8n.pt

# Download GFPGAN v1.4 face restoration model
RUN mkdir -p /workspace/models/gfpgan && \
    wget -q -O /workspace/models/gfpgan/GFPGANv1.4.pth \
        https://github.com/TencentARC/GFPGAN/releases/download/v1.3.4/GFPGANv1.4.pth

# IP-Adapter weights + CLIP vision encoder are downloaded at first use inside
# handler.py and cached in MODELS_DIR — keeping them out of the image avoids
# flaky HuggingFace downloads during CI builds.

# Create tensorboard symlink and default samples file
RUN ln -sf $(which tensorboard) /usr/bin/tensorboard && \
    mkdir -p /workspace/OneTrainer/training_samples && \
    echo '[]' > /workspace/OneTrainer/training_samples/samples.json

# Override with our customized/patched files
COPY FluxModelLoader.py /workspace/OneTrainer/modules/modelLoader/flux/FluxModelLoader.py
COPY TrainConfig.py /workspace/OneTrainer/modules/util/config/TrainConfig.py
COPY GenericTrainer.py /workspace/OneTrainer/modules/trainer/GenericTrainer.py
COPY single_file_utils.py /workspace/OneTrainer/src/diffusers/src/diffusers/loaders/single_file_utils.py
COPY flux1dev_transformer_config/ /workspace/OneTrainer/flux1dev_transformer_config/
COPY flux1dev_vae_config/ /workspace/OneTrainer/flux1dev_vae_config/

WORKDIR /workspace
COPY handler.py /workspace/handler.py

CMD ["python", "-u", "/workspace/handler.py"]
