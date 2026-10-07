# Shared East Agent Plugin Library

The common implementation used by [`east-claude-plugin`](../east-claude-plugin) and [`east-codex-plugin`](../east-codex-plugin), published as `@elaraai/east-plugin` for a Claude Code or Codex plugin that builds on East's (see [Building on East's plugin](#building-on-easts-plugin)). It is not an agent plugin itself.

- `lib/`: project detection, search, review and deduplication, daemon client, Python diagnostics, status, transcript helpers, the stdio LSP client, the search-first guidance and hooks (Claude Code's in `search-hooks.ts`, Codex's in `codex-hook.ts`), and the Codex skill adapter (`codex-skills.ts`).
- `hooks/`: common lifecycle and Claude tool adapters. Codex's one tool hook is `east-codex-plugin/hooks/codex-tools.ts`, over `lib/codex-hook.ts` and `lib/codex-tools.ts` (patch and shell normalization).
- `daemon/`: TypeScript/TSX LSP, Python LSP launcher and resident diagnostics server.
- `mcp/`: example search, retrieval, status and the real LSP bridge; the search and retrieval tools are `example-tools.ts`'s, for any server.
- `skills/`: the four plugin-native skills plus symlinks to package-owned skills.
- `scripts/`: the sole index generator, Python renderer, asset sync and CLI installation/update implementations.
- `index.json`: canonical generated corpus. Both plugins ship generated copies for independent installation, and the published package ships it for a plugin that serves East's corpus beside its own.

Host runtime files are thin package re-exports, inlined by esbuild. They must not grow independent copies of shared behavior. `hostText` translates host-facing tool and skill names at the output boundary. Generated host bundles and indexes intentionally contain duplicated bytes so installed plugins do not depend on this workspace package.

```bash
pnpm --filter @elaraai/east-plugin run build
pnpm --filter @elaraai/east-plugin run generate-index
pnpm --filter @elaraai/east-claude-plugin run bundle
pnpm --filter @elaraai/east-codex-plugin run bundle
```

Index generation requires built examples and the Python environment, as documented in either host README. After runtime changes, build this package before bundling hosts. Codex `build` and Claude `build` do that automatically; a root recursive build follows the workspace dependency graph.

Edit the skill's owning library, or its native source here. Claude skill links resolve here or directly to their owning packages. Codex materializes and adapts the same sources at bundle time. Run both host test suites after changes to shared behavior.

## Building on East's plugin

A plugin for a product built on East — its own skills and its own examples — runs the same machinery over its own corpus, each piece called with the plugin's own names: the index generator, the example search and its MCP tools, the search-first hooks and the Codex skill adapter. East's own plugins are these, called with East's names.

```bash
npm install @elaraai/east-plugin@<the East packages' version>
```

**Versions.** `@elaraai/east-plugin` ships on the one version every `@elaraai/*` package shares, and depends on `@elaraai/east` and `@elaraai/east-diagnostics` at that version. Pin it exactly to the version of the East packages your examples use, and move them together. The East index it ships is that version's corpus.

### The index

An `index.config.json` names the packages whose `*.examples.ts(x)` are indexed, as East's [`index.config.json`](./index.config.json) does: a source with `ir: true` is a package whose examples are East programs, read from its built test modules (`dist`) and stored as IR with the TypeScript printed from it; any other is stored as its authored source. Hand-written entries (a CLI's, say) go in an `index.static.json` of `{ "entries": [...] }`.

```bash
npx east-plugin-generate-index --base-dir . --config index.config.json --static index.static.json --out index.json
# the python printings of the programs, optional (without them a program answers in TypeScript only):
uv run --with elaraai-east-py python node_modules/@elaraai/east-plugin/scripts/render-python.py index.json
```

From code, `generateIndex({ baseDir, config, staticEntries })` (`@elaraai/east-plugin/scripts/generate-index`) returns the index to write.

### The search

The search and fetch tools register on any MCP server with `registerExampleTools(server, { index, searchTool, getTool, corpus, packages, scopes })`, which answers once the index has loaded: a server awaits it before it connects, so an index that does not load fails it at startup, naming why. `scopes` are the npm scopes the corpus's packages are installed under, `@elaraai` unless given: the package filter accepts a name under any of them, and the search tool tells the agent not to read the installed packages there. A plugin composes its corpus with East's one of two ways:

- **One server answering both corpora.** Serve East's index beside your own: the package filter knows both, and an example id names its package, so the two never collide.

  ```ts
  import { fileURLToPath } from "node:url";
  import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
  import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
  import { registerExampleTools } from "@elaraai/east-plugin/mcp/example-tools";
  import { EAST_INDEX_PATH } from "@elaraai/east-plugin/lib/east-index";

  const server = new McpServer({ name: "acme", version: "1.0.0" });
  await registerExampleTools(server, {
    index: [EAST_INDEX_PATH, fileURLToPath(new URL("../index.json", import.meta.url))],
    searchTool: "search_acme_examples",
    getTool: "get_acme_example",
    corpus: "Acme",
    packages: ["acme-cloud", "east", "e3"],
  });
  await server.connect(new StdioServerTransport());
  ```

- **One each.** The East plugin, installed beside yours, answers East's corpus with its own tools; your server serves your index alone.

`EAST_INDEX_PATH` names the installed package's `index.json`. A bundled server, as East's plugins bundle theirs, copies that file into the plugin at build time and reads it from there.

### The hooks

Claude Code runs a hook per event. Each is the shared function, configured with your names:

```ts
// hooks/pre-write.ts — the gate on a write of your code with no search on record
import { gateText, type SearchGuidance } from "@elaraai/east-plugin/lib/search-guidance";
import { runPreWriteGate } from "@elaraai/east-plugin/lib/search-hooks";
import { SEARCH_TOOLS } from "@elaraai/east-plugin/lib/transcript";

const ACME: SearchGuidance = {
  searchTool: "mcp__plugin_acme_acme__search_acme_examples",
  getTool: "mcp__plugin_acme_acme__get_acme_example",
  corpus: "Acme",
  scope: "@elaraai",
};
await runPreWriteGate({
  searchTools: [ACME.searchTool, ACME.getTool, ...SEARCH_TOOLS], // a search of East's corpus counts too
  gateText: gateText(ACME),
  isCorpusCode: (code) => /@elaraai\/acme/.test(code),
  markerPrefix: "acme-search-seen",
  requireSearchEnv: "ACME_REQUIRE_SEARCH",
});
```

The read reminder is `runPreReadReminder({ readText: readText(ACME), isCorpusRead: corpusReadFor(ACME.scope) })`. Codex runs one hook over every tool: `codexSearchGate(event, options)` (`lib/codex-hook.ts`) records a search by your tools after the call, and before it reminds a read of your corpus and gates a write of your code; `writeSearchHookReply` writes its answer.

### Skills

A plugin ships its own skills; East's come from the East plugin installed beside it. Codex caches only the plugin itself, so a Codex plugin ships its skills as real files, adapted from the Claude Code ones: `materializeSkills(sources, target, names)` (`lib/codex-skills.ts`) adapts each skill's Markdown — your tools lose Claude Code's MCP prefix, `/acme:` becomes `$acme-codex-plugin:`, the words speak of Codex — and copies every other file.
