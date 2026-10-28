# NixOS module for netlab-ui, wired up as `nixosModules.default` in the root flake.nix.
# services.netlab-ui.enable = true; services.netlab-ui.user = "alice";
self:
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
}
