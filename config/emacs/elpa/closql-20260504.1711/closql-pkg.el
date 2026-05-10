;; -*- no-byte-compile: t; lexical-binding: nil -*-
(define-package "closql" "20260504.1711"
  "Store EIEIO objects using EmacSQL."
  '((emacs    "28.1")
    (compat   "31.0")
    (cond-let "0.2")
    (emacsql  "4.3"))
  :url "https://github.com/emacscollective/closql"
  :commit "0aa86373ed12ff3bd4344aec4b2c79c3347d2ae3"
  :revdesc "0aa86373ed12"
  :keywords '("extensions")
  :authors '(("Jonas Bernoulli" . "emacs.closql@jonas.bernoulli.dev"))
  :maintainers '(("Jonas Bernoulli" . "emacs.closql@jonas.bernoulli.dev")))
