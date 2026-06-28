{
  lib,
  buildNpmPackage,
  fetchFromGitHub,
  # dependencies
  fetchurl,
  nodejs_22,
}:

buildNpmPackage (finalAttrs: {
  pname = "torlink";
  version = "1.0.0-unstable";
  __structedAttrs = true;
  strictDeps = true;

  src = fetchFromGitHub {
    owner = "baairon";
    repo = "torlink";
    rev = "69027331b2c8edc77e517034775fae7972b446a0";
    hash = "sha256-siDwO3KpwPP82/ufGgZxcvkImKezLVKnLpOjPb5XpxM=";
  };

  nodejs = nodejs_22;
  npmDepsHash = "sha256-MjkkbcYLRY2Zc1je7ArVJ1ccSm5KtV95T758H2w6YKo=";
  npmFlags = [ "--ignore-scripts" ]; # ignore scripts for ip-set broken pre-install

  # node-datachannel binary tarball
  nodeDatachannelPrebuilt = fetchurl {
    url = "https://github.com/murat-dogan/node-datachannel/releases/download/v0.32.3/node-datachannel-v0.32.3-napi-v8-linux-x64.tar.gz";
    sha256 = "4092afc9cd594a3326eb1bd823da452b227b742ea8222689b2cea6f7344cf67a";
  };

  # extract node-datachannel tarball
  postInstall = ''
    tar -xzf ${finalAttrs.nodeDatachannelPrebuilt} \
      -C $out/lib/node_modules/torlnk/node_modules/node-datachannel
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
