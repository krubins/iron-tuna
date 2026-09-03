# The podcast desk

Three scripts, one episode, no network at build time beyond the data pull.

| Step | Script | What it does |
|---|---|---|
| 1 | `dump-column.mjs` | Runs the worker's own Vegas-column code (lifted the way `tools/test-worker-column.mjs` lifts it) against the live nflverse game lines and writes the board to JSON. Same functions, same feed, committed availability applied, so it matches `/api/vegas-column`. |
| 2 | `write-ep01.py` | Writes the episode script (speaker-tagged JSON) and the show notes (Markdown: board table, digest, transcript) from that snapshot. Every number in the dialogue comes from the JSON. If a named player has left the board it stops and says so rather than voicing stale copy. |
| 3 | `build-episode.py` | Voices the script with Kokoro (82M, via sherpa-onnx, offline), pauses between lines, loudness-normalises and encodes the MP3 with the static ffmpeg from the imageio-ffmpeg wheel. |

## One-time setup

```bash
pip install sherpa-onnx soundfile numpy imageio-ffmpeg
mkdir -p tools/podcast/models && cd tools/podcast/models
curl -L -O https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-en-v0_19.tar.bz2
tar xjf kokoro-en-v0_19.tar.bz2 && rm kokoro-en-v0_19.tar.bz2
```

The model directory is git-ignored (300 MB). `KOKORO_DIR` overrides the location.

## Build an episode

```bash
NODE_USE_ENV_PROXY=1 node tools/podcast/dump-column.mjs podcast/ep01-vegas-vs-adp.data.json
python3 tools/podcast/write-ep01.py podcast/ep01-vegas-vs-adp.data.json podcast/ep01-vegas-vs-adp
python3 tools/podcast/build-episode.py podcast/ep01-vegas-vs-adp.script.json podcast/ep01-vegas-vs-adp.mp3
```

Voices: speaker `A` (host) is Kokoro `am_michael` (sid 6), speaker `B` (the numbers desk) is `af_bella` (sid 1).
The eleven Kokoro v0.19 voices by sid: 0 af, 1 af_bella, 2 af_nicole, 3 af_sarah, 4 af_sky, 5 am_adam,
6 am_michael, 7 bf_emma, 8 bf_isabella, 9 bm_george, 10 bm_lewis. `PODCAST_SPEED` (default 1.0) scales pace.

A few player names are respelled for the phonemiser in `SAY` inside `write-ep01.py`; the show notes carry the real spelling.

## Voice

The site's own: a projections-first analyst who is allowed to be funny but never instead of being useful. The odds
get a vote, not a veto. Game lines are not player props, and the episode says so. Nothing names or imitates a real
writer or broadcaster.
