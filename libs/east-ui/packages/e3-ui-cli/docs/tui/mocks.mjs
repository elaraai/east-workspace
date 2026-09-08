// Mock generator for the e3-ui TUI design (v2 — command-bar shell, no sidebar).
// Every screen is composed from one shell so widths/alignment are exact.
// Output: docs/tui/mocks/<screen>.txt. Run: node docs/tui/mocks.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const W = 120;                 // terminal columns

const pad = (s, n) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
const padL = (s, n) => (s.length >= n ? s.slice(0, n) : ' '.repeat(n - s.length) + s);
const center = (s, n) => { const l = Math.max(0, Math.floor((n - s.length) / 2)); return pad(' '.repeat(l) + s, n); };
const rule = (n, ch = '─') => ch.repeat(n);
const lr = (left, right, n = W) => ' ' + pad(left, n - right.length - 2) + right;

// The 1-row header: `e3-ui` · breadcrumb · live pills. Context lives in each view's own title line.
function header(crumb, pills, _context) {
  const r1 = ' ' + pad('e3-ui  ' + crumb, W - pills.length - 1) + pills;
  return [pad(r1, W), rule(W)];
}

// "ELARA AI" in the ANSI-shadow block font, composed per glyph so rows align.
const GLYPH = {
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
  L: ['██╗     ', '██║     ', '██║     ', '██║     ', '███████╗', '╚══════╝'],
  A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
  I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
  ' ': ['    ', '    ', '    ', '    ', '    ', '    '],
};
function blockText(text) {
  const rows = ['', '', '', '', '', ''];
  for (const ch of text) for (let i = 0; i < 6; i++) rows[i] += GLYPH[ch][i] + (ch === ' ' ? '' : ' ');
  return rows.map(r => r.replace(/\s+$/, ''));
}
const WORDMARK = blockText('ELARA AI');

/**
 * Shell: header(3 lines incl. rule) · body · [commit bar] · [completion] · command bar · footer.
 * height counts every line; the body absorbs the remainder.
 */
function shell({ crumb, pills, context, body, commit = [], completion = [], command, footer, height = 36 }) {
  const out = [...header(crumb, pills, context)];
  const tail = [];
  if (commit.length) tail.push(...commit);
  if (completion.length) tail.push(...completion);
  tail.push(...commandBox(command));
  tail.push(pad(footer, W));
  const bodyH = height - out.length - tail.length;
  if (typeof body === 'function') body = body(bodyH);
  for (let i = 0; i < bodyH; i++) out.push(pad(body[i] ?? '', W));
  out.push(...tail);
  return out.join('\n');
}

mkdirSync(new URL('./mocks/', import.meta.url), { recursive: true });
const write = (name, text) => writeFileSync(new URL(`./mocks/${name}.txt`, import.meta.url), text + '\n');

/** The command box — a bordered single-line input, like a chat prompt but for commands only. */
function commandBox(command) {
  const inner = command.replace(/^\s*>\s?/, '');
  return [
    rule(W),
    ' › ' + pad(inner, W - 3),
    rule(W),
  ];
}
const PILLS_OK = '● CONNECTED  ';
const CMD_IDLE = ' > _                                              / commands · type a name to jump · ? help';
const FOOTER = (l, r) => lr(l, r);
/** Right-edge scrollbar: ▲ … ▼ with a thumb sized to visible/total and placed at top/total. */
function withScrollbar(lines, { total, top }) {
  const h = lines.length;
  if (total <= h) return lines.map(l => pad(l, W));
  const track = h - 2;
  const thumb = Math.max(1, Math.round(track * Math.min(1, h / total)));
  const pos = total <= h ? 0 : Math.round((track - thumb) * (top / (total - h)));
  return lines.map((l, i) => {
    const ch = i === 0 ? '▲' : i === h - 1 ? '▼' : (i - 1 >= pos && i - 1 < pos + thumb ? '█' : '│');
    return pad(l, W - 1) + ch;
  });
}

// ---------------------------------------------------------------------------
// S01 — launch (logo via terminal graphics; half-block / wordmark fallbacks)
// ---------------------------------------------------------------------------
{
  const body = [
    '', '', '', '', '', '', '', '',
    ...WORDMARK.map(l => center(l, W)),
    '',
    center('e3-ui  ·  1.0.70', W),
    '', '',
    center('opening ./demo-repo', W),
  ];
  const lines = [pad('', W), ...body];
  while (lines.length < 32) lines.push(pad('', W));
  lines.push(...commandBox('> ⠸ starting embedded e3 api server · 127.0.0.1:41823 · reading 3 workspaces'));
  lines.push(pad(' Ctrl-C abort', W));
  write('S01-launch', lines.join('\n'));
}

// ---------------------------------------------------------------------------
// S02 — refusals (each fills the body; stacked here)
// ---------------------------------------------------------------------------
{
  const block = (title, lines) => ['', center('✗  ' + title, W), '', ...lines.map(l => center(l, W)), ''];
  const body = [
    ...block('NOT AN E3 REPOSITORY', [
      './demo-repo has no objects/ packages/ executions/ workspaces/',
      '',
      'e3 repo create ./demo-repo          create one here',
      '/repo <path>                        open a different repository',
      'E3_REPO=<path>                      or set the default',
    ]),
    rule(W, '┄'),
    ...block('NOT LOGGED IN', [
      'https://e3.example.com has no saved credential',
      '',
      'e3-ui auth login https://e3.example.com        (same store as e3 auth)',
      'then   e3-ui https://e3.example.com/repos/demo',
    ]),
    rule(W, '┄'),
    ...block('SERVER UNREACHABLE', [
      'GET https://e3.example.com/api/repos — ECONNREFUSED after 4 attempts',
      '',
      'r  retry now         waits 15s and retries by itself',
    ]),
  ];
  write('S02-refusals', shell({ crumb: '', pills: 'v1.0.70  ', context: '', body, command: ' > /login https://e3.example.com_                              ⏎ run the device-flow login · esc', footer: FOOTER('q quit   /repo <path|url>   /login <url>', 'three states stacked for review; the bar pre-fills the fix'), height: 40 }));
}

// ---------------------------------------------------------------------------
// S03 — repositories view (remote origin, or a multi-repo server)
// ---------------------------------------------------------------------------
{
  const body = [
    lr('REPOSITORIES · https://e3.example.com', 'signed in as cm@elara.ai · 3 of 3'),
    '',
    ' ' + pad('NAME', 22) + pad('WORKSPACES', 14) + pad('PACKAGES', 12) + pad('OBJECTS', 12) + 'LAST DEPLOY',
    ' ' + pad('▌demo', 22) + pad('3', 14) + pad('2', 12) + pad('12,408', 12) + '3d ago · demand@1.4.2 → main',
    ' ' + pad(' forecasting', 22) + pad('1', 14) + pad('1', 12) + pad('3,102', 12) + '12d ago',
    ' ' + pad(' sandbox', 22) + pad('0', 14) + pad('0', 12) + pad('0', 12) + '—',
  ];
  write('S03-repos', shell({ crumb: 'e3.example.com', pills: PILLS_OK, context: 'https://e3.example.com · 3 repositories', body, command: CMD_IDLE, footer: FOOTER('↑↓ move   ⏎ open   /repo <name>   /login', 'q quit') }));
}

// ---------------------------------------------------------------------------
// S04 — workspaces view (first run / /workspaces)
// ---------------------------------------------------------------------------
{
  const body = [
    lr('WORKSPACES · demo-repo', '3 of 3'),
    '',
    ' ' + pad('NAME', 14) + pad('STATE', 14) + pad('PACKAGE', 22) + pad('TASKS', 30) + 'LAST RUN',
    ' ' + pad('▌main', 14) + pad('● DEPLOYED', 14) + pad('demand@1.4.2', 22) + pad('● 4  ◐ 1  ✗ 1', 30) + '✗ failed · 2m ago · 38.4s',
    ' ' + pad(' staging', 14) + pad('● DEPLOYED', 14) + pad('demand@1.5.0-rc.1', 22) + pad('○ 6 ready', 30) + '○ never run',
    ' ' + pad(' scratch', 14) + pad('○ EMPTY', 14) + pad('—', 22) + pad('—', 30) + '—',
  ];
  write('S04-workspaces', shell({ crumb: 'demo-repo', pills: PILLS_OK, context: './demo-repo · 3 workspaces · 2 packages', body, command: CMD_IDLE, footer: FOOTER('↑↓ move   ⏎ open   /workspace <name>', 'q quit') }));
}

// ---------------------------------------------------------------------------
// S05 — dashboard (the workspace view)
// ---------------------------------------------------------------------------
function dashboard({ running = false, commit = [], completion = [], command = CMD_IDLE, footer } = {}) {
  const colL = 58;
  const two = (l, r) => ' ' + pad(l, colL) + r;
  const strip = [
    two('TASKS 6', 'DATASETS 10'),
    two(pad('● up-to-date', 18) + padL('4', 4) + '   ' + pad('◐ waiting', 14) + padL('1', 4), pad('● up-to-date', 18) + padL('8', 4) + '   ' + pad('◐ stale', 12) + padL('1', 4)),
    two(pad('✗ failed', 18) + padL('1', 4) + '   ' + pad('○ ready', 14) + padL('0', 4), pad('○ unset', 18) + padL('1', 4)),
    two('▁▃▅▇▇▇  6 of 6 accounted', ''),
  ];
  const exec = running ? [
    lr('EXECUTION', '◔ RUNNING · started 12s ago · 3 of 6 tasks · ⠸'),
    '   12s  ● cached      ingest',
    '   11s  ● complete    features' + padL('4.2s', W - 34),
    '    9s  ◔ start       forecast' + padL('⠸ 9s', W - 34),
    '    9s  ◐ waiting     optimise' + padL('waiting on forecast', W - 34),
  ] : [
    lr('LAST EXECUTION', '✗ FAILED · started 2m ago · 38.4s · executed 4 · cached 1 · failed 1 · skipped 0'),
    '    1m  ✗ failed      report' + padL('exit 2 · 0.8s     ⏎ logs', W - 32),
  ];
  const t = (sel, name, status, deps, inputs, out) => ' ' + (sel ? '▌' : ' ') + pad(name, 12) + pad(status, 20) + pad(deps, 20) + pad(inputs, 18) + pad(out, 26) + '';
  const tasks = [
    lr('TASKS', ''),
    ' ' + pad(' NAME', 13) + pad('STATUS', 20) + pad('DEPENDS ON', 20) + pad('INPUTS', 18) + pad('OUTPUT', 26) + 'SIZE · LAST RUN',
    t(false, 'ingest', '● up-to-date', '—', 'sales, calendar', 'Array<Struct>') + '12.1 MB · 3.1s',
    t(false, 'features', '● up-to-date', 'ingest', 'params', 'Struct') + '412.6 MB · 12.0s',
    t(true, 'forecast', running ? '◔ in-progress' : '● up-to-date', 'features', '—', 'Dict<String, Struct>') + (running ? '⠸ 9s' : '84.2 MB · 38.4s'),
    t(false, 'optimise', '◐ waiting', 'forecast', 'overrides', 'Array<Struct>') + '— · waiting on forecast',
    t(false, 'report', '✗ failed · exit 2', 'forecast, optimise', '—', 'String') + '— · 0.8s',
    t(false, 'dashboard', '○ ready', '—', 'sales', 'UIComponentType') + '41 KB · never',
  ];
  const d = (name, status, type, size, hash) => '  ' + pad(name, 14) + pad(status, 16) + pad(type, 26) + pad(size, 10) + hash;
  const inputs = [
    lr('INPUTS', ''),
    ' ' + pad(' NAME', 15) + pad('STATUS', 16) + pad('TYPE', 26) + pad('SIZE', 10) + 'HASH',
    d('sales', '● up-to-date', 'Array<Struct>', '9.8 MB', '9f3c1a7e2b41'),
    d('calendar', '● up-to-date', 'Array<Struct>', '2.1 KB', '5b0e88a1c3d7'),
    d('params', '◐ stale', 'Struct', '1.2 KB', '0a44e1b7c9d2'),
    d('overrides', '○ unset', 'Dict<String, Float>', '—', '—'),
  ];
  const body = [lr('main', '● DEPLOYED · demand@1.4.2 · deployed 3d ago · lock: none'), ...strip, '', ...exec, '', ...tasks, '', ...inputs];
  const pills = running ? '◔ RUNNING 3/6  ● CONNECTED  ' : PILLS_OK;
  const context = 'main · demand@1.4.2 · deployed 3d ago · lock: none';
  return shell({
    crumb: 'demo-repo › main', pills, context, body, commit, completion, command,
    footer: footer ?? FOOTER('↑↓ move   ⏎ open   r run   x stop   w workspaces   / commands', 'polled 0.4s ago'),
  });
}
write('S05-dashboard', dashboard({}));
write('S06-dashboard-running', dashboard({ running: true, footer: FOOTER('↑↓ move   ⏎ open   x stop   / commands', 'polled 0.2s ago') }));

// S06b — run confirmation lives IN the command bar (no dialog)
write('S06b-run-confirm', dashboard({
  command: ' > /run --force_                       run 6 tasks in main, ignoring the cache · concurrency 4      ⏎ run · esc',
  footer: FOOTER('--force  re-run everything    --filter <glob>  only matching tasks    --concurrency <n>', ''),
}));

// S07 — command completion (fzf-style list grows upward from the bar)
{
  const completion = [
    ' ' + pad('  /task', 12) + pad('forecast', 14) + pad('● up-to-date', 18) + pad('Dict<String, Struct>', 24) + '84.2 MB · 38.4s',
    ' ' + pad('▌ /task', 12) + pad('forecast_v2', 14) + pad('○ ready', 18) + pad('Dict<String, Struct>', 24) + '—',
    ' ' + pad('  /task', 12) + pad('features', 14) + pad('● up-to-date', 18) + pad('Struct', 24) + '412.6 MB · 12.0s',
    ' ' + pad('  /input', 12) + pad('overrides', 14) + pad('○ unset', 18) + pad('Dict<String, Float>', 24) + '—',
  ];
  write('S07-command-completion', dashboard({
    completion,
    command: ' > /task fore_                                                  4 matches · ↑↓ pick · ⏎ open · tab complete',
    footer: FOOTER('/task /input /workspace /run /stop /logs /runs /find /goto /save /repo /help /quit', ''),
  }));
}

// S07b — plain typing = fuzzy jump across everything
{
  const completion = [
    ' ' + pad('▌ task', 12) + pad('forecast', 16) + pad('main', 10) + '● up-to-date · Dict<String, Struct> · 84.2 MB',
    ' ' + pad('  task', 12) + pad('forecast_v2', 16) + pad('staging', 10) + '○ ready',
    ' ' + pad('  dataset', 12) + pad('.tasks.forecast.output', 16) + pad('main', 10) + '● up-to-date · 84.2 MB',
  ];
  write('S07b-fuzzy-jump', dashboard({
    completion,
    command: ' > forc_                                                        3 matches · ↑↓ pick · ⏎ open · esc',
    footer: FOOTER('type to jump anywhere · / for commands', ''),
  }));
}

// ---------------------------------------------------------------------------
// S08 — task view · Output (paged value tree + scrollbar)
// ---------------------------------------------------------------------------
function taskShell({ tab = 'Output', body, command = CMD_IDLE, footer, running = false, commit = [] }) {
  const tabs = ['Output', 'Logs', 'Runs'].map((t, i) => (t === tab ? `▌${i + 1} ${t}▐` : ` ${i + 1} ${t} `)).join(' ');
  const head = [
    lr('forecast   ' + tabs, 'DATA TASK · ● UP-TO-DATE · cached · 38.4s · inputs 4be1…a9'),
    lr('.tasks.forecast.output · Dict<String, Struct> · 1,240,000 entries · 84.2 MB · c71e0d92aa10', ''),
    rule(W, '┄'),
  ];
  return shell({
    crumb: 'demo-repo › main › forecast', pills: running ? '◔ RUNNING 3/6  ● CONNECTED  ' : PILLS_OK,
    context: '',
    body: (h) => [...head, ...(typeof body === 'function' ? body(h - head.length) : body)], command, footer, commit,
  });
}
{
  const LW = 44;
  const row = (depth, twist, label, value, sel = false) => (sel ? '▌' : ' ') + pad('  '.repeat(depth) + twist + ' ' + label, LW) + pad(value, W - LW - 2);
  const rows = [
    row(0, '▾', 'k0148', 'Bakery · 2025-09-01 · 1,204'),
    row(1, '·', 'Store', '"Bakery"'),
    row(1, '·', 'Day', '2025-09-01 00:00:00'),
    row(1, '·', 'Units', '1,204'),
    row(1, '▸', 'Forecast', '3 fields'),
    row(0, '▾', 'k0149', 'Bakery · 2025-09-02 · 1,190', true),
    row(1, '·', 'Store', '"Bakery"'),
    row(1, '·', 'Day', '2025-09-02 00:00:00'),
    row(1, '·', 'Units', '1,190'),
    row(1, '▾', 'Forecast', 'Point · 1,201.4 · 0.91'),
    row(2, '·', 'Kind', 'Point'),
    row(2, '·', 'Mean', '1,201.4'),
    row(2, '·', 'Confidence', '0.91'),
    row(0, '▸', 'k0150', 'Bakery · 2025-09-03 · 1,233'),
    row(0, '▸', 'k0151', 'Bakery · 2025-09-04 · 1,240'),
    row(0, '▸', 'k0152', 'Bakery · 2025-09-05 · 1,198'),
    row(0, '░', '░░░░░░░░░░░░░░░░░░░░░░░░░░', '░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   loading p24'),
    row(0, '░', '░░░░░░░░░░░░░░░░░░░░░░░░░░', '░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░'),
    row(0, '░', '░░░░░░░░░░░░░░░░░░░░░░░░░░', '░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░'),
    row(0, '░', '░░░░░░░░░░░░░░░░░░░░░░░░░░', '░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░'),
    row(0, '░', '░░░░░░░░░░░░░░░░░░░░░░░░░░', '░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░'),
    row(0, '░', '░░░░░░░░░░░░░░░░░░░░░░░░░░', '░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░'),
  ];
  const body = (h) => {
    const n = h - 1;
    const r = rows.slice(0, n);
    while (r.length < n) r.push(row(0, '░', '░░░░░░░░░░░░░░░░░░░░░░░░░░', '░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░'));
    return [
      ...withScrollbar(r, { total: 1_240_000 + 8, top: 12_000 }),
      lr(`rows 12,001–${(12_000 + n).toLocaleString()} of 1,240,000 · 0.97% · p24 ▒ loading`, '▾ expand all  ▸ collapse all  s save .beast2'),
    ];
  };
  write('S08-task-output', taskShell({
    body,
    footer: FOOTER('↑↓ move   → expand   ← collapse   pgup pgdn   /find <key>   /goto <row|%>   s save   2 logs   3 runs', 'wheel · drag ▮'),
  }));
}

// S08b — /find and /goto in the command bar (the tree stays put)
{
  const LW = 44;
  const row = (depth, twist, label, value, sel = false) => (sel ? '▌' : ' ') + pad('  '.repeat(depth) + twist + ' ' + label, LW) + pad(value, W - LW - 2);
  const rows = [
    row(0, '▸', 'k0148', 'Bakery · 2025-09-01 · 1,204'),
    row(0, '▸', 'k0149', 'Bakery · 2025-09-02 · 1,190'),
    row(0, '▸', 'k0150', 'Bakery · 2025-09-03 · 1,233', true),
    row(0, '▸', 'k0151', 'Bakery · 2025-09-04 · 1,240'),
  ];
  const body = (h) => [...withScrollbar([...rows, ...Array(h - 1 - rows.length).fill('')], { total: 1_240_000, top: 12_002 }), lr('rows 12,003–12,006 of 1,240,000 · match held until esc', '')];
  write('S08b-find-goto', taskShell({
    body,
    command: ' > /find k015_                          prefix · 4 matches from row 12,003 · ⏎ jump · n N next/prev · esc',
    footer: FOOTER('/find "k0150"  exact    /find k015  prefix    /find Bakery|2025-09  struct-key fields    /goto 620000  /goto 50%', ''),
  }));
}

// ---------------------------------------------------------------------------
// S09 — output states
// ---------------------------------------------------------------------------
{
  const c = s => center(s, W);
  const body = [
    '', c('○  NO OUTPUT YET'), c('dashboard has not produced a value'), c('r  run the dataflow'), '',
    rule(W, '┄'),
    '', c('◐  TOO LARGE TO SHOW INLINE'), c('features · Struct · 412.6 MB — not a collection, so it cannot be paged'), c('s  save to features.beast2        e3 dataset get main.features'), '',
    rule(W, '┄'),
    '', c('◐  NOT INDEXED'), c('ingest · this value predates paged storage (dataset_not_indexed)'), c('re-run the producing task to re-write it    s save    ⏎ load whole value (18.2 MB)'), '',
  ];
  write('S09-output-states', taskShell({ body, footer: FOOTER('three states stacked for review — each fills the body', '') }));
}

// ---------------------------------------------------------------------------
// S10 — logs
// ---------------------------------------------------------------------------
{
  const ln = (n, text) => ' ' + padL(String(n), 5) + '  ' + pad(text, W - 10);
  const logLines = [
    ln(1190, '[info] starting task forecast (attempt 1)'),
    ln(1191, '[info] runner: east-c · concurrency 4 · timeout 600s'),
    ln(1192, '[info] e3 runner east-c 1.0.70 · task forecast · inputs 4be1…a9'),
    ln(1193, '[info] reading .inputs.params (hash 0a44…) · 1.2 KB'),
    ln(1194, '[info] horizon 14 · seasonality weekly · smoothing 0.35 · min_confidence 0.5'),
    ln(1195, '[info] stores: Bakery, Deli, Produce'),
    ln(1196, '[info] calendar: 2025-09-01 → 2025-12-31 · 12 holidays'),
    ln(1197, '[info] allocating 1,240,000 rows'),
    ln(1198, '[info] decoding .tasks.features.output segment 1/168'),
    ln(1199, '[info] decoding .tasks.features.output segment 42/168'),
    ln(1200, '[info] decoding .tasks.features.output segment 84/168'),
    ln(1201, '[info] decoding .tasks.features.output segment 126/168'),
    ln(1202, '[info] decoding .tasks.features.output segment 168/168'),
    ln(1203, '[info] features ready · 84.2 MB · 2.9s'),
    ln(1204, '[info] loading features from .tasks.features.output (hash 0a44…)'),
    ln(1205, '[info] 1,240,000 rows · 84.2 MB'),
    ln(1206, '[info] fitting model: horizon=14 seasonality=weekly'),
    ln(1207, '[warn] store "Deli" has 3 missing days — interpolated'),
    ln(1208, '[info] epoch 1/5  loss 0.412'),
    ln(1209, '[info] epoch 2/5  loss 0.301'),
    ln(1210, '[info] epoch 3/5  loss 0.276'),
    ln(1211, '[warn] store "Deli" forecast confidence below 0.5 for 2025-09-07'),
    ln(1212, '[info] epoch 4/5  loss 0.262'),
    ln(1213, '[info] epoch 5/5  loss 0.259'),
    ln(1214, '[info] writing .tasks.forecast.output'),
    ln(1215, '[info] done in 38.4s'),
  ];
  const body = (h) => {
    const n = h - 2;
    const tail = logLines.slice(-n);
    return [
      lr('stdout ▾   stderr (12)', '1,215 lines · 96 KB · ● live · following'),
      ...withScrollbar(tail, { total: 1215, top: 1215 - n }),
      lr(`lines ${(1216 - n).toLocaleString()}–1,215 of 1,215 · at end`, '↑ scroll up pauses follow · F resumes'),
    ];
  };
  write('S10-task-logs', taskShell({
    tab: 'Logs', body,
    command: ' > /find Deli_                                        2 of 2 · n N next/prev · ⏎ hold · esc',
    footer: FOOTER('↑↓ scroll   G end   F follow ● on   o stdout  e stderr   s save   c copy   1 output   3 runs', 'polled 1s ago'),
  }));
}

// ---------------------------------------------------------------------------
// S11 — runs
// ---------------------------------------------------------------------------
{
  const r = (sel, status, started, dur, exit, hash, note = '') => ' ' + (sel ? '▌' : ' ') + pad(status, 12) + pad(started, 22) + pad(dur, 10) + pad(exit, 6) + pad(hash, 14) + note;
  const body = [
    ' ' + pad(' STATUS', 13) + pad('STARTED', 22) + pad('DURATION', 10) + pad('EXIT', 6) + pad('INPUTS', 14) + '',
    r(true, '● success', '2026-09-08 11:42:10', '38.4s', '0', '4be1…a9', '← current'),
    r(false, '● success', '2026-09-08 09:12:44', '37.9s', '0', '4be1…a9'),
    r(false, '✗ failed', '2026-09-07 18:03:21', '2.1s', '2', '1c07…3f'),
    r(false, '● success', '2026-09-07 17:55:02', '39.0s', '0', '1c07…3f'),
    r(false, '◐ error', '2026-09-06 08:00:00', '—', '—', 'e0d2…77', 'runner exited early'),
    r(false, '● success', '2026-09-05 08:00:00', '41.2s', '0', 'e0d2…77'),
    r(false, '● success', '2026-09-04 08:00:00', '40.7s', '0', '90aa…c1'),
    '',
    ' ▪ 4be1…a9 = sha256 of the inputs (.tasks.features.output 0a44…, params 7be2…) · ⏎ expands the list',
  ];
  write('S11-task-runs', taskShell({ tab: 'Runs', body, footer: FOOTER('↑↓ move   ⏎ inputs   1 output   2 logs', '7 executions') }));
}

// ---------------------------------------------------------------------------
// S12 — input view · editing · commit bar
// ---------------------------------------------------------------------------
{
  const LW = 44;
  const VW = W - LW - 2;
  const row = (depth, twist, label, value, mark = ' ') => mark + pad('  '.repeat(depth) + twist + ' ' + label, LW) + pad(value, VW);
  const rows = [
    row(0, '·', 'Horizon days', '14'),
    row(0, '·', 'Seasonality', pad('Weekly', VW - 12) + 't tag ▾'),
    row(0, '·', 'Smoothing', pad('0.35', VW - 12) + 'edited', '┆'),
    row(0, '·', 'Min confidence', pad('0.5_', VW - 24) + '⏎ apply · esc cancel', '▌'),
    row(0, '▾', 'Stores', '3 items'),
    row(1, '·', 'Item 1', '"Bakery"'),
    row(1, '·', 'Item 2', '"Deli"'),
    row(1, '·', 'Item 3', '"Produce"'),
    row(1, '+', 'Add item', ''),
    row(0, '▸', 'Holidays', '12 entries'),
    row(0, '·', 'Notes', pad('Not set', VW - 12) + 't set'),
  ];
  const body = [
    lr('params   ▌Value▐', 'INPUT · ◐ STALE · read by features, forecast'),
    lr('.inputs.params · Struct · 1.2 KB · 0a44e1b7c9d2', ''),
    rule(W, '┄'),
    ...rows.map(r => pad(r, W)),
  ];
  const commit = [
    rule(W, '┄'),
    lr('◆ 2 changes pending   smoothing · min_confidence', '⏎ APPLY     esc DISCARD'),
  ];
  write('S12-input-edit', shell({
    crumb: 'demo-repo › main › params', pills: '◆ 2 DIRTY  ● CONNECTED  ',
    context: 'main · .inputs.params · Struct · read by features, forecast',
    body, commit,
    command: ' > _',
    footer: FOOTER('e edit   a add   x remove   t tag/set   ↑↓ move   → ←   ⏎ apply all   esc discard', 'dirty'),
  }));

  const body2 = body.slice();
  body2.splice(1, 0, lr('◐ CHANGED ON THE SERVER while you were editing · 0a44… → 7be2…', '⏎ reload and re-apply · esc keep editing'));
  write('S12b-input-conflict', shell({
    crumb: 'demo-repo › main › params', pills: '◆ 2 DIRTY  ● CONNECTED  ',
    context: 'main · .inputs.params · Struct · read by features, forecast',
    body: body2, commit, command: ' > _', footer: FOOTER('', 'dirty'),
  }));
}

// ---------------------------------------------------------------------------
// S13 — help (a full view, not an overlay)
// ---------------------------------------------------------------------------
{
  const col = (a, b, c) => ' ' + pad(a, 40) + pad(b, 40) + c;
  const body = [
    lr('HELP', 'esc back'),
    '',
    col('COMMANDS', 'KEYS · EVERYWHERE', 'KEYS · VALUE TREE'),
    col('/task <name>       open a task', '?  help          q  quit', '↑↓ j k  move        → l  expand'),
    col('/input <name>      open an input', 'esc  back        ⌫  back', '← h  collapse       ⏎  toggle'),
    col('/workspace <name>  switch workspace', 'tab ⇧tab  next/prev pane', '⇧←  collapse subtree'),
    col('/run [--force] [--filter g]  run', '1 2 3  tabs', 'pgup pgdn ^u ^d  page'),
    col('/stop              cancel the dataflow', 'r  run    x  stop', 'gg G  top / bottom'),
    col('/logs <task> [stderr]', 'w  workspaces', 's  save .beast2'),
    col('/runs <task>', 'R  refresh now', ''),
    col('/find <key|prefix|f1|f2>  jump to key', '', 'KEYS · INPUTS'),
    col('/goto <row|N%>', 'MOUSE', 'e  edit   a  add   x  remove'),
    col('/save [file]       write .beast2', 'wheel  scroll     click  select', 't  tag / set / clear'),
    col('/repo <path|url>   open another repo', 'click ▸  toggle   drag ▮  scrollbar', '⏎  apply all   esc  discard'),
    col('/about             version · server · logo', 'click tab / crumb / pill', ''),
    col('/quit', '', 'KEYS · LOGS'),
    col('', '', 'F  follow   o  stdout   e  stderr'),
    col('typing without / fuzzy-jumps anywhere', '', 'n N  next / prev match   c  copy'),
  ];
  write('S13-help', shell({ crumb: 'demo-repo › main', pills: PILLS_OK, context: 'help', body, command: CMD_IDLE, footer: FOOTER('', '') }));
}

// ---------------------------------------------------------------------------
// S14 — about (logo image · version · server · session)
// ---------------------------------------------------------------------------
{
  const body = [
    '',
    ...WORDMARK.map(l => '   ' + l),
    '',
    '   e3-ui 1.0.70',
    '',
    '   server     embedded @elaraai/e3-api-server 1.0.70 · http://127.0.0.1:41823 · repo default',
    '   repository ./demo-repo · 12,408 objects · 2 packages · 3 workspaces',
    '   terminal   kitty 0.36 · 120×36 · truecolor · graphics ● · mouse ● · kitty keyboard ●',
    '   state      ~/.local/state/e3-ui/state.json',
    '   licence    AGPL-3.0-or-later · commercial licence available',
  ];
  write('S14-about', shell({ crumb: 'demo-repo › main', pills: PILLS_OK, context: 'about', body, command: CMD_IDLE, footer: FOOTER('esc back', '') }));
}

// ---------------------------------------------------------------------------
// S15 — narrow (80 cols) — same shell, tighter tables; below 60 cols: refuse
// ---------------------------------------------------------------------------
{
  const W80 = 80;
  const p = (s, n) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
  const l80 = (l, r) => ' ' + p(l, W80 - r.length - 2) + r;
  const lines = [
    ' ' + p('e3-ui  demo-repo › main › forecast', W80 - 15) + '● CONNECTED  ',
    rule(W80),
    l80('forecast   ▌1 Output▐  2 Logs   3 Runs', '● UP-TO-DATE'),
    rule(W80, '┄'),
    p(' ▾ k0148                     Bakery · 2025-09-01 · 1,204', W80 - 1) + '▲',
    p('   · Store                   "Bakery"', W80 - 1) + '█',
    p('   · Day                     2025-09-01 00:00:00', W80 - 1) + '│',
    p('▌▾ k0149                     Bakery · 2025-09-02 · 1,190', W80 - 1) + '│',
    p('   · Store                   "Bakery"', W80 - 1) + '▼',
    l80('rows 12,001–12,005 of 1,240,000', 's save'),
    rule(W80),
    ' › ' + p('_                       / commands · ? help', W80 - 3),
    rule(W80),
    l80('↑↓ → ←   pgup pgdn   /find   /goto', ''),
    '',
    center('below 60×16 the app refuses: "terminal too small (58×14) — need 60×16"', W80),
  ];
  write('S15-narrow-80', lines.join('\n'));
}

// ---------------------------------------------------------------------------
// S16 — non-TTY and --help
// ---------------------------------------------------------------------------
{
  const text = `$ e3-ui | cat
e3-ui: interactive terminal required (stdout is not a TTY).
  scripts: e3 workspace status <repo> <ws> · e3 dataset get <repo> <ws.name> -f json
  help:    e3-ui --help
(exit 1)

$ e3-ui --help
Usage: e3-ui [options] [command] [repo] [workspace]

Browse an e3 repository in the terminal: workspaces, dataflow, task outputs, logs and editable inputs.

Arguments:
  repo                 local path · https://host/repos/<repo> · https://host (repo list)  (default: $E3_REPO or ".")
  workspace            workspace to open (default: last used, else the only one, else the list)

Options:
  -V, --version        output the version number
  -t, --task <name>    open a task on start
  -i, --input <name>   open an input on start
  --no-mouse           disable mouse reporting
  --ascii              box-drawing off (also E3_UI_ASCII=1) · colour honours NO_COLOR / FORCE_COLOR
  -h, --help           display help for command

Commands:
  auth                 login / logout / status / token / whoami — same store as \`e3 auth\` (~/.e3/credentials.json)
  shot [options]       Render an east-ui / e3-ui component to a PNG (unchanged)
  shots [options] [paths...]
  install-browser [options]
  doctor`;
  write('S16-non-tty-and-help', text);
}

// ---------------------------------------------------------------------------
// S17 — a kind:'ui' task is just a dataset (value tree) + a Reads tab
// ---------------------------------------------------------------------------
{
  const LW = 44;
  const row = (depth, twist, label, value, sel = false) => (sel ? '▌' : ' ') + pad('  '.repeat(depth) + twist + ' ' + label, LW) + pad(value, W - LW - 2);
  const rows = [
    row(0, '▾', 'Value', 'App'),
    row(1, '·', 'Title', '"Demand planner"'),
    row(1, '▸', 'Rail', 'NavList'),
    row(1, '▾', 'Body', 'ReactiveComponent', true),
    row(2, '·', 'Render', '[function]'),
    row(1, '▸', 'Bar end', '2 items'),
    row(1, '·', 'Nav key', '"planner"'),
  ];
  const tabs = '▌1 Output▐  2 Logs   3 Runs   4 Reads ';
  const body = [
    lr('dashboard   ' + tabs, 'UI TASK · ● UP-TO-DATE · manifest: 3 reads · 1 function'),
    lr('.tasks.dashboard.output · UIComponentType · 41 KB · 3e91…', ''),
    rule(W, '┄'),
    ...rows.map(r => pad(r, W)),
    '',
    lr('Reads: .inputs.sales · .inputs.params · .tasks.forecast.output', '⏎ open · o render PNG (later)'),
  ];
  write('S17-ui-task-output', shell({
    crumb: 'demo-repo › main › dashboard', pills: PILLS_OK,
    context: 'main · .tasks.dashboard.output · UIComponentType · 41 KB · 3e91…',
    body, command: CMD_IDLE, footer: FOOTER('↑↓ move   → expand   1 2 3 4 tabs', ''),
  }));
}

// ---------------------------------------------------------------------------
// S18 — reconnecting + a one-line toast (no boxes)
// ---------------------------------------------------------------------------
{
  const d = dashboard({ command: ' ● Dataflow started · main · 6 tasks queued                                                         (toast, 3s)' });
  const lines = d.split('\n');
  lines[0] = ' ' + pad('e3-ui  demo-repo › main', W - '◐ RECONNECTING 3/4  '.length - 1) + '◐ RECONNECTING 3/4  ';
  write('S18-toast-reconnect', lines.join('\n'));
}

console.log('mocks written to docs/tui/mocks/');
