# MiniMax H3 worker (RunPod serverless)

One endpoint serves two admin-only video models built on MiniMax H3 Ref2VA:

| Site model | `action` | What it does |
|---|---|---|
| **Viggle Animate** (`runpod-viggle`) | `viggle` | Replaces the person in a clip, working from one repainted frame of that clip. The site makes that frame with NanoBanana from your character picture before it submits the job. |
| **H3 Character Swap** (`runpod-h3-swap`) | `h3-swap` | H3 plus akatz-ai's Character Swap LoRA v1.5, running the H3 Relay workflow. SAM 3.1 masks and tracks the person, the clip is rendered in 124-frame windows, and the original sound is kept. |

See `handler.py` for the job input and output.

**License:** both models are derivatives of MiniMax H3 and use the MiniMax H3 Community License. That license excludes the USA, EU, UK and South Korea unless MiniMax grants a separate license.

## 1. Build the image
1. Push this folder. `/AI/` is git-ignored, so add it with `git add -f AI/h3-worker`.
2. `.github/workflows/build-h3-worker.yml` builds it and pushes `<DOCKERHUB_USERNAME>/h3-worker:latest`. It uses the same Docker Hub secrets as the FLUX worker.

## 2. Network volume (needed)
- Create one of at least **150 GB**, in a data centre that has 80 GB GPUs.
- Each model downloads its weights into `/runpod-volume/h3-models` on its first job:
  - Viggle: about 30 GB
  - H3 swap: about 47 GB
- Expect that first job to take a while. Later cold starts only load the weights.

## 3. Serverless endpoint
| Setting | Value |
|---|---|
| Container image | `<DOCKERHUB_USERNAME>/h3-worker:latest` |
| GPU | **80 GB** (A100 or H100). Both int8 transformers are about 21 GB each, plus a 16 GB text encoder for H3 swap. |
| Container disk | 30 GB |
| Network volume | the one from step 2 |
| Max workers | 1–2 while testing |
| Idle timeout | 120 s |
| Env | `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, with the **same values as the FLUX endpoint**. |

## 4. Tell the site
1. Add the endpoint id as `RUNPOD_H3_ENDPOINT_ID` in `.env.local` and in Vercel. Both models use it.
2. `RUNPOD_API_KEY` is already set.

## Notes
- **Viggle Animate:**
  - Holds well to about 10 seconds. The default renders 10 s of the clip, and the maximum is 15 s.
  - It works at its own 480-class sizes.
  - If the repaint looks wrong, the run fails at submit with NanoBanana's reason, and nothing is charged.
- **H3 Character Swap:**
  - The default is 15 s at 768p. Up to 30 s is available.
  - Lip sync is not reliable, and the identity can drift when the person leaves the frame and comes back.
- **Attention fallback:** if comfy-kitchen's int8 attention isn't available on the card, the worker retries with PyTorch attention.
