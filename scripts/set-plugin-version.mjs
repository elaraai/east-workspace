#!/usr/bin/env node
// Set both agent plugin versions to the unified monorepo release version.
// Writes into both plugin manifests — the assembled packages
// (@elaraai/east-claude-plugin, @elaraai/east-codex-plugin) take their
// version from there — and into the monorepo's two marketplace entries: the
// entry's version (plugin.json wins per the spec) and the pin of its npm
// source, which is what an install added as elaraai/east-workspace fetches.
//
// Unlike the VS Marketplace (see set-vsix-version.mjs), Claude Code plugin
// versions accept full semver including pre-release labels, so this just sets
// the exact value.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const NEW_VERSION = process.argv[2];
if (!NEW_VERSION) {
  console.error('Usage: set-plugin-version.mjs <semver>');
  process.exit(1);
}

function setJsonVersion(relPath, mutate) {
  const p = path.join(repoRoot, relPath);
  const raw = fs.readFileSync(p, 'utf8');
  const json = JSON.parse(raw);
  const before = mutate(json, 'read');
  mutate(json, 'write');
  const trailingNewline = raw.endsWith('\n') ? '\n' : '';
  const indent = raw.startsWith('{\n    ') ? 4 : 2;
  fs.writeFileSync(p, JSON.stringify(json, null, indent) + trailingNewline);
  return before;
}

const PLUGIN_JSON = 'libs/east-claude-plugin/.claude-plugin/plugin.json';
const MARKETPLACE_JSON = '.claude-plugin/marketplace.json';
const CODEX_MARKETPLACE_JSON = '.agents/plugins/marketplace.json';

/** An entry's npm source pinned to the version, when it has one. */
function pinNpmSource(entry) {
  if (entry.source?.source === 'npm') entry.source.version = NEW_VERSION;
}

const oldPlugin = setJsonVersion(PLUGIN_JSON, (j, op) => {
  if (op === 'read') return j.version;
  j.version = NEW_VERSION;
});

const oldMarket = setJsonVersion(MARKETPLACE_JSON, (j, op) => {
  const entry = j.plugins?.find((p) => p.name === 'east') ?? j.plugins?.[0];
  if (!entry) throw new Error('No plugin entry in marketplace.json');
  if (op === 'read') return entry.version;
  entry.version = NEW_VERSION;
  pinNpmSource(entry);
});

console.log(`east (plugin):      ${oldPlugin} → ${NEW_VERSION}`);
console.log(`east (marketplace): ${oldMarket} → ${NEW_VERSION}`);

const oldCodex = setJsonVersion('libs/east-codex-plugin/.codex-plugin/plugin.json', (j, op) => {
  if (op === 'read') return j.version;
  j.version = NEW_VERSION;
});
console.log(`east-codex-plugin:  ${oldCodex} → ${NEW_VERSION}`);

const oldCodexMarket = setJsonVersion(CODEX_MARKETPLACE_JSON, (j, op) => {
  const entry = j.plugins?.find((p) => p.name === 'east-codex-plugin') ?? j.plugins?.[0];
  if (!entry) throw new Error(`No plugin entry in ${CODEX_MARKETPLACE_JSON}`);
  if (op === 'read') return entry.source?.version;
  pinNpmSource(entry);
});
console.log(`east-codex-plugin (marketplace): ${oldCodexMarket} → ${NEW_VERSION}`);
