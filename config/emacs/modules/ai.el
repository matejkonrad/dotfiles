;;; ai.el --- AI coding assistants  -*- lexical-binding: t; -*-

;; vterm backs claude-code-ide's Claude window. Ghostel stays as the general
;; terminal on `SPC v` — vterm is only used inside claude-code-ide.
;; First install compiles a native module (needs cmake + libtool on the system).
(use-package vterm
  :ensure t)

;; claude-code-ide.el is not on MELPA — fetch from GitHub on first run.
(unless (package-installed-p 'claude-code-ide)
  (package-vc-install '(claude-code-ide
                        :url "https://github.com/manzaltu/claude-code-ide.el"
                        :branch "main")))

(use-package claude-code-ide
  :ensure nil  ; installed via package-vc-install above
  :bind ("C-c C-'" . claude-code-ide-menu)
  :custom
  (claude-code-ide-terminal-backend 'vterm)
  :config
  (claude-code-ide-emacs-tools-setup))

(provide 'ai)
