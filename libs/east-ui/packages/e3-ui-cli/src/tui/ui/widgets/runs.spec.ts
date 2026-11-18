/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { none, some, variant } from '@elaraai/east';
import { runInputName } from './runs.js';

describe('the name a run gives one of its task\'s inputs', () => {
    const jobs = [variant('field', 'records'), variant('field', 'jobs')];

    test('an input by its bare name, any other dataset by its path', () => {
        assert.equal(runInputName({ path: [variant('field', 'inputs'), variant('field', 'params')], index: none }), 'params');
        assert.equal(runInputName({ path: [variant('field', 'tasks'), variant('field', 'features'), variant('field', 'output')], index: none }), '.tasks.features.output');
        assert.equal(runInputName({ path: jobs, index: none }), '.records.jobs');
    });

    test('an index of a record by the index and its record, apart from the record beside it', () => {
        assert.equal(runInputName({ path: jobs, index: some('jobs_by_press') }), 'jobs_by_press of .records.jobs');
        assert.notEqual(runInputName({ path: jobs, index: some('jobs_by_press') }), runInputName({ path: jobs, index: none }));
    });
});
