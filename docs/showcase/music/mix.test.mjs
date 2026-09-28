import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MIX, mixVideo, prepareLoop, probe } from "./mix.mjs";

const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
const run = (args) => execFileSync(ffmpeg, ["-v", "error", "-nostdin", "-y", ...args], { maxBuffer: 16 * 1024 * 1024 });
const settings = { ...MIX, sourceStart: 0, sourceEnd: 4, crossfade: 0.5, fadeIn: 0.6, fadeOut: 1 };

function rms(pcm, start, end) {
  let sum = 0;
  let count = 0;
  for (let i = Math.round(start * 48000); i < Math.round(end * 48000) && i * 4 < pcm.length; i++) {
    sum += pcm.readFloatLE(i * 4) ** 2;
    count++;
  }
  return Math.sqrt(sum / count);
}

test("music covers multiple cycles, keeps the opening silent, fades once and preserves every video packet", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "showcase-music-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, "track.wav");
  const loop = path.join(dir, "loop.wav");
  const video = path.join(dir, "video.mp4");
  const mixed = path.join(dir, "mixed.mp4");
  run(["-f", "lavfi", "-i", "aevalsrc=0.4*sin(2*PI*if(lt(t\\,2)\\,440\\,660)*t):s=48000:d=4", source]);
  run(["-f", "lavfi", "-i", "color=black:s=64x64:r=10:d=18", "-c:v", "libx264", video]);
  prepareLoop(ffmpeg, source, loop, settings);
  const cycle = Number(probe(loop).format.duration);
  assert.ok(Math.abs(cycle - 3.5) < 0.001);
  mixVideo(ffmpeg, video, loop, mixed, 1.5, settings);
  const info = probe(mixed);
  const audioStream = info.streams.find((stream) => stream.codec_type === "audio");
  assert.equal(audioStream?.codec_name, "mp3", "VS Code's preview cannot decode AAC audio");
  assert.equal(audioStream?.disposition.default, 1, "players must select the audio track by default");
  const duration = Number(info.format.duration);
  assert.ok(Math.abs(duration - 18) < 0.03, `video must end at 18s, got ${duration}`);
  const audio = run(["-i", mixed, "-map", "0:a", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"]);
  assert.ok(rms(audio, 0, 1.45) < 0.00001, "opening must be silent");
  const normal = rms(audio, 2.2, 2.7);
  // A nonzero stream alone can still sound silent at normal playback volume.
  // Use the production loudness target and bound the decoded signal level.
  const normalDb = 20 * Math.log10(normal);
  assert.ok(normalDb > -28 && normalDb < -20, `audible background level: ${normalDb.toFixed(1)} dBFS`);
  assert.ok(rms(audio, 1.5, 1.6) < normal / 3, "music must fade in");
  for (let seam = 1.5 + cycle; seam < 17; seam += cycle) {
    assert.ok(rms(audio, seam - 0.05, seam + 0.05) > normal / 2, `loop must not fall silent at ${seam}s`);
  }
  assert.ok(rms(audio, 17.9, 17.98) < normal / 5, "final fade follows the video end");
  const videoHash = (file) => run(["-i", file, "-map", "0:v:0", "-c", "copy", "-f", "hash", "-"]).toString();
  assert.equal(videoHash(mixed), videoHash(video), "mix must preserve encoded video packets");
  const again = path.join(dir, "again.mp4");
  mixVideo(ffmpeg, mixed, loop, again, 1.5, settings);
  const audioHash = (file) => run(["-i", file, "-map", "0:a", "-c", "copy", "-f", "hash", "-"]).toString();
  assert.equal(audioHash(again), audioHash(mixed), "rerunning must replace, never stack, the soundtrack");

  const short = path.join(dir, "short.mp4");
  const shortMix = path.join(dir, "short-mix.mp4");
  run(["-f", "lavfi", "-i", "color=black:s=64x64:r=10:d=2", "-c:v", "libx264", short]);
  const shortTiming = mixVideo(ffmpeg, short, loop, shortMix, 1.4, settings);
  assert.ok(shortTiming.fadeInSeconds + shortTiming.fadeOutSeconds < 0.6);
  assert.ok(Math.abs(Number(probe(shortMix).format.duration) - 2) < 0.03);
  const shortAudio = run(["-i", shortMix, "-map", "0:a", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"]);
  assert.ok(rms(shortAudio, 0, 1.35) < 0.00001);
  assert.ok(rms(shortAudio, 1.65, 1.75) > 0.005, "short edits still have audible music");
  assert.ok(rms(shortAudio, 1.95, 1.99) < rms(shortAudio, 1.65, 1.75) / 3);
});
