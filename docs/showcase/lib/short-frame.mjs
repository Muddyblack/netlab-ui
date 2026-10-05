// The still part of a Short: background, heading and footer with the logo,
// drawn as HTML by headless Chrome (real fonts, the real SVG logo) and saved
// as one PNG. The video goes into the hole at VIDEO_BOX; captions are timed
// subtitles on top. Styled like the app and the main video's title card.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Where the video sits, in 1080×1920 units (scaled for larger presets). */
export const VIDEO_BOX = { y: 310, height: 1220 };

function chrome() {
  if (process.env.SHOWCASE_CHROME) return process.env.SHOWCASE_CHROME;
  for (const name of ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"]) {
    const found = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).stdout.trim();
    if (found) return found;
  }
  return undefined;
}

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function frameHtml({ kicker, title }) {
  const logo = fs.readFileSync(path.join(REPO, "frontend/public/favicon.svg"), "utf8");
  const { y, height } = VIDEO_BOX;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1080px; height: 1920px; overflow: hidden; font-family: "Noto Sans", "Inter", system-ui, sans-serif; color: #f0f0f0;
    background: radial-gradient(900px 520px at 0% 0%, rgba(245,158,11,.16), transparent 70%),
                radial-gradient(800px 500px at 100% 100%, rgba(210,100,0,.10), transparent 70%),
                linear-gradient(180deg, #1b1b1c 0%, #141415 100%); }
  header { position: absolute; left: 64px; right: 64px; top: 64px; }
  .kicker { font-size: 24px; font-weight: 700; letter-spacing: .24em; text-transform: uppercase; color: #f59e0b; }
  h1 { margin-top: 14px; font-size: 58px; font-weight: 800; letter-spacing: -.02em; line-height: 1.08; text-wrap: balance; }
  h1::after { content: ""; display: block; width: 72px; height: 5px; margin-top: 20px; border-radius: 3px; background: #f59e0b; }
  .video { position: absolute; left: 0; right: 0; top: ${y - 2}px; height: ${height + 4}px; background: #000;
    border-top: 2px solid #3c3c3c; border-bottom: 2px solid #3c3c3c; box-shadow: 0 0 60px rgba(0,0,0,.6); }
  footer { position: absolute; left: 64px; right: 64px; bottom: 56px; display: flex; align-items: center; gap: 20px; }
  footer .logo { width: 76px; height: 64px; }
  footer .logo svg { width: 100%; height: 100%; }
  footer .name { font-size: 34px; font-weight: 800; letter-spacing: -.01em; }
  footer .tag { font-size: 22px; color: #8a8a8a; margin-top: 2px; }
  footer .right { margin-left: auto; font-size: 22px; color: #6e6e6e; letter-spacing: .04em; }
</style></head><body>
  <header><div class="kicker">${escape(kicker)}</div><h1>${escape(title)}</h1></header>
  <div class="video"></div>
  <footer><div class="logo">${logo}</div><div><div class="name">netlab-ui</div><div class="tag">Network labs made visual</div></div>
    <div class="right">free &amp; open source</div></footer>
</body></html>`;
}

/** Render the frame at the export width (device scale keeps it sharp). */
export async function renderFrame(fields, width, file) {
  let playwright;
  try { playwright = await import("playwright-core"); } catch { throw new Error("playwright-core is missing: run docs/showcase/run.sh once (or npm install in docs/showcase)"); }
  const browser = await playwright.chromium.launch({ executablePath: chrome(), args: process.getuid?.() === 0 ? ["--no-sandbox"] : [] });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: width / 1080 });
    await page.setContent(frameHtml(fields), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: file });
  } finally {
    await browser.close();
  }
}
