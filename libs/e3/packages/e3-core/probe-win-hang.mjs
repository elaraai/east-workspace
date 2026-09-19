// PROBE (scratch branch only): where does partitionExec's first east-node test
// hang on Windows? Runs the test with and without the job launcher, and
// east-node runners directly through spawnAndCapture, dumping the process tree
// and the spawn trace whenever something stalls.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { East, IntegerType, encodeEastIR } from '@elaraai/east';
import { spawnAndCapture, jobLauncher } from './dist/src/execution/processExec.js';

const TRACE = join(tmpdir(), `e3-probe-trace-${Date.now()}.log`);
writeFileSync(TRACE, '');
process.env.E3_PROBE_TRACE = TRACE;
let traceShown = 0;
const log = (...a) => console.log(new Date().toISOString(), ...a);

function processes() {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,CreationDate | ConvertTo-Json -Compress'],
  { encoding: 'utf8', maxBuffer: 256 << 20 });
  try { return JSON.parse(r.stdout); } catch { return []; }
}

function dump(rootPid, label) {
  log(`===== STALL: ${label} — process tree under ${rootPid} =====`);
  const all = processes();
  const kids = new Map();
  for (const p of all) {
    if (!kids.has(p.ParentProcessId)) kids.set(p.ParentProcessId, []);
    kids.get(p.ParentProcessId).push(p);
  }
  const walk = (pid, depth, seen) => {
    for (const c of kids.get(pid) ?? []) {
      if (seen.has(c.ProcessId)) continue;
      seen.add(c.ProcessId);
      console.log(`${'  '.repeat(depth)}${c.ProcessId} ${c.Name} ${(c.CommandLine ?? '').slice(0, 400)}`);
      walk(c.ProcessId, depth + 1, seen);
    }
  };
  walk(rootPid, 1, new Set());
  log('----- every node/cmd/e3-job/bash/conhost process system-wide -----');
  for (const p of all) {
    if (/^(node|cmd|e3-job|bash|conhost|sh)\.exe$/i.test(p.Name)) {
      console.log(`  ${p.ProcessId} (parent ${p.ParentProcessId}) ${p.Name} ${(p.CommandLine ?? '').slice(0, 300)}`);
    }
  }
  const trace = readFileSync(TRACE, 'utf8').split('\n');
  log(`----- spawn trace (new lines since the last dump: ${trace.length - traceShown}) -----`);
  console.log(trace.slice(Math.max(0, traceShown - 20)).join('\n'));
  traceShown = trace.length;
}

function killTree(pid) {
  spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
}

/** Runs node with args in the e3-core dir, bounded; dumps and kills on a stall. */
async function runBounded(label, args, ms) {
  const child = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const done = new Promise((res) => child.on('close', (code) => res(code)));
  const timer = new Promise((res) => setTimeout(() => res('TIMEOUT'), ms));
  const started = Date.now();
  const r = await Promise.race([done, timer]);
  if (r === 'TIMEOUT') {
    log(`${label}: STALLED after ${ms} ms; output so far:`);
    console.log(out.split('\n').slice(-40).join('\n'));
    dump(child.pid, label);
    killTree(child.pid);
    await Promise.race([done, new Promise((res) => setTimeout(res, 10_000))]);
    return 'stalled';
  }
  const tail = out.split('\n').filter((l) => /✔|✖|ℹ (pass|fail)|not ok|Error/.test(l)).slice(-12).join('\n');
  log(`${label}: exit ${r} in ${Date.now() - started} ms\n${tail}`);
  return r === 0 ? 'passed' : 'failed';
}

const TEST7 = 'merges colliding keyed partials on the task runner through a merge tree, logging every unit';
const launcherPackage = resolve('../../../../node_modules/@elaraai/e3-job-win32-x64');
log(`launcher: ${jobLauncher()} (package dir ${launcherPackage}, exists ${existsSync(launcherPackage)})`);

const results = {};
const phase = async (name, fn) => { log(`########## ${name}`); results[name] = await fn(); log(`########## ${name}: ${JSON.stringify(results[name])}`); };

// A: the hanging test, with the launcher, four times.
await phase('A test7 with launcher', async () => {
  const r = [];
  for (let i = 0; i < 4; i++) r.push(await runBounded(`A${i}`, ['--test', '--test-reporter=spec', `--test-name-pattern=${TEST7}`, 'dist/src/execution/partitionExec.spec.js'], 150_000));
  return r;
});

// B: the same without the launcher (the package moved aside).
renameSync(launcherPackage, `${launcherPackage}.off`);
await phase('B test7 without launcher', async () => {
  const r = [];
  for (let i = 0; i < 4; i++) r.push(await runBounded(`B${i}`, ['--test', '--test-reporter=spec', `--test-name-pattern=${TEST7}`, 'dist/src/execution/partitionExec.spec.js'], 150_000));
  return r;
});
renameSync(`${launcherPackage}.off`, launcherPackage);

// C: east-node runners straight through spawnAndCapture (this process has the launcher).
const dir = mkdtempSync(join(tmpdir(), 'e3-probe-'));
const irPath = join(dir, 'one.beast2');
writeFileSync(irPath, encodeEastIR(East.function([], IntegerType, ($) => 1n).toIR()));
let n = 0;
async function runner(lifeline) {
  const out = join(dir, `out-${n++}.beast2`);
  const argv = lifeline
    ? ['east-node', 'run', '--exit-with-parent', '-p', '@elaraai/east-node-std', '-o', out, irPath]
    : ['east-node', 'run', '-p', '@elaraai/east-node-std', '-o', out, irPath];
  let pid = null;
  const run = spawnAndCapture(argv, dir, { stdinLifeline: lifeline, searchDirs: [process.cwd()], onSpawned: (p) => { pid = p; } });
  const r = await Promise.race([run, new Promise((res) => setTimeout(() => res('TIMEOUT'), 60_000))]);
  if (r === 'TIMEOUT') {
    dump(process.pid, `runner lifeline=${lifeline} pid=${pid} output ${existsSync(out) ? 'written' : 'missing'}`);
    if (pid) killTree(pid);
    return 'stalled';
  }
  return r.exitCode === 0 ? 'ok' : `exit ${r.exitCode} ${r.signal ?? ''} ${r.stderrTail.slice(-300)}`;
}
await phase('C1 lifeline sequential', async () => { const r = []; for (let i = 0; i < 12; i++) r.push(await runner(true)); return r; });
await phase('C2 no lifeline sequential', async () => { const r = []; for (let i = 0; i < 12; i++) r.push(await runner(false)); return r; });
await phase('C3 lifeline 4 at once', async () => { const r = []; for (let b = 0; b < 4; b++) r.push(...await Promise.all([runner(true), runner(true), runner(true), runner(true)])); return r; });
await phase('C4 no lifeline 4 at once', async () => { const r = []; for (let b = 0; b < 4; b++) r.push(...await Promise.all([runner(false), runner(false), runner(false), runner(false)])); return r; });

// D: the whole partitionExec file once, with the launcher.
await phase('D partitionExec.spec with launcher', async () => runBounded('D', ['--test', '--test-reporter=spec', 'dist/src/execution/partitionExec.spec.js'], 300_000));

log('RESULTS ' + JSON.stringify(results, null, 2));
appendFileSync(TRACE, 'done\n');
process.exit(0);
