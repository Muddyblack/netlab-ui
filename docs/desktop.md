# Desktop App

[`desktop/`](../desktop/) is an Electron shell around the same UI — no bundled backend, same as the container above: point it at a running netlab-ui backend (this machine or a remote netlab host) and it renders that backend's UI in a native window. Defaults to `http://localhost:8000`; change it any time from the **Server** menu.

The shell does not build a second copy of the frontend. It displays the frontend served by the selected backend, including the `clab-ui` patch applied by `frontend/patches/` during that frontend's build.

The window that loads the backend's UI gets zero Node/IPC access (`contextIsolation`, `sandbox`, `nodeIntegration: false` — see [`desktop/src/main.js`](../desktop/src/main.js)); only the local connect screen gets the settings bridge, and [`desktop/src/preload.js`](../desktop/src/preload.js) refuses to expose it to anything not loaded from `file://`. Same reasoning containerlab-app, Jellyfin, and Home Assistant's desktop clients use for "point this app at a server I trust."

```bash
cd desktop
npm install
npm start                # launches against your running backend
npm run check            # lint + unit tests
```

Packaging is via `electron-builder`:

```bash
npm run build:linux   # AppImage + .deb + .rpm
npm run build:mac     # universal .dmg (build on macOS)
npm run build:win     # NSIS .exe
```

Cross-compiling `.dmg` needs a macOS host (Apple's toolchain isn't available on Linux); Windows can be built cross-platform. Nothing is code-signed yet, so macOS Gatekeeper/Windows SmartScreen will warn on the built installers — same unsigned state containerlab-app's desktop releases are in today.

**Releasing:** [`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml) builds all three platforms in parallel (Linux/macOS/Windows runners) and publishes them to a GitHub Release. Push a tag to trigger it:

```bash
git tag desktop-v0.1.0 && git push origin desktop-v0.1.0
```

That prefix (`desktop-v*`, not `v*`) is deliberate — it keeps desktop releases on their own tag namespace, separate from whatever the repo's other `v*` tags are used for.
