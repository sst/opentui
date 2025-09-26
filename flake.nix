{
  description = "OpenTUI - Terminal UI framework";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
  }:
    flake-utils.lib.eachSystem
    [
      "x86_64-linux"
      "aarch64-linux"
      "x86_64-darwin"
      "aarch64-darwin"
    ]
    (
      system: let
        pkgs = nixpkgs.legacyPackages.${system};

        # Map Nix system to OpenTUI platform naming
        platformMap = {
          "x86_64-linux" = "x86_64-linux";
          "aarch64-linux" = "aarch64-linux";
          "x86_64-darwin" = "x86_64-macos";
          "aarch64-darwin" = "aarch64-macos";
        };

        platform = platformMap.${system};

        # Determine library extension based on OS
        libExt =
          if pkgs.stdenv.isDarwin
          then "dylib"
          else "so";
        libName = "libopentui.${libExt}";
        assetName = "libopentui-${platform}.${libExt}";

        version = "latest";

        opentui = pkgs.stdenv.mkDerivation rec {
          pname = "opentui";
          inherit version;

          src = pkgs.fetchFromGitHub {
            owner = "sst";
            repo = "opentui";
            rev = version;
            sha256 = pkgs.lib.fakeSha256; # Replace with actual sha256 once known
          };

          # Download pre-built binaries from GitHub releases
          buildInputs = with pkgs; [curl];

          phases = [
            "unpackPhase"
            "installPhase"
          ];

          installPhase = ''
            mkdir -p $out/include $out/lib $out/lib/pkgconfig

            # Download and install header
            curl -L -o $out/include/opentui.h \
              https://github.com/sst/opentui/releases/latest/download/opentui.h

            # Download and install library
            curl -L -o $out/lib/${libName} \
              https://github.com/sst/opentui/releases/latest/download/${assetName}

            # Set permissions
            chmod 644 $out/include/opentui.h
            chmod 755 $out/lib/${libName}

            # Create pkg-config file
            cat > $out/lib/pkgconfig/opentui.pc <<EOF
            prefix=$out
            exec_prefix=\''${prefix}
            libdir=\''${exec_prefix}/lib
            includedir=\''${prefix}/include

            Name: OpenTUI
            Description: Terminal UI framework
            Version: ${version}
            Libs: -L\''${libdir} -lopentui
            Cflags: -I\''${includedir}
            EOF

            # Create symlinks for library discovery
            ${pkgs.lib.optionalString (!pkgs.stdenv.isDarwin) ''
              ln -s ${libName} $out/lib/libopentui.so.1
              ln -s libopentui.so.1 $out/lib/libopentui.so
            ''}

            ${pkgs.lib.optionalString pkgs.stdenv.isDarwin ''
              install_name_tool -id $out/lib/${libName} $out/lib/${libName}
            ''}
          '';

          meta = with pkgs.lib; {
            description = "Terminal UI framework";
            homepage = "https://github.com/sst/opentui";
            license = licenses.mit;
            platforms = [
              "x86_64-linux"
              "aarch64-linux"
              "x86_64-darwin"
              "aarch64-darwin"
            ];
            maintainers = [];
          };
        };

        # Development shell with OpenTUI
        devShell = pkgs.mkShell {
          buildInputs = with pkgs; [
            opentui
            go
            bun
            zig
            pkg-config
          ];

          shellHook = ''
            echo "OpenTUI development environment"
            echo "  Header: ${opentui}/include/opentui.h"
            echo "  Library: ${opentui}/lib/${libName}"
            echo ""
            echo "To use in Go:"
            echo "  go get github.com/dnakov/opentui/packages/go"
            echo ""
            export PKG_CONFIG_PATH="${opentui}/lib/pkgconfig:$PKG_CONFIG_PATH"
            export LD_LIBRARY_PATH="${opentui}/lib:$LD_LIBRARY_PATH"
            ${pkgs.lib.optionalString pkgs.stdenv.isDarwin ''
              export DYLD_LIBRARY_PATH="${opentui}/lib:$DYLD_LIBRARY_PATH"
            ''}
          '';
        };
      in {
        packages = {
          default = opentui;
          opentui = opentui;
        };

        devShells.default = devShell;

        # Overlay for adding OpenTUI to nixpkgs
        overlays.default = final: prev: {
          opentui = opentui;
        };
      }
    );
}
