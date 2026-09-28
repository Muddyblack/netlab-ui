#!/usr/bin/env node
// Finish a verified recording with music. This runs separately from capture,
// so changing the mix never requires rebuilding the UI or deploying a lab.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fileHash, previewStart, sourceHash, verifyManifest } from "../lib/recordings.mjs";
import featureOrder from "../features/index.mjs";
import { INTRO, introRendererHash, renderBookends, replaceOpeningTitle } from "./intro.mjs";

import { OUTRO } from "./outro.mjs";

const SCRIPT = fileURLToPath(import.meta.url);
const HERE = path.resolve(path.dirname(SCRIPT), "..");
export const TRACK = {
  title: "Memories", artist: "Sappheiros",
  url: "https://soundcloud.com/sappheirosmusic/sappheiros-memories",
  license: "https://creativecommons.org/licenses/by/4.0/",
  licenseSource: "https://sappheiros.bandcamp.com/track/memories",
  sourceFileUrl: "https://www.mediafire.com/file/lacqy30vew21vx9/Sappheiros+-+Memories.mp3/file",
  sha256: "5d88218decffaec012fd16c157685c3a9de0102ecd1a5db3b175721fa799a75e",
};
export const MIX = { sourceStart: 14, sourceEnd: 300, crossfade: 8, fadeIn: 2, fadeOut: 6, lufs: -24, start: 0.5 };
const CREDIT = `Music: ${TRACK.title} by ${TRACK.artist}. ${TRACK.url} | CC BY 4.0: ${TRACK.license} | Edited, looped, faded and reduced in volume for this video.`;

function run(ffmpeg, args) {
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args], { stdio: ["ignore", "pipe", "pipe"] });
}

export function probe(file) {
  return JSON.parse(execFileSync(process.env.FFPROBE ?? "ffprobe", [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", file,
  ], { encoding: "utf8" }));
}

/** Make one repeatable cycle: middle, then tail crossfaded into the head.
 * Its final sample leads directly into the middle again. Memory and filter
 * size stay bounded regardless of how many hours the finished tour lasts. */
export function prepareLoop(ffmpeg, source, output, settings = MIX) {
  const { sourceStart, sourceEnd, crossfade, lufs } = settings;
  const length = sourceEnd - sourceStart;
  const sourceDuration = Number(probe(source).format.duration);
  if (![sourceStart, sourceEnd, crossfade, lufs, sourceDuration].every(Number.isFinite)
      || sourceStart < 0 || crossfade <= 0 || length <= 2 * crossfade || sourceEnd > sourceDuration) {
    throw new Error("Music excerpt must fit the track and leave room for its crossfade");
  }
  const filter = [
    `[0:a]atrim=start=${sourceStart}:end=${sourceEnd},asetpts=PTS-STARTPTS,`
      + `loudnorm=I=${lufs}:LRA=7:TP=-6,aresample=48000,asplit=3[body][tail][head]`,
    `[body]atrim=start=${crossfade}:end=${length - crossfade},asetpts=PTS-STARTPTS[middle]`,
    `[tail]atrim=start=${length - crossfade},asetpts=PTS-STARTPTS[end]`,
    `[head]atrim=end=${crossfade},asetpts=PTS-STARTPTS[beginning]`,
    `[end][beginning]acrossfade=d=${crossfade}:c1=tri:c2=tri[seam]`,
    "[middle][seam]concat=n=2:v=0:a=1[music]",
  ].join(";");
  run(ffmpeg, ["-i", source, "-filter_complex", filter, "-map", "[music]", "-c:a", "pcm_f32le", output]);
}

export function mixVideo(ffmpeg, video, loop, output, start, settings = MIX) {
  const info = probe(video);
  const duration = Number(info.streams.find((stream) => stream.codec_type === "video")?.duration);
  if (!Number.isFinite(duration) || !Number.isFinite(start) || start < 0 || start >= duration) {
    throw new Error("Music cue must fall within the video");
  }
  const active = duration - start;
  // Even very short edits get two separate fades with no overlap.
  const fadeIn = Math.min(settings.fadeIn, active / 3);
  const fadeOut = Math.min(settings.fadeOut, active / 3);
  const delaySamples = Math.round(start * 48000);
  run(ffmpeg, [
    "-i", video, "-stream_loop", "-1", "-i", loop,
    "-filter_complex", `[1:a]atrim=duration=${active},asetpts=PTS-STARTPTS,`
      + `afade=t=in:d=${fadeIn},afade=t=out:st=${active - fadeOut}:d=${fadeOut},`
      + `adelay=delays=${delaySamples}S:all=1,apad,atrim=duration=${duration}[music]`,
    // VS Code's media preview cannot decode AAC. MP3 in MP4 also plays in mpv
    // and Chromium, while preserving the original H.264 video stream.
    "-map", "0:v:0", "-map", "[music]", "-c:v", "copy", "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "48000",
    "-disposition:a:0", "default", "-metadata", `comment=${CREDIT}`,
    "-metadata:s:a:0", `handler_name=${TRACK.title} by ${TRACK.artist}`,
    "-movflags", "+faststart", "-t", String(duration), output,
  ]);
  return { startSeconds: start, durationSeconds: duration, fadeInSeconds: fadeIn, fadeOutSeconds: fadeOut };
}

export async function getTrack(cache, localFile) {
  const track = path.resolve(localFile ?? path.join(cache, "sappheiros-memories.mp3"));
  if (fs.existsSync(track)) {
    if (fileHash(track) !== TRACK.sha256) throw new Error(`Local music file differs from the credited original: ${track}`);
    return track;
  }
  if (localFile) throw new Error(`Local music file missing: ${track}`);
  console.log("· Downloading Memories from the artist's original MediaFire link");
  const page = await fetch(TRACK.sourceFileUrl, { signal: AbortSignal.timeout(30_000) });
  if (!page.ok) throw new Error(`Music download page: HTTP ${page.status}`);
  const tag = (await page.text()).match(/<a\b[^>]*\bid=["']downloadButton["'][^>]*>/i)?.[0];
  const href = tag?.match(/\bhref=["']([^"']+)["']/i)?.[1]?.replaceAll("&amp;", "&");
  const url = href && new URL(href);
  if (!url || url.protocol !== "https:" || !url.hostname.endsWith(".mediafire.com")) {
    throw new Error(`The artist's download link changed. Set SHOWCASE_MUSIC to an existing copy of the original MP3.`);
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Music download: HTTP ${response.status}`);
  fs.mkdirSync(cache, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(cache, "download-"));
  try {
    const downloaded = path.join(temporary, "track.mp3");
    fs.writeFileSync(downloaded, Buffer.from(await response.arrayBuffer()));
    if (fileHash(downloaded) !== TRACK.sha256) throw new Error("Music download does not match the credited original track");
    fs.renameSync(downloaded, track);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  return track;
}

async function main() {
  const rendererSha256 = fileHash(SCRIPT);
  const introSha256 = introRendererHash();
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== "--check")) {
    throw new Error("Usage: node docs/showcase/music/mix.mjs [--check]");
  }
  const media = path.join(HERE, "media");
  const manifestFile = path.join(media, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const capturedSource = sourceHash();
  const featureIds = await Promise.all(featureOrder.map(async (file) => (await import(`../features/${file}`)).default.id));
  verifyManifest(manifest, media, capturedSource, { featureIds, requireVideo: true });
  if (args[0] === "--check") {
    if (manifest.music?.rendererSha256 !== rendererSha256 || manifest.music?.introRendererSha256 !== introSha256) {
      throw new Error("Intro/music settings changed or no music has been mixed; rerun music/mix.mjs");
    }
    const mixed = path.join(media, manifest.music.video);
    if (manifest.music.sourceVideoSha256 !== fileHash(path.join(media, manifest.video))
        || !fs.existsSync(mixed) || fileHash(mixed) !== manifest.music.videoSha256) {
      throw new Error("Music edition is missing or no longer matches the silent video; rerun music/mix.mjs");
    }
    for (const [file, hash] of Object.entries({ ...manifest.music.intro.files, ...manifest.music.outro.files })) {
      if (!fs.existsSync(path.join(media, file)) || fileHash(path.join(media, file)) !== hash) {
        throw new Error(`Intro asset missing or changed: ${file}; rerun music/mix.mjs`);
      }
    }
    console.log("✓ Recording, soundtrack and music settings match.");
    return;
  }
  const video = path.join(media, manifest.video);
  if (probe(video).streams.some((stream) => stream.codec_type === "audio")) {
    throw new Error("This video already contains audio; keep its narration in a separate stem before adding music.");
  }
  const timing = JSON.parse(fs.readFileSync(path.join(media, manifest.features[0].timing), "utf8"));
  const trimStart = previewStart(timing);
  const start = MIX.start;
  const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
  const track = await getTrack(path.join(HERE, ".cache/music"), process.env.SHOWCASE_MUSIC);
  const name = path.parse(manifest.video);
  const musicVideo = path.join(name.dir, `${name.name}-music.mp4`);
  const output = path.join(media, musicVideo);
  const work = path.join(HERE, ".work");
  fs.mkdirSync(work, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(work, "music-"));
  try {
    const loop = path.join(temporary, "loop.wav");
    const mixed = path.join(temporary, "showcase.mp4");
    console.log("· Rendering the app's animated loading screen as the opening");
    const { intro, outro } = await renderBookends(ffmpeg, temporary);
    const edited = path.join(temporary, "with-intro.mp4");
    replaceOpeningTitle(ffmpeg, manifest.features.map((feature) => path.join(media, feature.clip)), trimStart, intro.clip, edited, outro.clip);
    console.log(`· Music starts during the intro at ${start.toFixed(2)}s; target ${MIX.lufs} LUFS`);
    prepareLoop(ffmpeg, track, loop);
    const timing = mixVideo(ffmpeg, edited, loop, mixed, start);
    // Check the original recording again before publishing the finished mix.
    verifyManifest(manifest, media, sourceHash(), { featureIds, requireVideo: true });
    if (fileHash(SCRIPT) !== rendererSha256 || introRendererHash() !== introSha256) {
      throw new Error("Intro/music settings changed during rendering; rerun the mix");
    }
    manifest.music = {
      ...TRACK, ...MIX, ...timing, credit: CREDIT, rendererSha256, introRendererSha256: introSha256,
      video: musicVideo, videoSha256: fileHash(mixed), sourceVideoSha256: manifest.files[manifest.video],
      outro: { seconds: OUTRO.seconds, files: { "outro/outro.mp4": fileHash(outro.clip), "outro/thanks-dark.webp": fileHash(outro.poster) } },
      intro: {
        seconds: INTRO.seconds, replacedTitleSeconds: trimStart,
        files: { "intro/intro.mp4": fileHash(intro.clip), "intro/loading-dark.webp": fileHash(intro.poster) },
      },
    };
    const nextManifest = path.join(temporary, "manifest.json");
    fs.writeFileSync(nextManifest, JSON.stringify(manifest, null, 2) + "\n");
    const replacements = [];
    try {
      for (const [source, destination] of [
        [mixed, output], [outro.clip, path.join(media, "outro/outro.mp4")],
        [outro.poster, path.join(media, "outro/thanks-dark.webp")], [intro.clip, path.join(media, "intro/intro.mp4")],
        [intro.poster, path.join(media, "intro/loading-dark.webp")],
      ]) {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        const backup = path.join(temporary, `previous-${replacements.length}`);
        if (fs.existsSync(destination)) fs.renameSync(destination, backup);
        replacements.push({ destination, backup });
        fs.renameSync(source, destination);
      }
      fs.renameSync(nextManifest, manifestFile);
    } catch (error) {
      for (const { destination, backup } of replacements.reverse()) {
        if (fs.existsSync(backup)) fs.renameSync(backup, destination);
        else fs.rmSync(destination, { force: true });
      }
      throw error;
    }
    console.log(`✓ ${output} — music loops as needed and fades at ${timing.durationSeconds.toFixed(2)}s`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
