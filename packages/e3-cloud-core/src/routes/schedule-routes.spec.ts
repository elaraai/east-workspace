/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Unit tests for schedule route pure functions.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { unixCronToAws, validateCron } from './schedule-routes.js';

describe('unixCronToAws', () => {
  it('daily at 2am — dow becomes ?', () => {
    assert.strictEqual(unixCronToAws('0 2 * * *'), 'cron(0 2 * * ? *)');
  });

  it('first of month at midnight — dom specified, dow ?', () => {
    assert.strictEqual(unixCronToAws('0 0 1 * *'), 'cron(0 0 1 * ? *)');
  });

  it('weekdays Mon-Fri — dow specified, dom ?, shift 1-5 to 2-6', () => {
    assert.strictEqual(unixCronToAws('0 9 * * 1-5'), 'cron(0 9 ? * 2-6 *)');
  });

  it('Sunday (0) at 2:30pm — 0 normalizes to 1 then shifts to 2', () => {
    // Note: 0→1 (Sunday normalize), then 1→2 (Unix-to-AWS shift)
    assert.strictEqual(unixCronToAws('30 14 * * 0'), 'cron(30 14 ? * 2 *)');
  });

  it('Sunday (7) at midnight — 7 normalizes to 1 then shifts to 2', () => {
    // Note: 7→1 (Sunday normalize), then 1→2 (Unix-to-AWS shift)
    assert.strictEqual(unixCronToAws('0 0 * * 7'), 'cron(0 0 ? * 2 *)');
  });

  it('both dom and dow specified — prefers dow', () => {
    assert.strictEqual(unixCronToAws('0 0 15 * 5'), 'cron(0 0 ? * 6 *)');
  });

  it('step values — every 5 minutes', () => {
    assert.strictEqual(unixCronToAws('*/5 * * * *'), 'cron(*/5 * * * ? *)');
  });

  it('throws on 4 fields', () => {
    assert.throws(() => unixCronToAws('0 2 * *'), /expected 5 fields, got 4/i);
  });

  it('throws on 6 fields', () => {
    assert.throws(() => unixCronToAws('0 2 * * * *'), /expected 5 fields, got 6/i);
  });
});

describe('validateCron', () => {
  it('valid: daily at 2am', () => {
    assert.strictEqual(validateCron('0 2 * * *'), null);
  });

  it('valid: complex expression with lists and steps', () => {
    assert.strictEqual(validateCron('*/15 0 1,15 * *'), null);
  });

  it('invalid: 4 fields', () => {
    const result = validateCron('0 9 * *');
    assert.ok(result !== null);
    assert.match(result, /4/);
  });

  it('invalid: alpha day-of-week', () => {
    const result = validateCron('0 9 * * MON');
    assert.ok(result !== null);
    assert.match(result, /day-of-week/);
  });

  it('invalid: alpha month', () => {
    const result = validateCron('0 9 * JAN *');
    assert.ok(result !== null);
    assert.match(result, /month/);
  });
});
