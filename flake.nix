{
  description = "netlab APP — FastAPI clab-ui adapter + React/Vite frontend";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-26.05";
    nixpkgs-unstable.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { self, nixpkgs, nixpkgs-unstable, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        unstablePkgs = import nixpkgs-unstable { inherit system; };

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
            pythonOverrides.${name} or pkgs.python312Packages.${attr}
          ) specs;

        # Dependencies nixpkgs doesn't carry in a new enough version, built
        # from their PyPI wheels (all pure Python). Bump version + url + hash
        # together; `url`/`hash` come from https://pypi.org/pypi/<name>/<ver>/json.
        pypiWheel =
          {
            pname,
            version,
            url,
            hash,
            deps,
          }:
          pkgs.python312Packages.buildPythonPackage {
            inherit pname version;
            format = "wheel";
            src = pkgs.fetchurl { inherit url hash; };
            propagatedBuildInputs = deps;
            # Version floors here are stricter than nixpkgs' (e.g. httpx2 wants
            # idna>=3.18); the older releases work for what netlab-ui uses.
            dontCheckRuntimeDeps = true;
            doCheck = false;
          };

        httpcore2 = pypiWheel {
          pname = "httpcore2";
          version = "2.13.1";
          url = "https://files.pythonhosted.org/packages/09/ba/a4568248771ce81957bfb7cc600264a40fbcda092391ee1c415c50be4bea/httpcore2-2.13.1-py3-none-any.whl";
          hash = "sha256-4eBdTyX319SWv7lnSPb0tnZXsD2gabOmjDYGnz23PQo=";
          deps = with pkgs.python312Packages; [ h11 truststore ];
        };
        httpx2 = pypiWheel {
          pname = "httpx2";
          version = "2.13.1";
          url = "https://files.pythonhosted.org/packages/d8/9c/6fe8931fd9f381042a9e4c7d5a7b4cbf7016b252bec0c99a49fce42c3326/httpx2-2.13.1-py3-none-any.whl";
          hash = "sha256-bf9Q+rwnDuX9JdhF0LB47SBWRXl0TW2WKFCXWZbS+aQ=";
          deps = [ httpcore2 ] ++ (with pkgs.python312Packages; [ anyio idna truststore typing-extensions ]);
        };
        mcpTypes = pypiWheel {
          pname = "mcp-types";
          version = "2.2.0";
          url = "https://files.pythonhosted.org/packages/8f/d7/6ffba5d8cd5dd9b8a19478875c50e04945314ba5074e84d749283f27f62d/mcp_types-2.2.0-py3-none-any.whl";
          hash = "sha256-6kdrc+6GcJq1q8lFI4XtNswFkH5YI1ViLilFlcmgTxM=";
          deps = with pkgs.python312Packages; [ pydantic typing-extensions ];
        };
        # MCP server for the user's AI agent; nixpkgs only has mcp 1.x.
        mcp = pypiWheel {
          pname = "mcp";
          version = "2.2.0";
          url = "https://files.pythonhosted.org/packages/1b/ff/8e7eade68b8a28f7da0ed1085544341b51f9c935dbf6b95c76b7edfea6a0/mcp-2.2.0-py3-none-any.whl";
          hash = "sha256-vemCWJRzoGCuFF40BumlMz/lOMlyKbqEH1p/kr4AT4E=";
          deps =
            [
              httpx2
              mcpTypes
            ]
            ++ (with pkgs.python312Packages; [
              anyio
              jsonschema
              opentelemetry-api
              pydantic
              pyjwt
              cryptography
              python-multipart
              sse-starlette
              starlette
              typing-extensions
              typing-inspection
              uvicorn
            ]);
        };

        # pyproject.toml dependency names resolved to the packages above.
        pythonOverrides = {
          inherit mcp;
        };

        # `netlab` (the networklab/ansible optional-dependency group) is
        # resolved separately below via a custom nixpkgs derivation and the
        # system/nixpkgs `ansible*` packages, so it's excluded here.
        backendRuntimeDeps = resolvePythonDeps backendPyproject.project.dependencies;
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
            ruamel-yaml
          ];
          doCheck = false;
        };

        # Python 3.12 with the backend's runtime + dev dependencies baked in.
        # The dependency lists themselves come from backend/pyproject.toml (see
        # backendRuntimeDeps/backendDevDeps above); this is just plumbing plus
        # the handful of things pyproject.toml can't express for Nix.
        python = pkgs.python312.withPackages (
          ps:
          backendRuntimeDeps
          ++ [
            # uvicorn's fast event loop + HTTP parser (uvicorn[standard] on
            # pip); uvicorn auto-detects them when importable.
            ps.uvloop
            ps.httptools
            # WebSocket transport (also in uvicorn[standard]): without it every
            # terminal, node shell and log stream upgrade is refused with a 404.
            ps.websockets
          ]
          ++ backendDevDeps
          ++ [
            # Optional netlab integrations shown by `netlab version`.
            ps.ansible-core
            # ps.ansible-pylibssh
            # Expose the PyPI `networklab` package's `netlab` CLI in the shell.
            netlab
          ]
        );

        node = pkgs.nodejs_24;

        # containerlab — netlab's default provider. The system wrapper wins:
        # deploying needs root (a setuid wrapper + the clab_admins group, which
        # only the system can provide — see docs/container.md / CONTRIBUTING.md),
        # so a system-installed containerlab must win over this unprivileged
        # store copy, which is only a fallback for status and authoring.
        containerlab = unstablePkgs.containerlab;

        # No git tag is visible to a flake build, so the version is the revision.
        guiVersion = "0.0.0+${self.shortRev or self.dirtyShortRev or "unknown"}";

        # The built UI (frontend/dist). After a dependency change in frontend/package-lock.json,
        # set npmDepsHash to pkgs.lib.fakeHash, build `.#frontend` once and paste the hash it reports.
        frontend = pkgs.buildNpmPackage {
          pname = "netlab-ui-frontend";
          version = guiVersion;
          src = ./frontend;
          npmDepsHash = "sha256-OUJPlD7mWtfwaqCrXOg3gviu+Q4cq+whMswb2loK4NY=";
          installPhase = ''
            runHook preInstall
            cp -r dist $out
            runHook postInstall
          '';
        };

        # The `netlab-ui` command with the UI and monitoring plugin bundled in, as the PyPI wheel has them.
        # netlab, Ansible and containerlab are NOT included: it uses the ones on PATH, so the NixOS module
        # (or the user) decides their versions.
        netlabUi = pkgs.python312Packages.buildPythonApplication {
          pname = "netlab-ui";
          version = guiVersion;
          pyproject = true;
          src = ./backend;
          build-system = with pkgs.python312Packages; [ setuptools setuptools-scm ];
          dependencies = backendRuntimeDeps ++ (with pkgs.python312Packages; [ uvloop httptools websockets ]);
          env.SETUPTOOLS_SCM_PRETEND_VERSION = guiVersion;
          preBuild = ''
            cp -r ${frontend} netlab_ui/_frontend
            cp -r ${./monitoring/plugin/monitoring} netlab_ui/_monitoring_plugin
            chmod -R u+w netlab_ui/_frontend netlab_ui/_monitoring_plugin
          '';
          doCheck = false;
          meta.mainProgram = "netlab-ui";
        };
      in
      {
        packages = {
          inherit frontend;
          netlab-ui = netlabUi;
          default = netlabUi;
        };

        devShells.default = pkgs.mkShell {
          packages = [
            python
            node
          ];

          shellHook = ''
            if [ -x /run/wrappers/bin/containerlab ]; then
              export PATH="/run/wrappers/bin:$PATH"
              export NETLAB_PROVIDERS_CLAB_START="containerlab deploy --reconfigure -t clab.yml"
              export NETLAB_PROVIDERS_CLAB_STOP="containerlab destroy --cleanup -t clab.yml"
            else
              export PATH="${containerlab}/bin:$PATH"
            fi
            echo "netlab APP dev shell"
            echo "  backend : uvicorn netlab_ui.app.main:app --reload --app-dir backend  (run from repo root -> :8000)"
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
              pkgs.writeShellScript "netlab-ui" ''
                if [ -x /run/wrappers/bin/containerlab ]; then
                  export PATH="/run/wrappers/bin:$PATH"
                else
                  export PATH="${containerlab}/bin:$PATH"
                fi
                cd "$(git rev-parse --show-toplevel)"
                exec ${python}/bin/uvicorn netlab_ui.app.main:app --reload --reload-dir backend --reload-exclude 'backend/tests/*' --timeout-graceful-shutdown 2 --app-dir backend "$@"
              ''
            );
          };
          frontend = {
            type = "app";
            program = toString (
              pkgs.writeShellScript "netlab-ui-frontend" ''
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
              pkgs.writeShellScript "netlab-ui-test" ''
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
              pkgs.writeShellScript "netlab-ui-dev" ''
                set -euo pipefail
                root="$(git rev-parse --show-toplevel)"
                # node for vite's `#!/usr/bin/env node`; containerlab as a fallback
                # (a system one, with the privileges to deploy, wins)
                if [ -x /run/wrappers/bin/containerlab ]; then
                  export PATH="${node}/bin:/run/wrappers/bin:$PATH"
                else
                  export PATH="${node}/bin:${containerlab}/bin:$PATH"
                fi

                # Enable job control so each background job becomes its own
                # process-group leader. Then $! is the group's PGID, and
                # `kill -- -$!` reaches the whole subtree (uvicorn's reloader +
                # worker, npm + vite) — not just the direct child.
                set -m

                pids=()
                ( cd "$root" && exec ${python}/bin/uvicorn netlab_ui.app.main:app --reload --reload-dir backend --reload-exclude 'backend/tests/*' --timeout-graceful-shutdown 2 --app-dir backend ) &
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
    )
    // {
      # services.netlab-ui.enable = true; services.netlab-ui.user = "alice";
      nixosModules.default =
        {
          config,
          lib,
          pkgs,
          ...
        }:
        let
          cfg = config.services.netlab-ui;
        in
        {
          options.services.netlab-ui = {
            enable = lib.mkEnableOption "the netlab GUI web service";
            package = lib.mkOption {
              type = lib.types.package;
              default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
              defaultText = lib.literalExpression "netlab-ui.packages.\${system}.default";
              description = "The netlab-ui package to run.";
            };
            user = lib.mkOption {
              type = lib.types.str;
              description = ''
                User the service runs as. Labs are saved in this user's home and run with this user's Docker and
                containerlab access, so use a normal user, not root.
              '';
            };
            host = lib.mkOption {
              type = lib.types.str;
              default = "127.0.0.1";
              description = "Address to listen on. The UI can deploy labs and open shells: set tokenFile before exposing it.";
            };
            port = lib.mkOption {
              type = lib.types.port;
              default = 8000;
            };
            openFirewall = lib.mkOption {
              type = lib.types.bool;
              default = false;
            };
            tokenFile = lib.mkOption {
              type = lib.types.nullOr lib.types.path;
              default = null;
              description = "File holding the API token remote clients (desktop app, VS Code) must send. Keep it out of the Nix store.";
            };
            extraPackages = lib.mkOption {
              type = lib.types.listOf lib.types.package;
              default = [ ];
              example = lib.literalExpression "[ pkgs.python3Packages.networklab pkgs.ansible ]";
              description = "Tools the service needs on PATH: at least netlab (and Ansible) at a version the UI supports.";
            };
            containerlab = {
              enable = lib.mkOption {
                type = lib.types.bool;
                default = true;
                description = ''
                  Install containerlab as a setuid wrapper restricted to the clab_admins group and add the user to it,
                  so deploys need no sudo password. This is containerlab's own sudo-less setup.
                '';
              };
              package = lib.mkPackageOption pkgs "containerlab" { };
            };
          };

          config = lib.mkIf cfg.enable {
            users.groups.clab_admins = lib.mkIf cfg.containerlab.enable { };
            users.users.${cfg.user}.extraGroups = lib.mkIf cfg.containerlab.enable [ "clab_admins" ];
            security.wrappers.containerlab = lib.mkIf cfg.containerlab.enable {
              source = "${cfg.containerlab.package}/bin/containerlab";
              owner = "root";
              group = "clab_admins";
              setuid = true;
              permissions = "u+rx,g+x,o=";
            };

            networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.port ];

            systemd.services.netlab-ui = {
              description = "netlab GUI";
              wantedBy = [ "multi-user.target" ];
              after = [
                "network-online.target"
                "docker.service"
              ];
              wants = [ "network-online.target" ];
              # /run/wrappers/bin first, so the setuid containerlab wins over any unprivileged copy.
              path = [ "/run/wrappers" ] ++ cfg.extraPackages;
              environment =
                {
                  UVICORN_HOST = cfg.host;
                  UVICORN_PORT = toString cfg.port;
                  NETLAB_PROVIDERS_CLAB_START = "containerlab deploy --reconfigure -t clab.yml";
                  NETLAB_PROVIDERS_CLAB_STOP = "containerlab destroy --cleanup -t clab.yml";
                }
                // lib.optionalAttrs (cfg.tokenFile != null) { NETLAB_UI_TOKEN_FILE = toString cfg.tokenFile; };
              serviceConfig = {
                ExecStart = "${lib.getExe cfg.package} serve";
                User = cfg.user;
                Restart = "on-failure";
                RestartSec = 3;
              };
            };
          };
        };
    };
}
