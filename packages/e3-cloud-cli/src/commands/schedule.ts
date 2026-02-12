/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Schedule management commands — set, get, remove, list schedules.
 */

import { some, none } from '@elaraai/east';
import {
  getSchedule,
  setSchedule,
  removeSchedule,
  listSchedules,
} from '@elaraai/e3-admin-client';
import { getValidToken } from '../credentials.js';
import { parseWorkspaceUrl, parseRepoUrl, formatError, exitError } from '../utils.js';

export const scheduleCommand = {
  async set(
    url: string,
    options: {
      cron?: string;
      forceTasks?: string;
      timezone?: string;
      description?: string;
      enabled?: string;
    }
  ): Promise<void> {
    try {
      const { baseUrl, repo, workspace } = parseWorkspaceUrl(url);
      const token = await getValidToken(baseUrl);

      // Build request — for updates, first fetch existing values
      const existing = await getSchedule(baseUrl, repo, workspace, { token });

      const cronExpression = options.cron ?? existing?.cronExpression;
      if (!cronExpression) {
        exitError('--cron is required when creating a new schedule');
      }

      const forceTaskPatterns = options.forceTasks
        ? options.forceTasks.split(',').map(s => s.trim())
        : (existing?.forceTaskPatterns ?? []);

      const enabled = options.enabled !== undefined
        ? options.enabled !== 'false'
        : (existing?.enabled ?? true);

      const schedule = await setSchedule(
        baseUrl,
        repo,
        workspace,
        {
          cronExpression,
          timezone: options.timezone ? some(options.timezone) : none,
          forceTaskPatterns,
          enabled,
          description: options.description ? some(options.description) : (existing?.description ?? none),
        },
        { token }
      );

      console.log(`Schedule ${existing ? 'updated' : 'created'} for ${repo}/${workspace}:`);
      console.log(`  Cron:            ${schedule.cronExpression}`);
      console.log(`  Timezone:        ${schedule.timezone}`);
      console.log(`  Force tasks:     ${schedule.forceTaskPatterns.join(', ') || '(none)'}`);
      console.log(`  Status:          ${schedule.enabled ? 'enabled' : 'disabled'}`);
      if (schedule.description.type === 'some') {
        console.log(`  Description:     ${schedule.description.value}`);
      }
    } catch (err) {
      exitError(formatError(err));
    }
  },

  async get(url: string): Promise<void> {
    try {
      const { baseUrl, repo, workspace } = parseWorkspaceUrl(url);
      const token = await getValidToken(baseUrl);

      const schedule = await getSchedule(baseUrl, repo, workspace, { token });

      if (!schedule) {
        console.log(`No schedule configured for ${repo}/${workspace}`);
        return;
      }

      console.log(`Schedule for ${repo}/${workspace}:`);
      console.log(`  Cron:            ${schedule.cronExpression}`);
      console.log(`  Timezone:        ${schedule.timezone}`);
      console.log(`  Force tasks:     ${schedule.forceTaskPatterns.join(', ') || '(none)'}`);
      console.log(`  Status:          ${schedule.enabled ? 'enabled' : 'disabled'}`);
      if (schedule.description.type === 'some') {
        console.log(`  Description:     ${schedule.description.value}`);
      }
      console.log(`  Last updated:    ${schedule.updatedAt}`);
    } catch (err) {
      exitError(formatError(err));
    }
  },

  async remove(url: string): Promise<void> {
    try {
      const { baseUrl, repo, workspace } = parseWorkspaceUrl(url);
      const token = await getValidToken(baseUrl);

      await removeSchedule(baseUrl, repo, workspace, { token });
      console.log(`Schedule removed for ${repo}/${workspace}`);
    } catch (err) {
      exitError(formatError(err));
    }
  },

  async list(url: string): Promise<void> {
    try {
      const { baseUrl, repo } = parseRepoUrl(url);
      const token = await getValidToken(baseUrl);

      const schedules = await listSchedules(baseUrl, repo, { token });

      if (schedules.length === 0) {
        console.log(`No schedules configured for ${repo}`);
        return;
      }

      console.log(`Schedules for ${repo}:`);
      for (const s of schedules) {
        const desc = s.description.type === 'some' ? s.description.value : '';
        const row = [
          `  ${s.workspace.padEnd(16)}`,
          `${s.cronExpression.padEnd(16)}`,
          `${s.timezone.padEnd(20)}`,
          `${(s.enabled ? 'enabled' : 'disabled').padEnd(12)}`,
          desc,
        ].join('');
        console.log(row);
      }
    } catch (err) {
      exitError(formatError(err));
    }
  },
};
