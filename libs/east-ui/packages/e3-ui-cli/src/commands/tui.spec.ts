/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseTuiArgs, isInteractive, nonInteractiveMessage } from './tui.js';

describe('parseTuiArgs', () => {
    test('defaults the repo to $E3_REPO, then "."', () => {
        assert.equal(parseTuiArgs(undefined, undefined, {}, {}).repo, '.');
        assert.equal(parseTuiArgs(undefined, undefined, {}, { E3_REPO: '/srv/repo' }).repo, '/srv/repo');
        assert.equal(parseTuiArgs('./demo', undefined, {}, { E3_REPO: '/srv/repo' }).repo, './demo');
        assert.equal(parseTuiArgs('', undefined, {}, { E3_REPO: '' }).repo, '.');
    });

    test('passes the workspace, task and input through', () => {
        const opts = parseTuiArgs('https://h/repos/r', 'main', { task: 'forecast' }, {});
        assert.deepEqual(opts, {
            repo: 'https://h/repos/r',
            workspace: 'main',
            task: 'forecast',
            input: undefined,
            mouse: true,
            ascii: false,
        });
        assert.equal(parseTuiArgs('.', '', { input: 'params' }, {}).workspace, undefined);
        assert.equal(parseTuiArgs('.', undefined, { input: 'params' }, {}).input, 'params');
    });

    test('--task and --input are mutually exclusive', () => {
        assert.throws(() => parseTuiArgs('.', undefined, { task: 'a', input: 'b' }, {}), /mutually exclusive/);
    });

    test('--no-mouse disables mouse reporting', () => {
        assert.equal(parseTuiArgs('.', undefined, { mouse: false }, {}).mouse, false);
        assert.equal(parseTuiArgs('.', undefined, { mouse: true }, {}).mouse, true);
    });

    test('--ascii and E3_UI_ASCII=1 both switch box-drawing off', () => {
        assert.equal(parseTuiArgs('.', undefined, { ascii: true }, {}).ascii, true);
        assert.equal(parseTuiArgs('.', undefined, {}, { E3_UI_ASCII: '1' }).ascii, true);
        assert.equal(parseTuiArgs('.', undefined, {}, { E3_UI_ASCII: '0' }).ascii, false);
    });
});

describe('the TTY gate', () => {
    test('isInteractive needs both stdin and stdout to be TTYs', () => {
        assert.equal(isInteractive({ isTTY: true }, { isTTY: true }), true);
        assert.equal(isInteractive({ isTTY: true }, {}), false);
        assert.equal(isInteractive({}, { isTTY: true }), false);
        assert.equal(isInteractive({ isTTY: false }, { isTTY: true }), false);
    });

    test('the refusal names the missing TTY and points at the scriptable commands', () => {
        const message = nonInteractiveMessage({ isTTY: true }, {});
        assert.equal(message, [
            'e3-ui: interactive terminal required (stdout is not a TTY).',
            '  scripts: e3 workspace status <repo> <ws> · e3 dataset get <repo> <ws.name> -f json',
            '  help:    e3-ui --help',
        ].join('\n'));
        assert.match(nonInteractiveMessage({}, { isTTY: true }), /stdin is not a TTY/);
    });

    test('`e3-ui | cat` prints the pointer to stderr, exits 1, and never loads Ink', () => {
        // The built CLI, run with piped stdio (no TTY on either end). NODE_DEBUG=module
        // lists every module load on stderr; `ink` must not be among them.
        const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.js');
        const result = spawnSync(process.execPath, [cli], {
            encoding: 'utf8',
            env: { ...process.env, NODE_DEBUG: 'module', E3_REPO: '' },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        assert.equal(result.status, 1);
        assert.equal(result.stdout, '');
        assert.match(result.stderr, /e3-ui: interactive terminal required \(stdout is not a TTY\)\./);
        assert.match(result.stderr, /e3 workspace status <repo> <ws>/);
        assert.doesNotMatch(result.stderr, /node_modules[\\/]ink[\\/]/);
        assert.doesNotMatch(result.stderr, /[\\/]tui[\\/]app\.js/);
    });

    test('`e3-ui --help` lists the root arguments, the auth group and the unchanged verbs', () => {
        const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.js');
        const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
        assert.equal(result.status, 0);
        assert.match(result.stdout, /^Usage: e3-ui \[options\] \[command\] \[repo\] \[workspace\]/);
        assert.match(result.stdout, /-t, --task <name>\s+open a task on start/);
        assert.match(result.stdout, /-i, --input <name>\s+open an input on start/);
        assert.match(result.stdout, /--no-mouse\s+disable mouse reporting/);
        assert.match(result.stdout, /--ascii\s+box-drawing off/);
        assert.match(result.stdout, /auth\s+login \/ logout \/ status \/ token \/ whoami/);
        for (const verb of ['shot [options]', 'shots [options] [paths...]', 'install-browser [options]', 'doctor']) {
            assert.ok(result.stdout.includes(verb), `help lists ${verb}`);
        }
    });

    test('`e3-ui auth status` is e3 auth status (the same store)', () => {
        const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.js');
        // An empty credentials file → the same two lines `e3 auth status` prints.
        const result = spawnSync(process.execPath, [cli, 'auth', 'status'], {
            encoding: 'utf8',
            env: { ...process.env, E3_CREDENTIALS_PATH: join(dirname(fileURLToPath(import.meta.url)), 'no-such-credentials.json') },
        });
        assert.equal(result.status, 0);
        assert.equal(result.stdout, 'No saved credentials.\nRun: e3 login <server>\n');
    });
});
