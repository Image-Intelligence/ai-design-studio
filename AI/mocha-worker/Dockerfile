# MoCha character-swap worker (RunPod serverless) - see handler.py and README.md.
# ComfyUI + Kijai's WanVideoWrapper, pinned to commits from the same week
# (early June 2026, the wrapper's last update) so the nodes match the core.
FROM pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    HF_HUB_ENABLE_HF_TRANSFER=1 \
    PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

# ffmpeg for the clip work; build-essential because Triton (sage attention) compiles a small launcher at run time
RUN apt-get update && apt-get install -y --no-install-recommends \
        git ffmpeg build-essential libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

ARG COMFY_COMMIT=ec6aa979a627ecbfb7847dad85a4a26a0a3a424a
ARG WRAPPER_COMMIT=088128b224242e110d3906c6750e9a3a348a659b
ARG KJNODES_COMMIT=996b010ae4613ae0743121ace5975830dcf8e6af
ARG VHS_COMMIT=4ee72c065db22c9d96c2427954dc69e7b908444b

WORKDIR /workspace
RUN git clone https://github.com/comfyanonymous/ComfyUI.git && cd ComfyUI && git checkout ${COMFY_COMMIT}
WORKDIR /workspace/ComfyUI/custom_nodes
RUN git clone https://github.com/kijai/ComfyUI-WanVideoWrapper.git && git -C ComfyUI-WanVideoWrapper checkout ${WRAPPER_COMMIT} && \
    git clone https://github.com/kijai/ComfyUI-KJNodes.git && git -C ComfyUI-KJNodes checkout ${KJNODES_COMMIT} && \
    git clone https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git && git -C ComfyUI-VideoHelperSuite checkout ${VHS_COMMIT}

# The base image's CUDA build of torch stays: every requirements file installs
# under these pins, so nothing can swap it for a CPU or older wheel
WORKDIR /workspace
RUN pip install torch==2.8.0 torchvision==0.23.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128 && \
    printf 'torch==2.8.0\ntorchvision==0.23.0\ntorchaudio==2.8.0\n' > /workspace/constraints.txt
RUN pip install -c /workspace/constraints.txt \
        -r ComfyUI/requirements.txt \
        -r ComfyUI/custom_nodes/ComfyUI-WanVideoWrapper/requirements.txt \
        -r ComfyUI/custom_nodes/ComfyUI-KJNodes/requirements.txt \
        -r ComfyUI/custom_nodes/ComfyUI-VideoHelperSuite/requirements.txt
RUN pip install -c /workspace/constraints.txt runpod boto3 "huggingface_hub[hf_transfer]" ultralytics sageattention==1.0.6

# YOLO person segmentation for the automatic first-frame mask (baked in, ~55 MB)
RUN python -c "from ultralytics import YOLO; YOLO('yolo11l-seg.pt')" && test -f /workspace/yolo11l-seg.pt

# Fail the build if any node pack cannot import (CPU-only load, then exit)
RUN cd ComfyUI && python main.py --cpu --quick-test-for-ci > /tmp/comfy-ci.log 2>&1; cat /tmp/comfy-ci.log | tail -40; \
    ! grep -q "IMPORT FAILED" /tmp/comfy-ci.log

COPY handler.py /workspace/handler.py
CMD ["python", "-u", "/workspace/handler.py"]
