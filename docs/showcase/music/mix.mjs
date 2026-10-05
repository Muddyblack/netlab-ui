#!/usr/bin/env node
// Finish a verified recording with music. This runs separately from capture,
// so changing the mix never requires rebuilding the UI or deploying a lab.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LAYOUT } from "../lib/media.mjs";
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
export const TRACKS = [
  { ...TRACK, file: "sappheiros-memories.mp3", sourceStart: 14, sourceEnd: 300 },
  {
    title: "Moments", artist: "Sappheiros", file: "sappheiros-moments.mp3",
    url: "https://soundcloud.com/sappheirosmusic/moments",
    license: "https://creativecommons.org/licenses/by/3.0/",
    licenseSource: "https://soundcloud.com/sappheirosmusic/moments",
    sourceFileUrl: "https://www.chosic.com/wp-content/uploads/2022/10/Sappheiros-Moments%28chosic.com%29.mp3",
    sha256: "fbc6a72f91b757f33ce1e9a56006fe233c4eaf92acc2d6848980ae643f2ad221",
    mixingCredit: "Mixed and mastered by Sacred Music",
    sourceStart: 24, endPadding: 12,
  },
];
export const MIX = { sourceStart: 14, sourceEnd: 300, crossfade: 8, fadeIn: 2, fadeOut: 6, lufs: -24, start: 0.5 };
const CREDIT = TRACKS.map((track) =>
  `${track.title} by ${track.artist}. ${track.url} | ${track.license}`
  + (track.mixingCredit ? ` | ${track.mixingCredit}` : "")
).join("; ") + " | Edited, crossfaded, looped and reduced in volume for this video.";

function run(ffmpeg, args) {
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args], { stdio: ["ignore", "pipe", "pipe"] });
}

export function probe(file) {
  return JSON.parse(execFileSync(process.env.FFPROBE ?? "ffprobe", [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", file,
  ], { encoding: "utf8" }));
}

/** Render a circular playlist: each body, then its tail crossfaded into
 * the next track's head. The last seam joins the first body on repeat. */
export function preparePlaylist(ffmpeg, sources, output, settings = MIX) {
  const { crossfade, lufs } = settings;
  if (!sources.length || !Number.isFinite(crossfade) || crossfade <= 0 || !Number.isFinite(lufs)) {
    throw new Error("Playlist needs tracks and a positive crossfade");
  }
  const filter = [];
  const segments = [];
  let offset = 0;
  const tracks = sources.map(({ file, sourceStart, sourceEnd, endPadding = 0 }, i) => {
    const sourceDuration = Number(probe(file).format.duration);
    const end = sourceEnd ?? sourceDuration - endPadding;
    const length = end - sourceStart;
    if (![sourceStart, end, sourceDuration].every(Number.isFinite)
        || sourceStart < 0 || length <= 2 * crossfade || end > sourceDuration) {
      throw new Error("Music excerpt must fit the track and leave room for its crossfade");
    }
    filter.push(
      `[${i}:a]atrim=start=${sourceStart}:end=${end},asetpts=PTS-STARTPTS,`
        + `loudnorm=I=${lufs}:LRA=7:TP=-6,aresample=48000,`
        + `aformat=sample_fmts=flt:channel_layouts=stereo,asplit=3[b${i}][t${i}][h${i}]`,
      `[b${i}]atrim=start=${crossfade}:end=${length - crossfade},asetpts=PTS-STARTPTS[body${i}]`,
      `[t${i}]atrim=start=${length - crossfade},asetpts=PTS-STARTPTS[tail${i}]`,
      `[h${i}]atrim=end=${crossfade},asetpts=PTS-STARTPTS[head${i}]`,
    );
    const entry = { sourceStart, sourceEnd: end, bodyStartSeconds: offset,
      transitionStartSeconds: offset + length - 2 * crossfade };
    offset += length - crossfade;
    return entry;
  });
  sources.forEach((_, i) => {
    filter.push(`[tail${i}][head${(i + 1) % sources.length}]`
      + `acrossfade=d=${crossfade}:c1=qsin:c2=qsin[seam${i}]`);
    segments.push(`[body${i}][seam${i}]`);
  });
  filter.push(`${segments.join("")}concat=n=${sources.length * 2}:v=0:a=1[music]`);
  run(ffmpeg, [...sources.flatMap(({ file }) => ["-i", file]),
    "-filter_complex", filter.join(";"), "-map", "[music]", "-c:a", "pcm_f32le", output]);
  return { tracks, cycleSeconds: offset };
}

export function prepareLoop(ffmpeg, source, output, settings = MIX) {
  return preparePlaylist(ffmpeg, [{ file: source, sourceStart: settings.sourceStart,
    sourceEnd: settings.sourceEnd }], output, settings);
}

export async function getMoments(cache, localFile) {
  const track = TRACKS[1];
  const file = path.resolve(localFile ?? path.join(cache, track.file));
  if (fs.existsSync(file)) {
    if (fileHash(file) !== track.sha256) throw new Error(`Local Moments file differs from the verified Chosic copy: ${file}`);
    return file;
  }
  if (localFile) throw new Error(`SHOWCASE_MOMENTS file missing: ${file}`);
  console.log("· Downloading Moments from Chosic");
  const response = await fetch(track.sourceFileUrl, {
    signal: AbortSignal.timeout(60_000),
    headers: { "User-Agent": "Mozilla/5.0", Referer: "https://www.chosic.com/" },
  });
  if (!response.ok) {
    throw new Error(`Moments download: HTTP ${response.status}. Set SHOWCASE_MOMENTS to a local Chosic copy.`);
  }
  fs.mkdirSync(cache, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(cache, "download-"));
  try {
    const downloaded = path.join(temporary, "track.mp3");
    fs.writeFileSync(downloaded, Buffer.from(await response.arrayBuffer()));
    if (fileHash(downloaded) !== track.sha256) throw new Error("Moments download does not match the verified Chosic copy");
    fs.renameSync(downloaded, file);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  return file;
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
    "-metadata:s:a:0", `handler_name=${TRACKS.map((track) => track.title).join(" / ")} by Sappheiros`,
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
  // Only --check demands the recording match today's source. Mixing just needs the recorded files to be
  // intact (their hashes are still verified), so a music change never forces a re-record.
  const mixing = args[0] === undefined;
  verifyManifest(manifest, media, capturedSource, { featureIds, requireVideo: true, allowSourceChange: mixing });
  if (args[0] === "--check") {
    if (manifest.music?.rendererSha256 !== rendererSha256 || manifest.music?.introRendererSha256 !== introSha256) {
      throw new Error("Intro/music settings changed or no music has been mixed; rerun music/mix.mjs");
    }
    const mixed = path.join(media, manifest.music.video);
    if (manifest.music.sourceVideoSha256 !== fileHash(path.join(media, manifest.video))
        || !fs.existsSync(mixed) || fileHash(mixed) !== manifest.music.videoSha256) {
      throw new Error("Music edition is missing or no longer matches the silent video; rerun music/mix.mjs");
    }
    const assets = { ...manifest.music.intro.files, ...manifest.music.outro.files };
    for (const [file, hash] of Object.entries(assets)) {
      if (!fs.existsSync(path.join(media, file)) || fileHash(path.join(media, file)) !== hash) {
        throw new Error(`Music edition asset missing or changed: ${file}; rerun music/mix.mjs`);
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
  const moments = await getMoments(path.join(HERE, ".cache/music"), process.env.SHOWCASE_MOMENTS);
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
    const playlist = preparePlaylist(ffmpeg, TRACKS.map((entry, i) => ({
      ...entry, file: [track, moments][i],
    })), loop);
    console.log("· Rendering the app's animated loading screen as the opening");
    // Render the bookends at the recorded clips' own size, whatever SHOWCASE_HEIGHT is now.
    const clipWidth = probe(video).streams.find((stream) => stream.codec_type === "video").width;
    const { intro, outro } = await renderBookends(ffmpeg, temporary, { pixelRatio: clipWidth / LAYOUT.width });
    const edited = path.join(temporary, "with-intro.mp4");
    replaceOpeningTitle(ffmpeg, manifest.features.map((feature) => path.join(media, feature.clip)), trimStart, intro.clip, edited, outro.clip);
    console.log(`· Music starts during the intro at ${start.toFixed(2)}s; target ${MIX.lufs} LUFS`);
    const timing = mixVideo(ffmpeg, edited, loop, mixed, start);
    // Check the original recording again before publishing the finished mix.
    verifyManifest(manifest, media, sourceHash(), { featureIds, requireVideo: true, allowSourceChange: true });
    if (fileHash(SCRIPT) !== rendererSha256 || introRendererHash() !== introSha256) {
      throw new Error("Intro/music settings changed during rendering; rerun the mix");
    }
    manifest.music = {
      ...MIX, ...timing, cycleSeconds: playlist.cycleSeconds,
      tracks: TRACKS.map((entry, i) => ({ ...entry, ...playlist.tracks[i], sha256: fileHash([track, moments][i]) })),
      credit: CREDIT, rendererSha256, introRendererSha256: introSha256,
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
