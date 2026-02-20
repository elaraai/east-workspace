/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { none } from '@elaraai/east';
import { handleScheduleTrigger } from './schedule-trigger.js';
import {
  createMockStorage,
  InMemoryScheduleStore,
  InMemoryDataflowOrchestrator,
} from '../testing/step-helpers.js';
import type { Schedule } from '@elaraai/e3-cloud-types';

const REPO = 'test-repo';
const WS = 'test-ws';

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    repo: REPO,
    workspace: WS,
    cronExpression: '0 2 * * *',
    timezone: 'UTC',
    forceTasks: [],
    enabled: true,
    description: none,
    createdBy: 'user-1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    schedulerName: 'e3-test-repo-test-ws',
    ...overrides,
  };
}

describe('schedule-trigger', () => {
  let mock: ReturnType<typeof createMockStorage>;
  let scheduleStore: InstanceType<typeof InMemoryScheduleStore>;
  let orchestrator: InstanceType<typeof InMemoryDataflowOrchestrator>;

  beforeEach(() => {
    mock = createMockStorage();
    scheduleStore = new InMemoryScheduleStore();
    orchestrator = new InMemoryDataflowOrchestrator();
  });

  it('skips when schedule not found', async () => {
    const result = await handleScheduleTrigger(
      { storage: mock.storage, scheduleStore, orchestrator },
      { repo: REPO, workspace: WS, schedulerExecutionId: 'sched-1', scheduledTime: '2025-01-01' },
    );

    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'not_found');
  });

  it('skips when schedule is disabled', async () => {
    await scheduleStore.put(REPO, WS, makeSchedule({ enabled: false }));

    const result = await handleScheduleTrigger(
      { storage: mock.storage, scheduleStore, orchestrator },
      { repo: REPO, workspace: WS, schedulerExecutionId: 'sched-1', scheduledTime: '2025-01-01' },
    );

    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'disabled');
  });

  it('skips when workspace does not exist', async () => {
    await scheduleStore.put(REPO, WS, makeSchedule());

    const result = await handleScheduleTrigger(
      { storage: mock.storage, scheduleStore, orchestrator },
      { repo: REPO, workspace: WS, schedulerExecutionId: 'sched-1', scheduledTime: '2025-01-01' },
    );

    assert.equal(result.status, 'skipped');
    assert.ok(result.reason === 'not_found' || result.reason === 'not_deployed');
  });
});
