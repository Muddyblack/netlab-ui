#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { fileHash } from './lib/recordings.mjs';
import { findFfmpeg } from './lib/media.mjs';
import { TRACKS, getTrack, getMoments, probe } from './music/mix.mjs';
import { VIDEO_BOX, renderFrame } from './lib/short-frame.mjs';

const SCRIPT = fileURLToPath(import.meta.url);
const HERE = path.dirname(SCRIPT);

export function resolution(value = '1080') {
  const width = Number(value);
  if (![1080, 1440, 2160].includes(width)) throw new Error('--width must be 1080, 1440 or 2160');
  const scale = width / 1080, even = v => Math.round(v / 2) * 2;
  // The video fills VIDEO_BOX (lib/short-frame.mjs) between heading and caption.
  return { width, height: width * 16 / 9, videoY: even(VIDEO_BOX.y * scale), videoHeight: even(VIDEO_BOX.height * scale) };
}

// The window cut from the 1600×900 recording (CSS px). It is wider than
// VIDEO_BOX's shape and stretched taller to fill it (about 1.3×): more of the
// app stays in view than an undistorted, narrower window would show. Its height
// stops above the recording's own caption (40px from the bottom, up to two
// lines): the Short shows that text below the video, so it isn't shown twice.
export const CROP = { width: 900, height: 780 };

// A feature's `framing`, one entry per caption like `narration`: "wide" squeezes
// a 1280px window (e.g. a whole Grafana tab) into the same video box — more
// distorted (about 1.85× taller), but nothing cut off. null keeps CROP.width.
export const FRAMING = { wide: 1280 };

// The part as runs of one crop width each, switching where a caption starts
// (a cut, like an editor would make). `widths` maps a caption to its width.
export function framingSegments(part, widths = new Map()) {
  const width = c => widths.get(c) ?? CROP.width;
  const segments = [{ start: part.start, width: part.captions[0] ? width(part.captions[0]) : CROP.width }];
  for (const c of part.captions.slice(1)) {
    if (width(c) !== segments.at(-1).width) segments.push({ start: c.startSeconds, width: width(c) });
  }
  return segments.map((s, i) => ({ ...s, end: segments[i + 1]?.start ?? part.end }));
}

export function framingWidths(timing, framing) {
  if (!framing) return new Map();
  const captions = timing.captions.filter(c => c.kind !== 'title');
  if (framing.length !== captions.length) throw new Error(`framing has ${framing.length} entries for ${captions.length} captions`);
  return new Map(captions.flatMap((c, i) => {
    if (framing[i] == null) return [];
    const width = typeof framing[i] === 'number' ? framing[i] : FRAMING[framing[i]];
    if (!width) throw new Error(`unknown framing "${framing[i]}"; use ${Object.keys(FRAMING).join(', ')}, a width or null`);
    return [[c, width]];
  }));
}

// A window that follows the recorded cursor and focus points, so the demo
// fills the portrait frame instead of sitting in it as a thin 16:9 strip.
// Keyframes are in source pixels, with time relative to the part start.
export function cameraPath(focus, start, end, sourceWidth, sourceHeight, { layout = { width: 1600, height: 900 }, ramp = 0.9, lead = 0.3, cropWidth = CROP.width } = {}) {
  const k = sourceHeight / layout.height;
  const w = Math.min(sourceWidth, Math.round(cropWidth * k / 2) * 2), h = Math.round(CROP.height * k / 2) * 2;
  const maxX = Math.max(0, sourceWidth - w);
  const clamp = v => Math.min(maxX, Math.max(0, v));
  let cam = maxX / 2, x0 = null;
  const moves = [];
  for (const { t, x } of focus) {
    const cx = x * k;
    // Hold still while the point stays in the middle half of the window.
    if (cx > cam + w * 0.25 && cx < cam + w * 0.75) continue;
    const target = clamp(cx - w / 2);
    if (Math.abs(target - cam) < w * 0.05) continue;
    // Start moving a little before the cursor arrives, as a camera operator would.
    const begin = t - lead;
    if (begin + ramp <= start) { cam = target; continue; }
    if (begin >= end) break;
    if (x0 === null) x0 = cam;
    moves.push({ t: begin - start, delta: target - cam });
    cam = target;
  }
  return { width: w, height: h, x0: x0 ?? cam, moves, ramp };
}

// A flat sum of eased ramps (smoothstep): no nesting, so long paths stay
// valid expressions. Commas are escaped for the filtergraph.
export function cropExpression({ x0, moves, ramp }) {
  const terms = moves.map(m => {
    const u = `clip((t-${m.t.toFixed(3)})/${ramp}\\,0\\,1)`;
    return `${m.delta.toFixed(1)}*${u}*${u}*(3-2*${u})`;
  });
  return `round(${[x0.toFixed(1), ...terms].join('+')})`;
}

// The demo over the frame image at input `frameInput`. `shots` are the framing
// segments ({ start, end } in part time, each with its followed `camera`),
// cropped one by one and joined; without them (old recordings) the whole
// recording is letterboxed into the video box.
export function videoFilter(size, shots, frameInput) {
  const fill = `scale=${size.width}:${size.videoHeight}:flags=lanczos:out_range=tv,setsar=1`;
  const crop = camera => `crop=${camera.width}:${camera.height}:${cropExpression(camera)}:0,${fill}`;
  let demo;
  if (!shots) {
    demo = `[0:v]setpts=PTS-STARTPTS,scale=${size.width}:${size.videoHeight}:force_original_aspect_ratio=decrease:flags=lanczos:out_range=tv,pad=${size.width}:${size.videoHeight}:0:(oh-ih)/2:color=black,setsar=1[demo];`;
  } else if (shots.length === 1) {
    demo = `[0:v]setpts=PTS-STARTPTS,${crop(shots[0].camera)}[demo];`;
  } else {
    // trim keeps part time, so each crop's expression uses the same clock.
    demo = `[0:v]setpts=PTS-STARTPTS,split=${shots.length}${shots.map((_, i) => `[in${i}]`).join('')};`
      + shots.map((shot, i) => `[in${i}]trim=start=${shot.start.toFixed(3)}:end=${shot.end.toFixed(3)},${crop(shot.camera)},setpts=PTS-STARTPTS[shot${i}];`).join('')
      + `${shots.map((_, i) => `[shot${i}]`).join('')}concat=n=${shots.length}:v=1:a=0[demo];`;
  }
  return demo
    + `[${frameInput}:v]scale=${size.width}:${size.height},setsar=1[frame];`
    + `[frame][demo]overlay=0:${size.videoY}:shortest=1,ass=captions.ass,fps=30,format=yuv420p,setparams=range=limited[v]`;
}

// Acronyms said as a word; every other one is spelled out ("BGP" → "B G P"),
// which eSpeak otherwise guesses at ("OSPF" came out as one mumbled word).
const SAID_AS_WORDS = new Set(['YAML', 'JSON', 'NAT', 'LAN', 'VLAN', 'WAN', 'RAM', 'GUI']);

// Text as a person would say it.
export function speakable(text) {
  return String(text)
    .replace(/\bCtrl\+/g, 'Control ').replace(/\bShift\+/g, 'Shift ').replace(/\bAlt\+/g, 'Alt ')
    .replace(/netlab-ui/gi, 'netlab you eye').replace(/\bUI\b/g, 'you eye').replace(/\bIS-IS\b/g, 'I S I S')
    .replace(/\b[A-Z]{2,5}s?\b/g, word => {
      const plural = /[A-Z]s$/.test(word), base = plural ? word.slice(0, -1) : word;
      return SAID_AS_WORDS.has(base) ? word : base.split('').join(' ') + (plural ? "'s" : '');
    })
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s*\+\s*/g, ' and ')
    .replace(/\s+/g, ' ').trim()
    .replace(/([^.!?])$/, '$1.');
}

// One spoken paragraph per caption, starting just after it appears and ending
// before the next one. `script` maps a caption to the feature's own narration
// (written to be heard, not read); without one, the caption itself is read.
// A paragraph is a string or `{ text, speed }`; "…" in it is a real pause.
export function voiceLines(part, script = new Map()) {
  const lines = [];
  part.captions.forEach((c, i) => {
    const at = c.startSeconds - part.start + 0.25;
    const next = part.captions[i + 1]?.startSeconds ?? part.end;
    const fit = next - part.start - at - 0.3;
    const entry = script.get(c) ?? c.text;
    const text = typeof entry === 'string' ? entry : entry.text;
    if (fit > 0.8) lines.push({ text: speakable(text), at, fit, ...(entry.speed ? { speed: entry.speed } : {}) });
  });
  return lines;
}

// A feature's `narration`: one paragraph for each of its captions, in order.
export function narrationScript(timing, narration) {
  if (!narration) return new Map();
  const captions = timing.captions.filter(c => c.kind !== 'title');
  if (narration.length !== captions.length) throw new Error(`narration has ${narration.length} paragraphs for ${captions.length} captions`);
  return new Map(captions.map((c, i) => [c, narration[i]]));
}

// Background music: quiet (well under the voice at -16 LUFS), fading in,
// held low while the voice speaks, swelling once it has finished, then fading
// out — the shape of the main video's soundtrack, at a lower level.
export function musicEnvelope(duration, voiceEnd) {
  const fadeIn = Math.min(1.5, duration / 4), fadeOut = Math.min(2, duration / 4);
  const swell = Math.min(voiceEnd + 0.2, duration - fadeOut - 0.5);
  return 'loudnorm=I=-27:TP=-8:LRA=7,aresample=48000,aformat=channel_layouts=stereo,'
    + `volume='0.55+0.45*clip((t-${swell.toFixed(2)})/1.5\\,0\\,1)':eval=frame,`
    + `afade=t=in:d=${fadeIn.toFixed(2)},afade=t=out:st=${(duration - fadeOut).toFixed(2)}:d=${fadeOut.toFixed(2)}`;
}

// Voice-over: duck the music under the voice, then keep the peaks in check.
export function audioFilter(voiceInputs, lines, hasMusic, duration) {
  const voices = lines.map((line, i) => {
    const ms = Math.round(line.at * 1000);
    return `[${voiceInputs + i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[v${i}]`;
  });
  // Take the synthetic edge off: cut rumble, a little warmth, tame the
  // metallic top end, and even out the level like a voice booth chain.
  const polish = 'highpass=f=75,equalizer=f=180:t=q:w=1:g=2,equalizer=f=6500:t=q:w=1.5:g=-3,lowpass=f=12000,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=160';
  const mixVoices = `${lines.map((_, i) => `[v${i}]`).join('')}amix=inputs=${lines.length}:normalize=0,${polish},loudnorm=I=-16:TP=-2:LRA=9,aresample=48000,apad=whole_dur=${duration.toFixed(3)}`;
  if (!hasMusic) return [...voices, `${mixVoices},alimiter=limit=0.9[a]`];
  return [...voices, `${mixVoices},asplit[voice][key]`,
    '[music][key]sidechaincompress=threshold=0.03:ratio=6:attack=30:release=450[ducked]',
    '[ducked][voice]amix=inputs=2:normalize=0,alimiter=limit=0.9[a]'];
}

export const VOICE = process.env.SHOWCASE_VOICE || 'am_michael:0.5,am_fenrir:0.5';
// Kokoro drags stressed vowels at 1.0 ("lab", "choose" came out long); a
// brisker pace sounds like natural speech.
const SPEED = Number(process.env.SHOWCASE_VOICE_SPEED) || 1.12;
const MODELS = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0';

// Kokoro in its own venv under .cache; the model files in narration/voices.
// On NixOS the pip wheels need the Nix libstdc++ and zlib, and Kokoro a nixpkgs espeak-ng.
function findVoice() {
  const venv = path.join(HERE, '.cache/voice-venv'), python = path.join(venv, 'bin/python');
  if (!fs.existsSync(python)) {
    console.log('· setting up the voice (Kokoro, offline) in .cache — once');
    execFileSync('python3', ['-m', 'venv', venv], { stdio: 'ignore' });
    execFileSync(path.join(venv, 'bin/pip'), ['install', '-q', 'kokoro-onnx', 'soundfile'], { stdio: 'inherit' });
  }
  const voices = path.join(HERE, 'narration/voices');
  fs.mkdirSync(voices, { recursive: true });
  for (const file of ['kokoro-v1.0.int8.onnx', 'voices-v1.0.bin']) {
    if (fs.existsSync(path.join(voices, file))) continue;
    console.log(`· downloading ${file} (once)`);
    execFileSync('curl', ['-fsSL', '-o', path.join(voices, `${file}.part`), `${MODELS}/${file}`], { stdio: 'inherit' });
    fs.renameSync(path.join(voices, `${file}.part`), path.join(voices, file));
  }
  const env = { ...process.env };
  const nix = attr => execFileSync('nix', ['build', '--no-link', '--print-out-paths', `nixpkgs#${attr}`], { encoding: 'utf8' }).trim().split('\n').at(-1);
  if (fs.existsSync('/etc/NIXOS')) {
    env.ESPEAK_NG ||= nix('espeak-ng');
    env.LD_LIBRARY_PATH = [...['stdenv.cc.cc.lib', 'zlib'].map(lib => path.join(nix(lib), 'lib')), env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  }
  execFileSync(python, ['-c', 'import kokoro_onnx, soundfile'], { env, stdio: 'ignore' });
  return { python, env };
}

function speak({ python, env }, lines, dir) {
  const request = path.join(dir, 'voice.json');
  fs.writeFileSync(request, JSON.stringify(lines.map((line, i) => ({ speed: SPEED, ...line, out: path.join(dir, `voice-${i}.wav`) }))));
  const result = execFileSync(python, [path.join(HERE, 'narration/speak.py'), request], { env: { ...env, SHOWCASE_VOICE: VOICE }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const spoken = JSON.parse(result);
  for (const line of spoken.filter(l => !l.fits)) console.warn(`  · too long for its scene (${line.duration.toFixed(1)}s, room for ${line.fit.toFixed(1)}s), shorten: "${line.text}"`);
  return spoken;
}

// The links and credits under every Short's description.
const ABOUT = `Try netlab-ui (free, open source): https://github.com/Muddyblack/netlab-ui

Built on netlab (https://netlab.tools/): describe the lab, and netlab assigns the IP addresses and writes the device configs for you.
The canvas is clab-ui (https://github.com/srl-labs/containerlab-app), and the labs run on containerlab (https://containerlab.dev/). Thanks to SRL Labs / Nokia and ipspace for making these open source.`;

export const VIDEO_FLAGS = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
  '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-movflags', '+faststart'];

export function validateExport(info, size, duration, silent) {
  const video = info.streams.find(s => s.codec_type === 'video');
  const audio = info.streams.find(s => s.codec_type === 'audio');
  if (!video || video.codec_name !== 'h264' || video.width !== size.width
      || video.height !== size.height || video.pix_fmt !== 'yuv420p'
      || video.color_range !== 'tv' || video.avg_frame_rate !== '30/1'
      || video.sample_aspect_ratio !== '1:1') throw new Error('Encoded video does not match the requested Shorts format');
  if (silent ? Boolean(audio) : !audio || audio.codec_name !== 'mp3') throw new Error('Encoded audio does not match the requested format');
  const actual = Number(info.format.duration);
  if (!Number.isFinite(actual) || actual > 59.1 || Math.abs(actual - duration) > 0.2) throw new Error('Encoded Short has an incorrect duration');
}

// Split at caption boundaries without speeding up actions or cutting a caption.
export function planParts(timing, duration, limit = 59) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid clip duration');
  const captions = timing.captions.filter(c => c.kind !== 'title');
  let start = timing.contentStartSeconds ?? 0;
  if (!Number.isFinite(start) || start < 0 || start >= duration) throw new Error('Invalid content start');
  for (const c of captions) {
    if (!Number.isFinite(c.startSeconds) || !Number.isFinite(c.endSeconds)
      || c.endSeconds <= c.startSeconds || c.endSeconds > duration + 0.2) throw new Error('Invalid caption timing');
    if (c.endSeconds - c.startSeconds > limit) throw new Error('A caption exceeds the Shorts limit; shorten the scene');
  }
  const parts = [];
  while (start < duration - 0.05) {
    let end = Math.min(duration, start + limit);
    const crossing = captions.find(c => c.startSeconds < end && c.endSeconds > end);
    if (crossing) end = crossing.startSeconds;
    if (end <= start + 0.05) throw new Error('Cannot split this scene without cutting a caption');
    parts.push({ start, end, captions: captions.filter(c => c.startSeconds >= start && c.startSeconds < end) });
    start = end;
  }
  return parts;
}

export function assText(text) {
  return String(text).replace(/\\/g, '／').replace(/[{}]/g, '').replace(/\r?\n/g, '\\N');
}
function stamp(seconds) {
  const ticks = Math.round(seconds * 100);
  return `${Math.floor(ticks / 360000)}:${String(Math.floor(ticks / 6000) % 60).padStart(2, '0')}:${String(Math.floor(ticks / 100) % 60).padStart(2, '0')}.${String(ticks % 100).padStart(2, '0')}`;
}
// Only the captions are subtitles (the heading and footer are in the frame
// image). A card in the app's caption colors (#252526 on #f0f0f0), just under
// the video; the fade matches the in-app caption.
export function subtitles(part) {
  const top = VIDEO_BOX.y + VIDEO_BOX.height + 48;
  const event = (start, end, text) => `Dialogue: 0,${stamp(start)},${stamp(end)},Caption,,0,0,0,,{\\fad(250,200)}${assText(text)}`;
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Caption,Noto Sans,46,&H00F0F0F0,&H00F0F0F0,&H00262525,&H00262525,0,0,0,0,100,100,0,0,3,18,0,8,96,96,${top},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`
    + part.captions.map(c => event(c.startSeconds - part.start, Math.min(c.endSeconds, part.end) - part.start, c.text)).join('\n') + '\n';
}

// "link-faults" → "LINK FAULTS · PART 2" for the heading's kicker.
export function kicker(id, label) {
  return id.replace(/-/g, ' ') + label;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: docs/showcase/shorts.sh --feature <name> | --all | --list\nOptions: --width 1080|1440|2160 (portrait width; default 1080)\n         --preflight (check recordings and tools without rendering)\n         --silent (no music; add it in YouTube), --no-voice (no voice-over)\n         --output <directory>'); return;
  }
  let width = '1080', preflight = false, voice = true;
  let featureId, all = false, list = false, silent = false, output = path.join(HERE, 'media/shorts');
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--feature' || arg === '--output' || arg === '--width') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      if (arg === '--feature') featureId = value;
      else if (arg === '--width') width = value;
      else output = path.resolve(value);
    } else if (arg === '--all') all = true;
    else if (arg === '--list') list = true;
    else if (arg === '--silent') silent = true;
    else if (arg === '--no-voice') voice = false;
    else if (arg === '--preflight') preflight = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  const size = resolution(width);
  const order = (await import('./features/index.mjs')).default;
  const ids = order.map(file => path.basename(file, '.mjs'));
  if (list) { console.log(ids.join('\n')); return; }
  if (all === Boolean(featureId)) throw new Error('Choose --feature <name> or --all; use --list for names');
  if (featureId && !ids.includes(featureId)) throw new Error(`Unknown feature: ${featureId}; use --list`);
  // Each feature's Short settings: `narration` and `framing`, per caption.
  const narrations = Object.fromEntries(await Promise.all((all ? ids : [featureId]).map(async id =>
    [id, (await import(`./features/${id}.mjs`)).default])));
  const media = path.join(HERE, 'media');
  const manifestPath = path.join(media, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('Record the showcase first: docs/showcase/run.sh');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const jobs = (all ? ids : [featureId]).map(id => {
    const feature = manifest.features.find(f => f.id === id);
    if (!feature?.clip || !feature.timing) throw new Error(`Missing recording for ${id}; run docs/showcase/run.sh`);
    for (const file of [feature.clip, feature.timing]) {
      if (!fs.existsSync(path.join(media, file)) || fileHash(path.join(media, file)) !== manifest.files?.[file]) throw new Error(`Missing or changed recording: ${file}; rerun showcase`);
    }
    const clip = path.join(media, feature.clip);
    const sourceInfo = probe(clip);
    const sourceVideo = sourceInfo.streams.find(s => s.codec_type === 'video');
    if (!sourceVideo) throw new Error(`No video stream in ${feature.clip}`);
    if (sourceVideo.width < size.width) console.warn(`· ${id}: source width ${sourceVideo.width}px is below export width ${size.width}px; this will upscale`);
    const timing = JSON.parse(fs.readFileSync(path.join(media, feature.timing), 'utf8'));
    if (!timing.focus?.length) console.warn(`· ${id}: no cursor track in this recording; using the letterboxed layout (re-record: run.sh --only ${id})`);
    return { feature, clip, timing, script: narrationScript(timing, narrations[id]?.narration), widths: framingWidths(timing, narrations[id]?.framing), source: sourceVideo, parts: planParts(timing, Number(sourceInfo.format.duration)) };
  });
  const ffmpeg = findFfmpeg(path.join(HERE, '.cache'));
  if (!ffmpeg) throw new Error('ffmpeg with libx264 is required');
  const filters = execFileSync(ffmpeg, ['-hide_banner', '-filters'], { encoding: 'utf8' });
  if (!/\bass\s/.test(filters)) throw new Error('ffmpeg needs the ass filter (libass) for portrait captions');
  const encoders = execFileSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  if (!encoders.includes('libx264') || ((!silent || voice) && !encoders.includes('libmp3lame'))) throw new Error('ffmpeg needs the libx264 and libmp3lame encoders');
  console.log(`· Format: ${size.width}×${size.height}, 30 fps, H.264, CRF 18, slow preset${!silent || voice ? ', MP3' : ''}${voice ? ', voice-over' : ''}`);
  if (preflight) { console.log('· Recordings and encoding tools verified; no videos rendered or music downloaded'); return; }
  const music = silent ? [] : await Promise.all([
    getTrack(path.join(HERE, '.cache/music'), process.env.SHOWCASE_MUSIC),
    getMoments(path.join(HERE, '.cache/music'), process.env.SHOWCASE_MOMENTS),
  ]);
  const musicDurations = music.map(file => Number(probe(file).format.duration));
  const voiceEnv = voice ? findVoice() : null;
  fs.mkdirSync(output, { recursive: true });
  for (const { feature, clip, timing, script, widths, source, parts } of jobs) {
    for (const [index, part] of parts.entries()) {
      const label = parts.length > 1 ? ` · Part ${index + 1}` : '';
      const name = `${feature.id}${parts.length > 1 ? `-${index + 1}` : ''}`;
      const duration = part.end - part.start;
      const temp = fs.mkdtempSync(path.join(output, '.render-'));
      try {
        fs.writeFileSync(path.join(temp, 'captions.ass'), subtitles(part));
        await renderFrame({ kicker: kicker(feature.id, label), title: feature.title }, size.width, path.join(temp, 'frame.png'));
        const input = ['-ss', String(part.start), '-i', clip];
        const shots = timing.focus?.length ? framingSegments(part, widths).map(({ start, end, width: cropWidth }) => {
          const camera = cameraPath(timing.focus, part.start, part.end, source.width, source.height, { cropWidth });
          // A wide window has little room to move: hold it still on everything
          // right of the lab sidebar (tabs, canvas, dashboards) instead of
          // drifting after the cursor into menus.
          if (cropWidth > CROP.width) Object.assign(camera, { x0: source.width - camera.width, moves: [] });
          return { start: start - part.start, end: end - part.start, cropWidth, camera };
        }) : null;
        const filters = [null]; // the video filter, once the frame's input number is known
        const selections = [];
        const planned = voice ? voiceLines(part, script) : [], spoken = planned.length > 0;
        if (!silent) {
          // One track (random), from a random point: a single piece of music
          // reads as a soundtrack; two crossfaded ones sounded busy under a voice.
          const trackIndex = randomInt(TRACKS.length), track = TRACKS[trackIndex];
          const end = track.sourceEnd ?? musicDurations[trackIndex] - track.endPadding;
          const available = Math.floor(end - track.sourceStart - duration);
          if (available < 0) throw new Error('Music track is too short');
          const start = track.sourceStart + randomInt(available + 1);
          input.push('-ss', String(start), '-t', String(duration), '-i', music[trackIndex]);
          selections.push({ title: track.title, start, duration, sha256: fileHash(music[trackIndex]) });
        }
        let lines = [];
        if (spoken) {
          console.log(`· Voicing ${name}`);
          lines = speak(voiceEnv, planned, temp);
          for (const line of lines) input.push('-i', line.out);
        }
        if (!silent) {
          const voiceEnd = lines.length ? Math.max(...lines.map(l => l.at + l.duration)) : duration * 0.6;
          filters.push(`[1:a]asetpts=PTS-STARTPTS,${musicEnvelope(duration, voiceEnd)}${spoken ? '[music]' : '[a]'}`);
        }
        if (spoken) {
          filters.push(...audioFilter(silent ? 1 : 2, lines, !silent, duration));
        }
        const audible = !silent || spoken;
        filters[0] = videoFilter(size, shots, input.filter(arg => arg === '-i').length);
        input.push('-loop', '1', '-framerate', '30', '-i', 'frame.png');
        console.log(`· Rendering ${name} (${duration.toFixed(1)}s)`);
        execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...input,
          '-filter_complex', filters.join(';'), '-map', '[v]', // MP3, not AAC: VS Code's media preview can't decode AAC (as music/mix.mjs).
          ...(audible ? ['-map', '[a]', '-c:a', 'libmp3lame', '-b:a', '256k', '-ar', '48000'] : ['-an']),
          '-t', String(duration), ...VIDEO_FLAGS, 'video.mp4'], { cwd: temp, stdio: ['ignore', 'ignore', 'pipe'] });
        validateExport(probe(path.join(temp, 'video.mp4')), size, duration, !audible);
        const credits = silent ? '' : '\n\nMusic:\n' + TRACKS.filter(t => selections.some(s => s.title === t.title)).map(t => `${t.title} by ${t.artist}\n${t.url}\nLicense: ${t.license}${t.mixingCredit ? '\n' + t.mixingCredit : ''}`).join('\n\n') + '\nAn edited excerpt, faded and reduced in volume.';
        fs.writeFileSync(path.join(temp, 'youtube.txt'), `${(`${feature.title}${label} | netlab-ui #Shorts`).slice(0, 100)}\n\n${feature.summary}\n\n${ABOUT}\n\n#Shorts #netlab #containerlab #Networking${credits}\n`);
        fs.writeFileSync(path.join(temp, 'manifest.json'), JSON.stringify({ format: { ...size, fps: 30, crf: 18, preset: 'slow', pixelFormat: 'yuv420p', audio: audible ? 'mp3' : null }, rendererSha256: fileHash(SCRIPT), feature: feature.id, sourceHash: manifest.sourceHash, sourceClipSha256: fileHash(clip), sourceTimingSha256: manifest.files[feature.timing], part, shots, music: selections,
          voice: spoken ? { model: 'Kokoro v1.0', voice: VOICE, lines: lines.map(({ text, at, duration: length, speed }) => ({ text, at, duration: length, speed })) } : null, videoSha256: fileHash(path.join(temp, 'video.mp4')) }, null, 2) + '\n');
        for (const [from, extension] of [['video.mp4', 'mp4'], ['youtube.txt', 'youtube.txt'], ['manifest.json', 'json']]) { fs.mkdirSync(path.join(output, feature.id), { recursive: true }); fs.renameSync(path.join(temp, from), path.join(output, feature.id, `${name}.${extension}`)); }
      } finally { fs.rmSync(temp, { recursive: true, force: true }); }
    }
  }
  console.log(`· Shorts saved to ${output}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) main().catch(error => {
  console.error(error.stderr?.toString() || error.message); process.exitCode = 1;
});
