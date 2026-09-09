/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import {
    createPersister, emptyState, isPersistedState, loadState, pruneTrees, repoEntry, statePath, writeStateSync,
} from './persist.js';

const scratch = fs.mkdtempSync(path.join(tmpdir(), 'e3-ui-state-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

describe('statePath', () => {
    test('$E3_UI_STATE, then $XDG_STATE_HOME, then the platform default', () => {
        assert.equal(statePath({ E3_UI_STATE: '/x/state.json', XDG_STATE_HOME: '/y' }, 'linux', '/home/u'), '/x/state.json');
        assert.equal(statePath({ XDG_STATE_HOME: '/y' }, 'linux', '/home/u'), path.join('/y', 'e3-ui', 'state.json'));
        assert.equal(statePath({}, 'linux', '/home/u'), path.join('/home/u', '.local', 'state', 'e3-ui', 'state.json'));
        assert.equal(statePath({}, 'darwin', '/Users/u'), path.join('/Users/u', '.local', 'state', 'e3-ui', 'state.json'));
        assert.equal(statePath({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'win32', 'C:\\Users\\u'), path.join('C:\\Users\\u\\AppData\\Local', 'e3-ui', 'state.json'));
        assert.equal(statePath({}, 'win32', 'C:\\Users\\u'), path.join('C:\\Users\\u', 'AppData', 'Local', 'e3-ui', 'state.json'));
    });
});

describe('loadState / writeStateSync', () => {
    test('a missing file starts fresh', () => {
        assert.deepEqual(loadState(path.join(scratch, 'missing', 'state.json')), { state: emptyState() });
    });

    test('round-trips through an atomic 0600 write', () => {
        const file = path.join(scratch, 'nested', 'state.json');
        const state = emptyState();
        state.lastRepo = './demo';
        repoEntry(state, './demo').workspace = 'main';
        writeStateSync(file, state);
        assert.deepEqual(loadState(file).state, state);
        if (process.platform !== 'win32') {
            assert.equal(fs.statSync(file).mode & 0o777, 0o600);
            assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
        }
        assert.deepEqual(fs.readdirSync(path.dirname(file)), ['state.json']);
    });

    test('a corrupt file is renamed to .bak and the state starts fresh', () => {
        const file = path.join(scratch, 'corrupt.json');
        fs.writeFileSync(file, '{ not json');
        const loaded = loadState(file);
        assert.deepEqual(loaded.state, emptyState());
        assert.equal(loaded.recoveredFrom, `${file}.bak`);
        assert.equal(fs.existsSync(file), false);
        assert.equal(fs.readFileSync(`${file}.bak`, 'utf8'), '{ not json');
    });

    test('an incompatible version is set aside the same way', () => {
        const file = path.join(scratch, 'v9.json');
        fs.writeFileSync(file, JSON.stringify({ version: 9, repos: {} }));
        assert.equal(isPersistedState({ version: 9, repos: {} }), false);
        assert.equal(isPersistedState({ version: 1, repos: {} }), true);
        assert.equal(isPersistedState(null), false);
        assert.equal(loadState(file).recoveredFrom, `${file}.bak`);
    });
});

describe('pruneTrees', () => {
    test('drops the least recently touched entries beyond the cap', () => {
        const state = emptyState();
        const a = repoEntry(state, 'a');
        const b = repoEntry(state, 'b');
        a.trees['main:.inputs.x'] = { open: {}, topRow: 0, touched: 1 };
        a.trees['main:.inputs.y'] = { open: {}, topRow: 0, touched: 5 };
        b.trees['main:.inputs.z'] = { open: {}, topRow: 0, touched: 3 };
        pruneTrees(state, 2);
        assert.deepEqual(Object.keys(a.trees), ['main:.inputs.y']);
        assert.deepEqual(Object.keys(b.trees), ['main:.inputs.z']);
    });
});

describe('createPersister', () => {
    test('debounces writes, flushes on demand, and reports write errors', async () => {
        const file = path.join(scratch, 'p', 'state.json');
        const persister = createPersister(file, emptyState(), { debounceMs: 20 });
        persister.update(s => { s.lastRepo = 'one'; });
        persister.update(s => { s.lastRepo = 'two'; });
        assert.equal(persister.dirty, true);
        assert.equal(fs.existsSync(file), false);
        await new Promise(resolve => setTimeout(resolve, 60));
        assert.equal(persister.dirty, false);
        assert.equal(loadState(file).state.lastRepo, 'two');
        persister.update(s => { s.lastRepo = 'three'; });
        persister.flush();
        assert.equal(loadState(file).state.lastRepo, 'three');
        persister.flush(); // nothing pending: a no-op

        const errors: unknown[] = [];
        const bad = createPersister(path.join(file, 'not-a-dir', 'state.json'), emptyState(), { debounceMs: 1, onError: e => errors.push(e) });
        bad.update(s => { s.lastRepo = 'x'; });
        bad.flush();
        assert.equal(errors.length, 1);
    });
});
