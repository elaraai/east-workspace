import { runEastLsp } from "@elaraai/east-diagnostics";

// Plugin LSP server entry: Claude Code launches this over stdio (declared in
// .claude-plugin/plugin.json) and injects the published diagnostics into the
// agent's context after every edit — native type errors rewritten as East
// type diffs, plus the east-diagnostics rule set.
runEastLsp();
