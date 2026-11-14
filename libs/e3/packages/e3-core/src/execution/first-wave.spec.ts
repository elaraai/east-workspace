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

  it('starts every unit at once under a budget whose guard runs, and one alone without it', () => {
    assert.equal(new LocalTaskRunner('repo', budget()).firstWave, guarded);
    assert.equal(new LocalTaskRunner('repo', new Budget({ cores: 4, memory: 1024 ** 3 }, { sampler: null })).firstWave, 'measure');
    assert.equal(new LocalTaskRunner('repo').firstWave, 'measure');
  });

  it('measures under a body that replaces the local one, whose units the guard may not watch, unless the body stops units itself', () => {
    assert.equal(new LocalTaskRunner('repo', budget(), { body }).firstWave, 'measure');
    assert.equal(new LocalTaskRunner('repo', budget(), { body, bodyStopsUnits: false }).firstWave, 'measure');
    assert.equal(new LocalTaskRunner('repo', budget(), { body, bodyStopsUnits: true }).firstWave, guarded);
    // The guard is still what stops a unit that runs here after all.
    assert.equal(new LocalTaskRunner('repo', new Budget({ cores: 4, memory: 1024 ** 3 }, { sampler: null }), { body, bodyStopsUnits: true }).firstWave, 'measure');
  });

  it('reads whether the body stops units as each stage starts, from a host that gives it as a getter', () => {
    let stops = false;
    const runner = new LocalTaskRunner('repo', budget(), { body, get bodyStopsUnits() { return stops; } });
    assert.equal(runner.firstWave, 'measure');
    stops = true;
    assert.equal(runner.firstWave, guarded);
  });
});
