{
  lib,
  buildNpmPackage,
  fetchFromGitHub,
  # dependencies
  fetchurl,
  nodejs_22,
  wl-clipboard,
  xclip,
}:

buildNpmPackage (finalAttrs: {
  pname = "torlink";
  version = "1.1.1-unstable";
  __structedAttrs = true;
  strictDeps = true;

  src = fetchFromGitHub {
    owner = "baairon";
    repo = "torlink";
    rev = "3c5b5597d9ad212b6dab50af5a6e614cdfb82743";
    hash = "sha256-f4olyyE2QqvVyakV5LvQq2Rm01fNeVox1Mk0VOat/nk=";
  };

  nodejs = nodejs_22;
  npmDepsHash = "sha256-7CCecywWleUE7wobdzwWb4Rff0LmrlHcON1iPeiiFnw=";
  npmFlags = [ "--ignore-scripts" ]; # ignore scripts for ip-set broken pre-install

  # node-datachannel binary tarball
  nodeDatachannelPrebuilt = fetchurl {
    url = "https://github.com/murat-dogan/node-datachannel/releases/download/v0.32.3/node-datachannel-v0.32.3-napi-v8-linux-x64.tar.gz";
    sha256 = "4092afc9cd594a3326eb1bd823da452b227b742ea8222689b2cea6f7344cf67a";
  };

  # replicate postbuild from package.json
  postBuild = ''
    cp scripts/cli-entry.cjs dist/cli.cjs
    chmod +x dist/cli.cjs
  '';

  # extract node-datachannel tarball
  postInstall = ''
    tar -xzf ${finalAttrs.nodeDatachannelPrebuilt} \
      -C $out/lib/node_modules/torlnk/node_modules/node-datachannel
      # add wl-copy and xclip to nix readeable path
      wrapProgram $out/bin/torlnk \
        --prefix PATH : ${
          lib.makeBinPath [
            wl-clipboard
            xclip
          ]
        }
  '';

  meta = {
    description = "Torlink is a torrent finder that lives in your terminal, with zero setup and nothing to configure.";
    homepage = "https://github.com/baairon/torlink";
    license = lib.licenses.mit;
    maintainers = with lib.maintainers; [ ghastrum ];
    mainProgram = "torlnk";
    platforms = lib.platforms.linux;
  };
})
