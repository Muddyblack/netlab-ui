// ffmpeg helpers: stills → WebP, screencast frames → MP4 clip + animated
// WebP preview, clips → one showcase video.
//
// ffmpeg is found on PATH, in $FFMPEG, or fetched once into
// docs/showcase/.cache via the imageio-ffmpeg Python package (a static
// build with libx264 and libwebp).

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Pixel size of every rendered video. The pages are laid out at a fixed
 * 1600×900 CSS viewport; this only decides how many device pixels we capture
 * and encode (1080 → 1920×1080, 1440 → 2560×1440, 2160 → 3840×2160), so the
 * layout never changes. Override with SHOWCASE_HEIGHT.
 */
export const LAYOUT = { width: 1600, height: 900 };
const OUTPUT_HEIGHT = Number(process.env.SHOWCASE_HEIGHT) || 1440;
export const OUTPUT = { width: Math.round(OUTPUT_HEIGHT * 16 / 9), height: OUTPUT_HEIGHT };
export const PIXEL_RATIO = OUTPUT.width / LAYOUT.width;
export const CRF = "18";

const has = (bin, args = ["-version"]) => spawnSync(bin, args, { stdio: "ignore" }).status === 0;

function encoders(bin) {
  const out = spawnSync(bin, ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout ?? "";
  return { x264: out.includes("libx264"), webp: out.includes("libwebp") };
}

/** A usable ffmpeg (with libx264 and libwebp), or null. */
export function findFfmpeg(cacheDir) {
  const candidates = [process.env.FFMPEG, "ffmpeg"].filter(Boolean);
  for (const bin of candidates) {
    if (has(bin)) {
      const enc = encoders(bin);
      if (enc.x264 && enc.webp) return bin;
    }
  }
  const venv = path.join(cacheDir, "ffmpeg-venv");
  const python = path.join(venv, "bin", "python");
  try {
    if (!fs.existsSync(python)) {
      console.log("· fetching a static ffmpeg (imageio-ffmpeg) into .cache — once");
      execFileSync("python3", ["-m", "venv", venv], { stdio: "ignore" });
      execFileSync(path.join(venv, "bin", "pip"), ["install", "-q", "imageio-ffmpeg"], { stdio: "ignore" });
    }
    const bin = execFileSync(python, ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"], { encoding: "utf8" }).trim();
    return has(bin) ? bin : null;
  } catch {
    return null;
  }
}

function run(ffmpeg, args) {
  const result = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffmpeg ${args.slice(-1)[0]}: ${result.stderr}`);
}

/** Lossy-but-crisp WebP from a PNG screenshot (a fraction of the size). */
export function pngToWebp(ffmpeg, png, webp) {
  run(ffmpeg, ["-i", png, "-c:v", "libwebp", "-quality", "90", "-compression_level", "6", webp]);
  fs.rmSync(png);
}

/**
 * Frames from a CDP screencast ({file, ts}) → an H.264 clip.
 *
 * Idle intervals (the stage's `wait`/`until`) are time-lapsed, so a clip
 * shows the actions at their real pace and the waiting in a blink.
 *
 * The screencast only emits a frame when something repaints, so each frame
 * is held until the next one. Holds are capped (`maxHold`), which turns
 * waiting (a deploy, a slow command) into a natural time-lapse instead of
 * dead air.
 */
/** How much faster idle waiting (the stage's `wait`/`until`) plays in a clip. */
export const IDLE_SPEED = 4;

/** Calculate the actual encoded timeline, including caption reading time. */
export function frameTimeline(frames, { maxHold = 1.2, tail = 1.6, idle = [], idleSpeed = IDLE_SPEED, captions = [], track = [], contentStart } = {}) {
  const intervals = [];
  for (const [start, end] of [...idle].sort((a, b) => a[0] - b[0])) {
    const previous = intervals.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else intervals.push([start, end]);
  }
  const durations = frames.map((frame, index) => {
    const next = frames[index + 1];
    if (!next) return tail;
    const elapsed = Math.max(0, next.ts - frame.ts);
    const waiting = intervals.reduce((sum, [start, end]) => sum + Math.max(0, Math.min(next.ts, end) - Math.max(frame.ts, start)), 0);
    return Math.max(0.001, Math.min(maxHold, elapsed - waiting * (1 - 1 / idleSpeed)));
  });
  const spans = captions.map((caption) => {
    const indices = frames.flatMap((frame, index) => frame.ts >= caption.start && frame.ts < caption.end ? [index] : []);
    if (!indices.length) throw new Error(`No recorded frames for caption: ${caption.text}`);
    const visible = indices.reduce((sum, index) => sum + durations[index], 0);
    // Chrome can stop painting a static page, and long frame holds are capped.
    // Enforce readability here, after both capping and idle compression.
    const paddingSeconds = Math.max(0, caption.minSeconds - visible);
    durations[indices.at(-1)] += paddingSeconds;
    return { ...caption, indices, paddingSeconds };
  });
  let time = 0;
  const timeline = durations.map((duration) => {
    const start = time;
    time += duration;
    return { start, duration };
  });
  // Cursor samples → clip time (~8 Hz), for cropping the 16:9 demo to portrait.
  const focus = [];
  let cursor = 0;
  for (const [ts, x, y] of [...track].sort((a, b) => a[0] - b[0])) {
    while (cursor + 1 < frames.length && frames[cursor + 1].ts <= ts) cursor += 1;
    const t = Number(timeline[cursor].start.toFixed(3));
    if (focus.length && t - focus.at(-1).t < 0.12) focus.pop();
    focus.push({ t, x: Math.round(x), y: Math.round(y) });
  }
  return {
    duration: time,
    focus,
    contentStartSeconds: timeline[frames.findIndex((frame) => frame.ts >= contentStart)]?.start,
    frames: frames.map((frame, index) => ({ ...frame, ...timeline[index] })),
    captions: spans.map(({ indices, start: _start, end: _end, ...caption }) => ({
      ...caption,
      startSeconds: timeline[indices[0]].start,
      endSeconds: timeline[indices.at(-1)].start + timeline[indices.at(-1)].duration,
      visibleSeconds: indices.reduce((sum, index) => sum + durations[index], 0),
    })),
  };
}

export function framesToClip(
  ffmpeg, frames, clip, { width = OUTPUT.width, height = OUTPUT.height, ...options } = {},
) {
  if (!frames.length) throw new Error("Chrome did not capture any video frames");
  const timing = frameTimeline(frames, options);
  const list = `${clip}.ffconcat`;
  const lines = ["ffconcat version 1.0"];
  timing.frames.forEach((frame) => {
    lines.push(`file '${path.resolve(frame.file)}'`, `duration ${frame.duration.toFixed(6)}`);
  });
  lines.push(`file '${path.resolve(frames.at(-1).file)}'`);
  fs.writeFileSync(list, lines.join("\n") + "\n");
  run(ffmpeg, [
    "-f", "concat", "-safe", "0", "-i", list,
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p`,
    // The repeated final concat image establishes its timestamp but can
    // inherit the preceding duration. Bound it to our measured timeline.
    "-t", timing.duration.toFixed(6),
    "-c:v", "libx264", "-preset", "slow", "-crf", CRF, "-movflags", "+faststart", clip,
  ]);
  fs.rmSync(list);
  return timing;
}

/**
 * Small animated WebP preview of a clip for the README gallery. It starts
 * after the title card (`skip` seconds): the gallery shows the title already,
 * and lossy WebP turns the card's dark gradient into blocks. Quality 80 keeps
 * the dark UI's flat areas from banding.
 */
export function clipToPreview(ffmpeg, clip, preview, { width = 880, fps = 10, skip = 0 } = {}) {
  run(ffmpeg, [
    // Keep the complete feature: a fixed cutoff can interrupt a caption just
    // before the animated preview loops back to its beginning.
    "-ss", String(skip), "-i", clip,
    "-vf", `fps=${fps},scale=${width}:-2:flags=lanczos`,
    "-c:v", "libwebp_anim", "-quality", "80", "-compression_level", "4", "-loop", "0", preview,
  ]);
}

/** All clips, in order, as one video to share. */
export function joinClips(ffmpeg, clips, output) {
  if (!clips.length) return false;
  const list = `${output}.txt`;
  fs.writeFileSync(list, clips.map((clip) => `file '${path.resolve(clip)}'`).join("\n") + "\n");
  run(ffmpeg, ["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", output]);
  fs.rmSync(list);
  return true;
}
