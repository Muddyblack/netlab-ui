#!/usr/bin/env node
// Generate the showcase: dark stills and a fresh clip per feature, one
// joined video, animated previews, GALLERY.md and the README gallery.
//
// Start through run.sh, which builds the UI and boots an isolated backend.
// Options:
//   --resume [dir]   reuse completed scenes and redo the failed scene onward
//   --restart id     with --resume, redo this scene or an earlier prerequisite
//   --only a,b        re-record just these scenes and rejoin the video from the
//                     existing clips of the rest (their files are verified)
//   --from feature    diagnose this and later scenes, stills only, no publishing
//   --themes light,dark   themes for stills (default dark)
//   --video-theme dark    theme the clips are recorded in
//   --no-video        stills only
//   --no-previews     no animated previews in the gallery
//   --list            print the features and exit
//   --check           verify published media matches the current source
//   --preflight       check feature coverage and deployment prerequisites

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { galleryMarkdown, writeGallery } from "./lib/gallery.mjs";
import { clipToPreview, findFfmpeg, framesToClip, joinClips, LAYOUT, OUTPUT, PIXEL_RATIO, pngToWebp } from "./lib/media.mjs";
import { Stage, initScript } from "./lib/stage.mjs";
import { loadShowcasePage } from "./lib/startup.mjs";
import { sourceHash, previewStart, sealManifest, validateFeatureOrder, verifyManifest } from "./lib/recordings.mjs";
import featureOrder from "./features/index.mjs";
import { captureOptions, sceneHashes, loadResume, copyCompleted, completeScene, saveProgress } from "./lib/resume.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const MEDIA = path.join(HERE, "media");
const WORK = path.join(HERE, ".work");
const VIEWPORT = LAYOUT;
const VIDEO_NAME = "netlab-ui-showcase.mp4";

function parseArgs(argv) {
  const args = { themes: ["dark"], videoTheme: "dark", video: true, previews: true, only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => argv[++i];
    if (flag === "--base") args.base = value();
    else if (flag === "--workspace") args.workspace = path.resolve(value());
    else if (flag === "--only") args.only = value().split(",").map((s) => s.trim());
    else if (flag === "--resume") args.resume = argv[i + 1] && !argv[i + 1].startsWith("--") ? value() : true;
    else if (flag === "--restart") {
      args.restart = value();
      if (!args.restart || args.restart.startsWith("--")) throw new Error("--restart needs a feature id");
    }
    else if (flag === "--from") {
      args.from = value();
      if (!args.from || args.from.startsWith("--")) throw new Error("--from needs a feature id");
    }
    else if (flag === "--themes") args.themes = value().split(",");
    else if (flag === "--video-theme") args.videoTheme = value();
    else if (flag === "--no-video") args.video = false;
    else if (flag === "--no-previews") args.previews = false;
    else if (flag === "--list") args.list = true;
    else if (flag === "--check") args.check = true;
    else if (flag === "--preflight") args.preflight = true;
    else throw new Error(`unknown option ${flag}`);
  }
  args.base ??= process.env.SHOWCASE_BASE ?? "http://127.0.0.1:8765";
  args.workspace ??= path.join(WORK, "workspace");
  if (args.restart && !args.resume) throw new Error("--restart requires --resume");
  if (args.resume && (args.from || args.only || argv.some((v) => ["--themes", "--video-theme", "--no-video", "--no-previews"].includes(v)))) throw new Error("--resume restores the original capture options; do not combine it with --from, --only or media options");
  if (args.from && args.only) throw new Error("Use --from or --only, not both");
  if (args.from) { args.video = false; args.previews = false; }
  return args;
}

/** playwright-core from docs/showcase/node_modules (run.sh installs it), else
 * a full `playwright` resolvable from here or installed globally. */
async function loadPlaywright() {
  for (const name of ["playwright-core", "playwright"]) {
    try {
      return await import(name);
    } catch {
      // try the next one
    }
  }
  const root = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
  return createRequire(path.join(root, "noop.js"))("playwright");
}

/**
 * The browser to drive: $SHOWCASE_CHROME, else a Chromium/Chrome on PATH (on
 * NixOS the only kind that runs), else Playwright's own download (undefined).
 */
function browserExecutable() {
  if (process.env.SHOWCASE_CHROME) return process.env.SHOWCASE_CHROME;
  for (const name of ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"]) {
    const found = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).stdout.trim();
    if (found) return found;
  }
  return undefined;
}

async function loadFeatures() {
  const dir = path.join(HERE, "features");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".mjs") && f !== "index.mjs");
  validateFeatureOrder(files, featureOrder);
  const features = [];
  for (const file of featureOrder) {
    const mod = await import(pathToFileURL(path.join(dir, file)).href);
    features.push({ file, state: "any", ...mod.default });
  }
  return features;
}

/** A full run starts empty; partial runs may reuse only verified recordings. */
class Manifest {
  constructor(features, previous, selected, currentSource) {
    const byId = new Map((previous?.features ?? []).map((f) => [f.id, f]));
    this.sourceHash = currentSource;
    this.features = features.map((f) => ({
      ...(selected.includes(f) ? { shots: [] } : byId.get(f.id)),
      id: f.id, title: f.title, summary: f.summary,
    }));
  }

  feature(id) {
    return this.features.find((f) => f.id === id);
  }

  shot(featureId, name, alt) {
    const feature = this.feature(featureId);
    let shot = feature.shots.find((s) => s.name === name);
    if (!shot) {
      shot = { name, alt, files: {} };
      feature.shots.push(shot);
    }
    return shot;
  }
}

const dockerUp = () => spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

function netlab(labDir, args) {
  console.log(`  · netlab ${args.join(" ")} (${path.basename(labDir)})`);
  const result = spawnSync("netlab", args, { cwd: labDir, encoding: "utf8", timeout: 900_000, env: { ...process.env, PWD: labDir } });
  if (result.status !== 0) throw new Error(`netlab ${args.join(" ")} failed:\n${(result.stdout + result.stderr).slice(-2000)}`);
  return result.stdout;
}

const settled = new Set();

/**
 * Put the feature's lab in the state it needs. A running lab also gets its
 * configuration re-applied once per run, after its first minute and a half:
 * FRR's watchfrr restarts all daemons when one misses its startup deadline,
 * which drops the configuration netlab pushed — on a slow machine that makes
 * a router silently empty in the pictures. `netlab initial` is idempotent.
 */
async function ensureState(workspace, feature) {
  if (!feature.lab || feature.state === "any") return;
  const labDir = path.join(workspace, feature.lab);
  const lock = path.join(labDir, "netlab.lock");
  if (feature.state === "undeployed") {
    if (fs.existsSync(lock)) netlab(labDir, ["down", "--cleanup"]);
    settled.delete(labDir);
    return;
  }
  if (!fs.existsSync(lock)) netlab(labDir, ["up"]);
  if (settled.has(labDir)) {
    assertRunning(labDir);
    return;
  }
  const age = (Date.now() - fs.statSync(lock).mtimeMs) / 1000;
  if (age < 90) await new Promise((r) => setTimeout(r, (90 - age) * 1000));
  try {
    netlab(labDir, ["initial"]);
  } catch (error) {
    // A half-deployed lab (a failed deploy leaves netlab.lock behind):
    // start over rather than failing every feature that follows.
    console.log(`  · lab not healthy (${String(error.message).split("\n")[0]}), redeploying`);
    netlab(labDir, ["down", "--cleanup", "--force"]);
    netlab(labDir, ["up"]);
  }
  // Re-applying the configuration resets routing sessions; let OSPF and BGP
  // converge before anything is photographed.
  await new Promise((r) => setTimeout(r, 35_000));
  assertRunning(labDir);
  settled.add(labDir);
}

// The monitoring plugin's stack is listed next to the lab's nodes. It is not a
// router: the monitoring scene waits for Grafana itself.
const STACK_ENTRIES = new Set(["monitoring"]);

function assertRunning(labDir) {
  const status = JSON.parse(netlab(labDir, ["status", "--format", "json"]));
  const nodes = Object.entries(status.nodes ?? {}).filter(([name]) => !STACK_ENTRIES.has(name));
  const down = nodes.filter(([, info]) => !/^Up\b/i.test(info.status ?? "") || /paused|unhealthy/i.test(info.status));
  if (!nodes.length || down.length) {
    throw new Error(`Lab is not ready: ${down.map(([name, info]) => `${name} (${info.status ?? "no status"})`).join(", ") || "no running nodes"}`);
  }
}

function checkDeploymentTools(selected) {
  if (!selected.some((feature) => feature.state === "deployed" || feature.needsDocker)) return;
  if (!dockerUp()) throw new Error("Docker is unavailable; the full showcase requires a running lab. No media was replaced.");
  const result = spawnSync("containerlab", ["version"], { encoding: "utf8" });
  const match = /version:\s*(\d+)\.(\d+)\.(\d+)/i.exec(result.stdout ?? "");
  if (result.status !== 0 || !match || (Number(match[1]) === 0 && Number(match[2]) < 75)) {
    throw new Error(`The showcase needs containerlab >= 0.75 with deployment privileges; found ${match ? match.slice(1).join(".") : "no usable containerlab"}. No media was replaced.`);
  }
  const root = process.getuid?.() === 0; // root deploys directly, like the backend does
  // netlab itself runs `sudo -E containerlab` (and `sudo ip ...`), which keeps
  // PATH, so the dev shell's containerlab works without a system install.
  if (!root && spawnSync("sudo", ["-n", "true"], { stdio: "ignore" }).status !== 0) {
    throw new Error("netlab deploys labs through sudo: run `sudo -v` first (run.sh does this). No media was replaced.");
  }
}

async function startScreencast(context, page, framesDir) {
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = path.join(framesDir, `${String(frames.length).padStart(5, "0")}.jpg`);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, ts: metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg", quality: 92, maxWidth: OUTPUT.width, maxHeight: OUTPUT.height, everyNthFrame: 1,
  });
  return async () => {
    await cdp.send("Page.stopScreencast").catch(() => undefined);
    await cdp.detach().catch(() => undefined);
    return frames;
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const features = await loadFeatures();
  if (args.list) {
    for (const f of features) console.log(`${f.id.padEnd(18)} ${f.state.padEnd(10)} ${f.title}`);
    return;
  }
  const currentSource = sourceHash();
  const manifestFile = path.join(MEDIA, "manifest.json");
  const previous = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : null;
  const featureIds = features.map((f) => f.id);
  if (args.check) {
    if (!previous) throw new Error("No showcase has been recorded yet");
    verifyManifest(previous, MEDIA, currentSource, { featureIds, requireVideo: true });
    console.log(`✓ All ${features.length} features, clips, previews and caption timings verified against the capture manifest.`);
    return;
  }
  const unknown = args.only?.filter((id) => !featureIds.includes(id)) ?? [];
  if (unknown.length) throw new Error(`Unknown features: ${unknown.join(", ")}`);
  if (args.from && !featureIds.includes(args.from)) throw new Error(`Unknown feature: ${args.from}`);
  const commonHash = sourceHash(REPO, { excludeFeatures: true });
  const hashes = sceneHashes(features, path.join(HERE, "features"));
  let resume = null;
  if (args.resume) {
    const pointer = path.join(WORK, "latest-capture.json");
    if (args.resume === true && !fs.existsSync(pointer)) throw new Error("No resumable capture yet; start one full recording first.");
    const directory = args.resume === true ? JSON.parse(fs.readFileSync(pointer, "utf8")).directory : path.resolve(args.resume);
    if (!fs.existsSync(path.join(directory, "progress.json"))) throw new Error(`Nothing to resume in ${directory}: no progress.json`);
    resume = loadResume(directory, features, commonHash, hashes, args.restart);
    Object.assign(args, resume.progress.options);
    if (resume.appChanged && resume.start) console.log("· app or recorder code changed since those scenes were recorded: keeping them (add --restart <scene> to redo earlier ones)");
    console.log(`· resume: keep ${resume.start} completed scenes; ${features[resume.start] ? `restart at ${features[resume.start].id}` : "finish assembly"}`);
  }
  const selected = resume ? features.slice(resume.start) : args.from
    ? features.slice(featureIds.indexOf(args.from))
    : features.filter((f) => !args.only || args.only.includes(f.id));
  if (!selected.length && !resume) throw new Error("No features selected");
  if (!args.from && !resume && selected.length < features.length) {
    if (!previous) throw new Error("Record the full showcase before using --only");
    verifyManifest(previous, MEDIA, currentSource, { featureIds, requireVideo: args.video && args.previews, allowSourceChange: true });
    if (previous.sourceHash !== currentSource) {
      console.log(`· --only: keeping the other ${features.length - selected.length} scenes as recorded earlier (files verified); re-recording ${selected.map((f) => f.id).join(", ")}`);
    }
  }
  checkDeploymentTools(selected);
  if (args.preflight) return;
  if (process.env.SHOWCASE_SOURCE_HASH !== currentSource) {
    throw new Error("Start recordings with docs/showcase/run.sh so the current frontend is built first.");
  }
  const ffmpeg = findFfmpeg(path.join(HERE, ".cache"));
  if (!ffmpeg) throw new Error("ffmpeg with libx264 and libwebp is required to generate the showcase");
  const served = await fetch(args.base);
  if (!served.ok || await served.text() !== fs.readFileSync(path.join(REPO, "frontend/dist/index.html"), "utf8")) {
    throw new Error("The backend is not serving the frontend just built by run.sh");
  }

  fs.mkdirSync(WORK, { recursive: true });
  // Readable name (capture-20261004-1626) instead of a random suffix. Only the
  // newest capture is kept: it already holds every scene finished so far.
  const now = new Date();
  const two = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
  const output = fs.mkdtempSync(path.join(WORK, `capture-${stamp}-`));
  const pruneOld = () => {
    for (const name of fs.readdirSync(WORK)) {
      const dir = path.join(WORK, name);
      if (name.startsWith("capture-") && path.resolve(dir) !== path.resolve(output)) fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  const manifest = new Manifest(args.from ? selected : features, args.from || resume ? null : previous, selected, currentSource);
  const checkpointed = !args.from && !args.only;
  let progress = null;
  if (checkpointed) {
    if (resume) {
      copyCompleted(resume, output);
      for (const scene of resume.progress.completed.slice(0, resume.start)) {
        manifest.features[features.findIndex((f) => f.id === scene.entry.id)] = structuredClone(scene.entry);
      }
    }
    progress = { version: 1, featureIds, commonHash, sceneHashes: hashes, options: captureOptions(args),
      completed: resume ? structuredClone(resume.progress.completed.slice(0, resume.start)) : [] };
    saveProgress(output, progress);
    const pointer = path.join(WORK, "latest-capture.json");
    fs.writeFileSync(pointer + ".tmp", JSON.stringify({ directory: output }) + "\n");
    fs.renameSync(pointer + ".tmp", pointer);
    if (resume) pruneOld();
    console.log(`· resumable capture: ${path.relative(REPO, output)}`);
  }
  // Verified, unchanged features can be reused for a partial run. New files
  // stay isolated until every requested scene succeeds.
  for (const feature of features.filter((f) => !args.from && !resume && !selected.includes(f))) {
    fs.cpSync(path.join(MEDIA, feature.id), path.join(output, feature.id), { recursive: true });
  }
  const { chromium } = await loadPlaywright();
  const executablePath = browserExecutable();
  if (executablePath) console.log(`· browser: ${executablePath}`);
  const browser = await chromium.launch({
    executablePath,
    // CDP screencast frames are CSS-pixel sized under an emulated device scale
    // factor; only a real (flag-set) one makes them capture true device pixels.
    args: [`--force-device-scale-factor=${PIXEL_RATIO}`, ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])],
  });
  try {
    for (const [index, feature] of features.entries()) {
      if (!selected.includes(feature)) continue;
      const kicker = `${String(index + 1).padStart(2, "0")} / ${String(features.length).padStart(2, "0")}`;
      console.log(`\n▸ ${feature.id} — ${feature.title}`);
      // The video goes first: it must start from a fresh state (no leftover
      // snapshots or test results); the stills can use whatever it left.
      const plan = args.video ? [{ theme: args.videoTheme, recording: true, stillsOff: true }] : [];
      plan.push(...(feature.themes ?? args.themes).map((theme) => ({ theme, recording: false })));
      for (const step of plan) {
        const viewport = step.recording ? VIEWPORT : { ...VIEWPORT, ...feature.stillViewport };
        const context = await browser.newContext({ viewport, deviceScaleFactor: step.recording ? PIXEL_RATIO : 2, colorScheme: step.theme, serviceWorkers: "block" });
        await context.addInitScript(initScript(step.theme));
        const page = await context.newPage();
        const browserErrors = [];
        page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));
        page.on("requestfailed", (request) => browserErrors.push(`request: ${request.url()} ${request.failure()?.errorText ?? ""}`));
        page.on("console", (message) => {
          if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
        });
        page.setDefaultTimeout(20_000);
        try {
          await ensureState(args.workspace, feature);
          await loadShowcasePage(page, args.base, feature.lab, browserErrors);
          const stage = new Stage({
            page, baseUrl: args.base, theme: step.theme, recording: step.recording, feature,
            mediaDir: output, workspace: args.workspace, manifest, netlab,
            ffmpegStill: (png) => { const webp = png.replace(/\.png$/, ".webp"); pngToWebp(ffmpeg, png, webp); return webp; },
          });
          if (step.stillsOff) stage.shot = async () => undefined;
          // Draw the first connection, deploy, then keep that lab running
          // throughout the remaining scenes.
          if (feature.lab && !feature.showOpen) {
            stage.recording = false;
            await stage.openLab(feature.lab);
            stage.recording = step.recording;
          }
          let stop = null;
          if (step.recording) {
            stop = await startScreencast(context, page, path.join(WORK, "frames", feature.id));
            await stage.card(kicker, feature.title, feature.summary);
          }
          await feature.run(stage);
          if (stop) {
            await stage.say("");
            await page.waitForTimeout(900);
            const frames = await stop();
            const clip = path.join(output, feature.id, `${feature.id}.mp4`);
            fs.mkdirSync(path.dirname(clip), { recursive: true });
            const timing = framesToClip(ffmpeg, frames, clip, {
              ...OUTPUT, idle: stage.idle, captions: stage.captions, track: stage.track, contentStart: stage.contentStart,
            });
            fs.writeFileSync(path.join(WORK, `timing-${feature.id}.json`), JSON.stringify(timing, null, 2) + "\n");
            const entry = manifest.feature(feature.id);
            entry.clip = path.relative(output, clip);
            entry.timing = `${feature.id}/timing.json`;
            const { frames: _frames, ...summary } = timing;
            fs.writeFileSync(path.join(output, entry.timing), JSON.stringify(summary, null, 2) + "\n");
            if (args.previews) {
              entry.preview = `${feature.id}/preview.webp`;
              clipToPreview(ffmpeg, clip, path.join(output, entry.preview), { skip: previewStart(timing) });
            }
            fs.rmSync(path.join(WORK, "frames", feature.id), { recursive: true, force: true });
          }
          console.log(`  ✓ ${step.theme}${step.recording ? " + video" : ""}`);
        } catch (error) {
          const shot = path.join(WORK, "errors", `${feature.id}-${step.theme}.png`);
          fs.mkdirSync(path.dirname(shot), { recursive: true });
          await page.screenshot({ path: shot }).catch(() => undefined);
          throw new Error(`${feature.id}/${step.theme}: ${error.message}${browserErrors.length ? `\nBrowser: ${browserErrors.slice(-8).join(" | ")}` : ""}\nScreenshot: ${path.relative(REPO, shot)}\nNo gallery or media was replaced. Incomplete output: ${path.relative(REPO, output)}${progress ? "\nResume with: docs/showcase/run.sh --resume" : ""}`, { cause: error });
        } finally {
          await context.close();
        }
      }
      if (progress) {
        if (sourceHash() !== currentSource) throw new Error("Source changed during capture; this scene was not checkpointed.");
        progress.completed.push(completeScene(output, manifest.feature(feature.id), feature, progress.options));
        saveProgress(output, progress);
        pruneOld();
      }
    }
  } finally {
    await browser.close();
  }

  if (args.from) {
    if (sourceHash() !== currentSource) throw new Error("Source changed during diagnostic run; rerun to verify the current code.");
    fs.writeFileSync(path.join(output, "diagnostic.json"), JSON.stringify(manifest, null, 2) + "\n");
    console.log(`\n✓ Diagnostic passed: ${selected.map((f) => f.id).join(", ")}\nStills: ${path.relative(REPO, output)}\nNo gallery or published media was replaced. Run without --from for the full video.`);
    return;
  }

  if (args.video) {
    const clips = manifest.features.map((f) => {
      if (!f.clip) throw new Error(`No fresh clip for ${f.id}; refusing to publish an incomplete tour`);
      return path.join(output, f.clip);
    });
    joinClips(ffmpeg, clips, path.join(output, VIDEO_NAME));
    manifest.video = VIDEO_NAME;
    const probe = spawnSync(ffmpeg, ["-i", path.join(output, VIDEO_NAME)], { encoding: "utf8" }).stderr;
    const [, h, m, s] = /Duration: (\d+):(\d+):(\d+)/.exec(probe) ?? [];
    manifest.videoSeconds = h ? Number(h) * 3600 + Number(m) * 60 + Number(s) : undefined;
  }
  if (sourceHash() !== currentSource) throw new Error("Source changed during recording. No media was replaced; rerun the full showcase.");
  manifest.generated = new Date().toISOString();
  sealManifest(manifest, output);
  verifyManifest(manifest, output, currentSource, { featureIds, requireVideo: args.video && args.previews });
  fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  // Replace the complete generated directory, removing obsolete stills and
  // previews as well. A failed run never mixes new captures with old clips.
  const backup = path.join(WORK, "previous-media");
  fs.rmSync(backup, { recursive: true, force: true });
  if (fs.existsSync(MEDIA)) fs.renameSync(MEDIA, backup);
  try {
    fs.renameSync(output, MEDIA);
  } catch (error) {
    if (fs.existsSync(backup)) fs.renameSync(backup, MEDIA);
    throw error;
  }
  if (progress) {
    const pointer = path.join(WORK, "latest-capture.json");
    fs.writeFileSync(pointer + ".tmp", JSON.stringify({ directory: MEDIA }) + "\n");
    fs.renameSync(pointer + ".tmp", pointer);
  }
  const injected = writeGallery(manifest, path.join(HERE, "GALLERY.md"), path.join(REPO, "README.md"));
  console.log(`\nGallery: docs/showcase/GALLERY.md${injected ? " and README.md" : ""}`);
  if (manifest.video) console.log(`Video:   docs/showcase/media/${manifest.video}`);
}

export { galleryMarkdown, parseArgs };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
