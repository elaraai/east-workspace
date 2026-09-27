/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// Drives the TUI over the repository tui-check-seed.mjs writes, through an
// embedded server in this process under a small budget, and reports what a
// person would see and what it costs:
// 1. a run watched from the dashboard: the budget in use, split progress,
//    waits and requeues, frame by frame;
// 2. a split task's Runs tab;
// 3. paging each collection, through the loader (a thumb drag, the end) and
//    the app (/goto, G, /find, gg, a held j, page downs, a row expanded), with
//    requests, times, pages retained, the heap and the RSS;
// 4. /save of a massive collection, sampling the RSS while it writes;
// 5. a record: its row in the RECORDS table, its state, an index's pages
//    (/find, G) and its history, from the table and from /dataset.
// Frames are written to <out-dir>.
//
//   node --expose-gc contrib/tui-check-probe.mjs <repo-dir> <out-dir> [jobs] [memory] [parts]
import { mkdirSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startRepoServer } from '../dist/e3-server.js';
import { openSession } from '../dist/tui/session.js';
import { initialState } from '../dist/tui/state/actions.js';
import { createStore } from '../dist/tui/state/store.js';
import { createDatasetLoader } from '../dist/tui/data/dataset.js';
import { KEY, mountApp } from '../dist/tui/testing/harness.js';

const [repo, outDir, jobs = '4', memory = '1G', partsArg = '1,2,3,4,5'] = process.argv.slice(2);
if (repo === undefined || outDir === undefined) throw new Error('usage: node --expose-gc tui-check-probe.mjs <repo-dir> <out-dir> [jobs] [memory] [parts]');
const parts = new Set(partsArg.split(',').map(Number));
mkdirSync(outDir, { recursive: true });
const server = await startRepoServer(repo, { jobs, memory });
const session = await openSession(repo, { startServer: async () => server });

// Every call by name, every page request, and the most page requests in flight.
const calls = new Map();
let requests = 0;
let inflight = 0;
let peakInflight = 0;
const api = new Proxy(session.api, {
  get(target, prop) {
    const value = target[prop];
    if (typeof value !== 'function') return value;
    return async (...args) => {
      calls.set(prop, (calls.get(prop) ?? 0) + 1);
      if (prop !== 'datasetGetPage') return value.apply(target, args);
      requests++;
      inflight++;
      peakInflight = Math.max(peakInflight, inflight);
      try {
        return await value.apply(target, args);
      } finally {
        inflight--;
      }
    };
  },
});

const MB = 2 ** 20;
const mem = () => {
  globalThis.gc();
  globalThis.gc();
  const m = process.memoryUsage();
  return `heap ${Math.round(m.heapUsed / MB)} MB, buffers ${Math.round(m.arrayBuffers / MB)} MB, rss ${Math.round(m.rss / MB)} MB`;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(what, predicate, ms = 600_000) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}
const pad7 = (i) => String(i).padStart(7, '0');
const snap = (m, name) => writeFileSync(join(outDir, `${name}.txt`), m.frame() + '\n');
const mount = () => mountApp({
  api, session: session.info, feeds: true, now: () => Date.now(),
  size: { columns: 120, rows: 40 }, view: { kind: 'workspaces', list: { sel: 0, top: 0 } },
});
const shows = (m, text) => () => m.frame().includes(text);

console.log(`budget: ${jobs} cores, ${memory}; start ${mem()}`);

// 1. A run, watched from the dashboard.
if (parts.has(1)) {
  const m = await mount();
  m.controller.openWorkspace('big');
  await until('the dashboard', shows(m, 'TASKS'));
  snap(m, '1-dashboard-before');
  await m.press('r');
  snap(m, '1-run-confirm');
  await m.press(KEY.enter);
  const t0 = Date.now();
  const panels = new Set();
  const seen = { budget: 0, split: 0, waiting: 0, requeued: 0, frames: 0 };
  let saved = 0;
  while (!m.frame().includes('LAST EXECUTION') || Date.now() - t0 < 2_000) {
    await sleep(250);
    const lines = m.lines();
    const at = lines.findIndex(l => /^ (LAST )?EXECUTION/.test(l));
    if (at < 0) continue;
    const panel = lines.slice(at, at + 8).join('\n');
    seen.frames++;
    if (/cores \d+ of \d+/.test(lines[at])) seen.budget++;
    if (/ of \d+ pieces| merges/.test(panel)) seen.split++;
    if (/◐ waiting {5}\S/.test(panel)) seen.waiting++;
    if (/⟲ requeued/.test(panel)) seen.requeued++;
    const shape = panel.replace(/\d+(\.\d+)?/g, '#').replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, '*');
    if (!panels.has(shape) && saved < 40) {
      panels.add(shape);
      snap(m, `1-running-${String(++saved).padStart(2, '0')}`);
    }
    m.dropFrames();
    if (Date.now() - t0 > 1_800_000) throw new Error('the run took over 30 minutes');
  }
  snap(m, '1-dashboard-after');
  console.log(`\n== 1. run: ${((Date.now() - t0) / 1000).toFixed(1)} s, ${seen.frames} frames sampled: header budget in ${seen.budget}, split progress in ${seen.split}, a wait in ${seen.waiting}, a requeue in ${seen.requeued}; ${saved} distinct panels saved; ${mem()}`);
  m.unmount();
}

// 2. A split task's Runs tab.
if (parts.has(2)) {
  const m = await mount();
  m.controller.openWorkspace('big');
  await until('the dashboard', shows(m, 'TASKS'));
  for (const task of ['enrich', 'by_site']) {
    const t = Date.now();
    await m.type(`/runs ${task}`);
    await m.press(KEY.enter);
    await until(`${task}'s runs`, () => m.store.getState().data.executions['big']?.[task] !== undefined);
    const runs = m.store.getState().data.executions['big'][task];
    const byInputs = new Set(runs.map(r => r.inputsHash)).size;
    snap(m, `2-runs-${task}`);
    console.log(`\n== 2. ${task} Runs tab: ${runs.length} rows over ${byInputs} inputs hashes, in ${Date.now() - t} ms; ${mem()}`);
    await m.press(KEY.escape);
  }
  m.unmount();
}

// 3. Paging each collection.
if (parts.has(3)) {
  for (const [path, key, open] of [
    ['.inputs.wide', (i) => `k${pad7(i)}`, '/input wide'],
    ['.inputs.cols', (i) => `r${pad7(i)}`, '/input cols'],
    ['.inputs.big', (i) => `s${String(i).padStart(6, '0')}`, '/input big'],
    ['.tasks.enrich.output', (i) => `k${pad7(i)}`, '/task enrich'],
  ]) {
    const store = createStore(initialState({ columns: 120, rows: 40 }, repo));
    store.dispatch({ type: 'session', session: session.info });
    const loader = createDatasetLoader({ store, api: () => api });
    const mode = () => store.getState().data.dataset['big']?.[path]?.mode;
    let t = Date.now();
    requests = 0;
    await loader.tick('big', path);
    await until('the first page', () => mode()?.kind === 'paged' && mode().pages.has(0));
    const { pageSize, totalRows, totalBytes } = mode();
    console.log(`\n== 3. ${path}: ${totalRows.toLocaleString()} rows, ${Math.round(totalBytes / MB)} MiB stored (${Math.round(totalBytes / totalRows)} B a row); page ${pageSize} rows; first page ${Date.now() - t} ms, ${requests} requests`);
    const visible = 30;
    const middle = Math.floor(totalRows / 2);
    requests = 0;
    peakInflight = 0;
    for (let report = 1; report <= 30; report++) {
      const top = Math.round((middle * report) / 30);
      loader.needRows('big', path, Math.max(0, top - pageSize), top + visible + pageSize);
      await sleep(10);
    }
    const dragEnded = Date.now();
    await until('the middle page', () => mode().pages.has(Math.floor(middle / pageSize)));
    console.log(`loader drag top → middle: shown ${Date.now() - dragEnded} ms after; ${requests} requests, at most ${peakInflight} in flight; ${mode().pages.size} pages retained; ${mem()}`);
    t = Date.now();
    requests = 0;
    const last = Math.ceil(totalRows / pageSize) - 1;
    loader.needRows('big', path, Math.max(0, totalRows - visible - pageSize), totalRows);
    await until('the last page', () => mode().pages.has(last));
    console.log(`loader end: ${Date.now() - t} ms, ${requests} requests; ${mode().pages.size} pages retained; ${mem()}`);
    loader.reset();

    const m = await mount();
    m.controller.openWorkspace('big');
    await until('the dashboard', shows(m, 'TASKS'));
    t = Date.now();
    requests = 0;
    await m.type(open);
    await m.press(KEY.enter);
    await until('the first row', shows(m, key(0)));
    console.log(`app ${open}: first rows in ${Date.now() - t} ms, ${requests} requests`);
    snap(m, `3-${path.replaceAll('.', '_')}-open`);
    // Records open a level deep by default; collapsed, a record is one line and
    // the key of the row a jump lands on is on screen.
    await m.dispatch({ type: 'tree/collapseAll' });
    for (const [label, keys, text] of [
      ['/goto 50%', ['/goto 50%'], key(middle)],
      ['G', ['G'], key(totalRows - 1)],
      [`/find "${key(123)}"`, [`/find "${key(Math.min(123, totalRows - 1))}"`], key(Math.min(123, totalRows - 1))],
      ['gg', ['g', 'g'], key(0)],
    ]) {
      m.dropFrames();
      t = Date.now();
      requests = 0;
      for (const k of keys) {
        if (k.startsWith('/')) {
          await m.type(k);
          await m.press(KEY.enter);
        } else {
          await m.press(k);
        }
      }
      await until(label, shows(m, text));
      console.log(`app ${label}: shown in ${Date.now() - t} ms, ${requests} requests`);
    }
    // A held j: 300 records, as a key repeat sends them.
    m.dropFrames();
    t = Date.now();
    requests = 0;
    for (let i = 0; i < 300; i++) await m.press('j');
    await until('record 300', shows(m, key(300)), 60_000).catch(() => undefined);
    console.log(`app 300 × j: ${((Date.now() - t) / 300).toFixed(1)} ms a key, ${requests} requests; ${m.lines().find(l => l.startsWith('▌'))?.slice(0, 40).trim()}`);
    // Page downs: 60 windows, then until the window's placeholders fill.
    m.dropFrames();
    t = Date.now();
    requests = 0;
    for (let i = 0; i < 60; i++) await m.press(KEY.pageDown);
    const pressed = Date.now() - t;
    await until('the rows after 60 pages', () => !m.frame().includes('░'), 60_000).catch(() => undefined);
    console.log(`app 60 × PgDn: ${(pressed / 60).toFixed(1)} ms a key, filled ${Date.now() - t - pressed} ms after; ${requests} requests; ${mem()}`);
    snap(m, `3-${path.replaceAll('.', '_')}-paged`);
    // A record expanded, and its first collection field.
    t = Date.now();
    await m.press(KEY.right);
    await m.press('j');
    await m.press('j');
    await m.press('j');
    await m.press(KEY.right);
    await sleep(200);
    console.log(`app a record and a field expanded: ${Date.now() - t} ms`);
    snap(m, `3-${path.replaceAll('.', '_')}-expanded`);
    const appMode = m.store.getState().data.dataset['big']?.[path]?.mode;
    console.log(`app: ${appMode?.kind === 'paged' ? appMode.pages.size : '?'} pages retained; ${mem()}`);
    m.unmount();
  }
}

// 4. /save of a massive collection.
if (parts.has(4)) {
  const m = await mount();
  m.controller.openWorkspace('big');
  await until('the dashboard', shows(m, 'TASKS'));
  await m.type('/input wide');
  await m.press(KEY.enter);
  await until('the first row', shows(m, 'k0000000'));
  const file = join(tmpdir(), `tui-check-save-${process.pid}.beast2`);
  const before = process.memoryUsage().rss;
  let peak = before;
  const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 20);
  const t = Date.now();
  await m.type(`/save ${file}`);
  await m.press(KEY.enter);
  await until('the save', shows(m, 'saved '), 600_000);
  clearInterval(sampler);
  const size = statSync(file).size;
  rmSync(file, { force: true });
  console.log(`\n== 4. /save .inputs.wide: ${Math.round(size / MB)} MiB in ${((Date.now() - t) / 1000).toFixed(1)} s; rss ${Math.round(before / MB)} → peak ${Math.round(peak / MB)} MB (+${Math.round((peak - before) / MB)} MB); ${mem()}`);
  m.unmount();
}

// 5. A record.
if (parts.has(5)) {
  const m = await mount();
  m.controller.openWorkspace('big');
  await until('the RECORDS row', () => m.store.getState().data.records['big']?.['ledger']?.signature != null && /^ .?ledger\s+[\d,]+\s/m.test(m.frame()));
  snap(m, '5-dashboard');
  console.log(`\n== 5. record: the RECORDS row: ${m.lines().find(l => /^ .?ledger\s/.test(l))?.trim()}`);
  const step = async (label, keys, done) => {
    m.dropFrames();
    const t = Date.now();
    requests = 0;
    for (const k of keys) {
      if (k.startsWith('/')) {
        await m.type(k);
        await m.press(KEY.enter);
      } else {
        await m.press(k);
      }
    }
    await until(label, done);
    console.log(`${label}: ${Date.now() - t} ms, ${requests} page requests; ${m.lines()[3]?.trim()}`);
  };
  // From the table: the last selectable row is the record's.
  await step('the state, from the table', ['G', KEY.enter], shows(m, 'L0000000'));
  snap(m, '5-state');
  await step('/goto 50%', ['/goto 50%'], shows(m, 'L0100000'));
  await step('/index by_site', ['/index by_site'], () => /index by_site/.test(m.lines()[3] ?? '') && shows(m, 'site-0 · L')());
  snap(m, '5-index');
  await step('/find site-50 on the index', ['/find site-50'], shows(m, 'site-50 · L'));
  await step('G on the index', ['G'], shows(m, 'site-96 · L0199'));
  snap(m, '5-index-end');
  await step('/index primary', ['/index primary'], shows(m, 'L0000000'));
  await step('the History tab', ['2'], () => / commits?$/.test(m.lines().at(-1) ?? ''));
  console.log(`history: ${m.lines().at(-1)?.trim()}; ${m.lines().slice(6, 9).map(l => l.trim()).join(' | ')}`);
  snap(m, '5-history');
  await m.press(KEY.escape);
  await step('/dataset .records.ledger', ['/dataset .records.ledger'], () => m.store.getState().view.kind === 'record');
  console.log(`record: ${mem()}`);
  m.unmount();
}

console.log(`\ncalls: ${[...calls.entries()].map(([k, v]) => `${String(k)} ${v}`).join(', ')}`);
await session.stop();
