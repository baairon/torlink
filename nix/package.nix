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
  version = "1.3.1";
  __structuredAttrs = true;
  strictDeps = true;

  src = fetchFromGitHub {
    owner = "baairon";
    repo = "torlink";
    tag = "v${finalAttrs.version}";
    hash = "sha256-XMwJ1nVVcwXOhj3moqBMRngOAnAfbOuICHMAYQheeWA=";
  };

  nodejs = nodejs_22;
  npmDepsHash = "sha256-FT4SUjuEKefMG2zzA/QhafZbLab0tUeWHnO30+7smnI=";
  # ignore-scripts for ip-set broken preinstall
  npmFlags = [ "--ignore-scripts" ];

  # node-datachannel binary tarball
  nodeDatachannelPrebuilt = fetchurl {
    url = "https://github.com/murat-dogan/node-datachannel/releases/download/v0.32.3/node-datachannel-v0.32.3-napi-v8-linux-x64.tar.gz";
    sha256 = "4092afc9cd594a3326eb1bd823da452b227b742ea8222689b2cea6f7344cf67a";
  };

  # replicate postbuild from package.json
  postBuild = ''
    node scripts/postbuild.cjs
  '';

  # extract node-datachannel tarball
  # add wl-copy and xclip to nix readeable path
  postInstall = ''
    tar -xzf ${finalAttrs.nodeDatachannelPrebuilt} \
      -C $out/lib/node_modules/torlnk/node_modules/node-datachannel
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
    changelog = "https://github.com/baairon/torlink/releases/tag/v${finalAttrs.src.tag}";
    license = lib.licenses.mit;
    maintainers = with lib.maintainers; [ ghastrum ];
    mainProgram = "torlnk";
    platforms = lib.platforms.linux;
  };
})
