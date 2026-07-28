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

        # Python 3.12 with the backend's runtime + dev dependencies baked in,
        # mirroring backend/pyproject.toml.
        python = pkgs.python312.withPackages (
          ps: with ps; [
            fastapi
            uvicorn
            # uvicorn's fast event loop + HTTP parser (uvicorn[standard] on
            # pip); uvicorn auto-detects them when importable.
            uvloop
            httptools
            ruamel-yaml
            ptyprocess
            watchfiles
            # dev
            pytest
            httpx
            # Optional netlab integrations shown by `netlab version`.
            # ansible
            # ansible-core
            # ansible-pylibssh
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
