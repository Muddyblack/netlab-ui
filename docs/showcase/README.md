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

Commit the generation scripts, SVG source artwork and credits. The generated
`media/` folder and `GALLERY.md` are ignored; the few images the repository
README shows live in `docs/images/` and are copied there by hand.

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

A full run captures every scene into a temporary directory. Only after every scene succeeds does it replace `media/` and regenerate the gallery. A failure leaves the previous gallery untouched, reports the error, and exits unsuccessfully; it never treats a partial scene as complete. The complete replacement also removes obsolete screenshots and previews.

The manifest records a hash of the frontend, backend, dependency files, canvas patches, lab fixtures and recording scripts. This includes uncommitted edits. It also records checksums for every published asset and the final caption timings. The source must remain unchanged throughout the build and recording.

```bash
docs/showcase/run.sh --check
```

This verifies that every feature has its screenshots, clip, preview and caption timings, that every asset matches its checksum, and that the source still matches. Older published recordings without this metadata fail the check; failed capture directories can be imported as described below. `--only` can reuse other scenes only when this verification passes for the current source; after a UI change, run the full showcase.

## Resuming a failed recording

```bash
docs/showcase/run.sh --resume
# Or choose a saved capture and redo a scene (including all later scenes):
docs/showcase/run.sh --resume docs/showcase/.work/capture-XXXXXX --restart validation
```

Each full recording saves `progress.json` after a feature's **entire** set of
stills, video, preview and caption timings succeeds. Resume verifies checksums,
keeps the completed prefix, and restarts the first unfinished feature from its
first still. A failed video pass therefore redoes that feature's stills too.
`--restart` can move the restart earlier, but cannot skip an unfinished or changed
feature. Original theme/video options are restored automatically; don't add
`--no-video`, `--themes`, `--only` or `--from` to a resume command.

Resumed output goes into a new capture directory. Old partial files are never
copied, and the earlier attempt remains available for recovery. A second failure
updates the latest-capture pointer so the next `--resume` uses the newest verified
progress. If recording finished but video assembly failed, resume retries assembly.
Only a complete verified tour replaces the published media and gallery.

The lab is rebuilt from the fixtures and deployed as required. Scenes with state
dependencies restart from their prerequisite: monitoring restarts at validation
so the dashboard has the fault-test outage band. Earlier clips otherwise do not
need to be replayed to recreate a deployed lab.

A fix to the failed scene's own script allows earlier clips to be reused. Editing
an already completed scene automatically moves the restart back to it. Changes
to the app, lab fixtures, monitoring plugin, or shared capture helpers require a
new recording; the runner will explain this before building or capturing.

**Older captures without checkpoints:** supply their directory and an explicit
`--restart` naming the scene that failed. The importer supports the default dark
video tour and verifies every preceding scene's expected screenshots, MP4,
preview and caption timings. It requires `ffprobe`. Such captures did not record
their original source version, so imported clips retain an explicit
`sourceVerified: false` provenance record in the new manifest. They are not
represented as having verified historical source. Failed and later scenes are
always recorded again. For the existing failed validation run:

```bash
docs/showcase/run.sh --resume docs/showcase/.work/capture-To8okv --restart validation
```

## Options

To check the remaining scenes after a failure without replaying the earlier ones:

```bash
docs/showcase/run.sh --from validation
```

`--from` runs that feature and every later feature in order, with stills only.
It builds the current UI and prepares the required lab, but needs no previous
successful recording. Diagnostic images stay in `.work/capture-*`; the gallery
and published media are untouched. After it passes, run without `--from` to
record the complete video. `--from` cannot be combined with `--only`.

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

## Animated intro and background music

[`music/mix.mjs`](music/mix.mjs) replaces the first title card with five seconds of
the app's animated loading screen and adds **Memories**, followed by **Moments**, both by Sappheiros, at a quiet
background level. Music fades in during the intro, repeats with smooth crossfades
for longer videos, and fades out at the measured end. Run it after `run.sh`; it creates the extra
`media/netlab-ui-showcase-music.mp4` and records its checksum in the manifest.
The original silent video stays unchanged. Repeating the mix is safe.
See [music settings and attribution](music/README.md) for the credit to include when
sharing the video. Use `node docs/showcase/music/mix.mjs --check` to verify the mix.

## YouTube Shorts

Turn existing recorded feature clips into portrait Shorts:

```bash
docs/showcase/shorts.sh --list
docs/showcase/shorts.sh --feature monitoring
# Higher resolution portrait output (2K):
docs/showcase/shorts.sh --feature monitoring --width 1440
# Check the source recordings and encoding tools first:
docs/showcase/shorts.sh --feature monitoring --width 1440 --preflight
docs/showcase/shorts.sh --all
# Without music (choose a song inside YouTube), or without the voice-over:
docs/showcase/shorts.sh --feature shell --silent
docs/showcase/shorts.sh --feature shell --no-voice
```

Record with `docs/showcase/run.sh` first if the local clips or manifest are missing.
Shorts export does not build the app or deploy labs. It verifies the selected
clip and timing checksums, and uses the recorded title and summary. Existing
recordings can be exported after source changes; their original source hash is
retained in each Short's JSON metadata.

Outputs are ignored local artifacts in `media/shorts/<feature>/`: `<feature>.mp4`,
`<feature>.youtube.txt` (title on the first line, description and credits below),
and `<feature>.json` (source checksums, caption timings, music excerpts).
`--output <directory>` chooses another destination. Upload the MP4 manually and
paste the upload text; the script does not publish to YouTube.

The default format is 1080×1920; `--width 1440` exports 1440×2560 and
`--width 2160` exports 2160×3840. All presets use 30 fps, H.264/yuv420p,
limited color range, square pixels, CRF 18 with the slow preset (matching the
showcase quality settings), MP3 audio (VS Code's preview can't play AAC;
YouTube accepts both) and fast-start MP4. Captions scale with
the output resolution. Every encoded file is probed before publication to
verify its dimensions, codec, pixel format, frame rate, color range and duration.
A higher output resolution cannot recover details missing from the source clip;
the script warns when the source width is smaller than the export width.
`--preflight` verifies recordings and encoding tools without rendering or
downloading music. `--list` and `--help` need no media tools.
Layout: a heading (feature name as an orange kicker, the title, an accent bar),
the video, the caption in a card like the app's, and a footer with the logo.
The heading, footer and background are HTML drawn once by headless Chrome
([`lib/short-frame.mjs`](lib/short-frame.mjs)); the captions are timed subtitles.

The video is a 900×780 CSS px window of the recording, stretched about 1.3×
taller to fill the video box: slightly distorted, but much more of the app
stays in view than with an undistorted, narrower window. It follows the cursor and the points a scene
marks with `s.focus(target)` (no mouse move, so no hover effects), easing over
and starting just before the cursor arrives. Its height stops above the
recording's own caption, which the Short shows below the video instead.
A feature's `framing` (one entry per caption, like `narration`) can mark a
scene `"wide"`: a 1280px window squeezed into the same box (about 1.85×
taller, but a whole Grafana tab fits), held still on everything right of the
lab sidebar. The width switches where that caption starts.
Recordings made before the cursor track existed are letterboxed instead
(re-record them with `run.sh --only <feature>`). The original title card is
skipped.

The voice-over is an offline [Kokoro](https://github.com/thewh1teagle/kokoro-onnx)
voice ([`narration/speak.py`](narration/speak.py)): a 50/50 blend of
`am_michael` and `am_fenrir` by default; `SHOWCASE_VOICE` takes another voice
or blend, e.g. `am_michael:0.6,am_fenrir:0.4`. It speaks the feature's
`narration`, one paragraph per caption, written to be heard (see
[`features/monitoring.mjs`](features/monitoring.mjs)); a feature without one
gets its captions read. "…" in a paragraph is a real pause (0.35 s, for
listing things), and a paragraph can be `{ text, speed }` to slow it down
(default 1.12). A paragraph starts just after its caption appears and
must end before the next one: speak.py speeds up a long one slightly (at most
1.2×) and `shorts.sh` names any that still don't fit, to shorten. About 2.6
words a second is a good guide. The voice gets a light EQ and compression, and
the music ducks under it. The first run sets up a venv in `.cache/` and
downloads the model (~120 MB) to `narration/voices/`; on NixOS it takes
espeak-ng, libstdc++ and zlib from nixpkgs.

The music is one of the two tracks (random), from a random point, so every Short
gets a different excerpt. It sits well under the voice: it fades in, stays low
(and ducks) while the voice speaks, swells once the voice has finished, then
fades out. The upload text credits only the track used. The voice speaks at
1.12× (`SHOWCASE_VOICE_SPEED`); at 1.0 Kokoro drags stressed vowels. Features longer than 59
seconds split into numbered parts at caption boundaries, preserving action pace
and caption reading time. Very short features keep their natural length.

Each part crossfades two randomly selected excerpts from the showcase's verified
Sappheiros tracks, normalized to −24 LUFS with opening and closing fades.
Rerunning changes the excerpts and replaces the corresponding exports.
Include both generated music credits when uploading; Creative Commons licensing
does not guarantee that YouTube will never issue a Content ID claim.
`--silent` lets you choose music in YouTube's own library instead.
Requires ffprobe and ffmpeg with libx264, libmp3lame and libass, plus Noto Sans (or a
fontconfig substitute) for captions. `FFMPEG` and `FFPROBE` override binaries.
YouTube accepts square or vertical videos up to three minutes as Shorts:
[YouTube's format guidance](https://support.google.com/youtube/answer/15424877).
