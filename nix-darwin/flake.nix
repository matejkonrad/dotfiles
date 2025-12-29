{
  description = "Example nix-darwin system flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-darwin.url = "github:LnL7/nix-darwin/master";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = inputs@{ self, nix-darwin, nixpkgs }:
  let
    configuration = { pkgs, ... }: 
     let
        brotli = pkgs.brotli;
      in {
      # List packages installed in system profile. To search by name, run:
      # $ nix-env -qaP | grep wget
	  environment.systemPackages = [ 
        pkgs.vim
        pkgs.nixd 
        pkgs.neovim
        pkgs.rustc
      	pkgs.cargo
        pkgs.rust-analyzer
        pkgs.clippy # Linter
        pkgs.rustfmt # Formatter
        pkgs.flutter
        pkgs.dart
        pkgs.cocoapods
        pkgs.just
        pkgs.uv
        pkgs.git-lfs
        pkgs.yarn
        pkgs.spacer
        pkgs.ffmpeg-full
        pkgs.ripgrep
        pkgs.volta
        brotli
        pkgs.delve
        pkgs.go
        pkgs.ast-grep
      ];

     environment.variables = {
       CGO_ENABLED = "1";
       CGO_CFLAGS = "-I${brotli}/include";
       CGO_LDFLAGS = "-L${brotli}/lib";
     };

      nix.enable = false;

      # Necessary for using flakes on this system.
      nix.settings.experimental-features = "nix-command flakes";

      # Enable alternative shell support in nix-darwin.
      # programs.fish.enable = true;

      # Set Git commit hash for darwin-version.
      system.configurationRevision = self.rev or self.dirtyRev or null;

      # Used for backwards compatibility, please read the changelog before changing.
      # $ darwin-rebuild changelog
      system.stateVersion = 6;

      # The platform the configuration will be used on.
      nixpkgs.hostPlatform = "aarch64-darwin";
    };
  in
  {
    # Build darwin flake using:
    # $ darwin-rebuild build --flake .#Matejs-MacBook-Pro
    darwinConfigurations."Matejs-MacBook-Pro" = nix-darwin.lib.darwinSystem {
      modules = [ configuration ];
    };
  };
}
