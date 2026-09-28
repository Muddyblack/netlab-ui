// Render the application's real StartupGate and SVG with Playwright, then
// replace the first feature title in the extra music edition of the tour.
import { createHash } from "node:crypto";
import { OUTRO, outroHtml } from "./outro.mjs";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { joinClips, pngToWebp } from "../lib/media.mjs";
import { fileHash } from "../lib/recordings.mjs";

const SCRIPT = fileURLToPath(import.meta.url);
const REPO = path.resolve(path.dirname(SCRIPT), "../../..");
const FRONTEND = path.join(REPO, "frontend");
const frontendRequire = createRequire(path.join(FRONTEND, "package.json"));
export const INTRO = { seconds: 5, fps: 30, fade: 0.25 };
export const introRendererHash = () => createHash("sha256").update(fileHash(SCRIPT)).update(fileHash(path.join(path.dirname(SCRIPT), "outro.mjs"))).digest("hex");

const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { MuiThemeProvider, applyThemeVars } from "@containerlab/clab-ui/theme";
import { StartupGate } from "/src/components/StartupGate.tsx";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import "@containerlab/clab-ui/styles/global.css";
localStorage.setItem("clab-standalone-theme", "dark");
applyThemeVars("dark");
document.documentElement.style.colorScheme = "dark";
createRoot(document.getElementById("root")).render(
  createElement(MuiThemeProvider, null, createElement(StartupGate, {
    startup: { status: "checking", health: null, error: null }, onRetry() {},
  })),
);
`;

function ffmpegRun(ffmpeg, args) {
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args]);
}

function browserExecutable() {
  if (process.env.SHOWCASE_CHROME) return process.env.SHOWCASE_CHROME;
  for (const name of ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"]) {
    const result = spawnSync("which", [name], { encoding: "utf8" });
    if (result.status === 0) return result.stdout.trim();
  }
  return undefined;
}

export async function renderBookends(ffmpeg, directory, { width = 1600, height = 900 } = {}) {
  const { createServer } = await import(pathToFileURL(frontendRequire.resolve("vite")).href);
  const { chromium } = await import("playwright-core");
  const frames = path.join(directory, "intro-frames");
  fs.mkdirSync(frames, { recursive: true });
  const virtual = "\0showcase-intro";
  const html = fs.readFileSync(path.join(FRONTEND, "index.html"), "utf8")
    .replace('src="/src/main.tsx"', 'src="/@id/__x00__showcase-intro"');
  const server = await createServer({
    root: FRONTEND,
    configFile: path.join(FRONTEND, "vite.config.ts"),
    cacheDir: path.join(REPO, "docs/showcase/.work/intro-vite-cache"),
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, open: false },
    plugins: [{
      name: "showcase-startup-intro",
      resolveId(id) { if (id === virtual) return virtual; },
      load(id) { if (id === virtual) return ENTRY; },
      configureServer(vite) {
        vite.middlewares.use("/__showcase_intro.html", async (_req, res, next) => {
          try {
            res.setHeader("Content-Type", "text/html");
            res.end(await vite.transformIndexHtml("/__showcase_intro.html", html));
          } catch (error) { next(error); }
        });
      },
    }],
  });
  let browser;
  let outro;
  try {
    await server.listen();
    browser = await chromium.launch({ executablePath: browserExecutable() });
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: "dark" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__showcase_intro.html`);
    const logo = page.getByAltText("Checking netlab", { exact: true });
    await logo.waitFor();
    await page.getByText("Checking netlab environment", { exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    // Inline the exact SVG loaded by StartupGate so its CSS animations can
    // be stepped at fixed frame times instead of depending on capture speed.
    const svg = fs.readFileSync(path.join(FRONTEND, "public/netlab-full-lockup_animated.svg"), "utf8");
    const animations = await logo.evaluate((img, markup) => {
      const svg = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
      svg.setAttribute("class", img.className);
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", img.alt);
      const style = getComputedStyle(img);
      svg.style.width = style.width;
      svg.style.height = style.height;
      img.replaceWith(document.importNode(svg, true));
      const animations = document.getAnimations();
      for (const animation of animations) { animation.pause(); animation.currentTime = 0; }
      return animations.length;
    }, svg);
    if (!animations) throw new Error("Startup SVG did not expose any animations");
    for (let frame = 0; frame < INTRO.seconds * INTRO.fps; frame++) {
      await page.evaluate((time) => {
        for (const animation of document.getAnimations()) animation.currentTime = time;
      }, frame * 1000 / INTRO.fps);
      await page.screenshot({ path: path.join(frames, `${String(frame).padStart(4, "0")}.png`), animations: "allow" });
    }
    if (errors.length) throw new Error(`Startup intro: ${errors.join("; ")}`);
    console.log("· Rendering the animated containerlab thank-you outro");
    // Keep the loaded local fonts; replace only the page content and styles.
    await page.evaluate((html) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      document.head.append(doc.querySelector("style"));
      document.body.replaceChildren(...doc.body.childNodes);
    }, outroHtml);
    const clabSvg = fs.readFileSync(path.join(FRONTEND, "public/netlabxclab-netlab-ui-loop.svg"), "utf8");
    await page.evaluate((markup) => {
      const source = new DOMParser().parseFromString(markup, "image/svg+xml");
      const svg = document.importNode(source.documentElement, true);
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "Netlab × clab-ui");
      document.getElementById("clab-mark").append(svg);
      for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = 0; }
    }, clabSvg);
    const outroFrames = path.join(directory, "outro-frames");
    fs.mkdirSync(outroFrames);
    for (let frame = 0; frame < OUTRO.seconds * OUTRO.fps; frame++) {
      await page.evaluate(time => { for (const a of document.getAnimations()) a.currentTime = time; }, frame * 1000 / OUTRO.fps);
      await page.screenshot({ path: path.join(outroFrames, `${String(frame).padStart(4, "0")}.png`), animations: "allow" });
    }
    const outroClip = path.join(directory, "outro.mp4");
    ffmpegRun(ffmpeg, ["-framerate", String(OUTRO.fps), "-i", path.join(outroFrames, "%04d.png"),
      "-vf", "fade=t=in:d=0.3:color=0x1e1e1e,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "20",
      "-video_track_timescale", "15360", "-movflags", "+faststart", outroClip]);
    const outroPoster = path.join(directory, "thanks-dark.webp");
    pngToWebp(ffmpeg, path.join(outroFrames, "0150.png"), outroPoster);
    fs.rmSync(outroFrames, { recursive: true, force: true });
    outro = { clip: outroClip, poster: outroPoster };

  } finally {
    if (browser) await browser.close();
    await server.close();
  }
  const clip = path.join(directory, "intro.mp4");
  ffmpegRun(ffmpeg, [
    "-framerate", String(INTRO.fps), "-i", path.join(frames, "%04d.png"),
    "-vf", `fade=t=out:st=${INTRO.seconds - INTRO.fade}:d=${INTRO.fade}:color=0x1e1e1e,format=yuv420p`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-video_track_timescale", "15360", "-movflags", "+faststart", clip,
  ]);
  const poster = path.join(directory, "loading-dark.webp");
  pngToWebp(ffmpeg, path.join(frames, "0132.png"), poster);
  fs.rmSync(frames, { recursive: true, force: true });
  return { intro: { clip, poster }, outro };
}

/** Only the first feature needs a new encode; remaining scenes are copied. */
export function replaceOpeningTitle(ffmpeg, clips, trimStart, intro, output, outro) {
  if (!clips.length || !Number.isFinite(trimStart) || trimStart <= 0) throw new Error("Missing first feature title timing");
  const first = path.join(path.dirname(output), "first-content.mp4");
  try {
    ffmpegRun(ffmpeg, [
      "-ss", String(trimStart), "-i", clips[0], "-map", "0:v:0", "-an",
      "-vf", `fade=t=in:d=${INTRO.fade}:color=0x1e1e1e,format=yuv420p`,
      "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-video_track_timescale", "15360", "-movflags", "+faststart", first,
    ]);
    joinClips(ffmpeg, [intro, first, ...clips.slice(1), ...(outro ? [outro] : [])], output);
  } finally {
    fs.rmSync(first, { force: true });
  }
}
