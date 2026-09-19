// PROBE (scratch branch only), round 2: an east-node partition unit hangs on
// Windows now and then, with or without the job launcher. What is the stuck
// runner doing? Each runner is preloaded with a watchdog (probe-watchdog.cjs)
// that, 20 s in, records a marker, its active resources and a diagnostic
// report; on a stall this driver adds the runner's output file, thread states
// and, when cdb is installed, every thread's native stack. Then the same test
// with the stdin lifeline off.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const TRACE = join(tmpdir(), `e3-probe-trace-${Date.now()}.log`);
writeFileSync(TRACE, '');
const REPORTS = mkdtempSync(join(tmpdir(), 'e3-probe-reports-'));
const WATCHDOG = resolve('probe-watchdog.cjs');
const log = (...a) => console.log(new Date().toISOString(), ...a);

const CDB = [
  'C:\\Program Files (x86)\\Windows Kits\\10\\Debuggers\\x64\\cdb.exe',
  'C:\\Program Files\\Windows Kits\\10\\Debuggers\\x64\\cdb.exe',
].find((p) => existsSync(p));
log(`cdb: ${CDB ?? 'not installed'}`);

function ps(command) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', maxBuffer: 256 << 20 });
  return r.stdout;
}

function processes() {
  try {
    return JSON.parse(ps('Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'));
  } catch { return []; }
}

function summarizeReport(file) {
  try {
    const r = JSON.parse(readFileSync(file, 'utf8'));
    const handles = (r.libuv ?? []).filter((h) => h.is_active || h.is_referenced)
      .map((h) => `${h.type}${h.is_referenced ? '' : '(unref)'}${h.is_active ? '' : '(inactive)'} ${JSON.stringify(Object.fromEntries(Object.entries(h).filter(([k]) => !['type', 'is_active', 'is_referenced', 'address'].includes(k))))}`);
    const workers = (r.workers ?? []).map((w, i) => `worker ${i}: js ${JSON.stringify(w.javascriptStack?.message)} handles ${JSON.stringify((w.libuv ?? []).map((h) => `${h.type}${h.is_active ? '' : '(inactive)'}`))}`);
    return [`event ${r.header?.event} trigger ${r.header?.trigger}`, `js: ${r.javascriptStack?.message} ${JSON.stringify((r.javascriptStack?.stack ?? []).slice(0, 8))}`,
      `native: ${JSON.stringify((r.nativeStack ?? []).slice(0, 12).map((f) => f.symbol))}`, ...handles.map((h) => `  handle ${h}`), ...workers].join('\n      ');
  } catch (e) { return `(unreadable report: ${e.message})`; }
}

function dump(rootPid, label) {
  log(`===== STALL: ${label} — process tree under ${rootPid} =====`);
  const all = processes();
  const kids = new Map();
  for (const p of all) {
    if (!kids.has(p.ParentProcessId)) kids.set(p.ParentProcessId, []);
    kids.get(p.ParentProcessId).push(p);
  }
  const tree = [];
  const walk = (pid, depth) => {
    for (const c of kids.get(pid) ?? []) {
      tree.push(c);
      console.log(`${'  '.repeat(depth)}${c.ProcessId} ${c.Name} ${(c.CommandLine ?? '').slice(0, 200)}`);
      walk(c.ProcessId, depth + 1);
    }
  };
  walk(rootPid, 1);
  for (const p of tree) {
    const cmdline = p.CommandLine ?? '';
    if (!/east-node\.mjs/.test(cmdline)) continue;
    log(`----- stuck runner ${p.ProcessId}: ${cmdline}`);
    const out = /"-o" "([^"]+)"/.exec(cmdline)?.[1];
    console.log(`  output ${out}: ${out && existsSync(out) ? `written, ${statSync(out).size} bytes` : 'MISSING'}`);
    const mine = readdirSync(REPORTS).filter((f) => f.includes(`-${p.ProcessId}-`)).sort();
    if (!mine.some((f) => f === `marker-${p.ProcessId}-0.txt`)) console.log('  main thread: NO watchdog marker — its timer never fired');
    for (const f of mine) {
      console.log(`  ${f}: ${f.endsWith('.json') ? summarizeReport(join(REPORTS, f)) : readFileSync(join(REPORTS, f), 'utf8')}`);
    }
    console.log(`  threads: ${ps(`(Get-Process -Id ${p.ProcessId}).Threads | ForEach-Object { \"$($_.Id) $($_.ThreadState) $($_.WaitReason) cpu=$([int]$_.TotalProcessorTime.TotalMilliseconds)ms\" }`).trim().split(/\r?\n/).join(' | ')}`);
    const cpu1 = ps(`(Get-Process -Id ${p.ProcessId}).TotalProcessorTime.TotalMilliseconds`).trim();
    spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 2000)']);
    const cpu2 = ps(`(Get-Process -Id ${p.ProcessId}).TotalProcessorTime.TotalMilliseconds`).trim();
    console.log(`  cpu over 2 s: ${cpu1} -> ${cpu2} ms`);
    if (CDB) {
      const r = spawnSync(CDB, ['-pv', '-p', String(p.ProcessId), '-y', 'srv*C:\\symbols*https://msdl.microsoft.com/download/symbols', '-c', '~*k 25; q'],
        { encoding: 'utf8', timeout: 180_000, maxBuffer: 64 << 20 });
      console.log(`  cdb (status ${r.status}):\n${(r.stdout ?? '').split(/\r?\n/).filter((l) => /^\s*[#.]?\s*\d+\s+Id:|^[0-9a-f]{2} [0-9a-f`]+ [0-9a-f`]+ |ntdll|KERNEL|node|uv_|Wait|Read|Sleep|Critical/i.test(l)).slice(0, 400).join('\n')}`);
    }
  }
  const runnerPids = tree.filter((p) => /east-node\.mjs/.test(p.CommandLine ?? '')).map((p) => p.ProcessId);
  const specReports = readdirSync(REPORTS).filter((f) => f.startsWith('report-') && !runnerPids.some((pid) => f.startsWith(`report-${pid}-`)));
  for (const f of specReports) console.log(`  spec-side report ${f}: ${summarizeReport(join(REPORTS, f))}`);
}

function killTree(pid) {
  spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
}

async function runBounded(label, args, ms, extraEnv) {
  const env = { ...process.env, E3_PROBE_TRACE: TRACE, E3_PROBE_REPORTS: REPORTS, NODE_OPTIONS: `--require ${WATCHDOG}`, ...extraEnv };
  const child = spawn(process.execPath, args, { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const done = new Promise((res) => child.on('close', (code) => res(code)));
  const started = Date.now();
  const r = await Promise.race([done, new Promise((res) => setTimeout(() => res('TIMEOUT'), ms))]);
  if (r === 'TIMEOUT') {
    log(`${label}: STALLED after ${ms} ms`);
    dump(child.pid, label);
    killTree(child.pid);
    await Promise.race([done, new Promise((res) => setTimeout(res, 10_000))]);
    return 'stalled';
  }
  log(`${label}: exit ${r} in ${Date.now() - started} ms ${out.split('\n').filter((l) => /✔|✖/.test(l)).slice(-2).join(' ')}`);
  return r === 0 ? 'passed' : 'failed';
}

const TEST7 = 'merges colliding keyed partials on the task runner through a merge tree, logging every unit';
const test7 = ['--test', '--test-reporter=spec', `--test-name-pattern=${TEST7}`, 'dist/src/execution/partitionExec.spec.js'];
const results = {};
const phase = async (name, fn) => { log(`########## ${name}`); results[name] = await fn(); log(`########## ${name}: ${JSON.stringify(results[name])}`); };

await phase('A test7 with the lifeline', async () => {
  const r = [];
  for (let i = 0; i < 6; i++) r.push(await runBounded(`A${i}`, test7, 120_000, {}));
  return r;
});
await phase('E test7 without the lifeline', async () => {
  const r = [];
  for (let i = 0; i < 6; i++) r.push(await runBounded(`E${i}`, test7, 120_000, { E3_PROBE_NO_LIFELINE: '1' }));
  return r;
});

log('RESULTS ' + JSON.stringify(results, null, 2));
process.exit(0);
