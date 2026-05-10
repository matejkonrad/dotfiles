;;; evil-config.el --- vim emulation  -*- lexical-binding: t; -*-

(use-package evil
  :ensure t
  :init
  (setq evil-want-integration t)
  (setq evil-want-keybinding nil)     ; required for evil-collection
  (setq evil-want-C-u-scroll t)       ; vim-style C-u scrolls up
  (setq evil-want-C-i-jump t)         ; jump-list with C-i
  (setq evil-undo-system 'undo-redo)  ; use Emacs 28+ built-in undo
  (setq evil-search-module 'evil-search)
  (setq evil-split-window-below t)
  (setq evil-vsplit-window-right t)
  :config
  (evil-mode 1)
  ;; H / L cycle tabs (vim default was screen-top/bottom, rarely used)
  (define-key evil-normal-state-map (kbd "H") 'centaur-tabs-backward)
  (define-key evil-normal-state-map (kbd "L") 'centaur-tabs-forward))

;; Vim keybindings for the rest of Emacs (magit, dired, treemacs, etc.)
(use-package evil-collection
  :ensure t
  :after evil
  :config
  (evil-collection-init))

;; cs"', ds), ysiw"
(use-package evil-surround
  :ensure t
  :after evil
  :config
  (global-evil-surround-mode 1))

;; gcc to comment line, gc<motion> for region
(use-package evil-commentary
  :ensure t
  :after evil
  :config
  (evil-commentary-mode 1))

;; Tree-sitter text objects: vif (function), vac (class), vio (loop), etc.
(use-package evil-textobj-tree-sitter
  :ensure t
  :after evil
  :config
  (define-key evil-outer-text-objects-map "f"
              (evil-textobj-tree-sitter-get-textobj "function.outer"))
  (define-key evil-inner-text-objects-map "f"
              (evil-textobj-tree-sitter-get-textobj "function.inner"))
  (define-key evil-outer-text-objects-map "c"
              (evil-textobj-tree-sitter-get-textobj "class.outer"))
  (define-key evil-inner-text-objects-map "c"
              (evil-textobj-tree-sitter-get-textobj "class.inner"))
  (define-key evil-outer-text-objects-map "o"
              (evil-textobj-tree-sitter-get-textobj "loop.outer"))
  (define-key evil-inner-text-objects-map "o"
              (evil-textobj-tree-sitter-get-textobj "loop.inner")))

;; Multiple cursors for evil
(use-package evil-mc
  :ensure t
  :after evil
  :config
  (global-evil-mc-mode 1))

;; C-c +/- to inc/dec the number under cursor (vim's C-a/C-x equivalents)
(use-package evil-numbers
  :ensure t
  :after evil
  :config
  (define-key evil-normal-state-map (kbd "C-c +") 'evil-numbers/inc-at-pt)
  (define-key evil-normal-state-map (kbd "C-c -") 'evil-numbers/dec-at-pt)
  (define-key evil-visual-state-map (kbd "C-c +") 'evil-numbers/inc-at-pt)
  (define-key evil-visual-state-map (kbd "C-c -") 'evil-numbers/dec-at-pt))

;; flash.nvim-style jumping: press s, type chars, jump to a label
(use-package avy
  :ensure t
  :custom
  (avy-timeout-seconds 0.3)
  (avy-keys '(?a ?s ?d ?f ?g ?h ?j ?k ?l ?q ?w ?e ?r ?u ?i ?o ?p))
  :config
  (with-eval-after-load 'evil
    (define-key evil-normal-state-map (kbd "s") 'avy-goto-char-timer)
    (define-key evil-motion-state-map (kbd "s") 'avy-goto-char-timer)
    (define-key evil-visual-state-map (kbd "s") 'avy-goto-char-timer)))

;; SPC leader (Doom/LazyVim-style) — declarative bindings
(use-package general
  :ensure t
  :after evil
  :config
  (general-create-definer my/leader
    :states '(normal visual)
    :keymaps 'override
    :prefix "SPC")

  (my/leader
    ;; Files / search
    "SPC" '(affe-find         :which-key "find file (async)")
    "f" '(affe-find           :which-key "find file (async)")
    "F" '(project-find-file   :which-key "project files (cached)")
    "," '(consult-recent-file :which-key "recent files")
    "r" '(affe-grep           :which-key "ripgrep (async)")
    "R" '(consult-ripgrep     :which-key "ripgrep (consult)")
    "b" '(consult-buffer      :which-key "switch buffer")
    "/" '(consult-line        :which-key "search in buffer")
    "j" '(avy-goto-char-timer :which-key "jump")

    ;; Tools
    "g" '(magit-status       :which-key "magit")
    "v" '(ghostel            :which-key "terminal")
    "h" '(help-command       :which-key "help")
    "c" '(claude-code-ide-menu :which-key "claude")
    "=" '(er/expand-region   :which-key "expand region")

    ;; Treemacs
    "e" '(treemacs               :which-key "toggle tree")
    "t" '(treemacs-select-window :which-key "focus tree")

    ;; Windows
    "wh" '(windmove-left     :which-key "window left")
    "wj" '(windmove-down     :which-key "window down")
    "wk" '(windmove-up       :which-key "window up")
    "wl" '(windmove-right    :which-key "window right")
    "ws" '(split-window-below :which-key "split below")
    "wv" '(split-window-right :which-key "split right")
    "wd" '(delete-window      :which-key "delete window")
    "wo" '(delete-other-windows :which-key "only this")

    ;; Quit
    "qq" '(save-buffers-kill-terminal :which-key "quit emacs")))

(provide 'evil-config)
