/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { pythonInstalls } from '@elaraai/e3';
import { decodeEnvironmentFile, type DetachedCallRequest, type StorageBackend, type TaskBodyRequest } from '@elaraai/e3-core';
import { decodeEnvironmentSpec, decodeTaskObject, type EnvironmentSpec, type RunnerValue } from '@elaraai/e3-types';
import { selectTask, type RackComputeSize, type RackPolicy, type TaskSelection } from './policy.js';
import { rackTierFor, type IneligibleReason, type RackTier } from './tiers.js';
import { collectPlatformNames, hostCoupledPlatforms, scanProgram } from './host-coupling.js';

/**
 * A request's rack destination, or why it remains local. Work that declares
 * an environment names it: a rack is leased it only once the environment's
 * layers are built for the rack's platform.
 */
export type Eligibility =
  | { eligible: true; tier: RackTier; size: RackComputeSize; timeoutMinutes: number; memoryLimit: number | null; gpu: boolean; environment: string | null }
  | { eligible: false; reason: IneligibleReason };

/** How an evaluator selects work for a rack. */
export interface EligibilityOptions {
  /**
   * Whether all the work it judges is a rack's, whatever the policy's rules
   * select: a command's `--rack`, which names its one piece of work. A rule
   * that matches the work's name still gives its size, its timeout, its
   * memory limit, its GPU and its host-coupling override; otherwise the
   * policy's defaults do. Fitness still applies.
   */
  readonly selected?: boolean;
}

/**
 * Why the environment work declares cannot go to a rack, or null when it can.
 *
 * @remarks
 * An environment that is files of the launching machine's platform, or a
 * server's image, is not installed for a rack's; nor is one built on Windows,
 * whose built environments have another layout. A spec of another type than
 * this release's is refused by the one decoder every reader goes through, and
 * the work stays here, where running it says why.
 */
function environmentRefusal(spec: EnvironmentSpec): IneligibleReason | null {
  if (spec.type === 'tools' || spec.type === 'image') return `environment:${spec.type}`;
  if (process.platform === 'win32') return 'environment:windows-host';
  return null;
}

/**
 * What a python environment installs, read from its lock as its sync takes it
 * ({@link pythonInstalls}): a project's with its own `pyproject.toml`, which
 * says the groups it installs; none of a node environment. Each file is
 * decoded as every reader of an environment's files decodes one (e3-core's
 * `decodeEnvironmentFile`), which refuses a file an older SDK stored raw.
 */
async function readInstalls(storage: StorageBackend, repo: string, spec: EnvironmentSpec): Promise<string[]> {
  if (spec.type !== 'python' && spec.type !== 'workspace_python') return [];
  const read = async (hash: string): Promise<string> => new TextDecoder().decode(decodeEnvironmentFile(await storage.objects.read(repo, hash), hash));
  const lock = await read(spec.value.lock);
  return spec.type === 'python'
    ? pythonInstalls(lock, { kind: 'project', pyproject: await read(spec.value.pyproject) })
    : pythonInstalls(lock, { kind: 'members', subjects: spec.value.subjects, requires: spec.value.requires });
}

/** The refusal of a program that calls platform functions reaching the host, or null for one that calls none. */
function hostCoupling(blocked: Iterable<string>): IneligibleReason | null {
  const names = [...new Set(blocked)].sort();
  return names.length === 0 ? null : `host-coupled:${names.join(',')}`;
}

/** The verdict that work may go to a rack, as its rule gives it. */
function eligible(selection: TaskSelection, tier: RackTier, environment: string | null): Eligibility {
  return { eligible: true, tier, size: selection.size, timeoutMinutes: selection.timeoutMinutes, memoryLimit: selection.memoryLimit, gpu: selection.gpu, environment };
}

/**
 * Evaluates routing once per logical task and graph name for a run, and reads
 * what each environment the run's work declares installs once.
 * The program and output reducer are task-object references, so a merge that
 * arrives before any map (cached maps) receives the same complete scan.
 * @example
 * const eligibility = await new EligibilityEvaluator(policy).evaluate(request);
 */
export class EligibilityEvaluator {
  private readonly verdicts = new Map<string, Promise<Eligibility>>();
  /** What each environment installs, by repository and spec: a lock is read
   *  once for a run, however much of its work declares it. */
  private readonly installs = new Map<string, Promise<string[]>>();

  /**
   * @param policy - The policy snapshot for this run
   * @param options - Whether the evaluator's work is a rack's whatever the
   *   policy's rules select
   */
  constructor(private readonly policy: RackPolicy, private readonly options: EligibilityOptions = {}) {}

  /**
   * Checks selection, runtime, environment and every executable IR bundle.
   *
   * @remarks
   * The task's verdict is reached once for all its units: a split task's
   * pieces and merges go where the task goes.
   * @param request - A task or split unit after its cache miss
   * @returns Its eligibility, with a deterministic reason on refusal
   */
  evaluate(request: TaskBodyRequest): Promise<Eligibility> {
    const name = request.options.taskName;
    if (name === undefined) return Promise.resolve({ eligible: false, reason: 'no-task-name' });
    const hash = request.logicalTaskHash ?? request.taskHash;
    const key = JSON.stringify([request.repo, hash, name]);
    let result = this.verdicts.get(key);
    if (result === undefined) {
      if (this.verdicts.size >= 4096) this.verdicts.clear();
      result = this.check(request, hash, name);
      this.verdicts.set(key, result);
    }
    return result;
  }

  /**
   * Checks a function call as a task is checked: its rule, by the name
   * `fn:<name>`; its runner; the environment it declares; and its program,
   * for a platform call that reaches the host.
   * @param request - The call, before anything of it has run
   * @param storage - The repository's storage, which keeps the environment's
   *   spec
   * @returns Its eligibility, with a deterministic reason on refusal
   * @example
   * const eligibility = await new EligibilityEvaluator(policy, { selected: true }).evaluateCall(request, storage);
   */
  async evaluateCall(request: DetachedCallRequest, storage: StorageBackend): Promise<Eligibility> {
    const name = request.options.functionName;
    if (name === undefined) return { eligible: false, reason: 'no-function-name' };
    const selection = this.select(`fn:${name}`);
    if (selection === null) return { eligible: false, reason: 'not-selected' };
    try {
      const environment = request.spec.environment ?? null;
      const tier = await this.route(storage, request.repo, request.spec.runner, environment, selection.gpu);
      if ('ineligible' in tier) return { eligible: false, reason: tier.ineligible };
      if (!selection.allowHostCoupled) {
        const coupled = hostCoupling(hostCoupledPlatforms(collectPlatformNames(request.spec.bodyIr)));
        if (coupled !== null) return { eligible: false, reason: coupled };
      }
      return eligible(selection, tier.tier, environment);
    } catch {
      return { eligible: false, reason: 'unscannable' };
    }
  }

  /** The work's selection by its name, or null when it is not a rack's. */
  private select(name: string): TaskSelection | null {
    const selection = selectTask(this.policy, name);
    return selection.target === 'local' && this.options.selected !== true ? null : selection;
  }

  /**
   * The tier work runs on, or why it cannot go to a rack: from its runner, the
   * environment it declares, and its rule's GPU ({@link rackTierFor}). What a
   * python environment installs is read only where it can move the work, from
   * the slim python image to the one that holds it, and once for a run
   * ({@link readInstalls}).
   */
  private async route(storage: StorageBackend, repo: string, runner: RunnerValue, environment: string | null, gpu: boolean):
    Promise<{ tier: RackTier } | { ineligible: IneligibleReason }> {
    const spec = environment === null ? null : decodeEnvironmentSpec(await storage.objects.read(repo, environment), environment);
    const refused = spec === null ? null : environmentRefusal(spec);
    if (refused !== null) return { ineligible: refused };
    const asks = { environment: spec !== null, gpu };
    const route = rackTierFor(runner, asks);
    if (environment === null || spec === null || !('tier' in route) || route.tier !== 'py') return route;
    const key = JSON.stringify([repo, environment]);
    let installs = this.installs.get(key);
    if (installs === undefined) {
      if (this.installs.size >= 4096) this.installs.clear();
      installs = readInstalls(storage, repo, spec);
      this.installs.set(key, installs);
    }
    return rackTierFor(runner, { ...asks, installs: await installs });
  }

  private async check(request: TaskBodyRequest, logicalHash: string, name: string): Promise<Eligibility> {
    const selection = this.select(name);
    if (selection === null) return { eligible: false, reason: 'not-selected' };
    try {
      const task = logicalHash === request.taskHash ? request.task : decodeTaskObject(await request.storage.objects.read(request.repo, logicalHash));
      const environment = task.environment.type === 'some' ? task.environment.value : null;
      const tier = await this.route(request.storage, request.repo, task.runner, environment, selection.gpu);
      if ('ineligible' in tier) return { eligible: false, reason: tier.ineligible };
      if (task.body.type !== 'east') return { eligible: false, reason: 'custom-runner' };
      if (!selection.allowHostCoupled) {
        const programs = [task.body.value.program];
        const output = task.output.kind;
        if (output.type === 'dict' && output.value.merge.type === 'some') programs.push(output.value.merge.value);
        if (output.type === 'fold') programs.push(output.value.combine);
        const blocked: string[] = [];
        for (const hash of programs) blocked.push(...await scanProgram(hash, () => request.storage.objects.read(request.repo, hash)));
        const coupled = hostCoupling(blocked);
        if (coupled !== null) return { eligible: false, reason: coupled };
      }
      return eligible(selection, tier.tier, environment);
    } catch {
      return { eligible: false, reason: 'unscannable' };
    }
  }
}
