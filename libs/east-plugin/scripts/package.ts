#!/usr/bin/env node
/**
 * Assembles East's plugins as the hosts install them — the directories a
 * release publishes as `@elaraai/east-claude-plugin` and
 * `@elaraai/east-codex-plugin` — under `libs/east-plugin/marketplace/`, and
 * writes that directory's marketplace files, so a checkout is a local
 * marketplace for both hosts, under the catalog's names — a maintainer swaps
 * the source of `elaraai` between the catalog and a checkout with one
 * `marketplace add`, and `east@elaraai` stays the plugin (#1309):
 *
 *   claude plugin marketplace add <checkout>/libs/east-plugin/marketplace
 *   codex  plugin marketplace add <checkout>/libs/east-plugin/marketplace
 *
 * Usage: node dist/scripts/package.js [--host claude|codex] [--out <dir>]
 *   --host   assemble one host's plugin (default both)
 *   --out    the marketplace directory (default libs/east-plugin/marketplace);
 *            a directory this script wrote before, or an empty or absent one —
 *            anything else there is refused, since the plugins and the
 *            marketplace files replace what they find
 *
 * Each host's `.build/` must exist (pnpm --filter <host> run bundle).
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { argument } from "../lib/args.js";
import { assemblePlugin, type PluginHost } from "../lib/package.js";

// dist/scripts/package.js → libs/east-plugin
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const libs = resolve(root, "..");

/** East's plugins: the host, its source package, and the package it is published as. */
const PLUGINS: Record<PluginHost, { source: string; dir: string; plugin: string }> = {
  claude: { source: join(libs, "east-claude-plugin"), dir: "east-claude-plugin", plugin: "east" },
  codex: { source: join(libs, "east-codex-plugin"), dir: "east-codex-plugin", plugin: "east-codex-plugin" },
};

/** What this script writes under the marketplace directory: the plugins and the marketplace files, and nothing else may be there. */
const WRITTEN = new Set([PLUGINS.claude.dir, PLUGINS.codex.dir, `${PLUGINS.claude.dir}.assembling`, `${PLUGINS.codex.dir}.assembling`, ".claude-plugin", ".agents"]);

const OWNER = { name: "Elara AI", email: "support@elara.ai", url: "https://elaraai.com" };
const DESCRIPTION = "East programming language ecosystem - types, expressions, Node.js/Python runtimes, UI components, and durable execution";

const args = process.argv.slice(2);
const host = argument(args, "--host");
if (host !== undefined && host !== "claude" && host !== "codex") {
  console.error(`--host takes claude or codex, not ${host}`);
  process.exit(2);
}
const out = resolve(argument(args, "--out") ?? join(root, "marketplace"));
const hosts: PluginHost[] = host === undefined ? ["claude", "codex"] : [host];

// Refused before anything is written: a plugin source, a package, the repo
// root — each holds what no assembly wrote, and would lose it.
if (existsSync(out)) {
  const foreign = (await readdir(out)).filter((name) => !WRITTEN.has(name));
  if (foreign.length > 0) {
    console.error(`Refusing to write a marketplace into ${out}: it holds ${foreign.join(", ")}, which no assembly wrote`);
    process.exit(2);
  }
}

for (const which of hosts) {
  const { source, dir } = PLUGINS[which];
  const manifest = await assemblePlugin({
    host: which,
    source,
    skills: join(root, "skills"),
    index: join(root, "index.json"),
    out: join(out, dir),
  });
  console.log(`assembled ${manifest.name}@${manifest.version} → ${join(out, dir)}`);
}

// The marketplace files name every plugin assembled here, so a host added to
// this directory installs what is on disk, under the published catalog's
// names (elaraai, elaraai-codex): one name registers once, and a maintainer
// points it at a checkout or at the catalog.
const present = (which: PluginHost): boolean => existsSync(join(out, PLUGINS[which].dir, "package.json"));
await mkdir(join(out, ".claude-plugin"), { recursive: true });
await writeFile(join(out, ".claude-plugin", "marketplace.json"), `${JSON.stringify({
  name: "elaraai",
  description: "East's agent plugins, assembled from this checkout",
  owner: OWNER,
  plugins: present("claude") ? [{ name: PLUGINS.claude.plugin, source: `./${PLUGINS.claude.dir}`, description: DESCRIPTION }] : [],
}, null, 2)}\n`);
await mkdir(join(out, ".agents", "plugins"), { recursive: true });
await writeFile(join(out, ".agents", "plugins", "marketplace.json"), `${JSON.stringify({
  name: "elaraai-codex",
  interface: { displayName: "Elara AI (this checkout)" },
  plugins: present("codex") ? [{
    name: PLUGINS.codex.plugin,
    source: { source: "local", path: `./${PLUGINS.codex.dir}` },
    policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
    category: "Productivity",
  }] : [],
}, null, 2)}\n`);
console.log(`marketplace: ${out} (elaraai, elaraai-codex)`);
