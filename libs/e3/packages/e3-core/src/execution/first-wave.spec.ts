/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Budget } from './budget.js';
import { LocalTaskRunner, type TaskBodyExecutor } from './LocalTaskRunner.js';

describe('how a local runner starts a split task\'s stages', () => {
  // The budget's guard runs on Linux and macOS, and on Windows none does.
  const guarded = process.platform === 'win32' ? 'measure' : 'estimate';
  const budget = () => new Budget({ cores: 4, memory: 1024 ** 3 });
  const body: TaskBodyExecutor = (_request, local) => local();
  /** A body that says whether it stops units. */
  const saying = (stopsUnits: boolean): TaskBodyExecutor => Object.assign<TaskBodyExecutor, { stopsUnits: boolean }>((_request, local) => local(), { stopsUnits });

  it('starts every unit at once under a budget whose guard runs, and one alone without it', () => {
    assert.equal(new LocalTaskRunner('repo', budget()).firstWave, guarded);
    assert.equal(new LocalTaskRunner('repo', new Budget({ cores: 4, memory: 1024 ** 3 }, { sampler: null })).firstWave, 'measure');
    assert.equal(new LocalTaskRunner('repo').firstWave, 'measure');
  });

  it('measures under a body that replaces the local one, whose units the guard may not watch, unless the body says it stops units itself', () => {
    assert.equal(new LocalTaskRunner('repo', budget(), { body }).firstWave, 'measure');
    assert.equal(new LocalTaskRunner('repo', budget(), { body: saying(false) }).firstWave, 'measure');
    assert.equal(new LocalTaskRunner('repo', budget(), { body: saying(true) }).firstWave, guarded);
    // The guard is still what stops a unit that runs here after all.
    assert.equal(new LocalTaskRunner('repo', new Budget({ cores: 4, memory: 1024 ** 3 }, { sampler: null }), { body: saying(true) }).firstWave, 'measure');
  });

  it('reads what the body says of itself, so a host that gives a runner the body says nothing for it', () => {
    // The body alone is given: no option of the runner's names what it does
    const runner = new LocalTaskRunner('repo', budget(), { body: saying(true) });
    assert.equal(runner.firstWave, guarded);
  });
});
