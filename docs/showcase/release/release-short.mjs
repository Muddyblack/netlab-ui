#!/usr/bin/env node
// A release-announcement Short (24s, 1080x1920, 30 fps, H.264 + MP3).
// The scene is docs/showcase/release/short.html, driven by a clock
// (window.__render(t)) and captured frame by frame with headless Chrome, then
// muxed with the showcase music. Usage:
//   env -u LD_LIBRARY_PATH node docs/showcase/release/release-short.mjs [--out dir] [--still 5.0]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOWCASE = path.resolve(HERE, '..');
const DURATION = 24, FPS = 30;
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const out = path.resolve(opt('--out', path.join(SHOWCASE, 'media/shorts/release-0.0.3')));
const still = opt('--still');
fs.mkdirSync(out, { recursive: true });

const chrome = process.env.SHOWCASE_CHROME || execFileSync('sh', ['-c', 'command -v chromium || command -v google-chrome-stable || command -v google-chrome'], { encoding: 'utf8' }).trim();
const { chromium } = await import(path.join(SHOWCASE, 'node_modules/playwright-core/index.mjs'));
const browser = await chromium.launch({ executablePath: chrome, args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(HERE, 'short.html')).href);
await page.evaluate(() => window.__ready);
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth > 0));

if (still) {
  await page.evaluate(t => window.__render(t), Number(still));
  await page.screenshot({ path: path.join(out, `still-${still}.png`) });
  await browser.close();
  console.log(`still saved to ${out}`);
  process.exit(0);
}

const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const frames = DURATION * FPS;
const tmp = fs.mkdtempSync(path.join(out, '.frames-'));
for (let i = 0; i < frames; i++) {
  await page.evaluate(t => window.__render(t), i / FPS);
  await page.screenshot({ path: path.join(tmp, `f${String(i).padStart(4, '0')}.png`) });
}
await browser.close();

const music = path.join(SHOWCASE, '.cache/music/sappheiros-moments.mp3');
const trackLength = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', music], { encoding: 'utf8' }));
const musicStart = 24 + Math.floor(Math.random() * Math.max(1, trackLength - 12 - 24 - DURATION));
const video = path.join(out, 'netlab-ui-0.0.3-short.mp4');
execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
  '-framerate', String(FPS), '-i', path.join(tmp, 'f%04d.png'),
  '-ss', String(musicStart), '-t', String(DURATION), '-i', music,
  '-filter_complex', `[0:v]fps=${FPS},scale=1080:1920,setsar=1,format=yuv420p[v];[1:a]loudnorm=I=-16:TP=-2:LRA=9,aresample=48000,aformat=channel_layouts=stereo,afade=t=in:d=1,afade=t=out:st=${DURATION - 2}:d=2[a]`,
  '-map', '[v]', '-map', '[a]', '-t', String(DURATION),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-movflags', '+faststart',
  '-c:a', 'libmp3lame', '-b:a', '256k', '-ar', '48000', video], { stdio: 'inherit' });
fs.rmSync(tmp, { recursive: true, force: true });

fs.writeFileSync(path.join(out, 'youtube.txt'), `netlab-ui 0.0.3 is out | Free network lab UI #Shorts

netlab-ui 0.0.3 is out: install with pipx, upgrade with one command, open the UI in its own app window, monitor labs with Grafana and review AI-agent proposals.

Try netlab-ui (free, open source): https://github.com/Muddyblack/netlab-ui
Releases: https://github.com/Muddyblack/netlab-ui/releases

Built on netlab (https://netlab.tools/), containerlab (https://containerlab.dev/) and clab-ui (https://github.com/srl-labs/containerlab-app). Thanks to Ivan Pepelnjak / ipspace, SRL Labs and Nokia for making these open source.

#Shorts #netlab #containerlab #Networking #OpenSource

Music:
Moments by Sappheiros
https://soundcloud.com/sappheirosmusic/moments
License: https://creativecommons.org/licenses/by/3.0/
Mixed and mastered by Sacred Music
An edited excerpt, faded and reduced in volume.
`);
console.log(`saved ${video}`);
