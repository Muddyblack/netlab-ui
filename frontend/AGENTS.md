# Frontend Agent Guidelines

See root `AGENTS.md` for agent spawn policy and model roles.

## Stack
- **React + TypeScript** with Vite
- **`@srl-labs/clab-ui`** consumed as a normal npm dependency, published on GitHub Packages (see `frontend/.npmrc` + `NODE_AUTH_TOKEN`)
- Theme defined in `src/theme.ts`

## Structure
```
frontend/src/
  api/          # Generated OpenAPI client types + fetch wrappers
  components/   # Netlab-specific React components
  host/         # Host/environment integration
  lifecycle/    # App lifecycle logic
  panels/       # Side/bottom panel components
  terminal/     # Terminal UI
  utils/        # Shared utilities
  App.tsx       # Root component, passes extension props to clab-ui
  theme.ts      # MUI/custom theme config
```

## Check Before You Implement (mandatory)

Before writing any new component, hook, utility, or UI pattern, check whether `@srl-labs/clab-ui` already provides it.

Key areas that are **already covered by clab-ui** — do not reimplement:
- **Toasts / error notifications** → its `Toast` component, `useAppToasts` hook
- **Panels, dialogs, context menus**
- **Canvas, topology, node rendering**
- **Stores and services** (graph store, canvas store, topology host sync)

```bash
# Run this before implementing anything — checks the installed package's type declarations
grep -r "SomeConcept" frontend/node_modules/@srl-labs/clab-ui --include="*.d.ts" -l
```

If `clab-ui` doesn't export something you need, that's an upstream ask (bump the version once it's added) — never copy-paste its source into `frontend/src/`.

## clab-ui@0.3.0 patch (temporary)

`0.3.0`'s "delete dead code" cleanup (upstream commit `2b581cd`) accidentally
dropped root-level exports (`useNodes`, `useEdges`, `useIsLocked`,
`useTopoViewerActions`, the form primitives, icon helpers) that an earlier
commit (`9d77b4a`) had added specifically for netlab-gui-style integrators.
The underlying code is still bundled in `dist/` — only the barrel `export`
statements were removed.

`frontend/patches/@srl-labs+clab-ui+0.3.0.patch` (applied automatically via
`npm install`'s `postinstall` → `patch-package`) restores those exports by
re-adding the missing `export` lines in `dist/index.js`/`dist/index.d.ts`. It
does not fork or reimplement anything from clab-ui.

- `@srl-labs/clab-ui` is pinned to an **exact** version (`"0.3.0"`, no `^`) —
  `patch-package` refuses to apply against a different version, so a version
  bump fails the install loudly instead of silently losing the patch.
- Once upstream republishes a version with these exports restored for real,
  bump the pin and delete `frontend/patches/@srl-labs+clab-ui+0.3.0.patch`,
  the `patch-package` devDependency, and the `postinstall` script.
- Track/link the upstream fix here once filed: (no issue filed yet).

## Rules
- **Never deep-import from clab-ui** — only import from `@srl-labs/clab-ui` root or its declared sub-entries (e.g. `@srl-labs/clab-ui/host`).
- Netlab customizations go in `src/` — clab-ui is a dependency, not something we edit.
- API types in `src/api/` are auto-generated — do not hand-edit them; change the backend and regenerate.
- Extension points (custom panels, modals, etc.) are passed as props from `App.tsx`.

## Token tips
- For component questions, check `src/components/` and `src/panels/` first.
- For API shape questions, look in `src/api/` (generated types) and `backend/app/contract/`.
- `App.tsx` is the wiring point — check it to understand how clab-ui is extended.
