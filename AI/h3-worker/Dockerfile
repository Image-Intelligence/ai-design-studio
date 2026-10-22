# MiniMax H3 character-swap worker (Viggle-Animate + H3 Character Swap LoRA) -
# RunPod serverless. See handler.py and README.md.
# ComfyUI v0.42.0 (2026-10-18, has the core MiniMax-H3 nodes), the Viggle and
# H3 Relay node packs at their latest tags, PyTorch 2.11 cu128 (the version
# H3 Relay was qualified on).
FROM pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    HF_HUB_ENABLE_HF_TRANSFER=1 \
    PYTORCH_ALLOC_CONF=expandable_segments:True \
    PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

RUN apt-get update && apt-get install -y --no-install-recommends \
        git ffmpeg build-essential libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

ARG COMFY_COMMIT=355cd6b14c92c19ac3188fe528e47a3f21ef5178
ARG VIGGLE_COMMIT=6ae081af5b3175f99ef7cddebd5dfaf93390ab70
ARG RELAY_COMMIT=e2a7665b6eb8ea37a88c0de2c9c6b69a8f7c9220

WORKDIR /workspace
RUN git clone https://github.com/comfyanonymous/ComfyUI.git && cd ComfyUI && git checkout ${COMFY_COMMIT}
WORKDIR /workspace/ComfyUI/custom_nodes
RUN git clone https://github.com/Saganaki22/ComfyUI-Viggle-Animate-H3.git && git -C ComfyUI-Viggle-Animate-H3 checkout ${VIGGLE_COMMIT} && \
    git clone https://github.com/akatz-ai/h3-relay.git && git -C h3-relay checkout ${RELAY_COMMIT}

# PyTorch 2.11 (cu128) in place of the base image's 2.8; everything after
# installs under these pins so nothing can swap it for another build
WORKDIR /workspace
RUN pip install torch==2.11.0 torchvision==0.26.0 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cu128 && \
    printf 'torch==2.11.0\ntorchvision==0.26.0\ntorchaudio==2.11.0\n' > /workspace/constraints.txt
RUN pip install -c /workspace/constraints.txt -r ComfyUI/requirements.txt
RUN pip install -c /workspace/constraints.txt runpod boto3 "huggingface_hub[hf_transfer]" pillow

# Fail the build if a node pack cannot import (CPU-only load, then exit)
RUN cd ComfyUI && python main.py --cpu --quick-test-for-ci > /tmp/comfy-ci.log 2>&1; tail -40 /tmp/comfy-ci.log; \
    ! grep -q "IMPORT FAILED" /tmp/comfy-ci.log

COPY handler.py /workspace/handler.py
CMD ["python", "-u", "/workspace/handler.py"]
