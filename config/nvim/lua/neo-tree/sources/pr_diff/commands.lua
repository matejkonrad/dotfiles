-- Reuse neo-tree's shared commands (open, close_node, refresh, etc.).
return vim.tbl_deep_extend("force", {}, require("neo-tree.sources.common.commands"))
