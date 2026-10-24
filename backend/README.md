# netlab-ui

A web UI for [netlab](https://netlab.tools): topology editor, lab lifecycle, device consoles, config diffs and
lab monitoring in the browser. This package is the backend with the UI and the netlab `monitoring` plugin bundled in.

```bash
pipx install netlab-ui
netlab-ui                  # http://127.0.0.1:8000
netlab-ui install-service  # run it as a systemd service
netlab-ui upgrade          # update later
```

netlab, Ansible and containerlab are not installed by this package: it uses the ones on your `PATH`
(or the `netlab` you pick in **Settings → Environment**). `pipx install "netlab-ui[netlab]"` also installs netlab
and Ansible.

Documentation, screenshots, the container image and the NixOS module:
<https://github.com/Muddyblack/netlab-ui>
