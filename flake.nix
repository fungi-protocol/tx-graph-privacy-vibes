{
  description = "Interactive transaction-graph privacy simulator — an educational tool";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    flake-parts.inputs.nixpkgs-lib.follows = "nixpkgs";
  };

  outputs = inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];

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
              node build.mjs app.js index.html.in index.html
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
        in
        {
          devShells.default = pkgs.mkShell {
            packages = [ node pkgs.typescript pkgs.esbuild pkgs.jq ];
          };

          packages.default = app;

          checks = {
            inherit unit typecheck determinism;
            build = app;
          };
        };
    };
}
