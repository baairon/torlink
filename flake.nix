{
  description = "A sleek, zero-setup torrent finder and downloader that lives right in your terminal.";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:

    let
      systems = [
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;

    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.callPackage ./nix/package.nix { };
        }
      );
      overlays.default = final: prev: {
        torlink = final.callPackage ./nix/package.nix { };
      };

    };

}
