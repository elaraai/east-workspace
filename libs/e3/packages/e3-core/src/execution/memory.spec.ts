/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What the guard measures: a runner whole, from its cgroup or its process
 * tree, and the machine's memory, a container's where its limit leaves less.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { defaultMemorySampler, linuxMemorySampler, psGroupResident } from './memory.js';

const KiB = 1024;

describe("Linux's sampler", () => {
  let root: string;
  let proc: string;
  let cgroups: string;

  /** Writes a file of the fake filesystem, making its directories. */
  const put = (file: string, text: string): void => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };

  /** A process of the fake /proc: its resident memory, and its children by
   *  the thread that forked each. */
  const processEntry = (pid: number, residentKiB: number | null, children: Record<number, number[]> = { [pid]: [] }): void => {
    put(path.join(proc, String(pid), 'status'),
      `Name:\tnode\nPid:\t${pid}\n${residentKiB === null ? '' : `VmRSS:\t   ${residentKiB} kB\n`}Threads:\t2\n`);
    for (const [task, kids] of Object.entries(children)) {
      put(path.join(proc, String(pid), 'task', task, 'children'), kids.map((kid) => `${kid} `).join(''));
    }
  };

  before(() => {
    root = mkdtempSync(path.join(tmpdir(), 'e3-memory-'));
    proc = path.join(root, 'proc');
    cgroups = path.join(root, 'cgroup');
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("measures a runner's whole process tree, through every thread's children", async () => {
    // 100 forked 101 on its main thread and 103 on another; 101 forked 104.
    // 102 is a thread, with no entry of its own at the top level. A zombie
    // child has no resident memory.
    processEntry(100, 1000, { 100: [101], 102: [103] });
    processEntry(101, 200, { 101: [104] });
    processEntry(103, 300);
    processEntry(104, null);
    processEntry(200, 5000);
    const usage = await linuxMemorySampler(proc, cgroups).sample([{ pid: 100 }, { pid: 999 }]);
    assert.deepEqual([...usage], [[100, 1500 * KiB]], 'the tree of 100, and nothing for a runner that has gone');
  });

  it("measures a runner in a cgroup by the cgroup's working set", async () => {
    const unit = path.join(cgroups, 'scope', 'unit-a');
    put(path.join(unit, 'memory.current'), '5000000\n');
    put(path.join(unit, 'memory.stat'), 'anon 3000000\nfile 2000000\nactive_file 800000\ninactive_file 1200000\n');
    const usage = await linuxMemorySampler(proc, cgroups).sample([{ pid: 100, cgroup: unit }]);
    assert.deepEqual([...usage], [[100, 3_800_000]], 'what the cgroup holds, less the file cache the kernel reclaims first');
  });

  it("reads the machine's memory, and a container's where its limit leaves less", async () => {
    put(path.join(proc, 'meminfo'), 'MemTotal:       16000000 kB\nMemFree:         1000000 kB\nMemAvailable:    8000000 kB\n');
    put(path.join(proc, 'self', 'cgroup'), '0::/box/e3\n');
    const sampler = linuxMemorySampler(proc, cgroups);
    assert.deepEqual(await sampler.machine(), { available: 8_000_000 * KiB, total: 16_000_000 * KiB }, 'no limit up the hierarchy');

    put(path.join(cgroups, 'box', 'memory.max'), `${4 * 1024 ** 3}\n`);
    put(path.join(cgroups, 'box', 'memory.current'), `${3 * 1024 ** 3}\n`);
    put(path.join(cgroups, 'box', 'memory.stat'), `inactive_file ${512 * 1024 ** 2}\n`);
    put(path.join(cgroups, 'box', 'e3', 'memory.max'), 'max\n');
    assert.deepEqual(await sampler.machine(), { available: 1.5 * 1024 ** 3, total: 4 * 1024 ** 3 },
      "the container's limit, less what it holds and cannot reclaim first");
  });

  it("reads nothing of a machine whose meminfo it cannot read", async () => {
    assert.equal(await linuxMemorySampler(path.join(root, 'nowhere'), cgroups).machine(), null);
  });
});

describe("macOS's sampler", () => {
  it("sums each process group's resident memory from a ps listing", () => {
    const listing = '    1  12000\n  500   2048\n  500   1024\n  501      0\n\n  junk\n';
    assert.deepEqual([...psGroupResident(listing)], [[1, 12000 * KiB], [500, 3072 * KiB], [501, 0]]);
  });
});

describe('the default sampler', () => {
  it('is Linux\'s or macOS\'s, and none elsewhere', () => {
    const sampler = defaultMemorySampler();
    assert.equal(sampler === null, process.platform !== 'linux' && process.platform !== 'darwin');
  });

  it('measures this process on Linux and macOS', { skip: process.platform !== 'linux' && process.platform !== 'darwin' }, async () => {
    // This process's group is the test runner's, which its own resident
    // memory is part of.
    const usage = await defaultMemorySampler()!.sample([{ pid: process.pid }]);
    if (process.platform === 'linux') assert.ok((usage.get(process.pid) ?? 0) >= process.memoryUsage.rss() / 2);
    const machine = await defaultMemorySampler()!.machine();
    assert.ok(machine === null || (machine.available >= 0 && machine.total > 0));
  });
});
