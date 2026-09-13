# Shared East Agent Plugin Library

The common implementation used by [`east-claude-plugin`](../east-claude-plugin) and [`east-codex-plugin`](../east-codex-plugin). This is a private build-time workspace package, not a separately installed agent plugin.

- `lib/`: project detection, search, review and deduplication, daemon client, Python diagnostics, status, transcript helpers and the stdio LSP client.
- `hooks/`: common lifecycle and Claude tool adapters. Codex-specific patch/shell normalization lives in `east-codex-plugin/hooks/codex-tools.ts`.
- `daemon/`: TypeScript/TSX LSP, Python LSP launcher and resident diagnostics server.
- `mcp/`: example search, retrieval, status and the real LSP bridge.
- `skills/`: the four plugin-native skills plus symlinks to package-owned skills.
- `scripts/`: the sole index generator, Python renderer, asset sync and CLI installation/update implementations.
- `index.json`: canonical generated corpus. Both plugins ship generated copies for independent installation.

Host runtime files are thin package re-exports, inlined by esbuild. They must not grow independent copies of shared behavior. `hostText` translates host-facing tool and skill names at the output boundary. Generated host bundles and indexes intentionally contain duplicated bytes so installed plugins do not depend on this workspace package.

```bash
pnpm --filter @elaraai/east-plugin run build
pnpm --filter @elaraai/east-plugin run generate-index
pnpm --filter @elaraai/east-claude-plugin run bundle
pnpm --filter @elaraai/east-codex-plugin run bundle
```

Index generation requires built examples and the Python environment, as documented in either host README. After runtime changes, build this package before bundling hosts. Codex `build` and Claude `build` do that automatically; a root recursive build follows the workspace dependency graph.

Edit the skill's owning library, or its native source here. Claude skill links resolve here or directly to their owning packages. Codex materializes and adapts the same sources at bundle time. Run both host test suites after changes to shared behavior.
