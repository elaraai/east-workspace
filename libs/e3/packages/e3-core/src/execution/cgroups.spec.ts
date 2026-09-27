/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * cgroup v2 as e3 uses it: a unit's cap, the working set a unit is measured
 * by, and the cgroups units run in where e3's cgroup is delegated to it —
 * against a cgroup tree written for the test, and on a cgroup systemd
 * delegates where the machine has one to give.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ArrayType, East, IRType, StringType, encodeBeast2For, none, variant } from '@elaraai/east';
import { TASK_OBJECT_KIND, TaskObjectType, type TaskObject } from '@elaraai/e3-types';
import { cgroupWorkingSet, delegatedCgroups, unitCap, type CgroupSource } from './cgroups.js';
import { objectWrite } from '../storage/local/LocalObjectStore.js';
import { LocalStorage } from '../storage/local/index.js';
import { createTestRepo, removeTestRepo } from '../test-helpers.js';

const MiB = 1024 ** 2;

describe("a unit's cap", () => {
  it('is its reservation and half again, and at least 64 MiB more', () => {
    assert.equal(unitCap(0), 64 * MiB);
    assert.equal(unitCap(100 * MiB), 164 * MiB);
    assert.equal(unitCap(1024 * MiB), 1536 * MiB);
    // A unit its cap killed reserves that cap, so each requeue raises it by half.
    assert.equal(unitCap(unitCap(1024 * MiB)), 2304 * MiB);
  });
});

describe("a cgroup's working set", () => {
  const files = (entries: Record<string, string>) => (file: string): string | null => entries[file] ?? null;

  it('is what the cgroup holds, less its inactive file cache', () => {
    assert.equal(cgroupWorkingSet('/cg', files({ '/cg/memory.current': '1000\n', '/cg/memory.stat': 'anon 700\ninactive_file 250\n' })), 750);
    assert.equal(cgroupWorkingSet('/cg', files({ '/cg/memory.current': '1000\n' })), 1000);
    assert.equal(cgroupWorkingSet('/cg', files({})), null);
  });
});

describe("units' cgroups, on a cgroup delegated to e3", { skip: process.platform === 'win32' ? "cgroups are Linux's" : false }, () => {
  const pid = 4242;
  const scope = '/user.slice/run-e3.scope';
  let root: string;
  let dir: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'e3-cgroups-'));
    dir = path.join(root, 'fs', scope);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(root, 'cgroup'), `0::${scope}\n`);
    writeFileSync(path.join(dir, 'cgroup.controllers'), 'cpu memory pids\n');
    writeFileSync(path.join(dir, 'cgroup.procs'), `${pid}\n`);
    writeFileSync(path.join(dir, 'cgroup.subtree_control'), '');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const source = (overrides: CgroupSource = {}): CgroupSource =>
    ({ platform: 'linux', env: {}, pid, cgroupFile: path.join(root, 'cgroup'), root: path.join(root, 'fs'), ...overrides });

  it('moves the process into a child cgroup of its own, and hands the memory controller to its children', async () => {
    const cgroups = await delegatedCgroups(source());
    assert.ok(cgroups !== null);
    assert.equal(cgroups.dir, dir);
    assert.equal(readFileSync(path.join(dir, 'e3', 'cgroup.procs'), 'utf8'), String(pid));
    assert.equal(readFileSync(path.join(dir, 'cgroup.subtree_control'), 'utf8'), '+memory');
  });

  it('makes a unit a cgroup whose processes die together, capped without swap, or uncapped', async () => {
    const cgroups = (await delegatedCgroups(source()))!;
    const capped = await cgroups.create('unit-a-1', 96 * MiB);
    assert.equal(capped, path.join(dir, 'unit-a-1'));
    assert.equal(readFileSync(path.join(capped, 'memory.oom.group'), 'utf8'), '1');
    assert.equal(readFileSync(path.join(capped, 'memory.max'), 'utf8'), String(96 * MiB));
    assert.equal(readFileSync(path.join(capped, 'memory.swap.max'), 'utf8'), '0');
    const open = await cgroups.create('unit-b-1', null);
    assert.equal(readFileSync(path.join(open, 'memory.oom.group'), 'utf8'), '1');
    assert.equal(existsSync(path.join(open, 'memory.max')), false);
    assert.equal(existsSync(path.join(open, 'memory.swap.max')), false);
  });

  it('knows a unit its cap killed from the one held at its cap', async () => {
    const cgroups = (await delegatedCgroups(source()))!;
    const cgroup = await cgroups.create('unit-c-1', 96 * MiB);
    assert.equal(await cgroups.capKilled(cgroup), false, 'no events yet');
    writeFileSync(path.join(cgroup, 'memory.events'), 'low 0\nhigh 0\nmax 12\noom 1\noom_kill 0\noom_group_kill 0\n');
    assert.equal(await cgroups.capKilled(cgroup), false);
    writeFileSync(path.join(cgroup, 'memory.events'), 'low 0\nhigh 0\nmax 12\noom 1\noom_kill 1\noom_group_kill 1\n');
    assert.equal(await cgroups.capKilled(cgroup), true);
  });

  it('runs a runner through a shell that enters its cgroup first, with its arguments as given', async () => {
    const cgroups = (await delegatedCgroups(source()))!;
    const cgroup = await cgroups.create('unit-d-1', null);
    writeFileSync(path.join(cgroup, 'cgroup.procs'), '');
    const argv = cgroups.enter(cgroup, [process.execPath, '-e', 'process.stdout.write(process.argv.slice(1).join("|"))', 'a b', '$HOME', '"c"']);
    const ran = spawnSync(argv[0]!, argv.slice(1), { encoding: 'utf8' });
    assert.equal(ran.status, 0, ran.stderr);
    assert.equal(ran.stdout, 'a b|$HOME|"c"');
    assert.equal(readFileSync(path.join(cgroup, 'cgroup.procs'), 'utf8'), '0\n', 'the shell wrote itself into the cgroup');
  });

  it('is not set up off Linux, when E3_CGROUPS is 0, without the memory controller, or beside another process', async () => {
    assert.equal(await delegatedCgroups(source({ platform: 'darwin' })), null);
    assert.equal(await delegatedCgroups(source({ env: { E3_CGROUPS: '0' } })), null);
    writeFileSync(path.join(dir, 'cgroup.procs'), `${pid}\n77\n`);
    assert.equal(await delegatedCgroups(source()), null, 'another process shares the cgroup');
    writeFileSync(path.join(dir, 'cgroup.procs'), `${pid}\n`);
    writeFileSync(path.join(dir, 'cgroup.controllers'), 'cpu pids\n');
    assert.equal(await delegatedCgroups(source()), null, 'no memory controller');
    assert.equal(existsSync(path.join(dir, 'e3')), false, 'and the process moved nowhere');
  });

  it("is not set up where the cgroup is not the process's to write", { skip: process.getuid?.() === 0 ? 'root may write any file' : false }, async () => {
    chmodSync(path.join(dir, 'cgroup.subtree_control'), 0o444);
    assert.equal(await delegatedCgroups(source()), null);
    assert.equal(existsSync(path.join(dir, 'e3')), false);
  });
});

/** Why the machine has no cgroup to delegate, or `false` when it has. */
function noDelegation(): string | false {
  if (process.platform !== 'linux') return "cgroups are Linux's";
  const probe = spawnSync('systemd-run', ['--user', '--scope', '-p', 'Delegate=yes', '-q', '--', 'true'], { timeout: 10_000 });
  return probe.status === 0 ? false : 'no cgroup to delegate: `systemd-run --user` is not available here';
}

describe('a unit on a cgroup systemd delegates to e3', { skip: noDelegation() }, () => {
  it('outgrows its cap, dies alone, and runs again under a cap half as large again until it completes', async () => {
    const repo = createTestRepo();
    const work = mkdtempSync(path.join(tmpdir(), 'e3-delegated-'));
    try {
      const storage = new LocalStorage();
      // A runner that holds 200 MiB, touched, then copies its input.
      const commandFn = East.function(
        [ArrayType(StringType), StringType],
        ArrayType(StringType),
        ($, inputs, output) => [process.execPath, '-e',
          'const held = Buffer.alloc(200 * 2 ** 20, 1); require("node:fs").copyFileSync(process.argv[1], process.argv[2]); process.stdout.write(String(held.length))',
          inputs.get(0n), output],
      );
      const task: TaskObject = {
        kind: TASK_OBJECT_KIND,
        body: variant('command', { commandIr: await objectWrite(repo, encodeBeast2For(IRType)(commandFn.toIR().ir)) }),
        runner: variant('custom', { command: [] }),
        inputs: [],
        output: { path: [], kind: variant('value', null) },
        role: variant('data', null),
        environment: none,
      };
      const taskHash = await objectWrite(repo, encodeBeast2For(TaskObjectType)(task));
      const input = await storage.objects.write(repo, new Uint8Array([1, 2, 3]));

      // The e3 process, alone in a scope systemd delegates to it, runs the
      // task as a unit its stage measured at 32 MiB: capped at 96 MiB.
      const here = path.dirname(fileURLToPath(import.meta.url));
      const module = (file: string): string => pathToFileURL(path.join(here, file)).href;
      const script = path.join(work, 'run-unit.mjs');
      writeFileSync(script, [
        "import { readFileSync, readdirSync } from 'node:fs';",
        `import { LocalTaskRunner } from '${module('LocalTaskRunner.js')}';`,
        `import { Budget } from '${module('budget.js')}';`,
        `import { LocalStorage } from '${module('../storage/local/index.js')}';`,
        `import { inputsHash } from '${module('../executions.js')}';`,
        'const [repo, taskHash, input] = process.argv.slice(2);',
        'const storage = new LocalStorage();',
        'const runner = new LocalTaskRunner(repo, new Budget({ cores: 2, memory: 4 * 1024 ** 3 }));',
        'const result = await runner.executeUnit(storage, taskHash, { inputs: [input], merge: null }, { expectedPeakBytes: 32 * 1024 ** 2 });',
        "const stderr = (await storage.logs.read(repo, taskHash, inputsHash([input]), result.executionId, 'stderr')).data;",
        "const cgroup = readFileSync('/proc/self/cgroup', 'utf8').trim().slice(3);",
        "const left = readdirSync('/sys/fs/cgroup' + cgroup.replace(/\\/e3$/, '')).filter((name) => name.startsWith('unit-'));",
        'process.stdout.write(JSON.stringify({ state: result.state, error: result.error, stderr, cgroup, left }) + "\\n");',
      ].join('\n'));
      const ran = spawnSync('systemd-run', ['--user', '--scope', '-p', 'Delegate=yes', '-q', '--', process.execPath, script, repo, taskHash, input],
        { encoding: 'utf8', timeout: 120_000 });
      assert.equal(ran.status, 0, ran.stderr);
      const report = JSON.parse(ran.stdout.trim().split('\n').at(-1)!) as { state: string; error: string | null; stderr: string; cgroup: string; left: string[] };

      assert.equal(report.state, 'success', report.error ?? report.stderr);
      assert.match(report.cgroup, /\/e3$/, 'e3 moved itself into a child of its scope');
      assert.deepEqual(report.left, [], "no unit's cgroup is left behind");
      const caps = report.stderr.split('\n').filter((line) => line.startsWith('e3: the runner outgrew its cap'));
      assert.equal(caps[0], 'e3: the runner outgrew its cap of 96 MiB: it runs again under a cap of 160 MiB');
      assert.ok(caps.length >= 2, `each requeue raised the cap by half:\n${caps.join('\n')}`);
    } finally {
      removeTestRepo(repo);
      rmSync(work, { recursive: true, force: true });
    }
  });
});
