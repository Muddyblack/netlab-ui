import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { clipToPreview, framesToClip, frameTimeline } from "./media.mjs";
import { previewStart } from "./recordings.mjs";

const frames = (...times) => times.map((ts, index) => ({ ts, file: `${index}.jpg` }));

test("an empty recording fails instead of keeping a missing clip unnoticed", () => {
  assert.throws(() => framesToClip("ffmpeg", [], "unused.mp4"), /did not capture any video frames/);
});

test("a frame crossing an idle boundary speeds up only the idle part", () => {
  const timing = frameTimeline(frames(0, 4), { idle: [[1, 3]], maxHold: 10 });
  assert.equal(timing.frames[0].duration, 2.5);
});

test("overlapping waits count once", () => {
  const timing = frameTimeline(frames(0, 4), { idle: [[2, 4], [0, 3]], maxHold: 10 });
  assert.equal(timing.frames[0].duration, 1);
});

test("a caption survives both long static frames and time-lapse compression", () => {
  const timing = frameTimeline(frames(0, 1, 9, 10), {
    idle: [[1, 10]],
    captions: [{ text: "Read this", start: 1, end: 10, minSeconds: 4 }],
  });
  assert.equal(timing.captions[0].visibleSeconds, 4);
  assert.ok(timing.captions[0].paddingSeconds > 0);
  assert.equal(timing.captions[0].endSeconds - timing.captions[0].startSeconds, 4);
});

test("padding one caption shifts the next caption without shortening it", () => {
  const timing = frameTimeline(frames(0, 1, 2, 3), {
    captions: [
      { text: "First", start: 0, end: 1, minSeconds: 3 },
      { text: "Second", start: 1, end: 3, minSeconds: 4 },
    ],
  });
  assert.equal(timing.captions[0].visibleSeconds, 3);
  assert.equal(timing.captions[1].startSeconds, 3);
  assert.equal(timing.captions[1].visibleSeconds, 4);
});

test("a caption with no captured frame fails instead of silently disappearing", () => {
  assert.throws(() => frameTimeline(frames(0, 5), {
    captions: [{ text: "Missing caption", start: 1, end: 4, minSeconds: 3 }],
  }), /No recorded frames for caption: Missing caption/);
});

test("already readable captions keep their original pace", () => {
  const timing = frameTimeline(frames(0, 1, 2, 3, 4), {
    captions: [{ text: "Readable", start: 0, end: 4, minSeconds: 3 }],
  });
  assert.equal(timing.captions[0].visibleSeconds, 4);
  assert.equal(timing.captions[0].paddingSeconds, 0);
});

test("preview start follows the title fade on the final compressed timeline", () => {
  const timing = frameTimeline(frames(0, 1, 2, 3, 4), {
    idle: [[0, 4]], contentStart: 2.5,
    captions: [{ kind: "title", text: "Title", start: 0, end: 2, minSeconds: 5 }],
  });
  assert.equal(timing.captions[0].endSeconds, 5);
  assert.equal(timing.contentStartSeconds, 5.25);
});

test("the encoded video preserves both captions for their full reading time", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "showcase-timing-"));
  const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
  try {
    const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];
    const source = colors.map((color, ts) => {
      const file = path.join(dir, `${ts}.ppm`);
      fs.writeFileSync(file, Buffer.concat([Buffer.from("P6\n2 2\n255\n"), Buffer.from([...color, ...color, ...color, ...color])]));
      return { file, ts };
    });
    const clip = path.join(dir, "timing.mp4");
    const timing = framesToClip(ffmpeg, source, clip, {
      width: 64, height: 64, idle: [[0, 2]], contentStart: 1,
      captions: [
        { text: "Red title", kind: "title", start: 0, end: 1, minSeconds: 3 },
        { text: "Green", start: 1, end: 2, minSeconds: 3.5 },
      ],
    });
    const decoded = spawnSync(ffmpeg, ["-v", "error", "-i", clip, "-vf", "scale=1:1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], { maxBuffer: 1024 * 1024 });
    assert.equal(decoded.status, 0, decoded.stderr.toString());
    const counts = [0, 0, 0];
    for (let i = 0; i < decoded.stdout.length; i += 3) {
      const pixel = [...decoded.stdout.subarray(i, i + 3)];
      counts[pixel.indexOf(Math.max(...pixel))] += 1;
    }
    assert.ok(Math.abs(counts[0] / 30 - 3) < 0.07, `red lasted ${counts[0] / 30}s`);
    assert.ok(Math.abs(counts[1] / 30 - 3.5) < 0.07, `green lasted ${counts[1] / 30}s`);
    assert.ok(Math.abs(counts[2] / 30 - 1.6) < 0.07, `tail lasted ${counts[2] / 30}s`);

    const preview = path.join(dir, "preview.webp");
    clipToPreview(ffmpeg, clip, preview, { skip: previewStart(timing), width: 64 });
    // Read the first ANMF image as a standalone WebP: ffmpeg builds without
    // animated WebP decoding can still decode its VP8 frame.
    const webp = fs.readFileSync(preview);
    let firstImage;
    let milliseconds = 0;
    for (let offset = 12; offset + 8 <= webp.length;) {
      const size = webp.readUInt32LE(offset + 4);
      if (webp.toString("ascii", offset, offset + 4) === "ANMF") {
        const frame = webp.subarray(offset + 8, offset + 8 + size);
        milliseconds += frame.readUIntLE(12, 3);
        firstImage ??= frame.subarray(16);
      }
      offset += 8 + size + size % 2;
    }
    assert.ok(firstImage, "preview must contain animation frames");
    const header = Buffer.from("RIFF0000WEBP");
    header.writeUInt32LE(firstImage.length + 4, 4);
    const imageFile = path.join(dir, "first.webp");
    fs.writeFileSync(imageFile, Buffer.concat([header, firstImage]));
    const first = spawnSync(ffmpeg, ["-v", "error", "-i", imageFile, "-vf", "scale=1:1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]);
    assert.equal(first.status, 0, first.stderr.toString());
    assert.ok(first.stdout[1] > 200 && first.stdout[0] < 30, "preview must start with green content, not the red title");
    assert.ok(Math.abs(milliseconds / 1000 - (timing.duration - timing.contentStartSeconds)) < 0.15, `preview lasted ${milliseconds / 1000}s; expected ${timing.duration - timing.contentStartSeconds}s; decoded counts ${counts}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
