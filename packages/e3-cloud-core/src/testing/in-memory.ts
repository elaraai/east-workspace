/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/* eslint-disable @typescript-eslint/require-await */

/**
 * In-memory implementations for testing.
 *
 * These classes provide simple, synchronous implementations of the
 * core interfaces for use in unit tests.
 */

import type { RepoUser, RepoRole, ComputeSize, TaskTimeout, Schedule } from '@elaraai/e3-cloud-types';
import type { DataflowRun } from '@elaraai/e3-types';
import type { AclStore, Identity, WhoamiBackend } from '../interfaces.js';
import type { ComputeResultStore } from '../compute-result-store.js';
import type { TaskConfigStore } from '../task-config-store.js';
import type { ScheduleStore } from '../schedule-store.js';
import type { RepoManager, RepoStatus, RepoMetadata } from '../repo-manager.js';
import type { DataflowRunStore } from '../dataflow-run-store.js';
import type {
  ExecutionTracker,
  DataflowExecution,
  TaskExecutionStatus,
  DataflowEvent,
} from '../execution-tracker.js';
import type { DataflowOrchestrator } from '../dataflow-orchestrator.js';
import type { SchedulerService } from '../scheduler-service.js';

/**
 * In-memory ACL store for testing.
 */
export class InMemoryAclStore implements AclStore {
  // Map<repo, Map<userId, RepoUser>>
  private acls = new Map<string, Map<string, RepoUser>>();

  listUsers(repo: string): Promise<RepoUser[]> {
    const repoAcl = this.acls.get(repo);
    return Promise.resolve(repoAcl ? Array.from(repoAcl.values()) : []);
  }

  addUser(repo: string, user: RepoUser): Promise<RepoUser> {
    let repoAcl = this.acls.get(repo);
    if (!repoAcl) {
      repoAcl = new Map();
      this.acls.set(repo, repoAcl);
    }
    repoAcl.set(user.userId, user);
    return Promise.resolve(user);
  }

  removeUser(repo: string, userId: string): Promise<void> {
    this.acls.get(repo)?.delete(userId);
    return Promise.resolve();
  }

  getRole(repo: string, userId: string): Promise<RepoRole | null> {
    return Promise.resolve(this.acls.get(repo)?.get(userId)?.role ?? null);
  }

  listReposForUser(userId: string): Promise<string[]> {
    const repos: string[] = [];
    for (const [repo, acl] of this.acls) {
      if (acl.has(userId)) repos.push(repo);
    }
    return Promise.resolve(repos);
  }

  deleteAllForRepo(repo: string): Promise<void> {
    this.acls.delete(repo);
    return Promise.resolve();
  }

  /** Clear all data (for test reset) */
  clear(): void {
    this.acls.clear();
  }
}

/**
 * Mock whoami backend for testing.
 */
export class MockWhoamiBackend implements WhoamiBackend {
  constructor(private identity: Identity | null = null) {}

  setIdentity(identity: Identity | null): void {
    this.identity = identity;
  }

  getIdentity(): Identity | null {
    return this.identity;
  }
}

/**
 * In-memory compute result store for testing.
 */
export class InMemoryComputeResultStore implements ComputeResultStore {
  // Map<"repo/workspace/taskExecutionId", result>
  private results = new Map<string, string>();

  private key(repo: string, workspace: string, taskExecutionId: string): string {
    return `${repo}/${workspace}/${taskExecutionId}`;
  }

  async write(repo: string, workspace: string, taskExecutionId: string, result: string): Promise<void> {
    this.results.set(this.key(repo, workspace, taskExecutionId), result);
  }

  async read(repo: string, workspace: string, taskExecutionId: string): Promise<string | null> {
    return this.results.get(this.key(repo, workspace, taskExecutionId)) ?? null;
  }

  async delete(repo: string, workspace: string, taskExecutionId: string): Promise<void> {
    this.results.delete(this.key(repo, workspace, taskExecutionId));
  }

  clear(): void {
    this.results.clear();
  }
}

/**
 * In-memory task config store for testing.
 */
export class InMemoryTaskConfigStore implements TaskConfigStore {
  // Map<"repo/workspace/task", ComputeSize>
  private compute = new Map<string, ComputeSize>();
  // Map<"repo/workspace/task", TaskTimeout>
  private timeout = new Map<string, TaskTimeout>();

  private key(repo: string, workspace: string, taskName: string): string {
    return `${repo}/${workspace}/${taskName}`;
  }

  private wsPrefix(repo: string, workspace: string): string {
    return `${repo}/${workspace}/`;
  }

  async getCompute(repo: string, workspace: string, taskName: string): Promise<ComputeSize | null> {
    return this.compute.get(this.key(repo, workspace, taskName)) ?? null;
  }

  async putCompute(repo: string, workspace: string, taskName: string, size: ComputeSize): Promise<void> {
    this.compute.set(this.key(repo, workspace, taskName), size);
  }

  async putComputeBatch(repo: string, workspace: string, configs: Record<string, ComputeSize>): Promise<void> {
    for (const [task, size] of Object.entries(configs)) {
      this.compute.set(this.key(repo, workspace, task), size);
    }
  }

  async deleteCompute(repo: string, workspace: string, taskName: string): Promise<void> {
    this.compute.delete(this.key(repo, workspace, taskName));
  }

  async deleteComputeBatch(repo: string, workspace: string, taskNames: string[]): Promise<void> {
    for (const task of taskNames) {
      this.compute.delete(this.key(repo, workspace, task));
    }
  }

  async listCompute(repo: string, workspace: string): Promise<Record<string, ComputeSize>> {
    const prefix = this.wsPrefix(repo, workspace);
    const result: Record<string, ComputeSize> = {};
    for (const [k, v] of this.compute) {
      if (k.startsWith(prefix)) {
        result[k.slice(prefix.length)] = v;
      }
    }
    return result;
  }

  async getTimeout(repo: string, workspace: string, taskName: string): Promise<TaskTimeout | null> {
    return this.timeout.get(this.key(repo, workspace, taskName)) ?? null;
  }

  async putTimeout(repo: string, workspace: string, taskName: string, timeout: TaskTimeout): Promise<void> {
    this.timeout.set(this.key(repo, workspace, taskName), timeout);
  }

  async putTimeoutBatch(repo: string, workspace: string, configs: Record<string, TaskTimeout>): Promise<void> {
    for (const [task, t] of Object.entries(configs)) {
      this.timeout.set(this.key(repo, workspace, task), t);
    }
  }

  async deleteTimeout(repo: string, workspace: string, taskName: string): Promise<void> {
    this.timeout.delete(this.key(repo, workspace, taskName));
  }

  async deleteTimeoutBatch(repo: string, workspace: string, taskNames: string[]): Promise<void> {
    for (const task of taskNames) {
      this.timeout.delete(this.key(repo, workspace, task));
    }
  }

  async listTimeout(repo: string, workspace: string): Promise<Record<string, TaskTimeout>> {
    const prefix = this.wsPrefix(repo, workspace);
    const result: Record<string, TaskTimeout> = {};
    for (const [k, v] of this.timeout) {
      if (k.startsWith(prefix)) {
        result[k.slice(prefix.length)] = v;
      }
    }
    return result;
  }

  async deleteAllForWorkspace(repo: string, workspace: string): Promise<void> {
    const prefix = this.wsPrefix(repo, workspace);
    for (const k of this.compute.keys()) {
      if (k.startsWith(prefix)) this.compute.delete(k);
    }
    for (const k of this.timeout.keys()) {
      if (k.startsWith(prefix)) this.timeout.delete(k);
    }
  }

  async deleteAllForRepo(repo: string): Promise<void> {
    const prefix = `${repo}/`;
    for (const k of this.compute.keys()) {
      if (k.startsWith(prefix)) this.compute.delete(k);
    }
    for (const k of this.timeout.keys()) {
      if (k.startsWith(prefix)) this.timeout.delete(k);
    }
  }

  clear(): void {
    this.compute.clear();
    this.timeout.clear();
  }
}

/**
 * In-memory schedule store for testing.
 */
export class InMemoryScheduleStore implements ScheduleStore {
  // Map<"repo/workspace", Schedule>
  private schedules = new Map<string, Schedule>();

  private key(repo: string, workspace: string): string {
    return `${repo}/${workspace}`;
  }

  async get(repo: string, workspace: string): Promise<Schedule | null> {
    return this.schedules.get(this.key(repo, workspace)) ?? null;
  }

  async put(repo: string, workspace: string, schedule: Schedule): Promise<void> {
    this.schedules.set(this.key(repo, workspace), schedule);
  }

  async delete(repo: string, workspace: string): Promise<void> {
    this.schedules.delete(this.key(repo, workspace));
  }

  async listForRepo(repo: string): Promise<Schedule[]> {
    const prefix = `${repo}/`;
    const result: Schedule[] = [];
    for (const [k, v] of this.schedules) {
      if (k.startsWith(prefix)) result.push(v);
    }
    return result;
  }

  async deleteAllForRepo(repo: string): Promise<void> {
    const prefix = `${repo}/`;
    for (const k of this.schedules.keys()) {
      if (k.startsWith(prefix)) this.schedules.delete(k);
    }
  }

  clear(): void {
    this.schedules.clear();
  }
}

/**
 * In-memory repo manager for testing.
 */
export class InMemoryRepoManager implements RepoManager {
  private repos = new Map<string, RepoMetadata>();

  async listRepos(includeAll = false): Promise<string[]> {
    const result: string[] = [];
    for (const [name, meta] of this.repos) {
      if (includeAll || meta.status === 'active') result.push(name);
    }
    return result;
  }

  async getRepoMetadata(repo: string): Promise<RepoMetadata | null> {
    return this.repos.get(repo) ?? null;
  }

  async createRepo(repo: string): Promise<void> {
    if (this.repos.has(repo)) {
      throw new Error(`Repository '${repo}' already exists`);
    }
    const now = new Date().toISOString();
    this.repos.set(repo, {
      name: repo,
      status: 'active',
      createdAt: now,
      statusChangedAt: now,
    });
  }

  async setRepoStatus(
    repo: string,
    expectedStatus: RepoStatus | RepoStatus[],
    newStatus: RepoStatus,
    executionArn?: string,
  ): Promise<void> {
    const meta = this.repos.get(repo);
    const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
    if (!meta || !expected.includes(meta.status)) {
      throw new Error(
        `Repository '${repo}' status is '${meta?.status ?? 'not_found'}', expected '${expected.join(' or ')}'`
      );
    }
    meta.status = newStatus;
    meta.statusChangedAt = new Date().toISOString();
    meta.executionArn = executionArn;
  }

  async repoExists(repo: string): Promise<boolean> {
    return this.repos.has(repo);
  }

  async removeRepoMetadata(repo: string): Promise<void> {
    this.repos.delete(repo);
  }

  clear(): void {
    this.repos.clear();
  }
}

/**
 * In-memory dataflow run store for testing.
 */
export class InMemoryDataflowRunStore implements DataflowRunStore {
  // Map<"repo/workspace/runId", DataflowRun>
  private runs = new Map<string, DataflowRun>();

  private key(repo: string, workspace: string, runId: string): string {
    return `${repo}/${workspace}/${runId}`;
  }

  private wsPrefix(repo: string, workspace: string): string {
    return `${repo}/${workspace}/`;
  }

  async get(repo: string, workspace: string, runId: string): Promise<DataflowRun | null> {
    return this.runs.get(this.key(repo, workspace, runId)) ?? null;
  }

  async write(repo: string, workspace: string, run: DataflowRun): Promise<void> {
    this.runs.set(this.key(repo, workspace, run.runId), run);
  }

  async list(repo: string, workspace: string): Promise<string[]> {
    const prefix = this.wsPrefix(repo, workspace);
    const result: string[] = [];
    for (const k of this.runs.keys()) {
      if (k.startsWith(prefix)) result.push(k.slice(prefix.length));
    }
    return result;
  }

  async getLatest(repo: string, workspace: string): Promise<DataflowRun | null> {
    const prefix = this.wsPrefix(repo, workspace);
    let latest: DataflowRun | null = null;
    for (const [k, v] of this.runs) {
      if (k.startsWith(prefix)) {
        if (!latest || v.runId > latest.runId) latest = v;
      }
    }
    return latest;
  }

  async delete(repo: string, workspace: string, runId: string): Promise<void> {
    this.runs.delete(this.key(repo, workspace, runId));
  }

  clear(): void {
    this.runs.clear();
  }
}

/**
 * In-memory execution tracker for testing.
 */
export class InMemoryExecutionTracker implements ExecutionTracker {
  // Map<"repo/workspace", DataflowExecution[]>
  private executions = new Map<string, DataflowExecution[]>();
  // Map<"repo/executionId/taskName", TaskExecutionStatus>
  private tasks = new Map<string, TaskExecutionStatus>();
  // Map<"repo/executionId", DataflowEvent[]>
  private events = new Map<string, DataflowEvent[]>();
  private nextIds = new Map<string, number>();

  private wsKey(repo: string, workspace: string): string {
    return `${repo}/${workspace}`;
  }

  private taskKey(repo: string, executionId: number, taskName: string): string {
    return `${repo}/${executionId}/${taskName}`;
  }

  private eventKey(repo: string, executionId: number): string {
    return `${repo}/${executionId}`;
  }

  async createExecution(repo: string, workspace: string): Promise<DataflowExecution> {
    const wsKey = this.wsKey(repo, workspace);
    const nextId = (this.nextIds.get(wsKey) ?? 0) + 1;
    this.nextIds.set(wsKey, nextId);

    const exec: DataflowExecution = {
      id: nextId,
      repo,
      workspace,
      status: 'starting',
      startedAt: new Date().toISOString(),
      completedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      cachedCount: 0,
      eventSeq: 0,
    };

    const list = this.executions.get(wsKey) ?? [];
    list.push(exec);
    this.executions.set(wsKey, list);
    return exec;
  }

  async startExecution(
    repo: string,
    workspace: string,
    executionId: number,
    graph: string,
    taskCount: number,
  ): Promise<void> {
    const exec = await this.getExecution(repo, workspace, executionId);
    if (!exec) throw new Error(`Execution ${executionId} not found`);
    exec.status = 'running';
    exec.graph = graph;
    exec.taskCount = taskCount;
  }

  async getExecution(
    repo: string,
    workspace: string,
    executionId?: number,
  ): Promise<DataflowExecution | null> {
    const list = this.executions.get(this.wsKey(repo, workspace)) ?? [];
    if (executionId !== undefined) {
      return list.find(e => e.id === executionId) ?? null;
    }
    return list.length > 0 ? list[list.length - 1] : null;
  }

  async updateExecution(
    repo: string,
    workspace: string,
    executionId: number,
    updates: Partial<Pick<DataflowExecution, 'status' | 'completedAt' | 'completedCount' | 'failedCount' | 'skippedCount' | 'cachedCount' | 'eventSeq'>>,
  ): Promise<void> {
    const exec = await this.getExecution(repo, workspace, executionId);
    if (!exec) return;
    Object.assign(exec, updates);
  }

  async incrementExecutionCounters(
    repo: string,
    workspace: string,
    executionId: number,
    increments: { completedCount?: number; failedCount?: number; skippedCount?: number; cachedCount?: number },
  ): Promise<void> {
    const exec = await this.getExecution(repo, workspace, executionId);
    if (!exec) return;
    if (increments.completedCount) exec.completedCount += increments.completedCount;
    if (increments.failedCount) exec.failedCount += increments.failedCount;
    if (increments.skippedCount) exec.skippedCount += increments.skippedCount;
    if (increments.cachedCount) exec.cachedCount += increments.cachedCount;
  }

  async listExecutions(
    repo: string,
    workspace: string,
    limit?: number,
  ): Promise<DataflowExecution[]> {
    const list = [...(this.executions.get(this.wsKey(repo, workspace)) ?? [])];
    list.reverse(); // newest first
    return limit ? list.slice(0, limit) : list;
  }

  async getExecutionTasks(repo: string, executionId: number): Promise<TaskExecutionStatus[]> {
    const prefix = `${repo}/${executionId}/`;
    const result: TaskExecutionStatus[] = [];
    for (const [k, v] of this.tasks) {
      if (k.startsWith(prefix)) result.push(v);
    }
    return result;
  }

  async setTaskStatus(
    repo: string,
    executionId: number,
    taskName: string,
    status: Omit<TaskExecutionStatus, 'taskName'>,
  ): Promise<void> {
    this.tasks.set(this.taskKey(repo, executionId, taskName), { taskName, ...status });
  }

  async updateTaskStatus(
    repo: string,
    executionId: number,
    taskName: string,
    updates: Partial<Omit<TaskExecutionStatus, 'taskName'>>,
  ): Promise<void> {
    const key = this.taskKey(repo, executionId, taskName);
    const existing = this.tasks.get(key);
    if (existing) {
      Object.assign(existing, updates);
    }
  }

  async getExecutionEvents(
    repo: string,
    executionId: number,
    offset = 0,
    limit?: number,
  ): Promise<{ events: DataflowEvent[]; total: number }> {
    const all = this.events.get(this.eventKey(repo, executionId)) ?? [];
    const total = all.length;
    const end = limit !== undefined ? offset + limit : all.length;
    return { events: all.slice(offset, end), total };
  }

  async addExecutionEvent(
    repo: string,
    _workspace: string,
    executionId: number,
    event: Omit<DataflowEvent, 'seq'>,
  ): Promise<number> {
    const key = this.eventKey(repo, executionId);
    const list = this.events.get(key) ?? [];
    const seq = list.length + 1;
    list.push({ ...event, seq });
    this.events.set(key, list);
    return seq;
  }

  clear(): void {
    this.executions.clear();
    this.tasks.clear();
    this.events.clear();
    this.nextIds.clear();
  }
}

/**
 * In-memory dataflow orchestrator for testing.
 *
 * Records startExecution() calls for assertion, returns synthetic execution names.
 */
export class InMemoryDataflowOrchestrator implements DataflowOrchestrator {
  calls: Array<Parameters<DataflowOrchestrator['startExecution']>[0]> = [];

  async startExecution(params: Parameters<DataflowOrchestrator['startExecution']>[0]): Promise<string> {
    this.calls.push(params);
    return `test-execution-${params.repo}-${params.workspace}-${params.executionId}`;
  }

  clear(): void {
    this.calls = [];
  }
}

/**
 * In-memory scheduler service for testing.
 *
 * Records deleteSchedule() calls for assertion.
 */
export class InMemorySchedulerService implements SchedulerService {
  deletedSchedules: string[] = [];

  async deleteSchedule(schedulerName: string): Promise<void> {
    this.deletedSchedules.push(schedulerName);
  }

  clear(): void {
    this.deletedSchedules = [];
  }
}
