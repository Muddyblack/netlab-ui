import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { replaceOpeningTitle } from "./intro.mjs";

const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
const run = (args) => execFileSync(ffmpeg, ["-v", "error", "-nostdin", "-y", ...args]);

test("the loading intro replaces only the first title and retains every later scene before the outro", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "showcase-intro-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const first = path.join(dir, "first.mp4");
  const last = path.join(dir, "last.mp4");
  const intro = path.join(dir, "intro.mp4");
  const outro = path.join(dir, "outro.mp4");
  const output = path.join(dir, "edited.mp4");
  for (const [file, color, seconds, filters] of [
    [first, "red", 2, ["-vf", "drawbox=color=blue:t=fill:enable='gte(t,0.5)'"]],
    [outro, "magenta", 1, []], [last, "lime", 1, []], [intro, "yellow", 1, []],
  ]) {
    run(["-f", "lavfi", "-i", `color=${color}:s=64x64:r=10:d=${seconds}`, ...filters,
      "-c:v", "libx264", "-video_track_timescale", "15360", file]);
  }
  const original = fs.readFileSync(first);
  replaceOpeningTitle(ffmpeg, [first, last], 0.5, intro, output, outro);
  assert.deepEqual(fs.readFileSync(first), original, "source feature remains unchanged");
  const pixels = run(["-i", output, "-vf", "scale=1:1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]);
  assert.equal(pixels.length / 3, 45, "1s intro + 1.5s first content + 1s final scene + 1s outro");
  for (let frame = 0; frame < 45; frame++) {
    const [r, g, b] = pixels.subarray(frame * 3, frame * 3 + 3);
    if (frame < 10) assert.ok(r > 180 && g > 180 && b < 30, "intro comes first");
    else if (frame >= 13 && frame < 25) assert.ok(b > 180 && r < 30, "first title is removed, content stays");
    else if (frame >= 35) assert.ok(r > 180 && b > 180 && g < 30, "outro follows every feature");
    else if (frame >= 25) assert.ok(g > 180 && r < 30 && b < 30, "later scenes stay in order");
  }
});
