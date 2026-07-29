#!/usr/bin/env node
// Copy the hand-authored HTML that ships OUTSIDE the converter's component
// cards into the built bundle:
//
//   1. guidelines/cards/*.html — foundation/convention specimen cards
//      (groups Colors / Type / Foundations / Conventions / App layout),
//      linking ../../styles.css (valid at that depth).
//   2. guidelines/patterns/<category>/*.html — the component-level pattern
//      specs (reconciled against packages/east-ui + packages/e3-ui; every
//      file's subject is implemented), linking ../../../styles.css and
//      ../spec.css. guidelines/patterns/spec.css ships alongside them —
//      the shared structural stylesheet those files link.
//
// Every file carries its own first-line `@dsCard` marker (patterns register
// under "Patterns · <Category>" groups), so they all appear in the picker
// alongside the converter's component cards.
//
// Run after EVERY package-build/resync (the build wipes ds-bundle):
//   node .design-sync/extra-cards.mjs
// Skipping it makes the next close-out reconciliation DELETE these remotely.
// components/core/core.card.html is deliberately NOT shipped: it re-renders
// the atoms via unpkg CDN React + babel-standalone (fragile in the pane)
// and is superseded by the 8 per-component cards.
import { cpSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(join(root, 'ds-bundle', '_ds_bundle.js'))) {
  console.error('extra-cards: ds-bundle missing — run the converter first');
  process.exit(1);
}

let cards = 0;
const cardsSrc = join(root, 'guidelines', 'cards');
const cardsOut = join(root, 'ds-bundle', 'guidelines', 'cards');
mkdirSync(cardsOut, { recursive: true });
for (const f of readdirSync(cardsSrc)) {
  if (!f.endsWith('.html')) continue;
  cpSync(join(cardsSrc, f), join(cardsOut, f));
  cards++;
}

const patterns = 0; // guidelines/patterns retired 2026-07-29 (git history)

let rendered = 0;
const renSrc = join(root, 'components', 'rendered');
if (existsSync(renSrc)) {
  const renOut = join(root, 'ds-bundle', 'components', 'rendered');
  mkdirSync(renOut, { recursive: true });
  for (const f of readdirSync(renSrc)) {
    const p = join(renSrc, f);
    if (statSync(p).isDirectory()) {
      mkdirSync(join(renOut, f), { recursive: true });
      for (const g of readdirSync(p)) {
        if (!g.endsWith('.html')) continue;
        cpSync(join(p, g), join(renOut, f, g));
        rendered++;
      }
    } else if (f.endsWith('.css')) {
      cpSync(p, join(renOut, f));
    }
  }
}

console.error(`extra-cards: ${cards} specimen card(s) → ds-bundle/guidelines/cards/`);
console.error(`extra-cards: ${patterns} pattern spec(s) + spec.css → ds-bundle/guidelines/patterns/`);
console.error(`extra-cards: ${rendered} rendered example card(s) → ds-bundle/components/rendered/`);
