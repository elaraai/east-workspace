/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Compute size management commands — set, get, list, remove.
 */

import { variant } from '@elaraai/east';
import type { ComputeSize } from '@elaraai/e3-cloud-types';
import {
  listCompute,
  getCompute,
  setCompute,
  setComputeBatch,
  removeCompute,
} from '@elaraai/e3-cloud-client';
import { taskList } from '@elaraai/e3-api-client';
import { getValidToken } from '../credentials.js';
import { parseWorkspaceUrl, formatError, exitError, confirm } from '../utils.js';

const VALID_SIZES = ['serverless', 'small', 'medium', 'large', 'xlarge'] as const;

function parseComputeSize(s: string): ComputeSize {
  if (!(VALID_SIZES as readonly string[]).includes(s)) {
    exitError(`Invalid compute size: ${s}. Must be one of: ${VALID_SIZES.join(', ')}`);
  }
  return variant(s as typeof VALID_SIZES[number], null);
}

export const computeCommand = {
  async set(
    url: string,
    taskNameOrPattern: string,
    options: { size: string; regex?: boolean }
  ): Promise<void> {
    try {
      const { baseUrl, repo, workspace } = parseWorkspaceUrl(url);
      const token = await getValidToken(baseUrl);
      const size = parseComputeSize(options.size);

      if (options.regex) {
        const tasks = await taskList(baseUrl, repo, workspace, { token });
        const regex = new RegExp(taskNameOrPattern);
        const matched = tasks.filter(t => regex.test(t.name)).map(t => t.name);
        if (matched.length === 0) {
          exitError(`No tasks matched pattern: ${taskNameOrPattern}`);
        }
        console.log(`Matched ${matched.length} tasks: ${matched.join(', ')}`);
        if (!await confirm(`Set compute size '${options.size}' for ${matched.length} tasks?`)) return;
        const configs = new Map<string, ComputeSize>();
        for (const name of matched) configs.set(name, size);
        await setComputeBatch(baseUrl, repo, workspace, configs, { token });
        console.log(`Compute size '${options.size}' set for ${matched.length} tasks`);
      } else {
        await setCompute(baseUrl, repo, workspace, taskNameOrPattern, size, { token });
        console.log(`Compute size '${options.size}' set for task '${taskNameOrPattern}'`);
      }
    } catch (err) {
      exitError(formatError(err));
    }
  },

  async get(url: string, taskName: string): Promise<void> {
    try {
      const { baseUrl, repo, workspace } = parseWorkspaceUrl(url);
      const token = await getValidToken(baseUrl);

      const size = await getCompute(baseUrl, repo, workspace, taskName, { token });
      console.log(`Compute size for '${taskName}': ${size.type}`);
    } catch (err) {
      exitError(formatError(err));
    }
  },

  async list(url: string): Promise<void> {
    try {
      const { baseUrl, repo, workspace } = parseWorkspaceUrl(url);
      const token = await getValidToken(baseUrl);

      const configs = await listCompute(baseUrl, repo, workspace, { token });
      const entries = [...configs.entries()];

      if (entries.length === 0) {
        console.log(`No compute configs for ${repo}/${workspace} (all tasks use serverless)`);
        return;
      }

      console.log(`Compute configs for ${repo}/${workspace}:`);
      for (const [taskName, size] of entries) {
        console.log(`  ${taskName.padEnd(32)} ${size.type}`);
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
        if (!await confirm(`Remove compute config for ${matched.length} tasks?`)) return;
        for (const name of matched) {
          await removeCompute(baseUrl, repo, workspace, name, { token });
        }
        console.log(`Compute config removed for ${matched.length} tasks`);
      } else {
        await removeCompute(baseUrl, repo, workspace, taskNameOrPattern, { token });
        console.log(`Compute config removed for task '${taskNameOrPattern}'`);
      }
    } catch (err) {
      exitError(formatError(err));
    }
  },
};
