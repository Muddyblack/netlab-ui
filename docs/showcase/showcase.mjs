#!/usr/bin/env node
// Generate the showcase: dark stills and a fresh clip per feature, one
// joined video, animated previews, GALLERY.md and the README gallery.
//
// Start through run.sh, which builds the UI and boots an isolated backend.
// Options:
//   --only a,b        just these features (requires matching source for the rest)
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
import { clipToPreview, findFfmpeg, framesToClip, joinClips, pngToWebp } from "./lib/media.mjs";
import { Stage, initScript } from "./lib/stage.mjs";
import { sourceHash, previewStart, sealManifest, validateFeatureOrder, verifyManifest } from "./lib/recordings.mjs";
import featureOrder from "./features/index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const MEDIA = path.join(HERE, "media");
const WORK = path.join(HERE, ".work");
const VIEWPORT = { width: 1600, height: 900 };
const VIDEO_NAME = "netlab-ui-showcase.mp4";

function parseArgs(argv) {
  const args = { themes: ["dark"], videoTheme: "dark", video: true, previews: true, only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => argv[++i];
    if (flag === "--base") args.base = value();
    else if (flag === "--workspace") args.workspace = path.resolve(value());
    else if (flag === "--only") args.only = value().split(",").map((s) => s.trim());
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

function assertRunning(labDir) {
  const status = JSON.parse(netlab(labDir, ["status", "--format", "json"]));
  const nodes = Object.entries(status.nodes ?? {});
  const down = nodes.filter(([, info]) => !/^Up\b/i.test(info.status ?? "") || /paused|unhealthy/i.test(info.status));
  if (!nodes.length || down.length) throw new Error(`Lab is not ready: ${down.map(([name]) => name).join(", ") || "no running nodes"}`);
}

function checkDeploymentTools(selected) {
  if (!selected.some((feature) => feature.state === "deployed" || feature.needsDocker)) return;
  if (!dockerUp()) throw new Error("Docker is unavailable; the full showcase requires a running lab. No media was replaced.");
  const result = spawnSync("containerlab", ["version"], { encoding: "utf8" });
  const match = /version:\s*(\d+)\.(\d+)\.(\d+)/i.exec(result.stdout ?? "");
  if (result.status !== 0 || !match || (Number(match[1]) === 0 && Number(match[2]) < 75)) {
    throw new Error(`The showcase needs containerlab >= 0.75 with deployment privileges; found ${match ? match.slice(1).join(".") : "no usable containerlab"}. No media was replaced.`);
  }
  if (fs.existsSync("/etc/NIXOS") && !fs.existsSync("/run/wrappers/bin/containerlab")) {
    throw new Error("The NixOS containerlab wrapper is not installed. Activate the NixOS configuration and log in again before recording. No media was replaced.");
  }
  if (fs.existsSync("/etc/NIXOS")) {
    try {
      fs.accessSync("/run/wrappers/bin/containerlab", fs.constants.X_OK);
    } catch {
      throw new Error("The NixOS containerlab wrapper is not executable by this login. Log out and back in to pick up clab_admins membership. No media was replaced.");
    }
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
    format: "jpeg", quality: 92, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height, everyNthFrame: 1,
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
    console.log(`✓ All ${features.length} features, clips, previews and caption timings match the current source.`);
    return;
  }
  const unknown = args.only?.filter((id) => !featureIds.includes(id)) ?? [];
  if (unknown.length) throw new Error(`Unknown features: ${unknown.join(", ")}`);
  const selected = features.filter((f) => !args.only || args.only.includes(f.id));
  if (!selected.length) throw new Error("No features selected");
  if (selected.length < features.length) {
    if (!previous) throw new Error("Record the full showcase before using --only");
    verifyManifest(previous, MEDIA, currentSource, { featureIds, requireVideo: args.video && args.previews });
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
  const output = fs.mkdtempSync(path.join(WORK, "capture-"));
  const manifest = new Manifest(features, previous, selected, currentSource);
  // Verified, unchanged features can be reused for a partial run. New files
  // stay isolated until every requested scene succeeds.
  for (const feature of features.filter((f) => !selected.includes(f))) {
    fs.cpSync(path.join(MEDIA, feature.id), path.join(output, feature.id), { recursive: true });
  }
  const { chromium } = await loadPlaywright();
  const executablePath = browserExecutable();
  if (executablePath) console.log(`· browser: ${executablePath}`);
  const browser = await chromium.launch({ executablePath });
  try {
    for (const [index, feature] of features.entries()) {
      if (!selected.includes(feature)) continue;
      const kicker = `${String(index + 1).padStart(2, "0")} / ${String(features.length).padStart(2, "0")}`;
      console.log(`\n▸ ${feature.id} — ${feature.title}`);
      const plan = (feature.themes ?? args.themes).map((theme) => ({ theme, recording: false }));
      if (args.video) plan.push({ theme: args.videoTheme, recording: true, stillsOff: true });
      for (const step of plan) {
        const viewport = step.recording ? VIEWPORT : { ...VIEWPORT, ...feature.stillViewport };
        const context = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: step.theme, serviceWorkers: "block" });
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
          await page.goto(args.base, { waitUntil: "load" });
          if (feature.lab) await page.getByText(new RegExp(`^${feature.lab}( \\(.*\\))?$`)).first().waitFor({ timeout: 30_000 });
          await page.waitForTimeout(800);
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
              ...VIEWPORT, idle: stage.idle, captions: stage.captions, contentStart: stage.contentStart,
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
          throw new Error(`${feature.id}/${step.theme}: ${error.message}${browserErrors.length ? `\nBrowser: ${browserErrors.slice(-8).join(" | ")}` : ""}\nScreenshot: ${path.relative(REPO, shot)}\nNo gallery or media was replaced. Incomplete output: ${path.relative(REPO, output)}`, { cause: error });
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
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
  const injected = writeGallery(manifest, path.join(HERE, "GALLERY.md"), path.join(REPO, "README.md"));
  console.log(`\nGallery: docs/showcase/GALLERY.md${injected ? " and README.md" : ""}`);
  if (manifest.video) console.log(`Video:   docs/showcase/media/${manifest.video}`);
}

export { galleryMarkdown };

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
