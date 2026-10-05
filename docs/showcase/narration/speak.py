"""Voice-over for the Shorts: speaks each caption to its own WAV (shorts.mjs).

    python speak.py lines.json

``lines.json`` is a list of ``{"text", "out", "speed", "fit"}``. A line longer
than ``fit`` seconds is spoken again, a little faster (up to 1.2×; beyond that
it sounds rushed, so ``fits`` comes back false and the text should be cut).
Prints the list back as JSON, with each line's ``duration``.

Kokoro, offline on the CPU. shorts.mjs sets up the venv; the model files are
git-ignored, in ``voices/``: kokoro-v1.0.int8.onnx and voices-v1.0.bin from
https://github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0).
Kokoro uses eSpeak only to look up pronunciations; on NixOS ``ESPEAK_NG``
points at a nixpkgs espeak-ng (the pip-bundled one can't find its data).
Voice: ``SHOWCASE_VOICE``, one Kokoro voice or a blend such as
``am_michael:0.6,am_fenrir:0.4`` (a blend of two softens each one's quirks).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "2")  # stay gentle on the CPU

import numpy as np
import onnxruntime as ort
import soundfile as sf
from kokoro_onnx import EspeakConfig, Kokoro

HERE = Path(__file__).resolve().parent
VOICE = os.environ.get("SHOWCASE_VOICE", "am_michael:0.5,am_fenrir:0.5")
MAX_SPEED = 1.2
SILENCE = 0.004  # amplitude treated as silence when trimming


def trim(samples: np.ndarray, rate: int) -> np.ndarray:
    """Drop the model's leading/trailing silence (keeps 60 ms so words aren't clipped)."""
    loud = np.flatnonzero(np.abs(samples) > SILENCE)
    if not loud.size:
        return samples
    keep = int(rate * 0.06)
    return samples[max(0, loud[0] - keep) : loud[-1] + keep]


def load_model() -> Kokoro:
    options = ort.SessionOptions()
    options.intra_op_num_threads = int(os.environ["OMP_NUM_THREADS"])
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(HERE / "voices/kokoro-v1.0.int8.onnx"), sess_options=options)
    espeak = os.environ.get("ESPEAK_NG")
    config = (
        EspeakConfig(lib_path=f"{espeak}/lib/libespeak-ng.so", data_path=f"{espeak}/share/espeak-ng-data")
        if espeak
        else None
    )
    return Kokoro.from_session(session, str(HERE / "voices/voices-v1.0.bin"), espeak_config=config)


# Kokoro was trained on misaki's phonemes, but kokoro-onnx hands it raw eSpeak
# IPA. The differences are what made it sound off: "tʃ"/"dʒ" as two symbols
# ("choose" came out as "shoos"), eSpeak's "ʲ" marks ("the app"), length marks
# and two-letter diphthongs. This is misaki's own eSpeak → misaki mapping
# (US English), longest first.
MISAKI = [
    ("ʔˌn̩", "ʔn"), ("ʔn̩", "ʔn"), ("ɜːɹ", "ɜɹ"),
    ("aɪ", "I"), ("aʊ", "W"), ("eɪ", "A"), ("oʊ", "O"), ("ɔɪ", "Y"),
    ("dʒ", "ʤ"), ("tʃ", "ʧ"), ("ɪə", "iə"), ("ɜː", "ɜɹ"),
    ("ʔ", "t"), ("e", "A"), ("r", "ɹ"), ("x", "k"), ("ç", "k"), ("ɐ", "ə"), ("ɚ", "əɹ"),
    ("ɬ", "l"), ("ʲ", ""), ("̃", ""), ("ː", ""),
    ("ɹɹ", "ɹ"),  # "ɚɹ" → "əɹɹ" (monitoring)
]


def to_misaki(phonemes: str) -> str:
    for old, new in MISAKI:
        phonemes = phonemes.replace(old, new)
    return phonemes


def voice_style(kokoro: Kokoro, spec: str) -> np.ndarray:
    """``name`` or ``name:weight,name:weight`` → one style vector."""
    parts = [(name, float(weight or 1)) for name, _, weight in (p.strip().partition(":") for p in spec.split(","))]
    total = sum(weight for _, weight in parts)
    return sum(kokoro.get_voice_style(name) * (weight / total) for name, weight in parts)


PAUSE_S = 0.35  # silence for "…": a beat between listed items


def phrases(kokoro: Kokoro, text: str) -> list[str]:
    """Phonemes for each piece of ``text`` between "…" pauses. A piece before a
    pause keeps the "…" so its pitch trails off like the start of a list."""
    pieces = [p.strip() for p in text.replace("...", "…").split("…")]
    out = []
    for i, piece in enumerate(pieces):
        if not piece:
            continue
        phonemes = to_misaki(kokoro.tokenizer.phonemize(piece, "en-us"))
        out.append(phonemes + ("…" if i < len(pieces) - 1 and not phonemes.endswith((".", "?", "!")) else ""))
    return out


def synthesize(kokoro: Kokoro, style: np.ndarray, pieces: list[str], speed: float) -> tuple[np.ndarray, int]:
    audio, rate = [], 24000
    for i, phonemes in enumerate(pieces):
        samples, rate = kokoro.create(phonemes, voice=style, speed=speed, lang="en-us", is_phonemes=True)
        audio.append(trim(samples, rate))
        if i < len(pieces) - 1:
            audio.append(np.zeros(int(rate * PAUSE_S), dtype=np.float32))
    return np.concatenate(audio), rate


def main() -> None:
    lines = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    kokoro = load_model()
    style = voice_style(kokoro, VOICE)
    for line in lines:
        speed = line.get("speed", 1.12)
        pieces = phrases(kokoro, line["text"])
        line["phonemes"] = " | ".join(pieces)
        while True:
            samples, rate = synthesize(kokoro, style, pieces, speed)
            duration = len(samples) / rate
            fit = line.get("fit")
            if not fit or duration <= fit or speed >= MAX_SPEED:
                break
            speed = min(MAX_SPEED, speed * duration / fit * 1.02)
        sf.write(line["out"], samples, rate)
        line.update(duration=duration, speed=speed, fits=not line.get("fit") or duration <= line["fit"])
    json.dump(lines, sys.stdout)


if __name__ == "__main__":
    main()
