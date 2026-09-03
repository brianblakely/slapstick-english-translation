{
  description = "Reproducible Slap Stick translation development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs =
    { nixpkgs, ... }:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forEachSystem = nixpkgs.lib.genAttrs supportedSystems;
      pkgsFor = system:
        import nixpkgs {
          inherit system;
          # The Snes9x core has a non-commercial license and is marked unfree
          # in nixpkgs. Keep the exception scoped to that one package.
          config.allowUnfreePredicate = package:
            nixpkgs.lib.getName package == "libretro-snes9x";
        };
      componentsFor = system:
        let
          pkgs = pkgsFor system;
          snes9xPin = builtins.fromJSON (builtins.readFile ./tools/snes9x-core.json);
          snes9x = pkgs.libretro.snes9x.overrideAttrs (previous: {
            version = "0-pinned-${builtins.substring 0 12 snes9xPin.revision}";
            src = pkgs.fetchFromGitHub {
              owner = snes9xPin.sourceOwner;
              repo = snes9xPin.sourceRepository;
              rev = snes9xPin.revision;
              hash = snes9xPin.nixSourceHash;
            };
            postPatch = (previous.postPatch or "") + ''
              substituteInPlace libretro/Makefile \
                --replace-fail \
                'git rev-parse --short HEAD || echo unknown' \
                'git rev-parse --short HEAD 2>/dev/null || echo unknown'
            '';
            # A core used through ctypes does not need mkLibretroCore's
            # convenience RetroArch launcher. Omitting it keeps the headless
            # smoke-test closure independent of the desktop frontend.
            installPhase = ''
              runHook preInstall
              install -Dm755 snes9x_libretro.so \
                "$out/lib/retroarch/cores/snes9x_libretro.so"
              runHook postInstall
            '';
          });
          retroarch = pkgs.wrapRetroArch { cores = [ snes9x ]; };
          core = "${snes9x}/lib/retroarch/cores/snes9x_libretro.so";
          launcher = pkgs.writeShellApplication {
            name = "slapstick-retroarch";
            runtimeInputs = [ pkgs.coreutils ];
            text = ''
              runtime_dir="''${SLAPSTICK_RETROARCH_HOME:-$PWD/.retroarch}"
              runtime_dir="$(realpath -m -- "$runtime_dir")"

              mkdir -p \
                "$runtime_dir/config" \
                "$runtime_dir/cache" \
                "$runtime_dir/data" \
                "$runtime_dir/state"

              export XDG_CONFIG_HOME="$runtime_dir/config"
              export XDG_CACHE_HOME="$runtime_dir/cache"
              export XDG_DATA_HOME="$runtime_dir/data"
              export XDG_STATE_HOME="$runtime_dir/state"

              exec ${retroarch}/bin/retroarch \
                --libretro ${nixpkgs.lib.escapeShellArg core} \
                "$@"
            '';
          };
          smoke = pkgs.writeShellApplication {
            name = "slapstick-smoke";
            runtimeInputs = [ pkgs.python3 ];
            text = ''
              exec python3 ${./tools/libretro-smoke.py} \
                --core ${nixpkgs.lib.escapeShellArg core} \
                "$@"
            '';
          };
        in
        {
          inherit
            core
            launcher
            pkgs
            retroarch
            snes9x
            smoke
            ;
        };
    in
    {
      packages = forEachSystem (
        system:
        let
          components = componentsFor system;
        in
        {
          default = components.launcher;
          core = components.snes9x;
          inherit (components) launcher retroarch smoke;
        }
      );

      apps = forEachSystem (
        system:
        let
          components = componentsFor system;
        in
        {
          default = {
            type = "app";
            program = "${components.launcher}/bin/slapstick-retroarch";
          };
          smoke = {
            type = "app";
            program = "${components.smoke}/bin/slapstick-smoke";
          };
        }
      );

      devShells = forEachSystem (
        system:
        let
          components = componentsFor system;
        in
        {
          default = components.pkgs.mkShellNoCC {
            packages = [
              components.pkgs.nodejs_22
              components.pkgs.python3
              components.launcher
              components.smoke
            ];
            shellHook = ''
              export SNES9X_LIBRETRO_CORE=${nixpkgs.lib.escapeShellArg components.core}
            '';
          };
        }
      );

      checks = forEachSystem (
        system:
        let
          components = componentsFor system;
        in
        {
          snes9x-core = components.pkgs.runCommand "slapstick-snes9x-core-check" { } ''
            test -f ${nixpkgs.lib.escapeShellArg components.core}
            touch "$out"
          '';
        }
      );
    };
}
