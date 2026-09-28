"""Voice-over for the showcase video — optional, NOT wired into run.sh yet.

Speaks ``script.txt`` (one paragraph per block, blank line between) with the
Kokoro text-to-speech model, fully offline on the CPU, and writes one WAV.
Each paragraph is generated in a single pass so the intonation carries through
it. An optional first line, ``[speed=1.14 pause=0.18]``, sets its speaking speed
and the pause after it in seconds; the direction itself is never spoken.
Use a quicker pace for familiar actions, ease back for a keyboard shortcut or
something the viewer needs to inspect, and leave more space when changing topic.

Setup (once): a Python venv with ``pip install kokoro-onnx soundfile``, plus
the model files next to this script (git-ignored, ~120 MB):
  voices/kokoro-v1.0.int8.onnx  and  voices/voices-v1.0.bin
from https://github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0).
Kokoro uses eSpeak only to look up pronunciations; on NixOS point
``ESPEAK_NG`` at a nixpkgs espeak-ng (the pip-bundled one can't find its data).

    python narrate.py [out.wav]      # → .work/narration.wav by default
"""

from __future__ import annotations

import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "2")  # stay gentle on the CPU

import numpy as np
import onnxruntime as ort
import soundfile as sf
from kokoro_onnx import EspeakConfig, Kokoro

HERE = Path(__file__).resolve().parent
VOICE = "am_michael"
SPEED = 1.14  # brisk default; script directions set the pace for each thought
GAP_S = 0.18  # extra silence between paragraphs, on top of the trimmed edges
FADE_S = 0.005  # smooth the edges without softening consonants
SILENCE = 0.004  # amplitude treated as silence when trimming


@dataclass(frozen=True)
class Block:
    text: str
    speed: float = SPEED
    pause: float = GAP_S


def read_script(path: Path) -> list[Block]:
    blocks = []
    for paragraph in re.split(r"\n\s*\n", path.read_text(encoding="utf-8").strip()):
        lines = paragraph.strip().splitlines()
        if not lines:
            continue
        speed, pause = SPEED, GAP_S
        if lines[0].startswith("["):
            direction = re.fullmatch(
                r"\[speed=(\d+(?:\.\d+)?) pause=(\d+(?:\.\d+)?)\]", lines.pop(0)
            )
            if direction is None:
                raise ValueError("Expected a direction like [speed=1.14 pause=0.18]")
            speed, pause = map(float, direction.groups())
            if not 0.5 <= speed <= 2.0 or not 0 <= pause <= 2.0:
                raise ValueError(
                    "Speed must be 0.5–2.0 and pause must be 0–2.0 seconds"
                )
        text = " ".join(" ".join(lines).split())
        if not text:
            raise ValueError("Each direction needs a paragraph to speak")
        blocks.append(Block(text, speed, pause))
    if not blocks:
        raise ValueError("The narration script is empty")
    return blocks


def trim(samples: np.ndarray, rate: int) -> np.ndarray:
    """Drop the model's leading/trailing silence (keeps 60 ms so words aren't clipped)."""
    loud = np.flatnonzero(np.abs(samples) > SILENCE)
    if not loud.size:
        return samples
    keep = int(rate * 0.06)
    return samples[max(0, loud[0] - keep) : loud[-1] + keep]


def join(parts: list[tuple[np.ndarray, float]], rate: int) -> np.ndarray:
    """Join paragraphs with their directed pauses and a short fade at each edge."""
    out: list[np.ndarray] = []
    for part, pause in parts:
        part = part.astype(np.float32).copy()
        fade = min(int(rate * FADE_S), len(part) // 2)
        if fade:
            ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
            part[:fade] *= ramp
            part[-fade:] *= ramp[::-1]
        out += [part, np.zeros(int(rate * pause), dtype=np.float32)]
    return np.concatenate(out[:-1])


def load_model() -> Kokoro:
    options = ort.SessionOptions()
    options.intra_op_num_threads = int(os.environ["OMP_NUM_THREADS"])
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(
        str(HERE / "voices/kokoro-v1.0.int8.onnx"), sess_options=options
    )
    espeak = os.environ.get("ESPEAK_NG")
    config = (
        EspeakConfig(
            lib_path=f"{espeak}/lib/libespeak-ng.so",
            data_path=f"{espeak}/share/espeak-ng-data",
        )
        if espeak
        else None
    )
    return Kokoro.from_session(
        session, str(HERE / "voices/voices-v1.0.bin"), espeak_config=config
    )


def main() -> None:
    out = (
        Path(sys.argv[1])
        if len(sys.argv) > 1
        else HERE.parent / ".work" / "narration.wav"
    )
    blocks = read_script(HERE / "script.txt")
    kokoro = load_model()
    started, parts, rate = time.time(), [], 24000
    for i, block in enumerate(blocks, 1):
        samples, rate = kokoro.create(
            block.text, voice=VOICE, speed=block.speed, lang="en-us"
        )
        parts.append((trim(samples, rate), block.pause))
        print(
            f"{i}/{len(blocks)}: speed {block.speed:.2f}, pause {block.pause:.2f}s",
            flush=True,
        )
    audio = join(parts, rate)
    out.parent.mkdir(parents=True, exist_ok=True)
    sf.write(out, audio, rate)
    duration = len(audio) / rate
    words = sum(len(block.text.split()) for block in blocks)
    print(
        f"{out}: {duration:.1f}s, {words / duration * 60:.0f} words/min, generated in {time.time() - started:.1f}s"
    )
    # Polish (optional, ffmpeg): gentle low cut, soft compression, broadcast loudness:
    #   ffmpeg -i narration.wav -af "highpass=f=80,acompressor=threshold=-18dB:ratio=2.5:attack=15:release=200,
    #     loudnorm=I=-16:TP=-1.5:LRA=7" -ar 48000 narration-polished.wav


if __name__ == "__main__":
    main()
