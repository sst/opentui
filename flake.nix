{
  description = "OpenTUI - Terminal UI framework";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachSystem [
      "x86_64-linux"
      "aarch64-linux"
      "x86_64-darwin"
      "aarch64-darwin"
    ] (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        
        # Determine library extension based on OS
        libExt = if pkgs.stdenv.isDarwin then "dylib" else "so";
        libName = "libopentui.${libExt}";
        
        opentui = pkgs.stdenv.mkDerivation rec {
          pname = "opentui";
          version = "0.1.0";
          
          src = ./.;
          
          nativeBuildInputs = with pkgs; [
            bun
            zig
            pkg-config
          ];
          
          buildPhase = ''
            # Build the core package
            cd packages/core
            bun install --frozen-lockfile
            
            # Build the Zig library
            cd src/zig
            zig build -Doptimize=ReleaseFast
            cd ../../../..
          '';
          
          installPhase = ''
            mkdir -p $out/include $out/lib $out/lib/pkgconfig
            
            # Install header (from Go package which has the C header)
            if [ -f packages/go/opentui.h ]; then
              cp packages/go/opentui.h $out/include/
              chmod 644 $out/include/opentui.h
            fi
            
            # Install library
            if [ -f packages/core/src/zig/zig-out/lib/${libName} ]; then
              cp packages/core/src/zig/zig-out/lib/${libName} $out/lib/
              chmod 755 $out/lib/${libName}
            fi
            
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
              if [ -f $out/lib/${libName} ]; then
                ln -s ${libName} $out/lib/libopentui.so.1
                ln -s libopentui.so.1 $out/lib/libopentui.so
              fi
            ''}
            
            ${pkgs.lib.optionalString pkgs.stdenv.isDarwin ''
              if [ -f $out/lib/${libName} ]; then
                install_name_tool -id $out/lib/${libName} $out/lib/${libName}
              fi
            ''}
          '';
          
          meta = with pkgs.lib; {
            description = "Terminal UI framework";
            homepage = "https://github.com/sst/opentui";
            license = licenses.mit;
            platforms = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
            maintainers = [ ];
          };
        };
        
        # Development shell with OpenTUI
        devShell = pkgs.mkShell {
          buildInputs = with pkgs; [
            # Development tools
            go
            bun
            zig
            pkg-config
            
            # Additional useful tools
            git
            gh
            curl
          ];
          
          shellHook = ''
            echo "OpenTUI development environment"
            echo ""
            
            # First, check if we need to build the library
            if [ ! -f packages/core/src/zig/zig-out/lib/${libName} ]; then
              echo "Building OpenTUI library..."
              (cd packages/core && bun install --silent 2>/dev/null || true)
              (cd packages/core/src/zig && zig build -Doptimize=ReleaseFast) || echo "Warning: Failed to build OpenTUI library"
            fi
            
            # Set up environment variables for Go to find the library
            export OPENTUI_ROOT="$PWD"
            export CGO_CFLAGS="-I$OPENTUI_ROOT/packages/go"
            export CGO_LDFLAGS="-L$OPENTUI_ROOT/packages/core/src/zig/zig-out/lib -lopentui"
            export LD_LIBRARY_PATH="$OPENTUI_ROOT/packages/core/src/zig/zig-out/lib:$LD_LIBRARY_PATH"
            ${pkgs.lib.optionalString pkgs.stdenv.isDarwin ''
              export DYLD_LIBRARY_PATH="$OPENTUI_ROOT/packages/core/src/zig/zig-out/lib:$DYLD_LIBRARY_PATH"
            ''}
            
            # Create a temporary pkg-config file for the current session
            export PKG_CONFIG_PATH="$OPENTUI_ROOT:$PKG_CONFIG_PATH"
            if [ ! -f "$OPENTUI_ROOT/opentui.pc" ]; then
              cat > "$OPENTUI_ROOT/opentui.pc" <<EOF
            prefix=$OPENTUI_ROOT
            libdir=$OPENTUI_ROOT/packages/core/src/zig/zig-out/lib
            includedir=$OPENTUI_ROOT/packages/go
            
            Name: OpenTUI
            Description: Terminal UI framework
            Version: 0.1.0
            Libs: -L\''${libdir} -lopentui
            Cflags: -I\''${includedir}
            EOF
            fi
            
            echo "Available tools:"
            echo "  - Bun (TypeScript/JavaScript runtime & package manager)"
            echo "  - Zig (for native components)"
            echo "  - Go (for Go bindings)"
            echo "  - Git & GitHub CLI"
            echo ""
            echo "Environment configured for Go development:"
            echo "  CGO_CFLAGS: $CGO_CFLAGS"
            echo "  CGO_LDFLAGS: $CGO_LDFLAGS"
            echo ""
            echo "To run Go examples:"
            echo "  cd packages/go/examples/basic && go run main.go"
            echo ""
            echo "To run TypeScript examples:"
            echo "  cd packages/core && bun run src/examples/index.ts"
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
      });
}