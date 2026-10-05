// The stage a feature script performs on: a Playwright page plus helpers
// that make recordings read like a product demo — a visible cursor that
// glides to what it clicks, a ripple on each click, captions, a title card —
// and stills that are cropped, settled and free of overlays.

import fs from "node:fs";
import path from "node:path";

import { IDLE_SPEED } from "./media.mjs";

/** Reading time in the finished video, with a three-second minimum. */
const readingTime = (text) => Math.min(6500, Math.max(3000, 900 + 60 * text.length));

// Injected into every page. Everything lives under #showcase-overlay and is
// hidden while a still is taken (html.showcase-still).
const OVERLAY = String.raw`
(() => {
  const css = ${"`"}
    #showcase-overlay { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
      font-family: Inter, Roboto, "Segoe UI", system-ui, sans-serif; }
    html.showcase-still #showcase-overlay { display: none; }
    #showcase-cursor { position: absolute; width: 26px; height: 26px; margin: -3px 0 0 -4px;
      transform: translate(-100px, -100px); transition: opacity .2s; filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
    .showcase-ripple { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
      border: 2px solid #f59e0b; background: rgba(245,158,11,.25); animation: showcase-ripple .55s ease-out forwards; }
    @keyframes showcase-ripple { to { transform: scale(3.4); opacity: 0; } }
    /* The app's own palette: VS Code greys (#1e1e1e / #252526 / #3c3c3c) and
       its orange accent (#f59e0b), so captions and cards look like part of it. */
    #showcase-caption { position: absolute; left: 50%; bottom: 40px; transform: translate(-50%, 10px); opacity: 0;
      max-width: 64%; padding: 10px 20px 10px 18px; border-radius: 8px; background: rgba(37,37,38,.96); color: #e8e8e8;
      border: 1px solid #3c3c3c; border-left: 3px solid #f59e0b;
      font-size: 18px; font-weight: 500; line-height: 1.4; text-align: left;
      box-shadow: 0 8px 24px rgba(0,0,0,.45);
      transition: opacity .3s ease, transform .3s ease; }
    #showcase-caption.on { opacity: 1; transform: translate(-50%, 0); }
    /* Fills over the caption's reading time: tells viewers how long it stays,
       and keeps the page repainting so the clip doesn't drop the frames. */
    #showcase-caption .read { position: absolute; left: 0; bottom: 0; height: 2px; width: 0; background: #f59e0b; opacity: .8; }
    #showcase-caption.on .read { animation: showcase-read var(--read, 2s) linear forwards; }
    @keyframes showcase-read { to { width: 100%; } }
    #showcase-card { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center;
      padding: 0 12%; opacity: 0; transition: opacity .4s ease; color: #f0f0f0; background: rgba(30,30,30,.94); }
    #showcase-card.on { opacity: 1; }
    #showcase-card .title::after { content: ""; display: block; width: 64px; height: 3px; margin-top: 20px;
      border-radius: 2px; background: #f59e0b; }
    #showcase-card .kicker { font-size: 14px; letter-spacing: .24em; text-transform: uppercase; color: #f59e0b; font-weight: 600; }
    #showcase-card .title { margin-top: 16px; font-size: 52px; font-weight: 700; letter-spacing: -.02em; line-height: 1.1; }
    #showcase-card .summary { margin-top: 18px; max-width: 900px; font-size: 22px; line-height: 1.5; color: #b4b4b4; }
    #showcase-card .brand { position: absolute; left: 12%; bottom: 56px; font-size: 15px; color: #6e6e6e; letter-spacing: .06em; }
  ${"`"};
  function mount() {
    if (document.getElementById("showcase-overlay")) return;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    const root = document.createElement("div");
    root.id = "showcase-overlay";
    root.innerHTML = '<svg id="showcase-cursor" viewBox="0 0 24 24"><path d="M4 2l15 9.2-6.6 1.4 3.9 7.1-2.9 1.6-3.9-7.2L4 19z" fill="#1e1e1e" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
      + '<div id="showcase-caption"></div>'
      + '<div id="showcase-card"><div class="kicker"></div><div class="title"></div><div class="summary"></div><div class="brand">netlab-ui</div></div>';
    document.body.appendChild(root);
    const cursor = root.querySelector("#showcase-cursor");
    document.addEventListener("mousemove", (e) => { cursor.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px)"; }, true);
    document.addEventListener("mousedown", (e) => {
      const ripple = document.createElement("div");
      ripple.className = "showcase-ripple";
      ripple.style.left = e.clientX + "px";
      ripple.style.top = e.clientY + "px";
      root.appendChild(ripple);
      setTimeout(() => ripple.remove(), 700);
    }, true);
  }
  window.__showcase = {
    say(text, readMs) {
      mount();
      const el = document.getElementById("showcase-caption");
      if (!text) { el.classList.remove("on"); return; }
      el.classList.remove("on");
      return new Promise((resolve) => setTimeout(() => {
        el.textContent = text;
        const bar = document.createElement("div");
        bar.className = "read";
        el.appendChild(bar);
        el.style.setProperty("--read", readMs + "ms");
        el.classList.add("on");
        // Count only the time after the caption has faded fully into view.
        setTimeout(() => resolve(Date.now() / 1000), 320);
      }, el.textContent ? 180 : 0));
    },
    card(kicker, title, summary) {
      mount();
      const el = document.getElementById("showcase-card");
      el.querySelector(".kicker").textContent = kicker;
      el.querySelector(".title").textContent = title;
      el.querySelector(".summary").textContent = summary;
      el.classList.add("on");
    },
    hideCard() { document.getElementById("showcase-card")?.classList.remove("on"); },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
`;

export const THEME_STORAGE_KEY = "clab-standalone-theme";

export function initScript(theme) {
  return `try { localStorage.setItem(${JSON.stringify(THEME_STORAGE_KEY)}, ${JSON.stringify(theme)}); } catch {}\n${OVERLAY}`;
}

export class Stage {
  constructor({ page, baseUrl, theme, recording, feature, mediaDir, workspace, netlab, manifest, ffmpegStill }) {
    Object.assign(this, { page, baseUrl, theme, recording, feature, mediaDir, workspace, netlab, manifest, ffmpegStill });
    this.mouse = { x: 800, y: 450 };
    /** [start, end] wall-clock seconds of idle waiting, sped up in the clip. */
    this.idle = [];
    /** Fully visible caption/title spans, checked again by the video encoder. */
    this.captions = [];
    /** [wall-clock seconds, x, y] cursor samples, used to frame portrait crops. */
    this.track = [];
  }

  // ---- pacing -------------------------------------------------------------

  /** A pause the viewer needs; skipped when only stills are taken. */
  async beat(ms = 700) {
    if (this.recording) await this.page.waitForTimeout(ms);
  }

  /** Waiting the viewer doesn't need to sit through: time-lapsed in the video. */
  async wait(ms) {
    const start = Date.now() / 1000;
    await this.page.waitForTimeout(ms);
    if (this.recording) this.idle.push([start, Date.now() / 1000]);
  }

  /** Wait for a locator (a deploy finishing, output arriving) — time-lapsed. */
  async until(locator, options = {}) {
    const start = Date.now() / 1000;
    try {
      await locator.waitFor(options);
    } finally {
      if (this.recording) this.idle.push([start, Date.now() / 1000]);
    }
  }

  /**
   * Caption at the bottom of the recording (no effect on stills). The script
   * carries on after `readMs`, but the caption stays up for its full reading
   * time: the next caption (or the end of the clip) waits until it's been on
   * screen that long in the finished video.
   */
  async say(text, readMs = 1100) {
    if (!this.recording) return;
    await this.finishCaption();
    if (!text) {
      await this.page.evaluate(() => window.__showcase?.say(""));
      return;
    }
    const read = readingTime(text);
    const start = await this.page.evaluate(([t, ms]) => window.__showcase.say(t, ms), [text, read]);
    this.caption = { text, kind: "caption", start, minSeconds: read / 1000 };
    await this.page.waitForTimeout(Math.min(readMs, read));
  }

  /** Wait until the current caption has had its reading time in the video. */
  async finishCaption() {
    if (!this.caption) return;
    const remaining = this.caption.minSeconds * 1000 - this.videoMs(this.caption.start * 1000);
    if (remaining > 0) await this.page.waitForTimeout(remaining);
    this.captions.push({ ...this.caption, end: Date.now() / 1000 });
    this.caption = null;
  }

  /** Milliseconds of finished video since `since`: idle stretches play faster. */
  videoMs(since) {
    const now = Date.now();
    let sped = 0;
    for (const [start, end] of this.idle) {
      const overlap = Math.min(end * 1000, now) - Math.max(start * 1000, since);
      if (overlap > 0) sped += overlap;
    }
    return now - since - sped * (1 - 1 / IDLE_SPEED);
  }

  async card(kicker, title, summary, holdMs = readingTime(summary)) {
    await this.page.evaluate(([k, t, s]) => window.__showcase?.card(k, t, s), [kicker, title, summary]);
    await this.page.waitForTimeout(420);
    const start = Date.now() / 1000;
    await this.page.waitForTimeout(holdMs);
    this.captions.push({ text: title, kind: "title", start, end: Date.now() / 1000, minSeconds: holdMs / 1000 });
    await this.page.evaluate(() => window.__showcase?.hideCard());
    await this.page.waitForTimeout(500);
    this.contentStart = Date.now() / 1000;
  }

  // ---- input --------------------------------------------------------------

  locate(target) {
    return typeof target === "string" ? this.page.getByText(target, { exact: true }).first() : target;
  }

  /**
   * Mark what the viewer should look at without moving the mouse (which would
   * set off hover effects, e.g. Grafana's crosshair). Portrait Shorts crop the
   * 16:9 recording around these points and the cursor.
   */
  async focus(target) {
    if (!this.recording) return;
    const box = await this.locate(target).boundingBox().catch(() => null);
    if (box) this.track.push([Date.now() / 1000, box.x + box.width / 2, box.y + box.height / 2]);
  }

  /** Glide the cursor to the target, like a person would. */
  async moveTo(target, { position } = {}) {
    const locator = this.locate(target);
    await this.until(locator, { state: "visible", timeout: 20_000 });
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error(`no box for ${target}`);
    const x = box.x + (position?.x ?? box.width / 2);
    const y = box.y + (position?.y ?? box.height / 2);
    await this.glide(x, y);
    await this.beat(160);
    return locator;
  }

  /**
   * Move the mouse to (x, y). Recording glides on the wall clock: the position
   * follows elapsed time, so a slow or busy browser drops frames of the glide
   * instead of stretching it, and it always lands in the same ~half second.
   * (`mouse.move({ steps })` fires its events as fast as the browser answers,
   * so its speed and smoothness depended on how loaded the machine was.)
   */
  async glide(x, y) {
    const from = { ...this.mouse };
    const distance = Math.hypot(x - from.x, y - from.y);
    if (this.recording && distance > 1) {
      const duration = Math.min(800, Math.max(300, 220 + distance * 0.55));
      const start = performance.now();
      for (let t = 0; t < 1;) {
        t = Math.min(1, (performance.now() - start) / duration);
        const eased = t * t * (3 - 2 * t);
        const px = from.x + (x - from.x) * eased, py = from.y + (y - from.y) * eased;
        await this.page.mouse.move(px, py);
        this.track.push([Date.now() / 1000, px, py]);
        if (t < 1) await new Promise((resolve) => setTimeout(resolve, 6));
      }
    } else {
      await this.page.mouse.move(x, y);
    }
    if (this.recording) this.track.push([Date.now() / 1000, x, y]);
    this.mouse = { x, y };
  }

  async click(target, options = {}) {
    await this.moveTo(target, options);
    const { button = "left", clickCount = 1 } = options;
    await this.page.mouse.down({ button, clickCount });
    await this.page.mouse.up({ button, clickCount });
    await this.beat(options.after ?? 450);
  }

  async dblclick(target, options = {}) {
    await this.moveTo(target, options);
    await this.page.mouse.dblclick(this.mouse.x, this.mouse.y);
    await this.beat(options.after ?? 500);
  }

  async rightClick(target, options = {}) {
    await this.click(target, { ...options, button: "right" });
  }

  async hover(target, options = {}) {
    await this.moveTo(target, options);
    await this.beat(options.after ?? 500);
  }

  async type(text, { delay = 40 } = {}) {
    await this.page.keyboard.type(text, { delay: this.recording ? delay : 0 });
    await this.beat(300);
  }

  async press(keys) {
    await this.page.keyboard.press(keys);
    await this.beat(350);
  }

  // ---- app shortcuts ------------------------------------------------------

  /** Open a lab from the explorer and wait for its canvas. */
  async openLab(name) {
    if (this.openedLab === name) return;
    this.openedLab = name;
    const nodes = this.page.locator(".react-flow__node").first();
    // From the explorer, as a person would: undeployed labs are listed by
    // name, running ones as "name (instance)". The tree re-renders on status
    // updates and can swallow a double-click, so Ctrl+P is the fallback.
    const candidates = [this.page.getByText(name, { exact: true }), this.page.getByText(new RegExp(`^${name} \\(`))];
    const findRow = async () => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        for (const candidate of candidates) {
          for (const item of await candidate.all()) {
            if (await item.isVisible()) return item;
          }
        }
        await this.page.waitForTimeout(500);
      }
      return null;
    };
    // Right after load a running lab is briefly listed as "name", then as
    // "name (instance)" once the status stream arrives — the row picked in
    // that moment vanishes. Pick again rather than waiting on a ghost.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const row = await findRow();
      if (!row) break;
      try {
        await row.waitFor({ state: "visible", timeout: 1500 });
        await this.dblclick(row);
      } catch {
        continue;
      }
      if (await this.until(nodes, { timeout: 8000 }).then(() => true, () => false)) {
        await this.wait(1500);
        return;
      }
    }
    await this.press("Control+p");
    await this.type(name);
    const item = this.page.locator(".MuiListItemButton-root").filter({ hasText: name }).filter({ hasText: /Lab$/ }).first();
    await this.click(item);
    await this.until(nodes, { timeout: 30_000 });
    await this.wait(1500);
  }

  /** Ctrl+P, type, then Enter once the palette lists a match. */
  async palette(query, { pick = true } = {}) {
    const input = this.page.getByPlaceholder(/^Open labs, units, nodes, actions/);
    await this.press("Control+p");
    // If the shortcut did not open it, typing would trigger app shortcuts instead.
    await input.waitFor({ timeout: 2500 }).catch(async () => {
      await this.press("Control+p");
      await input.waitFor({ timeout: 5000 });
    });
    // Park the cursor on the search box. Left over the result list, the hovered
    // row becomes the active one and Enter runs it instead of the first match.
    await this.moveTo(input);
    await this.type(query);
    // Results show the query's last word ("module:bgp" lists "bgp").
    const word = query.split(/[^A-Za-z0-9.]+/).filter(Boolean).at(-1) ?? query;
    const match = this.page.locator(".MuiListItemButton-root").filter({ hasText: new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).first();
    await this.until(match, { timeout: 10_000 }).catch(() => undefined);
    await this.wait(300);
    if (!pick) return;
    await this.press("Enter");
    await this.page.waitForTimeout(400); // let the palette's close transition finish
    if (await match.isVisible().catch(() => false)) {
      // Still open: the list was re-filtering as Enter landed.
      await this.click(match);
    }
  }

  byTestId(id) {
    return this.page.getByTestId(id);
  }

  menuItem(text) {
    return this.page.locator("[role=menuitem]").filter({ hasText: text }).first();
  }

  /** A link on the canvas between two nodes (by their names). */
  edge(a, b) {
    return this.page.locator(`.react-flow__edge[data-id="${a}--${b}"], .react-flow__edge[data-id="${b}--${a}"]`).first();
  }

  /**
   * Right-click a link at a point along its own path (`t` from 0 to 1) —
   * the middle of its bounding box may belong to a crossing link.
   */
  async rightClickEdge(a, b, t = 0.3) {
    const point = await this.edge(a, b).evaluate((el, at) => {
      const path = el.querySelector("path.react-flow__edge-path") ?? el.querySelector("path");
      const length = path.getTotalLength();
      const p = path.getPointAtLength(length * at);
      const m = path.getScreenCTM();
      return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
    }, t);
    await this.glide(point.x, point.y);
    await this.beat(160);
    await this.page.mouse.down({ button: "right" });
    await this.page.mouse.up({ button: "right" });
    await this.beat(450);
  }

  /** The lab in the explorer's Running Labs section, expanded. */
  async expandRunningLab(lab) {
    const row = this.page.getByText(new RegExp(`^${lab} \\(`)).first();
    await row.waitFor({ timeout: 300_000 });
    const expand = this.page.getByLabel(new RegExp(`^Expand ${lab} \\(`)).first();
    if (await expand.count()) await this.click(expand);
    return row;
  }

  node(name) {
    return this.page.locator(".react-flow__node").filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) }).first();
  }

  /** Run netlab in this feature's lab directory (setup, traffic, …). */
  netlabCli(...args) {
    return this.netlab(path.join(this.workspace, this.feature.lab), args);
  }

  async api(method, route, body) {
    const res = await fetch(new URL(route, this.baseUrl), {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${route}: HTTP ${res.status} ${await res.text()}`);
    return res.headers.get("content-type")?.includes("json") ? res.json() : res.text();
  }

  /**
   * Call one tool on netlab-ui's MCP server, the way an agent would: the
   * three streamable-HTTP requests (initialize, initialized, tools/call).
   * Returns the tool's text answer.
   */
  async mcp(tool, args = {}) {
    const { mcp } = await this.api("GET", "/api/assistant/capabilities");
    const headers = { Authorization: mcp.authHeader, "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    const post = async (body, extra = {}) => {
      const res = await fetch(mcp.url, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });
      if (!res.ok && res.status !== 202) throw new Error(`MCP ${body.method}: HTTP ${res.status} ${await res.text()}`);
      return res;
    };
    const init = await post({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "netlab-ui-showcase", version: "1" } },
    });
    const session = { "mcp-session-id": init.headers.get("mcp-session-id") ?? "" };
    await init.text();
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }, session);
    const res = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } }, session);
    const raw = await res.text();
    // Plain JSON, or one SSE `data:` line carrying it.
    const json = JSON.parse(raw.trim().startsWith("{") ? raw : raw.split("\n").find((line) => line.startsWith("data:")).slice(5));
    if (json.error) throw new Error(`MCP ${tool}: ${json.error.message}`);
    const text = (json.result?.content ?? []).map((part) => part.text ?? "").join("");
    // Tools report expected failures as text; for the showcase that's a failure.
    if (text.startsWith("Error:")) throw new Error(`MCP ${tool}: ${text}`);
    return text;
  }

  // ---- stills -------------------------------------------------------------

  async settle() {
    await this.page.evaluate(async () => {
      const wait = Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
      await Promise.race([wait, new Promise((r) => setTimeout(r, 1500))]);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    await this.page.waitForTimeout(250);
  }

  /**
   * A still of `target` (a locator; the whole window when omitted), with
   * `pad` pixels of context. Captions, the cursor, tooltips and toasts are
   * hidden. `hero` makes it the feature's thumbnail in the gallery grid.
   */
  async shot(name, target, { pad = 20, alt, toasts = false, hero = false } = {}) {
    const { page } = this;
    await this.settle();
    await page.evaluate((hideToasts) => {
      document.documentElement.classList.add("showcase-still");
      if (hideToasts) {
        for (const el of document.querySelectorAll(".notistack-SnackbarContainer, .MuiSnackbar-root")) el.style.visibility = "hidden";
      }
      // A tooltip left over from the cursor's path says nothing about the shot.
      for (const el of document.querySelectorAll(".MuiTooltip-popper")) el.style.visibility = "hidden";
    }, !toasts);
    const viewport = page.viewportSize();
    let clip;
    if (target) {
      const box = await target.boundingBox();
      if (box) {
        // Round outwards with padding, inwards without (no backdrop hairline).
        const outer = pad > 0;
        const x = Math.max(0, outer ? Math.floor(box.x - pad) : Math.ceil(box.x));
        const y = Math.max(0, outer ? Math.floor(box.y - pad) : Math.ceil(box.y));
        const right = Math.min(viewport.width, outer ? Math.ceil(box.x + box.width + pad) : Math.floor(box.x + box.width));
        const bottom = Math.min(viewport.height, outer ? Math.ceil(box.y + box.height + pad) : Math.floor(box.y + box.height));
        clip = { x, y, width: right - x, height: bottom - y };
      }
    }
    const dir = path.join(this.mediaDir, this.feature.id);
    fs.mkdirSync(dir, { recursive: true });
    const png = path.join(dir, `${name}-${this.theme}.png`);
    await page.screenshot({ path: png, clip, animations: "disabled" });
    await page.evaluate(() => {
      document.documentElement.classList.remove("showcase-still");
      for (const el of document.querySelectorAll(".notistack-SnackbarContainer, .MuiSnackbar-root, .MuiTooltip-popper")) el.style.visibility = "";
    });
    const file = this.ffmpegStill ? this.ffmpegStill(png) : png;
    const entry = this.manifest.shot(this.feature.id, name, alt ?? `${this.feature.title}: ${name.replaceAll("-", " ")}`);
    entry.files[this.theme] = path.relative(this.mediaDir, file);
    // The gallery grid uses full-window shots, so its thumbnails line up.
    entry.window = !clip;
    if (hero) entry.hero = true;
  }
}
