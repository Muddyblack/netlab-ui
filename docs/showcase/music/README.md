# Showcase intro, outro and music

The soundtrack plays **[Memories by Sappheiros](https://soundcloud.com/sappheirosmusic/sappheiros-memories)**
first, then **[Moments by Sappheiros](https://soundcloud.com/sappheirosmusic/moments)**.
Memories is [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), as linked from
[the artist's Bandcamp release](https://sappheiros.bandcamp.com/track/memories).
Moments is credited under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/),
with mixing and mastering by Sacred Music.

The local Memories MP3 came from the artist's MediaFire link and is verified
against its pinned SHA-256 checksum. The mixer downloads it only if missing.
Moments downloads automatically from the direct Chosic MP3 link when missing,
and is cached at `../.cache/music/sappheiros-moments.mp3`. Its SHA-256 checksum
is pinned to the verified Chosic copy, just like Memories. Both downloads are
verified before entering the cache; changed or incomplete files are rejected. Set `SHOWCASE_MUSIC` (Memories) and `SHOWCASE_MOMENTS` (Moments)
to use files in another folder. An explicit missing path stops the mix.
Both input checksums and excerpt timings are recorded in the manifest.

The YouTube title and description live in [`youtube-description.txt`](youtube-description.txt)
(title on the first line). It is a local, **gitignored** file, edited by hand and
pasted into YouTube; the mixer does not touch it. It must keep both music
credits and their license links.

## Render or adjust the mix

After recording the showcase, run from the repository root:

```bash
node docs/showcase/music/mix.mjs
node docs/showcase/music/mix.mjs --check
```

This requires the installed frontend and showcase dependencies, Chrome/Chromium
(or `$SHOWCASE_CHROME`), `ffprobe` (or `$FFPROBE`), and ffmpeg with `libmp3lame`
(or `$FFMPEG`). It verifies the recording first. The audio is MP3 inside the MP4,
so it plays in VS Code's media preview,
which [does not support AAC](https://github.com/microsoft/vscode/blob/main/extensions/media-preview/README.md).
It produces:

- `media/netlab-ui-showcase.mp4` — the original silent recording, kept unchanged.
- `media/netlab-ui-showcase-music.mp4` — an extra version with an animated intro, thank-you outro and music.
- `media/outro/outro.mp4` and `media/outro/thanks-dark.webp` — the animated end card and a still.
- `media/intro/intro.mp4` and `media/intro/loading-dark.webp` — the generated intro and a still.

Rerunning rebuilds the music edition from the silent original, so repeated runs never
stack music or increase its volume. Capture and audio finishing are separate; run
the mix after each fresh `run.sh` recording.

The extra version replaces the first feature's title card with five seconds of the
app's real `StartupGate`, including its animated SVG. Playwright renders the component
from the current frontend source with the normal theme and fonts. The SVG animations
are stepped at 30 frames per second, making their speed independent of capture time.
A short fade leads into the canvas; the rest of the feature scenes are copied unchanged.
The first title is removed using its recorded end marker, so no action is skipped.

The music enters 0.5 seconds into the loading animation. It targets −24 LUFS with a
two-second fade-in and a six-second fade-out.
The end is measured from the current video, so longer and shorter edits work without
changing timestamps. Fades shrink to fit very short videos.

Memories uses 0:14–5:00; playback begins at 0:22. At video time **4:30.5**,
its tail crossfades for eight seconds into Moments starting at **0:24**.
Moments excludes its last twelve seconds, then crossfades back into Memories
if the video runs long enough. Each song is normalized separately to the same
loudness target. Equal-power fades keep transitions from dipping in volume.
The final fade applies once, at the measured end of the video.

This is an excerpt-and-crossfade edit, without tempo changes or beat matching.
Very short videos can finish before the second song enters. Track excerpts live
in `TRACKS`; adjust the first song's end to bring the transition forward.

Music settings live in `MIX` in [`mix.mjs`](mix.mjs); intro timing is in `INTRO` in
[`intro.mjs`](intro.mjs). After changing them, rerun the mix;
the `--check` command detects an outdated renderer. The raw song and temporary loop
stay in ignored directories. The extra video's checksum, its source video checksum,
intro asset checksums, and music details are saved in the `music` entry of
`media/manifest.json`. The original
recording checksums stay unchanged. Use the music command's `--check` to validate
the extra edition as well as the recording.

## Thank-you outro

The fourteen-second end card uses the README’s complete animated collaboration
logo from `frontend/public/netlabxclab-netlab-ui-loop.svg`, including its transition
to netlab-ui. The centered layout uses the app’s dark theme and Roboto fonts. It thanks the netlab community (ipspace), the containerlab community, SRL Labs
and Nokia for their open-source work on netlab, containerlab and clab-ui, and
displays the netlab-ui and upstream links. The design and timing live in
[`outro.mjs`](outro.mjs); the same deterministic Playwright capture renders both
bookends. The final music fade follows the appended outro automatically.
