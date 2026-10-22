# MoCha worker (RunPod serverless)

Character replacement for the site's admin-only **MoCha** video model
(`runpod-mocha`, `lib/runpod-video-models.ts`). You give it a clip and 1-2
pictures of a character, and it replaces the person in the clip. It runs
Kijai's ComfyUI-WanVideoWrapper MoCha workflow headless, and masks the clip's
person itself on the first frame, so no clicking is needed. See `handler.py`
for the job input and output.

## 1. Build the image
1. Push this folder. `/AI/` is git-ignored, so add it with
   `git add -f AI/mocha-worker`.
2. `.github/workflows/build-mocha-worker.yml` builds it and pushes
   `<DOCKERHUB_USERNAME>/mocha-worker:latest`. It uses the same Docker Hub
   secrets as the FLUX worker.
3. The build fails on purpose if any ComfyUI node pack can't import.

## 2. Network volume (recommended)
- Create a RunPod network volume of at least **40 GB**, in a data centre that
  has the GPU you'll use.
- The first job downloads about 27 GB of weights into
  `/runpod-volume/mocha-models`. Later cold starts skip the download.
- Without a volume, every cold start downloads the weights again (minutes).

## 3. Serverless endpoint
| Setting | Value |
|---|---|
| Container image | `<DOCKERHUB_USERNAME>/mocha-worker:latest` |
| GPU | **48 GB** (L40S / A6000 Ada) to start, with **80 GB** (A100 / H100) as a second choice. 720p and longer runs need the 80 GB card. |
| Container disk | 20 GB |
| Network volume | the one from step 2 |
| Max workers | 1-2 while testing |
| Idle timeout | 60-120 s, so back-to-back tests reuse the warm worker |
| Execution timeout | leave it; the site sends 90 minutes per job |
| Env | `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, the **same values as the FLUX endpoint**. They must point at the site's private media bucket, because the worker reads the clip and pictures from it and writes the result there. |

## 4. Tell the site
1. Add the endpoint's id as `RUNPOD_MOCHA_ENDPOINT_ID` in `.env.local` and in
   Vercel.
2. `RUNPOD_API_KEY` is already set (the FLUX endpoint uses it).

Without these, the model answers "endpoint is not set up yet" and nothing is
charged.

## Notes
- **Trained length:** MoCha was trained on 81-frame clips at 832x480. 480p and
  81 frames are the defaults; longer runs and 720p are untested.
- **Portrait clips:** they render 480x832. Kijai's path takes any size, but
  MoCha's own script was landscape-only, so check the first portrait result.
- **Mask:** the mask the worker used is saved next to each video
  (`...-mask.png`, in the run's `videoMetadata.runpod.maskUrl`). If the swap
  hits the wrong person, look there first.
- **License:** MoCha's weights are AGPL-3.0, and the authors say "intended
  solely for academic research". Settle this before the model goes public.
