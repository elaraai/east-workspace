/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Graph-free, persistence-free execution — the shared primitive behind
 * `e3.function` calls and one-shot execution.
 *
 * runDetached: stage the program and its arguments → run them on a runner →
 * return the result value inline; write nothing durable. No task object, no
 * output object, no execution record, no logs, no dataset ref. The only disk
 * write is the transient scratch directory, removed on completion: inside the
 * repository for a local runner, as an execution's is, or the OS temp
 * directory without one. An argument is a value, or a stored dataset, which is
 * staged as a task input is and never read here.
 *
 * A stock runner runs the call as a unit through its `exec` (units.ts); a
 * `custom` runner runs its command with `run`'s arguments, as a custom task's
 * program runs.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { encodeBeast2SegmentsFor, readBeast2Manifest, spliceBeast2 } from '@elaraai/east';
import { manifestByteSize } from '@elaraai/e3-types';
import type { DetachedResult, DetachedRunOptions, DetachedSpec } from './interfaces.js';
import { giveDirectory, spawnAndCapture, stageInput, type ProcessSettings, type SpawnAndCaptureResult } from './processExec.js';
import { SegmentFetcher } from './segment-fetch.js';
import { callScratchDir } from './scratch.js';
import { stageCallUnit, unitArgv } from './units.js';
import { unitThreads, type Budget, type Grant } from './budget.js';
import { unitCgroups } from './cgroups.js';
import { uuidv7 } from '../uuid.js';

/**
 * Run a function on a runner, returning its value inline.
 *
 * The program and arguments are staged in a scratch directory — a value
 * written, a stored dataset staged as a task input is — and the runner
 * spawned, with bounded tails of stdout and stderr. On exit 0 the output is
 * sized before it is read, so a value over `maxResultBytes` is `too_large`
 * and never loaded. A collection, which `exec` writes as a manifest naming its
 * segments, is spliced back into one blob. The scratch directory is removed
 * however the call ends. Where placing an object is a download, a stock
 * runner's dataset argument is staged without its segments, which the runner
 * asks for as it reads them.
 *
 * NEVER writes to the object store, execution records, or logs.
 *
 * @param spec - The program, its arguments, the runner and the limits
 * @param options - Cancellation, the runner's search path and verbosity
 * @param budget - The budget of the local runner that runs the call: the
 *   runner spawns only once it holds a core, and its unit is granted threads
 *   from it. Absent, the spawn is not budgeted, and the unit is granted the
 *   CPUs this process may use, up to four.
 * @param settings - How the runner runs, as the local runner that runs the call
 *   says: the environment it starts from, and the user and group it runs as,
 *   who is given the scratch directory ({@link ProcessSettings}). Absent, this
 *   process's own.
 * @returns The call's value inline, or how it failed
 * @throws {Error} When an argument is a stored dataset and `options` gives no
 *   `storage` and `repo` to stage it from, or the settings name a user or
 *   group on Windows.
 * @throws {RangeError} When a user or group id is not a non-negative integer.
 */
export async function runDetached(
  spec: DetachedSpec,
  options: DetachedRunOptions = {},
  budget?: Budget,
  settings: ProcessSettings = {},
): Promise<DetachedResult> {
  const scratchDir = options.repo !== undefined
    ? await callScratchDir(options.repo, uuidv7().replaceAll('-', ''))
    : path.join(tmpdir(), `e3-call-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`);
  await fs.mkdir(scratchDir, { recursive: true });

  // A stock runner runs the call as a unit, and exits with this process: the
  // stdin lifeline pipe below and `--exit-with-parent` on its command line.
  // A custom command is given `run`'s arguments, and left alone.
  const runner = spec.runner;
  const stock = runner.type !== 'custom';
  // Where placing an object is a download, a stock runner's dataset argument
  // is staged without its segments, and placed as the runner asks for them.
  const fetcher = stock && options.storage !== undefined && options.repo !== undefined && options.storage.objects.placement === 'download'
    ? new SegmentFetcher(options.storage, options.repo, true)
    : null;
  try {
    // The runner writes its output here, as the user it runs as.
    await giveDirectory(scratchDir, settings);
    const program = path.join(scratchDir, 'program.beast2');
    await fs.writeFile(program, spec.bodyIr);
    const inputs: string[] = [];
    for (const [i, arg] of spec.args.entries()) {
      const input = path.join(scratchDir, `input-${i}.beast2`);
      if (arg instanceof Uint8Array) {
        await fs.writeFile(input, arg);
      } else if (options.storage === undefined || options.repo === undefined) {
        throw new Error(`argument ${i + 1} is a stored dataset, which is staged from a repository: runDetached needs options.storage and options.repo`);
      } else {
        // As a task input: a stock runner opens a manifest and reads only the
        // segments it touches, and a command gets its own copy of one file.
        await stageInput(options.storage, options.repo, arg.dataset, input, {
          link: stock,
          manifests: stock,
          ...(fetcher !== null && { fetcher, owner: settings }),
        });
      }
      inputs.push(input);
    }
    const fetching = fetcher !== null && fetcher.size > 0;
    if (fetching) fetcher.start();
    const outputPath = path.join(scratchDir, 'output.beast2');
    const args = runner.type === 'custom'
      ? [...runner.value.command, ...inputs.flatMap((input) => ['-i', input]), '-o', outputPath, program]
      : unitArgv(runner, await stageCallUnit(scratchDir, runner, program, inputs, outputPath, unitThreads(budget), fetching), options.verbose);

    const searchDirs = options.runnerSearchDir
      ? [options.runnerSearchDir, process.cwd()]
      : [process.cwd()];

    // A call aborted while it waits for the budget never spawns, and ends as
    // an aborted run does. It is a user task to the budget's guard, stopped
    // only when the machine is nearly out of memory.
    let grant: Grant | undefined;
    try {
      grant = await budget?.acquire({ signal: options.signal });
    } catch (err) {
      if (options.signal?.aborted) {
        return { kind: 'failed', exitCode: -1, stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false };
      }
      throw err;
    }
    // Under a budget the call runs in a cgroup of its own, uncapped, where
    // e3's cgroup is delegated to it.
    const cgroups = budget === undefined ? null : await unitCgroups();
    let cgroup: string | null = null;
    let result: SpawnAndCaptureResult;
    try {
      if (cgroups !== null) cgroup = await cgroups.create(`call-${uuidv7().replaceAll('-', '')}`, null).catch(() => null);
      result = await spawnAndCapture(cgroup === null ? args : cgroups!.enter(cgroup, args), scratchDir, {
        timeoutMs: spec.limits.timeoutMs,
        signal: options.signal,
        maxLogBytes: spec.limits.maxLogBytes,
        searchDirs,
        extraBins: options.extraBins,
        stdinLifeline: stock,
        env: settings.env,
        uid: settings.uid,
        gid: settings.gid,
        extraEnv: options.extraEnv,
        onSpawned: (pid, stop) => {
          if (pid !== null) grant?.watch({ pid, stop, ...(cgroup !== null && { cgroup }) });
        },
      });
    } finally {
      grant?.release();
      if (cgroup !== null) await cgroups!.remove(cgroup);
    }

    const streams = {
      stdout: result.stdoutTail,
      stderr: result.stderrTail,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
    };

    if (result.timedOut) {
      return { kind: 'timed_out', ms: spec.limits.timeoutMs, ...streams };
    }

    // Stopped by the guard, the machine nearly out of memory: failed, saying
    // so as a stopped task's log does.
    const stop = grant?.stopped ?? null;
    if (result.stoppedByE3 && stop !== null && !options.signal?.aborted) {
      const cause = `e3: the guard stopped the runner at ${Math.round(stop.peak / 1024 ** 2)} MiB, with the machine nearly out of memory`;
      return { kind: 'failed', exitCode: -1, ...streams, stderr: streams.stderr === '' ? cause : `${streams.stderr}\n${cause}` };
    }

    // Stopped because the call was aborted: failed with exit code -1 however
    // the stop ended the runner — Node's kill leaves a signal, taskkill (on
    // Windows without the job launcher) exit code 1.
    if (result.stoppedByE3) {
      return { kind: 'failed', exitCode: -1, ...streams };
    }

    if (result.exitCode !== 0) {
      // Spawn failures (exitCode null) also land here; surface the error
      // text on stderr so the caller sees why nothing ran.
      if (result.exitCode === null && result.error) {
        streams.stderr = streams.stderr ? `${streams.stderr}\n${result.error}` : result.error;
      }
      return { kind: 'failed', exitCode: result.exitCode ?? -1, ...streams };
    }

    // Sized BEFORE it is read — an over-cap value is never loaded into memory.
    let size: number;
    try {
      size = (await fs.stat(outputPath)).size;
    } catch {
      streams.stderr = streams.stderr
        ? `${streams.stderr}\nRunner exited 0 but wrote no output file`
        : 'Runner exited 0 but wrote no output file';
      return { kind: 'failed', exitCode: 0, ...streams };
    }
    if (size > spec.limits.maxResultBytes) {
      return { kind: 'too_large', bytes: size, limit: spec.limits.maxResultBytes, ...streams };
    }
    const written = await fs.readFile(outputPath);
    const manifest = readBeast2Manifest(written);
    if (manifest === null) {
      return { kind: 'success', value: written, ...streams };
    }
    // A collection: the manifest records its segments' sizes, and its segments
    // are standalone blobs under one header, which splice into the blob they
    // were cut from. An empty one names no segment.
    const bytes = manifestByteSize(manifest);
    if (bytes > spec.limits.maxResultBytes) {
      return { kind: 'too_large', bytes, limit: spec.limits.maxResultBytes, ...streams };
    }
    const segments = `${outputPath}.segments`;
    const value = manifest.entries.length === 0
      ? encodeBeast2SegmentsFor(manifest.type)([])
      : spliceBeast2(await Promise.all(manifest.entries.map((entry) => fs.readFile(path.join(segments, `${entry.hash}.beast2`)))));
    return { kind: 'success', value, ...streams };
  } finally {
    // Nothing more is asked for once the runner has exited.
    await fetcher?.stop();
    try {
      await fs.rm(scratchDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
