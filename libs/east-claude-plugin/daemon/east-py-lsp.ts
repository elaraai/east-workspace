import { runEastPyLsp } from "@elaraai/east-diagnostics";

// Plugin LSP server entry for python (#681): Claude Code launches this over
// stdio for `.py` files (declared in .claude-plugin/plugin.json, beside the
// TypeScript server). It is a launcher: in an east-py project it runs the
// project's own `east-py lsp` — the warm two-tier server — and falls back to a
// cold `east-py lint` per change when that cannot start; anywhere else it is a
// silent null server that never claims a file is clean.
runEastPyLsp();
