#!/usr/bin/env node
// Copy the hand-authored foundation/convention specimen cards into the
// built bundle. These carry their own first-line `@dsCard` markers (groups
// Colors / Type / Foundations / Conventions) and link ../../styles.css,
// which resolves correctly at this depth — so they register as picker
// cards alongside the converter's component cards.
//
// Run after EVERY package-build/resync (the build wipes ds-bundle):
//   node .design-sync/extra-cards.mjs
// components/core/core.card.html is deliberately NOT shipped: it re-renders
// the atoms via unpkg CDN React + babel-standalone (fragile in the pane)
// and is superseded by the 8 per-component cards.
import { cpSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'guidelines', 'cards');
const out = join(root, 'ds-bundle', 'guidelines', 'cards');
if (!existsSync(join(root, 'ds-bundle', '_ds_bundle.js'))) {
  console.error('extra-cards: ds-bundle missing — run the converter first');
  process.exit(1);
}
mkdirSync(out, { recursive: true });
let n = 0;
for (const f of readdirSync(src)) {
  if (!f.endsWith('.html')) continue;
  cpSync(join(src, f), join(out, f));
  n++;
}
console.error(`extra-cards: ${n} specimen card(s) → ds-bundle/guidelines/cards/`);
