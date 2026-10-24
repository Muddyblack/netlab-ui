# Installing on Linux

netlab-ui is a normal Python package. It uses the netlab, Ansible and containerlab already on the machine, so there is no second copy to keep in step.

## Install script

```bash
curl -fsSL https://raw.githubusercontent.com/Muddyblack/netlab-ui/main/scripts/install.sh | bash
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

## Updating

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

Keep the default `127.0.0.1` unless you mean to expose it. For the desktop app or another machine, run `netlab-ui token`, restart the service, and give clients the token (see [desktop.md](desktop.md)).
