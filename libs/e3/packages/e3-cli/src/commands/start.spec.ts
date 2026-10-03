/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { forcedTasks } from './start.js';

describe('forcedTasks', () => {
  it('forces nothing unless told: --force every task, --force-task the tasks it names', () => {
    assert.equal(forcedTasks({}), undefined);
    assert.equal(forcedTasks({ force: false }), undefined);
    assert.equal(forcedTasks({ force: true }), true);
    assert.deepEqual(forcedTasks({ forceTask: ['import_sales', 'import_stock'] }), ['import_sales', 'import_stock']);
  });

  it('refuses --force with --force-task, which say different things', () => {
    assert.throws(() => forcedTasks({ force: true, forceTask: ['import_sales'] }), {
      message: '--force forces every task the run runs, and --force-task only the tasks it names: give one or the other',
    });
  });
});
