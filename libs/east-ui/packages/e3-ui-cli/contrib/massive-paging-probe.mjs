/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// Measures the TUI's paging over the inputs massive-paging-seed.mjs writes,
// through an embedded server in this process, as DESIGN_TUI.md §17 measured it:
// a 30-report thumb drag from the top to the middle (10 ms apart) through the
// loader, then the end; and, through the mounted app, /goto 50%, G, /find and
// gg. Prints requests, time to the destination, pages retained and the heap.
//
//   node --expose-gc contrib/massive-paging-probe.mjs <repo-dir>
import { DatasetSegments, LocalStorage, workspaceGetDatasetHash } from '@elaraai/e3-core';
import { variant } from '@elaraai/east';
import { startRepoServer } from '../dist/e3-server.js';
import { openSession } from '../dist/tui/session.js';
import { initialState } from '../dist/tui/state/actions.js';
import { createStore } from '../dist/tui/state/store.js';
import { createDatasetLoader } from '../dist/tui/data/dataset.js';
import { KEY, mountApp } from '../dist/tui/testing/harness.js';

const repo = process.argv[2];
if (repo === undefined) throw new Error('usage: node --expose-gc massive-paging-probe.mjs <repo-dir>');
const server = await startRepoServer(repo);
const session = await openSession(repo, { startServer: async () => server });

// Every page request, and the most in flight at once.
let requests = 0;
let inflight = 0;
let peakInflight = 0;
const api = new Proxy(session.api, {
  get(target, prop) {
    const value = target[prop];
    if (prop !== 'datasetGetPage') return typeof value === 'function' ? value.bind(target) : value;
    return async (...args) => {
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

const heapMB = () => {
  globalThis.gc();
  globalThis.gc();
  return Math.round(process.memoryUsage().heapUsed / 2 ** 20);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(what, predicate, ms = 120_000) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

const storage = new LocalStorage();
for (const name of ['wide', 'narrow']) {
  const path = `.inputs.${name}`;
  const { hash } = await workspaceGetDatasetHash(storage, repo, 'big', [variant('field', 'inputs'), variant('field', name)]);
  const segments = await DatasetSegments.open(storage, repo, hash);
  let stored = 0;
  for (let i = 0; i < segments.segmentCount; i++) stored += segments.segmentBytes(i);
  const rows = segments.counts.reduce((a, b) => a + b, 0);
  console.log(`\n== ${name}: ${rows.toLocaleString()} rows, ${segments.segmentCount.toLocaleString()} segments, ${Math.round(stored / 2 ** 20)} MiB stored (${Math.round(stored / rows)} B a row)`);

  // The loader, as §17 measured it.
  const store = createStore(initialState({ columns: 120, rows: 36 }, repo));
  store.dispatch({ type: 'session', session: session.info });
  const loader = createDatasetLoader({ store, api: () => api });
  const mode = () => store.getState().data.dataset['big']?.[path]?.mode;
  const heap0 = heapMB();
  let t = Date.now();
  requests = 0;
  await loader.tick('big', path);
  await until('the first page', () => mode()?.kind === 'paged' && mode().pages.has(0));
  const { pageSize, totalRows } = mode();
  console.log(`open: first page in ${Date.now() - t} ms, ${requests} requests; page size ${pageSize} rows`);

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
  const destination = Math.floor(middle / pageSize);
  await until('the middle page', () => mode().pages.has(destination));
  const shownAfter = Date.now() - dragEnded;
  const heap = heapMB();
  console.log(`drag top → middle (30 reports, 10 ms apart): shown ${shownAfter} ms after the drag ended; ${requests} requests, at most ${peakInflight} in flight; ${mode().pages.size} pages retained; heap ${heap} MB (${heap - heap0 >= 0 ? '+' : ''}${heap - heap0} MB)`);

  t = Date.now();
  requests = 0;
  const last = Math.ceil(totalRows / pageSize) - 1;
  loader.needRows('big', path, Math.max(0, totalRows - visible - pageSize), totalRows);
  await until('the last page', () => mode().pages.has(last));
  console.log(`end: shown in ${Date.now() - t} ms, ${requests} requests; ${mode().pages.size} pages retained; heap ${heapMB()} MB`);
  loader.reset();

  // The app, driven by keys.
  const m = await mountApp({ api, session: session.info, feeds: true, view: { kind: 'workspaces', list: { sel: 0, top: 0 } } });
  const shows = (text) => () => m.frame().includes(text);
  const pad = (i) => String(i).padStart(7, '0');
  m.controller.openWorkspace('big');
  await until('the dashboard', shows(name));
  t = Date.now();
  requests = 0;
  await m.type(`/input ${name}`);
  await m.press(KEY.enter);
  await until('the first row', shows(`k${pad(0)}`));
  console.log(`app /input ${name}: first rows in ${Date.now() - t} ms, ${requests} requests`);
  for (const [label, keys, text] of [
    ['/goto 50%', ['/goto 50%'], `k${pad(middle)}`],
    ['G', ['G'], `k${pad(totalRows - 1)}`],
    [`/find "k${pad(123_456)}"`, [`/find "k${pad(123_456)}"`], `k${pad(123_456)}`],
    ['gg', ['g', 'g'], `k${pad(0)}`],
  ]) {
    m.dropFrames();
    t = Date.now();
    requests = 0;
    for (const key of keys) {
      if (key.startsWith('/')) {
        await m.type(key);
        await m.press(KEY.enter);
      } else {
        await m.press(key);
      }
    }
    await until(label, shows(text));
    console.log(`app ${label}: shown in ${Date.now() - t} ms, ${requests} requests`);
  }
  const appMode = m.store.getState().data.dataset['big']?.[path]?.mode;
  console.log(`app: ${appMode?.kind === 'paged' ? appMode.pages.size : '?'} pages retained; heap ${heapMB()} MB; rss ${Math.round(process.memoryUsage().rss / 2 ** 20)} MB`);
  m.unmount();
}
await session.stop();
