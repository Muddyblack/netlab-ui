{
  description = "netlab APP — FastAPI clab-ui adapter + React/Vite frontend";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-26.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };

        # Single source of truth for backend Python deps: parse
        # backend/pyproject.toml at eval time instead of hand-copying
        # dependency names into this file, where they can (and did) drift.
        backendPyproject = builtins.fromTOML (builtins.readFile ./backend/pyproject.toml);

        # Strip PEP 508 extras/markers/version specifiers down to the bare
        # distribution name, e.g. "uvicorn[standard]>=0.29" -> "uvicorn".
        pep508Name = spec: builtins.head (builtins.split "[][<>=!~; ]" spec);

        # PyPI distribution names that nixpkgs exposes under a different
        # python3Packages attribute. Extend this table, not the dependency
        # lists in backend/pyproject.toml, when a new dependency needs
        # remapping.
        pypiToNixpkgs = {
          "ruamel.yaml" = "ruamel-yaml";
        };

        resolvePythonDeps =
          specs:
          map (
            spec:
            let
              name = pep508Name spec;
              attr = pypiToNixpkgs.${name} or name;
            in
            pkgs.python312Packages.${attr}
          ) specs;

        # `netlab` (the networklab/ansible optional-dependency group) is
        # resolved separately below via a custom nixpkgs derivation and the
        # system/nixpkgs `ansible*` packages, so it's excluded here.
        backendRuntimeDeps = resolvePythonDeps backendPyproject.project.dependencies;
        backendAssistantDeps = resolvePythonDeps backendPyproject.project.optional-dependencies.assistant;
        backendDevDeps = resolvePythonDeps backendPyproject.project.optional-dependencies.dev;

        netlab = pkgs.python312Packages.buildPythonPackage rec {
          pname = "networklab";
          version = "26.5";
          src = pkgs.python312Packages.fetchPypi {
            inherit pname version;
            hash = "sha256-BXp+3A5jIlZwLXWYyMpeM3NlvvbmGbuQoUlMI50beZI=";
          };
          pyproject = true;
          build-system = with pkgs.python312Packages; [ setuptools wheel ];
          propagatedBuildInputs = with pkgs.python312Packages; [
            jinja2
            pyyaml
            netaddr
            python-box
            importlib-resources
            typing-extensions
            filelock
            packaging
            requests
            rich
          ];
          doCheck = false;
        };

        # Python 3.12 with the backend's runtime + optional-extra dependencies
        # baked in. The dependency lists themselves come from
        # backend/pyproject.toml (see backendRuntimeDeps/backendAssistantDeps/
        # backendDevDeps above); this is just plumbing plus the handful of
        # things pyproject.toml can't express for Nix.
        python = pkgs.python312.withPackages (
          ps:
          backendRuntimeDeps
          ++ [
            # uvicorn's fast event loop + HTTP parser (uvicorn[standard] on
            # pip); uvicorn auto-detects them when importable.
            ps.uvloop
            ps.httptools
          ]
          ++ backendAssistantDeps
          ++ backendDevDeps
          ++ [
            # Optional netlab integrations shown by `netlab version`.
            # ps.ansible
            # ps.ansible-core
            # ps.ansible-pylibssh
            # Expose the PyPI `networklab` package's `netlab` CLI in the shell.
            netlab
          ]
        );

        node = pkgs.nodejs_24;

        # containerlab — netlab's default provider. Needed for `netlab up`,
        # status and shell actions; without it only topology authoring works.
        containerlab = pkgs.containerlab;
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            python
            node
            containerlab
          ];

          shellHook = ''
            echo "netlab APP dev shell"
            echo "  backend : uvicorn app.main:app --reload --app-dir backend  (run from repo root -> :8000)"
            echo "            cd backend && pytest"
            echo "  frontend: cd frontend && npm install && npm run dev     (-> :5173)"
            echo "  python  : $(python --version)   node: $(node --version)"
          '';
        };

        # `nix run .#backend` / `.#frontend` / `.#test` convenience wrappers.
        apps = {
          backend = {
            type = "app";
            program = toString (
              pkgs.writeShellScript "netlab-gui-backend" ''
                export PATH="${containerlab}/bin:$PATH"   # netlab shells out to containerlab
                cd "$(git rev-parse --show-toplevel)"
                exec ${python}/bin/uvicorn app.main:app --reload --reload-exclude 'backend/tests/*' --timeout-graceful-shutdown 2 --app-dir backend "$@"
              ''
            );
          };
          frontend = {
            type = "app";
            program = toString (
              pkgs.writeShellScript "netlab-gui-frontend" ''
                export PATH="${node}/bin:$PATH"   # vite's `#!/usr/bin/env node` needs node on PATH
                cd "$(git rev-parse --show-toplevel)/frontend"
                npm install
                exec npm run dev "$@"
              ''
            );
          };
          test = {
            type = "app";
            program = toString (
              pkgs.writeShellScript "netlab-gui-test" ''
                cd "$(git rev-parse --show-toplevel)/backend"
                exec ${python}/bin/pytest "$@"
              ''
            );
          };

          # `nix run` (the default) — start backend + frontend together.
          # Ctrl-C stops both.
          default = {
            type = "app";
            program = toString (
              pkgs.writeShellScript "netlab-gui-dev" ''
                set -euo pipefail
                root="$(git rev-parse --show-toplevel)"
                # node for vite's `#!/usr/bin/env node`; containerlab is netlab's provider
                export PATH="${node}/bin:${containerlab}/bin:$PATH"

                # Enable job control so each background job becomes its own
                # process-group leader. Then $! is the group's PGID, and
                # `kill -- -$!` reaches the whole subtree (uvicorn's reloader +
                # worker, npm + vite) — not just the direct child.
                set -m

                pids=()
                ( cd "$root" && exec ${python}/bin/uvicorn app.main:app --reload --reload-exclude 'backend/tests/*' --timeout-graceful-shutdown 2 --app-dir backend ) &
                pids+=($!)
                ( cd "$root/frontend" && npm install && exec npm run dev ) &
                pids+=($!)

                cleanup() {
                  trap "" INT TERM        # ignore repeat Ctrl-C while tearing down
                  for pid in "''${pids[@]}"; do
                    kill -TERM -- "-$pid" 2>/dev/null || true
                  done
                  wait 2>/dev/null || true
                }
                trap cleanup INT TERM EXIT

                echo "backend -> http://localhost:8000   frontend -> http://localhost:5173"
                wait
              ''
            );
          };
        };
      }
    );
}
