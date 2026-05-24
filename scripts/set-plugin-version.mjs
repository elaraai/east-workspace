#!/usr/bin/env node
// Set the Claude Code plugin version to the unified monorepo release version.
// Writes into both the plugin manifest and the marketplace entry so the
// marketplace serves the same version (and plugin.json wins per the spec).
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

const oldPlugin = setJsonVersion(PLUGIN_JSON, (j, op) => {
  if (op === 'read') return j.version;
  j.version = NEW_VERSION;
});

const oldMarket = setJsonVersion(MARKETPLACE_JSON, (j, op) => {
  const entry = j.plugins?.find((p) => p.name === 'east') ?? j.plugins?.[0];
  if (!entry) throw new Error('No plugin entry in marketplace.json');
  if (op === 'read') return entry.version;
  entry.version = NEW_VERSION;
});

console.log(`east (plugin):      ${oldPlugin} → ${NEW_VERSION}`);
console.log(`east (marketplace): ${oldMarket} → ${NEW_VERSION}`);
