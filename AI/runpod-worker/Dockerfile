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
    realesrgan opencv-python-headless ultralytics huggingface_hub

# Download Real-ESRGAN model weights
RUN mkdir -p /workspace/models/esrgan && \
    wget -q -O /workspace/models/esrgan/RealESRGAN_x4plus.pth \
        https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth && \
    wget -q -O /workspace/models/esrgan/RealESRGAN_x2plus.pth \
        https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth

# Download ADetailer face detection model (same model used by A1111 ADetailer extension)
RUN mkdir -p /workspace/models/adetailer && \
    wget -q -O /workspace/models/adetailer/face_yolov8n.pt \
        https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8n.pt

# Download IP-Adapter weights + CLIP vision encoder (baked in to avoid first-run download)
RUN python -c "\
from huggingface_hub import hf_hub_download, snapshot_download; \
import os, shutil; \
os.makedirs('/workspace/models/ip_adapter', exist_ok=True); \
p = hf_hub_download('InstantX/FLUX.1-dev-IP-Adapter', 'ip_adapter.bin'); \
shutil.copy(p, '/workspace/models/ip_adapter/ip_adapter.bin'); \
print('IP-Adapter weights ready')"

RUN python -c "\
from transformers import CLIPVisionModelWithProjection; \
import torch; \
m = CLIPVisionModelWithProjection.from_pretrained('openai/clip-vit-large-patch14'); \
m.save_pretrained('/workspace/models/clip_vision'); \
print('CLIP vision encoder ready')"

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
