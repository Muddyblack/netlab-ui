# Installing on Linux

netlab-ui is a normal Python package. It uses the netlab, Ansible and containerlab already on the machine, so there is no second copy to keep in step.

## Install script

```bash
curl -fsSL https://raw.githubusercontent.com/Muddyblack/netlab-ui/main/packaging/install.sh | bash
```

Add options after `bash -s --`, for example `... | bash -s -- --with-netlab --service`:

| Option | Does |
| --- | --- |
| `--with-netlab` | also installs netlab and Ansible (skip if you already have netlab) |
| `--with-containerlab` | runs containerlab's own installer: Docker, containerlab, the `clab_admins` group (asks for sudo) |
| `--service` | installs a systemd user service that starts at boot |
| `--version X.Y.Z` | installs that release instead of the latest |

Or by hand: `pipx install 'netlab-ui[netlab]'`.

Start it with `netlab-ui` and open <http://127.0.0.1:8000>. On first use the UI checks the machine (netlab version, containerlab, Docker access, the sudo-less containerlab setup) and shows what to fix under Settings → Environment → Host Setup.

## Running it as a service

```bash
netlab-ui install-service            # a systemd user service that starts at boot
sudo netlab-ui install-service --system   # or a system service that runs as you
netlab-ui install-service --uninstall
```

It checks that the service really started and answers on its port, and prints the commands for `status`, `logs` and `restart`; if it did not start, it shows the last log lines and exits with an error.

- **Finding your tools.** A service does not see your terminal's environment, so the installer records where it found `netlab`, `ansible-playbook` and `containerlab` (for example `~/.local/bin`) in the unit's `PATH` and in the config file. It warns if one of them is missing.
- **Boot without a login.** A user service only runs at boot (and after you log out) if lingering is on. The installer turns it on and verifies it; if your system needs a password for that, it tells you to run `sudo loginctl enable-linger $USER`.
- **Settings.** `~/.config/netlab-ui/config.toml` (or `$NETLAB_UI_CONFIG_FILE`) holds the address, the port and the tool locations, so they do not depend on a terminal. `netlab-ui config` shows what the server will use.

  ```toml
  [server]
  host = "127.0.0.1"      # "0.0.0.0" only together with a token (netlab-ui token)
  port = 8000

  [tools]
  path = ["~/.local/bin"]                  # searched for netlab, ansible-playbook, containerlab
  netlab = "~/venvs/netlab/bin/netlab"     # optional: the netlab executable itself

  [tools.env]
  PYTHONPATH = "~/scratch/netlab"          # optional: set for every netlab command
  ```

  A flag (`--port`) wins over an environment variable (`UVICORN_PORT`), which wins over the file. Restart the service after editing it.

## Using a netlab checkout or another version

The service does not see your terminal, so a `PATH` or `PYTHONPATH` you set in your shell (for example to test a netlab pull request from a scratch directory) never reaches it. Put them in the config file instead:

```toml
[tools]
netlab = "~/scratch/netlab/bin/netlab"   # or put its directory in `path`

[tools.env]
PYTHONPATH = "~/scratch/netlab"
```

The variables are set for every netlab command and for the check that reads netlab's version. `netlab-ui config` lists what the server will use; Settings → Environment shows which netlab it found.

## Links to lab tools (Graphite, Grafana, Edgeshark, ...)

netlab builds these links from `SSH_CONNECTION`, the SSH endpoint of whoever started the UI, which a browser on another machine usually cannot use. The UI therefore puts **the address your browser used to reach it** into the links (`sys.ipaddr` and `sys.ipurl`), so a link works wherever the UI does: through an SSH tunnel (`ssh -L 8000:127.0.0.1:8000 host`, then `localhost`) or on the host's own address.

To use one fixed address instead (for example a DNS name in front of the host), set it in the config; commands the UI starts, such as `netlab up`, print it too:

```toml
[server]
public_host = "lab.example.net"          # or NETLAB_UI_PUBLIC_HOST
```

The UI listens on `127.0.0.1` by default; over SSH use a tunnel, or set `host = "0.0.0.0"` together with a token (see Remote access).

## Updating

The UI tells you when a newer release is on PyPI (a notice you can close; it comes back only for a still newer release). It asks PyPI at most every few hours; set `NETLAB_UI_UPDATE_CHECK=off` to turn the lookup off. A source checkout or dev build is never checked.

```bash
netlab-ui upgrade           # install the newest release and restart the user service
netlab-ui upgrade --check   # only say whether there is one (exit status 10 if so)
```

A system-wide service (`netlab-ui install-service --system`) needs `sudo systemctl restart netlab-ui` afterwards; the command tells you.

## NixOS

```nix
{
  inputs.netlab-ui.url = "github:Muddyblack/netlab-ui";
  # in your configuration:
  imports = [ netlab-ui.nixosModules.default ];
  services.netlab-ui = {
    enable = true;
    user = "alice";
    extraPackages = [ /* netlab, ansible: the versions you want */ ];
  };
}
```

The module also installs containerlab as a setuid wrapper for the `clab_admins` group (turn off with `services.netlab-ui.containerlab.enable = false`) and adds the user to that group. The user still needs to be in the `docker` group. Update with `nix flake update netlab-ui` and rebuild.

## Remote access

Keep the default `127.0.0.1` unless you mean to expose it. For the desktop app or another machine, run `netlab-ui token` (it restarts the user service and prints a browser sign-in link) and give clients the token (see [desktop.md](desktop.md)).
