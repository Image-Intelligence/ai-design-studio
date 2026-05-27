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

# Install worker deps (diffusers>=0.31 required for FluxImg2ImgPipeline)
RUN pip install --no-cache-dir runpod boto3 tensorboard peft "diffusers>=0.31.0" \
    realesrgan opencv-python-headless

# Download Real-ESRGAN model weights (baked into image so inference starts instantly)
RUN mkdir -p /workspace/models/esrgan && \
    wget -q -O /workspace/models/esrgan/RealESRGAN_x4plus.pth \
        https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth && \
    wget -q -O /workspace/models/esrgan/RealESRGAN_x2plus.pth \
        https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth

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
