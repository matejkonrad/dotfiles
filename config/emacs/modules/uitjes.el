

(use-package ace-window
  :ensure t
  :bind
  ("M-o" . ace-window))

(use-package vertico
  :ensure t
  :custom
  (vertico-count 10)
  (vertico-cycle t)
  :init
  (vertico-mode))

(use-package orderless
  :ensure t
  :custom
  (completion-styles '(orderless basic))
  (completion-category-overrides
   '((file (styles basic partial-completion)))))

(use-package marginalia
  :ensure t
  :init
  (marginalia-mode))

(use-package nerd-icons-completion
  :ensure t
  :after marginalia
  :config
  (nerd-icons-completion-mode)
  (add-hook 'marginalia-mode-hook
            #'nerd-icons-completion-marginalia-setup))

(use-package consult
  :ensure t
  :bind
  (("C-c f" . consult-find)        ; find files
   ("C-c r" . consult-ripgrep)     ; grep across project
   ("C-c b" . consult-buffer)))    ; switch buffers

;; Async fuzzy finder backed by fd/rg in a background process.
;; Streams partial results as the search runs (snacks/telescope-style).
(use-package affe
  :ensure t
  :after (consult orderless)
  :custom
  (affe-regexp-function #'orderless-pattern-compiler)
  (affe-highlight-function #'orderless--highlight))

;; Actions menu on minibuffer candidates ("right-click for completion")
(use-package embark
  :ensure t
  :bind
  (("C-." . embark-act)
   ("C-h B" . embark-bindings)))

(use-package embark-consult
  :ensure t
  :after (embark consult)
  :hook (embark-collect-mode . consult-preview-at-point-mode))

;; Modern dired replacement with previews and icons
(use-package dirvish
  :ensure t
  :init
  (dirvish-override-dired-mode))

;; Prettier help buffers (auto-remaps describe-key/function/variable/command)
(use-package helpful
  :ensure t
  :bind
  (([remap describe-key]      . helpful-key)
   ([remap describe-function] . helpful-callable)
   ([remap describe-variable] . helpful-variable)
   ([remap describe-command]  . helpful-command)))

;; Semantic selection growth: word → expression → string → block → function
(use-package expand-region
  :ensure t
  :bind ("C-=" . er/expand-region))

(use-package which-key
  :ensure t
  :custom
  (which-key-popup-type 'minibuffer)
  :init
  (which-key-mode))

(provide 'uitjes)
