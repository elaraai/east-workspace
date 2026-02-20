/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Schedule Routes for e3 Cloud Platform
 *
 * Provides CRUD endpoints for workspace schedule management:
 * - PUT /schedule — Create or update schedule
 * - GET /schedule — Get schedule
 * - DELETE /schedule — Delete schedule
 * - GET /schedules — List schedules for repo
 */

import { Hono } from 'hono';
import { NullType, ArrayType, variant } from '@elaraai/east';
import type { AclStore, Identity, IdentityBackend } from '../interfaces.js';
import { hasAccess } from '../authz.js';
import { errorCodeToStatus } from '../errors.js';
import type { SchedulerService } from '../scheduler-service.js';
import {
  ScheduleType,
  ScheduleRequestType,
  type Schedule,
  type AuthzError,
} from '@elaraai/e3-cloud-types';
import { sendSuccess, sendError, decodeBody } from '@elaraai/e3-api-server/beast2';
import type { ScheduleStore } from '../schedule-store.js';
import type { RefStore } from '@elaraai/e3-core';

const internalError = (message: string) => variant('internal', { message });

function getIdentity(c: any, identityBackend: IdentityBackend): Identity | null {
  const env = c.env as { event: unknown };
  return identityBackend.getIdentity(env.event);
}

function authzError(error: AuthzError) {
  const status = errorCodeToStatus(error.error);
  return new Response(
    JSON.stringify({
      success: false,
      error: { type: error.error.type, message: error.message },
    }),
    { status, headers: { 'Content-Type': 'application/json' } }
  );
}

/**
 * Convert a Unix 5-field cron expression to AWS EventBridge Scheduler 6-field format.
 *
 * Unix:  min hour dom month dow
 * AWS:   cron(min hour dom month dow year)
 *
 * Rules:
 * - If both dom and dow are *, set dow to ?
 * - If dom is not *, set dow to ?
 * - If dow is not *, set dom to ?
 * - Normalize dow 0 and 7 to 1 (AWS SUN)
 * - Append * for year
 */
export function unixCronToAws(cronExpression: string): string {
  const fields = cronExpression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${fields.length}`);
  }

  let [min, hour, dom, month, dow] = fields;

  // Normalize dow: Unix uses 0-7 (0 and 7 = Sun), AWS uses 1-7 (1 = Sun)
  if (dow !== '*' && dow !== '?') {
    dow = dow.replace(/\b0\b/g, '1').replace(/\b7\b/g, '1');
    // Convert ranges like 1-5 (Mon-Fri in Unix) to 2-6 (Mon-Fri in AWS)
    // Only shift if the values are simple digits or ranges
    dow = dow.replace(/(\d+)/g, (match) => {
      const n = parseInt(match, 10);
      // Unix: 0=Sun, 1=Mon, ..., 6=Sat, 7=Sun
      // AWS:  1=Sun, 2=Mon, ..., 7=Sat
      // We already handled 0 and 7 above, so shift 1-6 to 2-7
      if (n >= 1 && n <= 6) return String(n + 1);
      return match; // 0 and 7 already handled
    });
  }

  // AWS requires exactly one of dom/dow to be ?
  if (dom === '*' && dow === '*') {
    dow = '?';
  } else if (dom !== '*' && dow !== '*') {
    // Both specified — AWS doesn't support this, prefer dow
    dom = '?';
  } else if (dom !== '*') {
    dow = '?';
  } else {
    // dow is not *
    dom = '?';
  }

  return `cron(${min} ${hour} ${dom} ${month} ${dow} *)`;
}

/**
 * Validate a Unix 5-field cron expression.
 */
export function validateCron(expr: string): string | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return `Expected 5 fields, got ${fields.length}`;
  }
  // Basic validation: each field should contain only valid cron characters
  const cronFieldPattern = /^[0-9*,\-/]+$/;
  const fieldNames = ['minute', 'hour', 'day-of-month', 'month', 'day-of-week'];
  for (let i = 0; i < 5; i++) {
    if (!cronFieldPattern.test(fields[i])) {
      return `Invalid ${fieldNames[i]} field: ${fields[i]}`;
    }
  }
  return null;
}

/**
 * Create schedule routes for workspace schedule management.
 */
export function createScheduleRoutes(
  aclStore: AclStore,
  scheduleStore: ScheduleStore,
  refStore: RefStore,
  schedulerService: SchedulerService,
  identityBackend: IdentityBackend,
) {
  const defaultTimezone = process.env.DEFAULT_TIMEZONE ?? 'UTC';

  const app = new Hono();

  // PUT /api/repos/:repo/workspaces/:ws/schedule — Create or update schedule
  app.put('/', async (c) => {
    const repo = c.req.param('repo')!;
    const workspace = c.req.param('ws')!;
    const identity = getIdentity(c, identityBackend);

    if (!identity) {
      return authzError({ error: variant('unauthorized', null), message: 'Authentication required' });
    }

    if (!await hasAccess(aclStore, repo, identity.sub, 'member', identity.isAdmin)) {
      return authzError({ error: variant('forbidden', null), message: 'You do not have access to this repository' });
    }

    try {
      const body = await decodeBody(c, ScheduleRequestType);

      // Validate cron expression
      const cronError = validateCron(body.cronExpression);
      if (cronError) {
        return sendError(ScheduleType, internalError(`Invalid cron expression: ${cronError}`));
      }

      // Validate workspace exists
      const wsState = await refStore.workspaceRead(repo, workspace);
      if (wsState === null) {
        return sendError(ScheduleType, internalError(`Workspace '${workspace}' not found`));
      }

      // Resolve timezone
      const timezone = body.timezone.type === 'some' ? body.timezone.value : defaultTimezone;

      // Generate scheduler name
      const schedulerName = `e3-${repo}-${workspace}`.slice(0, 64);

      const now = new Date().toISOString();

      // Check if schedule already exists
      const existing = await scheduleStore.get(repo, workspace);

      const schedule: Schedule = {
        repo,
        workspace,
        cronExpression: body.cronExpression,
        timezone,
        forceTasks: body.forceTasks,
        enabled: body.enabled,
        description: body.description,
        createdBy: existing?.createdBy ?? identity.sub,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        schedulerName,
      };

      // Write schedule to DynamoDB
      await scheduleStore.put(repo, workspace, schedule);

      // Convert cron to AWS format
      const awsCron = unixCronToAws(body.cronExpression);

      // EventBridge Scheduler target input with context attributes
      const targetInput = JSON.stringify({
        repo,
        workspace,
        schedulerExecutionId: '<aws.scheduler.execution-id>',
        scheduledTime: '<aws.scheduler.scheduled-time>',
      });

      const description = body.description.type === 'some'
        ? body.description.value
        : `Schedule for ${repo}/${workspace}`;

      // Create or update cloud schedule via SchedulerService
      await schedulerService.upsertSchedule({
        name: schedulerName,
        cronExpression: awsCron,
        timezone,
        enabled: body.enabled,
        description,
        targetInput,
      });

      console.log(`Schedule ${existing ? 'updated' : 'created'} for ${repo}/${workspace}: cron=${body.cronExpression}, timezone=${timezone}, enabled=${body.enabled}, by=${identity.email ?? identity.sub}`);

      return sendSuccess(ScheduleType, schedule);
    } catch (err) {
      console.error('Failed to set schedule:', err);
      return sendError(ScheduleType, internalError('Failed to set schedule'));
    }
  });

  // GET /api/repos/:repo/workspaces/:ws/schedule — Get schedule
  app.get('/', async (c) => {
    const repo = c.req.param('repo')!;
    const workspace = c.req.param('ws')!;
    const identity = getIdentity(c, identityBackend);

    if (!identity) {
      return authzError({ error: variant('unauthorized', null), message: 'Authentication required' });
    }

    if (!await hasAccess(aclStore, repo, identity.sub, 'member', identity.isAdmin)) {
      return authzError({ error: variant('forbidden', null), message: 'You do not have access to this repository' });
    }

    try {
      const schedule = await scheduleStore.get(repo, workspace);
      if (!schedule) {
        return new Response(
          JSON.stringify({ error: { type: 'not_found', message: 'No schedule found' } }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return sendSuccess(ScheduleType, schedule);
    } catch (err) {
      console.error('Failed to get schedule:', err);
      return sendError(ScheduleType, internalError('Failed to get schedule'));
    }
  });

  // DELETE /api/repos/:repo/workspaces/:ws/schedule — Delete schedule
  app.delete('/', async (c) => {
    const repo = c.req.param('repo')!;
    const workspace = c.req.param('ws')!;
    const identity = getIdentity(c, identityBackend);

    if (!identity) {
      return authzError({ error: variant('unauthorized', null), message: 'Authentication required' });
    }

    if (!await hasAccess(aclStore, repo, identity.sub, 'member', identity.isAdmin)) {
      return authzError({ error: variant('forbidden', null), message: 'You do not have access to this repository' });
    }

    try {
      const schedule = await scheduleStore.get(repo, workspace);

      if (schedule) {
        // Delete cloud schedule
        await schedulerService.deleteSchedule(schedule.schedulerName);

        // Delete DynamoDB record
        await scheduleStore.delete(repo, workspace);

        console.log(`Schedule deleted for ${repo}/${workspace} by ${identity.email ?? identity.sub}`);
      }

      return sendSuccess(NullType, null);
    } catch (err) {
      console.error('Failed to delete schedule:', err);
      return sendError(NullType, internalError('Failed to delete schedule'));
    }
  });

  return app;
}

/**
 * Create schedule list route (mounted separately at /api/repos/:repo/schedules).
 */
export function createScheduleListRoute(
  aclStore: AclStore,
  scheduleStore: ScheduleStore,
  identityBackend: IdentityBackend,
) {
  const app = new Hono();

  // GET /api/repos/:repo/schedules — List schedules for repo
  app.get('/', async (c) => {
    const repo = c.req.param('repo')!;
    const identity = getIdentity(c, identityBackend);

    if (!identity) {
      return authzError({ error: variant('unauthorized', null), message: 'Authentication required' });
    }

    if (!await hasAccess(aclStore, repo, identity.sub, 'member', identity.isAdmin)) {
      return authzError({ error: variant('forbidden', null), message: 'You do not have access to this repository' });
    }

    try {
      const schedules = await scheduleStore.listForRepo(repo);
      return sendSuccess(ArrayType(ScheduleType), schedules);
    } catch (err) {
      console.error('Failed to list schedules:', err);
      return sendError(ArrayType(ScheduleType), internalError('Failed to list schedules'));
    }
  });

  return app;
}
