{
  description = "Interactive transaction-graph privacy simulator — an educational tool";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    flake-parts.inputs.nixpkgs-lib.follows = "nixpkgs";
  };

  outputs = inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      # no x86_64-darwin: nixpkgs 26.11 dropped the platform, so listing it
      # makes every whole-flake eval (nix flake show/check) fail on the assert
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];

      perSystem = { pkgs, lib, self', ... }:
        let
          node = pkgs.nodejs_22;

          src = lib.fileset.toSource {
            root = ./.;
            fileset = lib.fileset.unions [
              ./src
              ./test
              ./types
              ./golden
              ./tsconfig.json
              ./index.html.in
              ./build.mjs
            ];
          };

          # esbuild-bundle the app and inline it into the html template
          app = pkgs.stdenvNoCC.mkDerivation {
            pname = "tx-graph-sim";
            version = "0.1.0";
            inherit src;
            nativeBuildInputs = [ node pkgs.esbuild ];
            buildPhase = ''
              esbuild src/main.ts --bundle --minify --format=iife \
                --target=es2022 --outfile=app.js
              esbuild src/worker/analysis-worker.ts --bundle --minify --format=iife \
                --target=es2022 --outfile=worker.js
              node build.mjs app.js worker.js index.html.in index.html
            '';
            installPhase = ''
              mkdir -p $out
              cp index.html $out/
            '';
          };

          # tests are bundled for node and run with the builtin test runner
          unit = pkgs.stdenvNoCC.mkDerivation {
            name = "unit";
            inherit src;
            nativeBuildInputs = [ node pkgs.esbuild ];
            buildPhase = ''
              esbuild test/*.test.ts --bundle --platform=node --format=cjs \
                --target=es2022 --outdir=t
              node --test t/*.test.js
            '';
            installPhase = "touch $out";
          };

          typecheck = pkgs.stdenvNoCC.mkDerivation {
            name = "typecheck";
            inherit src;
            nativeBuildInputs = [ pkgs.typescript ];
            buildPhase = "tsc -p tsconfig.json --noEmit";
            installPhase = "touch $out";
          };

          # headless run at a pinned seed must reproduce the committed digest
          determinism = pkgs.stdenvNoCC.mkDerivation {
            name = "determinism";
            inherit src;
            nativeBuildInputs = [ node pkgs.esbuild ];
            buildPhase = ''
              esbuild src/engine/headless.ts --bundle --platform=node \
                --format=cjs --target=es2022 --outfile=headless.cjs
              node headless.cjs --seed golden > got.txt
              diff -u golden/determinism.txt got.txt
            '';
            installPhase = "touch $out";
          };
          # NixOS VM: serve the built page and drive the whole tutorial
          # with playwright's headless chromium (Linux only — VM tests
          # need a Linux builder)
          browser = pkgs.testers.runNixOSTest {
            name = "browser-tutorial";
            nodes.machine = _: {
              virtualisation.memorySize = 3072;
              virtualisation.cores = 2;
              systemd.services.serve = {
                wantedBy = [ "multi-user.target" ];
                serviceConfig.ExecStart =
                  "${pkgs.python3}/bin/python3 -m http.server 8000 --directory ${app}";
              };
              environment.systemPackages = [
                (pkgs.python3.withPackages (ps: [ ps.playwright ]))
              ];
            };
            testScript = ''
              machine.wait_for_unit("serve.service")
              machine.wait_for_open_port(8000)
              machine.succeed(
                  "PLAYWRIGHT_BROWSERS_PATH=${pkgs.playwright-driver.browsers} "
                  "PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true "
                  "python3 ${./test/drive-tutorial.py} >&2"
              )
            '';
          };
        in
        {
          devShells.default = pkgs.mkShell {
            packages = [ node pkgs.typescript pkgs.esbuild pkgs.jq ];
          };

          packages.default = app;

          checks = {
            inherit unit typecheck determinism;
            build = app;
          } // lib.optionalAttrs pkgs.stdenv.isLinux {
            inherit browser;
          };
        };
    };
}
