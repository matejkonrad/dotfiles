-- Reuse neo-tree's shared components (icon, name, git_status, etc.).
return vim.tbl_deep_extend("force", {}, require("neo-tree.sources.common.components"))
