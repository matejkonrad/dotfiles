#!/bin/bash

cp ~/.zshrc ./.zshrc 
cp ~/.vimrc ./.vimrc
mkdir .config/
mkdir .config/alacritty/
mkdir .config/nvim/

cp -r ~/.config/alacritty/ .config/alacritty/
cp -r ~/.config/nvim/lua/user/ .config/nvim/

