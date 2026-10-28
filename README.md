# VoiceSwap

A web app (PWA) that changes a voice note into a voice you have permission to use.

- **My voices**: save a voice from a 10-60 second sample. A permission box must be ticked.
- **Share to VoiceSwap**: after it is installed, it appears in Android's Share menu. Share a WhatsApp or Instagram voice note to it, pick a voice, then share the new audio back.
- **Voice 2 -> Voice 1**: upload audio A (the voice you want) and audio B (the speech). You get B's words in A's voice.
- Fun voices (deep, child, news anchor, robot) in basic mode.

It cannot change your voice live inside WhatsApp or phone calls. Android does not allow it.

## Two engines (important)

| Engine | Cost | Quality | Speed |
|---|---|---|---|
| `basic` (default) | free, no GPU | moves pitch and tone only. It is NOT an exact clone. | fast |
| `http` or `replicate` | needs a GPU | real AI voice conversion | fast on a GPU, very slow on a free CPU |

`basic` works out of the box. For a real clone, run the converter in `/converter` on a GPU machine and set `VC_ENGINE=http`. The converter and the `replicate` engine are written but were **not tested** against the real services.

## Run it on your computer or in Termux (to try it)

```
npm test          # 10 tests
npm start         # http://localhost:7860
```
Needs Node 18+ and ffmpeg (`pkg install ffmpeg nodejs` in Termux).

## Put it online (no card)

Share from your phone only works over **https**, so you must host it.
1. Push this folder to a private GitHub repo.
2. On Render.com (Web Service, Docker, free plan) or a Hugging Face Space (Docker), connect the repo. The Dockerfile is ready.
3. Open the address in Chrome on your phone. Menu -> Add to Home screen -> Install.
4. Share a voice note from WhatsApp -> VoiceSwap. (Test this on your phone: not every WhatsApp version shows Share for voice notes. If it does not, use "Choose an audio".)

Free hosts erase saved voices when they restart or sleep. For a real product, attach a disk and set `DATA_DIR` to it.

## Settings

Copy `.env.example` to `.env` (or add the same names in your host's dashboard). Everything is optional.

## Rules built in

- Cannot save a voice without the permission tick (the time is stored).
- No celebrity voice library.
- Files get an "AI voice" label inside them (user can turn it off) and the result page reminds the user to say it is AI.
- Rate limits, file type and size checks. Results are deleted after 24 hours.
- Terms page at `/terms.html`.

## Honest limits

- The permission tick cannot prove consent. The owner of the site is responsible for how it is used.
- Saved voices are identified by a random id kept in the browser (no login). Clearing browser data loses access to them. Add real login before selling widely.
- The WhatsApp Share steps and the real-GPU engines were not tested on real phones or real services.
- Sharing the result back sends an audio file, not a WhatsApp voice-note bubble.
