/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Frame specs for the launch, refusal, help, about and too-small screens
 * (the mocks S01, S02, S13, S14, S15 are the checklist).
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { KEY, mountApp, type Mounted } from '../../testing/harness.js';
import { taskView } from '../../state/actions.js';
import { ASCII } from '../../render/glyphs.js';

let mounted: Mounted | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

describe('launch', () => {
    test('shows the wordmark, the version, the target, and the step in the command box', async () => {
        mounted = await mountApp({ session: null });
        await mounted.dispatch({ type: 'view/launchStep', step: 'starting embedded e3 api server · 127.0.0.1:41823 · reading 3 workspaces' });
        const frame = mounted.frame();
        assert.match(frame, /███████╗ ██╗ {7}█████╗  ██████╗ {3}█████╗ {7}█████╗  ██╗/);
        assert.match(frame, /e3-ui  ·  1\.0\.72/);
        assert.match(frame, /opening \.\/demo-repo/);
        assert.match(mounted.lines()[33]!, /^ › [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] starting embedded e3 api server · 127\.0\.0\.1:41823 · reading 3 workspaces/);
        assert.match(mounted.lines()[35]!, /^ Ctrl-C abort/);
    });

    test('renders the ASCII wordmark under --ascii', async () => {
        mounted = await mountApp({ session: null, glyphs: ASCII });
        assert.match(mounted.frame(), /#######\s+#\s+#####\s+######/);
        assert.doesNotMatch(mounted.frame(), /█/);
    });
});

describe('refusals', () => {
    test('not an e3 repository', async () => {
        mounted = await mountApp({ session: null, view: { kind: 'refusal', refusal: { kind: 'not-repo', target: './demo-repo' } } });
        const frame = mounted.frame();
        assert.match(frame, /✗  NOT AN E3 REPOSITORY/);
        assert.match(frame, /\.\/demo-repo has no objects\/ packages\/ executions\/ workspaces\//);
        assert.match(frame, /e3 repo create \.\/demo-repo\s+create one here/);
        assert.match(frame, /\/repo <path>\s+open a different repository/);
        assert.match(frame, /E3_REPO=<path>\s+or set the default/);
        assert.match(mounted.lines()[35]!, /q quit   \/repo <path\|url>   \/login <url>/);
    });

    test('not logged in, with /login prefilled in the box', async () => {
        mounted = await mountApp({ session: null, view: { kind: 'refusal', refusal: { kind: 'not-logged-in', origin: 'https://e3.example.com', repo: 'demo' } }, actions: [{ type: 'command/edit', text: '/login https://e3.example.com' }] });
        const frame = mounted.frame();
        assert.match(frame, /✗  NOT LOGGED IN/);
        assert.match(frame, /https:\/\/e3\.example\.com has no saved credential/);
        assert.match(frame, /e3-ui auth login https:\/\/e3\.example\.com\s+\(same store as e3 auth\)/);
        assert.match(frame, /then   e3-ui https:\/\/e3\.example\.com\/repos\/demo/);
        assert.match(mounted.lines()[33]!, /^ › \/login https:\/\/e3\.example\.com_\s+run the device-flow login\s+⏎ login · esc/);
        await mounted.press(KEY.enter);
        assert.deepEqual(mounted.logins, ['https://e3.example.com']);
    });

    test('server unreachable, and r retries', async () => {
        mounted = await mountApp({ session: null, view: { kind: 'refusal', refusal: { kind: 'unreachable', url: 'https://e3.example.com/api/repos', error: 'ECONNREFUSED', attempts: 4 } } });
        const frame = mounted.frame();
        assert.match(frame, /✗  SERVER UNREACHABLE/);
        assert.match(frame, /GET https:\/\/e3\.example\.com\/api\/repos — ECONNREFUSED after 4 attempts/);
        assert.match(frame, /r  retry now\s+waits 15s and retries by itself/);
        await mounted.press('r');
        assert.deepEqual(mounted.opened, ['https://e3.example.com']);
    });
});

describe('help', () => {
    test('has a tab per page, opens on the page it was pressed from, and lists that page\'s commands and keys', async () => {
        mounted = await mountApp({ view: taskView('main', 'forecast') });
        await mounted.press('?');
        const lines = mounted.lines();
        assert.match(lines[0]!, /^ e3-ui  demo-repo › main › forecast/);
        assert.match(lines[2]!, /^ HELP\s+1 Everywhere\s+2 Repos\s+3 Workspaces\s+4 Dashboard\s+▌5 Task▐\s+6 Input\s+esc back$/);
        await mounted.press(KEY.right);
        assert.match(mounted.lines()[2]!, /▌6 Input▐/);
        await mounted.press(KEY.tab);
        assert.match(mounted.lines()[2]!, /▌1 Everywhere▐/, 'wraps around');
        await mounted.press(KEY.shiftTab);
        assert.match(mounted.lines()[2]!, /▌6 Input▐/);
        await mounted.press('5');
        assert.match(lines[4]!, /^ COMMANDS\s+KEYS · VALUE TREE\s+KEYS · STDOUT \/ STDERR/);
        assert.match(mounted.frame(), /\/find <"key">\s+exact key/);
        assert.match(mounted.frame(), /⇧←\s+collapse subtree/);
        assert.match(mounted.frame(), /F\s+follow the tail/);
        await mounted.press('6');
        assert.match(mounted.lines()[2]!, /▌6 Input▐/);
        assert.match(mounted.frame(), /t\s+tag \/ set \/ clear/);
        await mounted.press('1');
        assert.match(mounted.frame(), /typing without \/\s+fuzzy-jumps anywhere/);
        assert.match(mounted.frame(), /MOUSE/);
        await mounted.press(KEY.escape);
        assert.equal(mounted.store.getState().view.kind, 'task');
    });
});

describe('about', () => {
    test('shows the wordmark, server, repository, terminal, state and licence rows', async () => {
        mounted = await mountApp({ view: { kind: 'dashboard', ws: 'main', list: { sel: 0, top: 0 } } });
        await mounted.press('/');
        await mounted.type('about');
        await mounted.press(KEY.enter);
        const frame = mounted.frame();
        assert.match(frame, /   ███████╗ ██╗/);
        assert.match(frame, /   e3-ui 1\.0\.72/);
        assert.match(frame, /   terminal   kitty 0\.36 · 120×36 · truecolor · mouse ●/);
        assert.match(frame, /   licence    AGPL-3\.0-or-later · commercial licence available/);
        assert.match(mounted.lines()[35]!, /^ esc back/);
    });
});
