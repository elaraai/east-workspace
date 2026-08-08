#!/usr/bin/env node
// Stage the RENDERED component example captures (east-ui-components
// dist-examples/*.html — one variant grid per *.examples.ts file, produced
// by the real renderer + theme via `make east-ui-examples-html-all`) into
// the design system as picker cards:
//
//   app_design_system/components/rendered/<category>/<name>.html
//   app_design_system/components/rendered/render-<hash>.css   (deduped)
//
// Each capture's inlined <style> blocks (the Chakra/theme CSS — hundreds of
// KB, near-identical across captures) are extracted and deduplicated by
// content hash into shared render-*.css files the pages <link> instead.
// Every page gets a first-line @dsCard marker (group "Components ·
// <Category>") so it registers in the claude.ai/design pane.
//
// Rendered truth vs designed spec: these cards show what the production
// renderer ACTUALLY draws today. Run after every `make
// east-ui-examples-html-all` refresh, then re-sync.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB = join(__dirname, '..');
const SRC = join(LIB, 'packages/east-ui-components/dist-examples');
const OUT = join(LIB, 'app_design_system/components/rendered');

const title = (s) => s.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('');

if (!existsSync(SRC)) { console.error(`no ${SRC} — run make east-ui-examples-html-all first`); process.exit(1); }
const sheets = new Map(); // hash -> css text
let pages = 0;
for (const f of readdirSync(SRC).sort()) {
    if (!f.endsWith('.html')) continue;
    // <Category>__<cat>_<name>.html  e.g. Buttons__buttons_button.html
    const m = /^([^_]+)__([a-z0-9-]+)_([a-z0-9_-]+)\.html$/.exec(f);
    if (!m) { console.error(`skip (name shape): ${f}`); continue; }
    const [, groupCat, catDir, rest] = m;
    let t = readFileSync(join(SRC, f), 'utf8');
    // extract every <style> block, hash the concatenation
    const styles = [];
    t = t.replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => { styles.push(css); return ''; });
    const css = styles.join('\n');
    const hash = createHash('sha256').update(css).digest('hex').slice(0, 8);
    if (!sheets.has(hash)) sheets.set(hash, css);
    const compName = title(rest.replace(/_/g, '-'));
    const subtitle = `Rendered example grid — real renderer + theme (east-ui-components)`;
    const marker = `<!-- @dsCard group="Components · ${groupCat}" viewport="900x700" subtitle="${subtitle}" name="${compName}" -->`;
    t = t.replace(/<head>/, `<head>\n<link rel="stylesheet" href="../render-${hash}.css">`);
    t = t.replace(/<title>[^<]*<\/title>/, `<title>${compName}</title>`);
    const outDir = join(OUT, catDir);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `${rest.replace(/_/g, '-')}.html`), marker + '\n' + t);
    pages++;
}
for (const [hash, css] of sheets) writeFileSync(join(OUT, `render-${hash}.css`), css);
console.error(`example-cards: ${pages} page(s), ${sheets.size} shared stylesheet(s) → components/rendered/`);
