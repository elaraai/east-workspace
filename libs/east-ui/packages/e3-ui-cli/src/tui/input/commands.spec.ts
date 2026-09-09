/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, describe as describeCommand, hotkeyToCommand, parseCommand, splitWords } from './commands.js';

const ok = (text: string) => {
    const r = parseCommand(text);
    assert.ok(r.ok, `${text}: ${r.ok ? '' : r.error}`);
    return r.command;
};
const bad = (text: string) => {
    const r = parseCommand(text);
    assert.ok(!r.ok, `${text} should fail`);
    return r.error;
};

describe('parseCommand', () => {
    test('navigation commands take one target', () => {
        assert.deepEqual(ok('/task forecast'), { name: 'task', target: 'forecast' });
        assert.deepEqual(ok('task forecast'), { name: 'task', target: 'forecast' });
        assert.deepEqual(ok('/input params'), { name: 'input', target: 'params' });
        assert.deepEqual(ok('/dataset .tasks.forecast.output'), { name: 'dataset', target: '.tasks.forecast.output' });
        assert.deepEqual(ok('/workspace staging'), { name: 'workspace', target: 'staging' });
        assert.deepEqual(ok('/repo https://h/repos/x'), { name: 'repo', target: 'https://h/repos/x' });
        assert.deepEqual(ok('/workspaces'), { name: 'workspaces' });
        assert.deepEqual(ok('/repos'), { name: 'repos' });
        assert.match(bad('/task'), /a name required — \/task <name>/);
        assert.match(bad('/repo'), /a path or url required/);
    });

    test('/run flags', () => {
        assert.deepEqual(ok('/run'), { name: 'run', force: false, filter: undefined, concurrency: undefined });
        assert.deepEqual(ok('/run --force --filter fore* --concurrency 8'), { name: 'run', force: true, filter: 'fore*', concurrency: 8 });
        assert.deepEqual(ok('/run --filter=fore* --concurrency=2'), { name: 'run', force: false, filter: 'fore*', concurrency: 2 });
        assert.match(bad('/run --concurrency x'), /positive integer/);
        assert.match(bad('/run --filter'), /needs a glob/);
        assert.match(bad('/run --bogus'), /unknown \/run flag --bogus/);
        assert.deepEqual(ok('/stop'), { name: 'stop' });
    });

    test('task tabs, find, goto, save', () => {
        assert.deepEqual(ok('/logs forecast'), { name: 'logs', task: 'forecast', stream: undefined });
        assert.deepEqual(ok('/logs forecast stderr'), { name: 'logs', task: 'forecast', stream: 'stderr' });
        assert.match(bad('/logs forecast both'), /stdout or stderr/);
        assert.deepEqual(ok('/runs forecast'), { name: 'runs', task: 'forecast' });
        assert.deepEqual(ok('/find k015'), { name: 'find', query: 'k015' });
        assert.deepEqual(ok('/find "k0150"'), { name: 'find', query: '"k0150"' });
        assert.deepEqual(ok('/find Bakery|2025-09'), { name: 'find', query: 'Bakery|2025-09' });
        assert.deepEqual(ok('/find press, 2'), { name: 'find', query: 'press, 2' });
        assert.match(bad('/find'), /required/);
        assert.deepEqual(ok('/goto 620000'), { name: 'goto', target: { kind: 'row', row: 620000 } });
        assert.deepEqual(ok('/goto 1,240,000'), { name: 'goto', target: { kind: 'row', row: 1240000 } });
        assert.deepEqual(ok('/goto 50%'), { name: 'goto', target: { kind: 'percent', percent: 50 } });
        assert.match(bad('/goto 0'), /1-based/);
        assert.match(bad('/goto 120%'), /0–100/);
        assert.deepEqual(ok('/save'), { name: 'save', file: undefined, force: false });
        assert.deepEqual(ok('/save out.beast2 --force'), { name: 'save', file: 'out.beast2', force: true });
    });

    test('login, quit, editing commands, unknown commands', () => {
        assert.deepEqual(ok('/login https://e3.example.com'), { name: 'login', url: 'https://e3.example.com' });
        assert.match(bad('/login e3.example.com'), /http\(s\) url/);
        assert.deepEqual(ok('/quit'), { name: 'quit', force: false });
        assert.deepEqual(ok('/quit --force'), { name: 'quit', force: true });
        assert.deepEqual(ok('/tag Weekly'), { name: 'tag', tag: 'Weekly' });
        assert.deepEqual(ok('/add'), { name: 'add', key: undefined });
        assert.deepEqual(ok('/add region'), { name: 'add', key: 'region' });
        assert.deepEqual(ok('/remove --force'), { name: 'remove', force: true });
        assert.deepEqual(ok('/apply'), { name: 'apply' });
        assert.deepEqual(ok('/discard'), { name: 'discard', then: undefined });
        assert.deepEqual(ok('/discard --then "/task forecast"'), { name: 'discard', then: '/task forecast' });
        assert.deepEqual(ok('/refresh'), { name: 'refresh' });
        assert.deepEqual(ok('/help'), { name: 'help' });
        assert.deepEqual(ok('/about'), { name: 'about' });
        assert.match(bad('/'), /type a command/);
        assert.match(bad('/bogus'), /unknown command \/bogus/);
    });

    test('splitWords honours quotes', () => {
        assert.deepEqual(splitWords('a "b c" d'), ['a', 'b c', 'd']);
        assert.deepEqual(splitWords('  x   y '), ['x', 'y']);
        assert.deepEqual(splitWords('""'), ['']);
    });

    test('every command in COMMANDS parses its usage line', () => {
        for (const c of COMMANDS) {
            const sample = c.usage
                .replace('<name>', 'x').replace('<path>', '.a').replace('<path|url>', './r').replace('<url>', 'https://h')
                .replace('[--force] [--filter g]', '--force').replace('<task> [stderr]', 't').replace('<task>', 't')
                .replace('<key|prefix|f1|f2>', 'k').replace('<row|N%>', '5').replace('[file]', '').replace('[key]', '');
            assert.ok(parseCommand(sample).ok, `${sample} parses`);
        }
    });
});

describe('describe', () => {
    const ctx = { workspace: 'main', taskCount: 6, running: false, concurrency: 4, dirty: 0 };
    test('spells the /run consequence the design shows', () => {
        assert.deepEqual(describeCommand(ok('/run --force'), ctx), { text: 'run 6 tasks in main, ignoring the cache · concurrency 4', keys: '⏎ run · esc' });
        assert.equal(describeCommand(ok('/run --filter fo* --concurrency 2'), ctx).text, 'run tasks matching fo* in main · concurrency 2');
        assert.equal(describeCommand(ok('/run'), { ...ctx, running: true }).text, 'a run is already in progress');
        assert.equal(describeCommand(ok('/stop'), { ...ctx, running: true }).text, 'cancel the run in main');
        assert.equal(describeCommand(ok('/stop'), ctx).text, 'no run in progress');
    });
    test('quit and repo mention unsaved edits', () => {
        assert.equal(describeCommand(ok('/quit'), { ...ctx, dirty: 2 }).text, 'quit with 2 unsaved edits');
        assert.equal(describeCommand(ok('/quit --force'), { ...ctx, dirty: 2 }).text, 'quit');
        assert.equal(describeCommand(ok('/repo ./x'), { ...ctx, dirty: 1 }).text, 'open ./x · 1 unsaved edits are discarded');
    });
});

describe('hotkeyToCommand', () => {
    test('r x w s t prefill their commands', () => {
        assert.equal(hotkeyToCommand('r'), '/run ');
        assert.equal(hotkeyToCommand('x'), '/stop');
        assert.equal(hotkeyToCommand('w'), '/workspaces');
        assert.equal(hotkeyToCommand('s'), '/save');
        assert.equal(hotkeyToCommand('t'), '/tag ');
        assert.equal(hotkeyToCommand('q'), undefined);
    });
});
