# Showcase: screenshots, videos and the README gallery

Everything under `media/` is generated from the real app. After a UI change, regenerate the recording and add its background music:

```bash
docs/showcase/run.sh
node docs/showcase/music/mix.mjs
```

It produces:

- **Stills** for every feature, in the dark theme: `media/<feature>/<shot>-dark.webp` (`--themes light,dark` adds light ones; the gallery then serves both with `<picture>`).
- **One video to share**, `media/netlab-ui-showcase.mp4`: draw a connection, deploy, then demonstrate the remaining features with the lab running. Each feature has a title card, a visible cursor and captions.
- **An extra version with an animated loading intro and background music**, `media/netlab-ui-showcase-music.mp4`, produced by the second command. The original MP4 stays silent.
- **A clip per feature** (`media/<feature>/<feature>.mp4`) and an animated preview (`preview.webp`) for the gallery. Every preview starts after its title card has faded and continues through the end of the clip.
- **The gallery**: [`GALLERY.md`](GALLERY.md) is a thumbnail grid, then one collapsible section per feature. The repository README gets just the grid (between `<!-- showcase:start -->` and `<!-- showcase:end -->`), each thumbnail linking to its section in `GALLERY.md`.

## What belongs in Git

Commit the generation scripts, SVG source artwork, credits, gallery Markdown,
feature screenshots and animated WebP previews used by the gallery.

Keep these generated outputs local (the showcase `.gitignore` excludes them):

- All MP4s, including the combined tour and individual feature clips.
- Everything in `media/intro/` and `media/outro/`, including their still previews.
- `media/manifest.json` and per-feature `timing.json` files.
- Downloaded music, temporary frames and caches under `.work/` and `.cache/`.

The manifest describes a complete local recording, including ignored videos. Keep
it and the timing files: the mixer, `--check` and partial recordings need them.
A fresh clone contains the gallery, but needs a full recording before those
commands can work. Ignoring these files does not change local verification.

When sharing a video, upload it as a release asset or to external storage with
its manifest, timings and music credit. The generated repository gallery includes
only image links; add a published video URL separately once it exists. Do not
force-add local video outputs to Git. Update committed images when the documented
UI changes, rather than committing every experimental recording.

## What it needs

- The backend's Python: `backend/.venv`, or the Nix dev shell (`nix develop` / direnv). Every recording runs `npm ci` to install locked frontend dependencies and their patches, then builds the current frontend. An existing `dist/` is never reused.
- Node, and a Chromium or Chrome. `run.sh` installs `playwright-core` into `docs/showcase/node_modules` on first use (no browser download). The browser is `$SHOWCASE_CHROME`, else `chromium` / `google-chrome` on `PATH` (on NixOS, the only kind that runs), else one from `npx playwright install chromium`.
- Docker, containerlab 0.75 or newer with permission to deploy, and the default FRR and Linux images. Docker availability and the containerlab version are checked before installing frontend dependencies or building. Missing deployment prerequisites fail the run; scenes are never silently skipped.
- ffmpeg with libx264 and libwebp. The one on `PATH` or in `$FFMPEG` is used if it has both. Otherwise `run.sh` fetches a static build once into `.cache/` (the `imageio-ffmpeg` Python package).

The run is isolated:
- netlab-ui runs on `127.0.0.1:8765` with its own `HOME` and workspace under `.work/`. Your labs and netlab's lab registry never show up in the pictures.
- The showcase labs from `labs/` are copied fresh each time and torn down at the end.
- Each run clears the showcase's lab registry so failed deploys do not appear as running labs. If an interrupted run left a deployed lab, tear it down before rerunning; its workspace is preserved until then.

## Keeping recordings current

A full run captures every scene into a temporary directory. Only after every scene succeeds does it replace `media/` and regenerate the gallery. A failure leaves the previous gallery untouched, reports the error, and exits unsuccessfully; it never fills a gap with an old clip. Features that finished before the failure are kept in `.work/resume/`: fix the problem and run `docs/showcase/run.sh --resume` to record only the remaining ones (a run without `--resume` starts clean). The frontend is still rebuilt, so reused features may predate your fix. The complete replacement also removes obsolete screenshots and previews.

The manifest records a hash of the frontend, backend, dependency files, canvas patches, lab fixtures and recording scripts. This includes uncommitted edits. It also records checksums for every published asset and the final caption timings. The source must remain unchanged throughout the build and recording.

```bash
docs/showcase/run.sh --check
```

This verifies that every feature has its screenshots, clip, preview and caption timings, that every asset matches its checksum, and that the source still matches. Older recordings without this metadata fail the check and need a full run. `--only` can reuse other scenes only when this verification passes for the current source; after a UI change, run the full showcase.

## Options

```bash
docs/showcase/run.sh --list                 # the features
docs/showcase/run.sh --only deploy,shell    # retry these against the same verified source
docs/showcase/run.sh --check                # verify the complete published showcase
docs/showcase/run.sh --themes dark          # stills in one theme
docs/showcase/run.sh --no-video             # stills only (fast)
docs/showcase/run.sh --no-previews          # no animated previews in the gallery
docs/showcase/run.sh --video-theme light    # record the clips in the light theme
SHOWCASE_PORT=9000 docs/showcase/run.sh     # another port
```

## Adding a feature

Add one file, `features/my-feature.mjs`, then add its filename to [`features/index.mjs`](features/index.mjs). That list controls the gallery and video order. Move or insert a line there to reorder scenes; filenames and media links stay unchanged. The runner checks that every feature file appears exactly once.

```js
export default {
  id: "my-feature",                 // folder under media/, anchor in the gallery
  title: "Short headline",          // title card and gallery heading
  summary: "One sentence on what it does for the user.",
  lab: "fabric",                    // a lab from labs/ (optional)
  state: "deployed",                // "deployed" | "undeployed" | "any": ensured before each run
  needsDocker: true,                // fail early if Docker is unavailable
  showOpen: true,                   // record opening the lab (otherwise the clip starts on the open lab)
  stillViewport: { height: 1300 },  // optional: more room for stills (videos stay 16:9)
  async run(s) {
    await s.openLab("fabric");
    await s.say("Caption shown in the video");
    await s.rightClick(s.node("l1"));
    await s.click(s.menuItem("Something"));
    await s.shot("result", s.page.getByRole("dialog").first(), { alt: "What the picture shows" });
  },
};
```

The same `run` is used for stills (fast, no pauses) and for the video (the cursor glides, captions show, pauses are kept). These are separate passes so taking a screenshot cannot hide a caption in the recording. Restore any topology edits before the script returns. Write the steps once, like a person demonstrating the feature.

### Stage API (`s`)

| | |
|---|---|
| `s.openLab(name)` | open a lab from the explorer, wait for the canvas |
| `s.click / dblclick / rightClick / hover(target, {position, after})` | the cursor glides to the target first; `target` is a locator or exact text |
| `s.type(text)` · `s.press("Control+p")` | keyboard |
| `s.palette(query)` | Ctrl+P, type, Enter |
| `s.say(text)` | caption in the video (no effect on stills) |
| `s.wait(ms)` · `s.until(locator)` | wait for something (time-lapsed 4× in the video) |
| `s.beat(ms)` | a pause for the viewer (real time, recording only) |
| `s.shot(name, target?, {pad, alt, hero, toasts})` | still of a locator (or the window); overlays, tooltips and toasts hidden; `hero` makes it the gallery thumbnail (default: the first full-window shot) |
| `s.node(name)` · `s.edge(a, b)` · `s.menuItem(text)` · `s.byTestId(id)` | common locators |
| `s.rightClickEdge(a, b, t)` | right-click a link at a point along its path (crossing links share a middle) |
| `s.expandRunningLab(lab)` | the lab's row in Running Labs, expanded |
| `s.netlabCli(...args)` | run netlab in the lab (setup, traffic) |
| `s.api(method, route, body)` | call the backend |
| `s.mcp(tool, args)` | call a tool through the backend's MCP endpoint; return its text answer or fail on a tool error |
| `s.page` | the Playwright page for anything else |

A failing feature leaves a screenshot in `.work/errors/` and stops the run before publishing. Incomplete captures remain under `.work/capture-*/` for inspection.

## Adding a lab

Put a directory under `labs/` with a `topology.yml`, plus a `topology.yml.annotations.json` for the node positions. The easiest way to get the positions: arrange the lab in netlab-ui and copy the file it writes.

## How the video is made

Frames come from Chrome's screencast (sharper than Playwright's built-in recorder) and are encoded with H.264. The screencast only sends a frame when something changes, so each frame is held until the next one, with long holds capped. Time spent in `s.wait` / `s.until` plays back 4× faster. Cursor moves, typing and `s.beat` pauses keep their pace.

After those speed changes, the encoder checks every caption and title card. If one would be too short, it holds its last visible frame long enough to read it. Captions get at least three seconds, with longer text given more time. Every recorded clip writes its final caption timings to `.work/timing-<feature>.json`. The finished MP4's duration is measured automatically for the manifest; the README and gallery links omit it.

Run the timing regression checks (requires ffmpeg):

```bash
node --test docs/showcase/lib/*.test.mjs
```

## Animated intro and background music

[`music/mix.mjs`](music/mix.mjs) replaces the first title card with five seconds of
the app's animated loading screen and adds **Memories by Sappheiros** at a quiet
background level. Music fades in during the intro, repeats with smooth crossfades
for longer videos, and fades out at the measured end. Run it after `run.sh`; it creates the extra
`media/netlab-ui-showcase-music.mp4` and records its checksum in the manifest.
The original silent video stays unchanged. Repeating the mix is safe.
See [music settings and attribution](music/README.md) for the credit to include when
sharing the video. Use `node docs/showcase/music/mix.mjs --check` to verify the mix.

## Voice-over (optional, not enabled)

[`narration/`](narration/) can speak [`narration/script.txt`](narration/script.txt) with the offline Kokoro model (voice `am_michael`), on the CPU with no internet connection once the model is downloaded. `run.sh` doesn't use it yet; see the top of [`narration/narrate.py`](narration/narrate.py) for the one-time setup.

Write it like a spoken walkthrough, with contractions and a mix of short and longer sentences. Each paragraph stays together during synthesis. Its optional first line, such as `[speed=1.14 pause=0.18]`, controls the speaking speed and the added pause after it in seconds; this line isn't spoken. The defaults are speed `1.14` and pause `0.18`. The script moves faster through familiar actions, gives shortcuts and review steps more time, and leaves a longer pause at a topic change. Keep timing choices tied to the meaning of the text.
