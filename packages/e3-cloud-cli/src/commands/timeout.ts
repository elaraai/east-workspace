/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Task timeout management commands — set, get, list, remove.
 */

import type { TaskTimeout } from '@elaraai/e3-cloud-types';
import {
  listTimeout,
  getTimeout,
  setTimeout,
  setTimeoutBatch,
  removeTimeout,
} from '@elaraai/e3-cloud-client';
import { taskList } from '@elaraai/e3-api-client';
import { getValidToken } from '../credentials.js';
import { parseWorkspaceUrl, formatError, exitError, confirm } from '../utils.js';

function parseTimeout(s: string): bigint {
  const match = s.match(/^(\d+)(m|h|d)?$/);
  if (!match) {
    exitError(`Invalid timeout: ${s}. Use minutes (e.g., 120), hours (e.g., 2h), or days (e.g., 1d)`);
  }
  const value = parseInt(match![1], 10);
  const unit = match![2] ?? 'm';
  const minutes = unit === 'h' ? value * 60 : unit === 'd' ? value * 1440 : value;
  if (minutes < 1 || minutes > 43200) {
    exitError(`Timeout must be between 1 minute and 30 days (43200 minutes), got ${minutes} minutes`);
  }
  return BigInt(minutes);
}

function formatMinutes(minutes: bigint): string {
  const m = Number(minutes);
  if (m >= 1440 && m % 1440 === 0) return `${m / 1440}d`;
  if (m >= 60 && m % 60 === 0) return `${m / 60}h`;
  return `${m}m`;
}

export const timeoutCommand = {
  async set(
    url: string,
    taskNameOrPattern: string,
    options: { timeout: string; regex?: boolean }
  ): Promise<void> {
    try {
      const { baseUrl, repo, workspace } = parseWorkspaceUrl(url);
      const token = await getValidToken(baseUrl);
      const minutes = parseTimeout(options.timeout);
      const timeout: TaskTimeout = { minutes };

      if (options.regex) {
        const tasks = await taskList(baseUrl, repo, workspace, { token });
        const regex = new RegExp(taskNameOrPattern);
        const matched = tasks.filter(t => regex.test(t.name)).map(t => t.name);
        if (matched.length === 0) {
          exitError(`No tasks matched pattern: ${taskNameOrPattern}`);
        }
        console.log(`Matched ${matched.length} tasks: ${matched.join(', ')}`);
        if (!await confirm(`Set timeout ${formatMinutes(minutes)} for ${matched.length} tasks?`)) return;
        const configs = new Map<string, TaskTimeout>();
        for (const name of matched) configs.set(name, timeout);
        await setTimeoutBatch(baseUrl, repo, workspace, configs, { token });
        console.log(`Timeout ${formatMinutes(minutes)} set for ${matched.length} tasks`);
      } else {
        await setTimeout(baseUrl, repo, workspace, taskNameOrPattern, timeout, { token });
        console.log(`Timeout ${formatMinutes(minutes)} set for task '${taskNameOrPattern}'`);
      }
    } catch (err) {
      exitError(formatError(err));
    }
  },

  async get(url: string, taskName: string): Promise<void> {
    try {
      const { baseUrl, repo, workspace } = parseWorkspaceUrl(url);
      const token = await getValidToken(baseUrl);

      const timeout = await getTimeout(baseUrl, repo, workspace, taskName, { token });
      console.log(`Timeout for '${taskName}': ${formatMinutes(timeout.minutes)}`);
    } catch (err) {
      exitError(formatError(err));
    }
  },

  async list(url: string): Promise<void> {
    try {
      const { baseUrl, repo, workspace } = parseWorkspaceUrl(url);
      const token = await getValidToken(baseUrl);

      const configs = await listTimeout(baseUrl, repo, workspace, { token });
      const entries = [...configs.entries()];

      if (entries.length === 0) {
        console.log(`No timeout configs for ${repo}/${workspace} (all tasks use defaults)`);
        return;
      }

      console.log(`Timeout configs for ${repo}/${workspace}:`);
      for (const [taskName, timeout] of entries) {
        console.log(`  ${taskName.padEnd(32)} ${formatMinutes(timeout.minutes)}`);
      }
    } catch (err) {
      exitError(formatError(err));
    }
  },

  async remove(
    url: string,
    taskNameOrPattern: string,
    options: { regex?: boolean }
  ): Promise<void> {
    try {
      const { baseUrl, repo, workspace } = parseWorkspaceUrl(url);
      const token = await getValidToken(baseUrl);

      if (options.regex) {
        const tasks = await taskList(baseUrl, repo, workspace, { token });
        const regex = new RegExp(taskNameOrPattern);
        const matched = tasks.filter(t => regex.test(t.name)).map(t => t.name);
        if (matched.length === 0) {
          exitError(`No tasks matched pattern: ${taskNameOrPattern}`);
        }
        console.log(`Matched ${matched.length} tasks: ${matched.join(', ')}`);
        if (!await confirm(`Remove timeout config for ${matched.length} tasks?`)) return;
        for (const name of matched) {
          await removeTimeout(baseUrl, repo, workspace, name, { token });
        }
        console.log(`Timeout config removed for ${matched.length} tasks`);
      } else {
        await removeTimeout(baseUrl, repo, workspace, taskNameOrPattern, { token });
        console.log(`Timeout config removed for task '${taskNameOrPattern}'`);
      }
    } catch (err) {
      exitError(formatError(err));
    }
  },
};
