#!/usr/bin/env python3
"""Voice a speaker-tagged script into an MP3, fully offline.

Kokoro (82M) through sherpa-onnx: two voices, a short pause between lines,
a longer one at a section break, loudness-normalised and encoded with the
static ffmpeg that ships in the imageio-ffmpeg wheel. No network at build
time; see README.md for the one-time model download.

  python3 tools/podcast/build-episode.py podcast/ep01-vegas-vs-adp.script.json podcast/ep01-vegas-vs-adp.mp3
"""
import json, os, subprocess, sys, tempfile, time
import numpy as np
import soundfile as sf
import sherpa_onnx
import imageio_ffmpeg

script_path, out_mp3 = sys.argv[1], sys.argv[2]
MODEL = os.environ.get("KOKORO_DIR", os.path.join(os.path.dirname(__file__), "models", "kokoro-en-v0_19"))
for f in ("model.onnx", "voices.bin", "tokens.txt", "espeak-ng-data"):
    if not os.path.exists(os.path.join(MODEL, f)):
        sys.exit(f"missing {f} in {MODEL}: download kokoro-en-v0_19 first (README.md)")

script = json.load(open(script_path))
cfg = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
    kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
        model=f"{MODEL}/model.onnx", voices=f"{MODEL}/voices.bin",
        tokens=f"{MODEL}/tokens.txt", data_dir=f"{MODEL}/espeak-ng-data"),
    num_threads=max(2, os.cpu_count() or 2), provider="cpu"))
tts = sherpa_onnx.OfflineTts(cfg)
SR = tts.sample_rate
LINE_GAP, BREAK_GAP, SPEED = 0.45, 1.1, float(os.environ.get("PODCAST_SPEED", "1.0"))

def silence(sec): return np.zeros(int(SR * sec), dtype=np.float32)
parts, t0 = [silence(0.6), ], time.time()
for n, seg in enumerate(script["segments"]):
    if "break" in seg:
        parts.append(silence(float(seg["break"]) or BREAK_GAP)); continue
    sid = script["voices"][seg["speaker"]]["sid"]
    a = tts.generate(seg["text"], sid=sid, speed=SPEED)
    x = np.asarray(a.samples, dtype=np.float32)
    parts += [x, silence(LINE_GAP)]
    print(f"  {n+1:3d}/{len(script['segments'])} {seg['speaker']} {len(x)/SR:5.1f}s  {seg['text'][:60]}", flush=True)
parts.append(silence(1.0))
audio = np.concatenate(parts)
print(f"synthesised {len(audio)/SR/60:.1f} min in {time.time()-t0:.0f}s")

with tempfile.TemporaryDirectory() as td:
    wav = os.path.join(td, "ep.wav")
    sf.write(wav, audio, SR)
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    meta = ["-metadata", f"title={script['title']}", "-metadata", "artist=Iron Tuna",
            "-metadata", f"album=Iron Tuna, the auction desk", "-metadata", f"track={script.get('episode', 1)}",
            "-metadata", f"date={script.get('pulledAt', '')[:10]}"]
    cmd = [ff, "-y", "-loglevel", "error", "-i", wav, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
           "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "96k", *meta, out_mp3]
    subprocess.run(cmd, check=True)
print("wrote", out_mp3, f"{os.path.getsize(out_mp3)/1e6:.1f} MB")
