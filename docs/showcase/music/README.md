# Showcase intro, outro and music

Music: **[Memories by Sappheiros](https://soundcloud.com/sappheirosmusic/sappheiros-memories)**.
Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), as linked from
[the artist's Bandcamp release](https://sappheiros.bandcamp.com/track/memories).
The showcase uses an excerpt with reduced volume, repeats and fades.

The existing local MP3 came from the MediaFire link on the artist's SoundCloud page.
It lives at `../.cache/music/sappheiros-memories.mp3` and is checked against its
SHA-256 checksum. The mixer reuses it. Only when that cached file is missing does it
download from the artist's original link and verify the checksum. Set `SHOWCASE_MUSIC`
to use the same file from another local folder; an explicit missing path stops the mix.
The music is credited in the MP4 metadata and the media manifest. Keep the credit
below in the description when sharing the video:

> Music: “Memories” by Sappheiros — https://soundcloud.com/sappheirosmusic/sappheiros-memories
>
> CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/
>
> Edited, looped, faded and reduced in volume for this video.

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

The excerpt uses 0:14–5:00 of the song, excluding its long intro and ending fade.
It starts at 0:22, plays through the body, then crossfades the last eight seconds
into the first eight. That cycle repeats seamlessly for as long as the video needs.
The final fade applies once, at the end of the video.

Music settings live in `MIX` in [`mix.mjs`](mix.mjs); intro timing is in `INTRO` in
[`intro.mjs`](intro.mjs). After changing them, rerun the mix;
the `--check` command detects an outdated renderer. The raw song and temporary loop
stay in ignored directories. The extra video's checksum, its source video checksum,
intro asset checksums, and music details are saved in the `music` entry of
`media/manifest.json`. The original
recording checksums stay unchanged. Use the music command's `--check` to validate
the extra edition as well as the recording.

Run the audio regression checks with:

```bash
node --test docs/showcase/music/*.test.mjs
```

## Thank-you outro

The fourteen-second end card uses the README’s complete animated collaboration
logo from `frontend/public/netlabxclab-netlab-ui-loop.svg`, including its transition
to netlab-ui. The centered layout uses the app’s dark theme and Roboto fonts. It thanks the netlab community (ipspace), the containerlab community, SRL Labs
and Nokia for their open-source work on netlab, containerlab and clab-ui, and
displays the netlab-ui and upstream links. The design and timing live in
[`outro.mjs`](outro.mjs); the same deterministic Playwright capture renders both
bookends. The final music fade follows the appended outro automatically.
