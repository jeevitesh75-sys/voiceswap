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

`basic` works out of the box but it only changes pitch and tone. **It cannot copy a real person's voice.** For a real clone you need the AI converter (Seed-VC) on a GPU.

### Real cloning with a free GPU (no card): Google Colab
One-time on Render -> your service -> Environment: add `VC_ENGINE` = `http` and `CONVERTER_KEY` = a secret word you choose (8+ letters). Save.

Each time you want AI cloning:
1. Open colab.research.google.com on your phone (Chrome menu -> Desktop site helps). File -> Upload notebook -> choose `VoiceSwap_Converter.ipynb`.
2. In the first code cell type your website address (`SITE_URL`) and the same secret word (`KEY`).
3. Runtime -> Change runtime type -> T4 GPU. Then Runtime -> Run all. First time takes 5-10 minutes.
4. When it prints `CONNECTED to your website`, the site uses the AI voice. The notebook sends its new address to the website by itself, now and every minute, so you never copy an address.
5. Keep the Colab page open. If Colab stops, the site shows "converter is not connected" until you run it again.

This is fine for testing and demos, not for a paid service. For that, rent a GPU and run `/converter` (see its Dockerfile) with a fixed address in `CONVERTER_URL`.

The converter server and the registration were tested with a fake model. The real Seed-VC model, the Colab install and the free tunnel were **not** tested. If a Colab step shows a red error, copy it and send it to your developer.

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
