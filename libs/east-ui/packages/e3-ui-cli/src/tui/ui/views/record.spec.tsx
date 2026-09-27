/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Frame specs for the record view (mock S19): the State tab over a record's
 * rows and through its indexes — the title lines, `/index`, `/find` on an
 * index's key — the History tab and its pages, and the ways in: the
 * dashboard's RECORDS table, `/record`, `/dataset .records.<name>`, a fuzzy
 * jump and a ui task's Reads tab.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { IntegerType, NullType, StringType, variant } from '@elaraai/east';
import { commitChain, dictOf, fakeRepo, type FakeApi } from '../../api.fake.js';
import { recordView } from '../../state/actions.js';
import { KEY, NOW, dashboardView, mountApp, type Mounted } from '../../testing/harness.js';

let mounted: Mounted | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

/** A ledger of 300 rows with an index by store that joins its rows and one by units that projects the store, and 250 commits. */
function repo(): FakeApi {
    const api = fakeRepo();
    api.geometry = true;
    const { type, value } = dictOf(300);
    api.record('main', {
        name: 'ledger',
        type,
        value,
        mutations: [{ name: 'set_status', form: 'patch' }, { name: 'restock', form: 'edit' }],
        indexes: [
            { name: 'by_store', keyType: StringType, valueType: NullType, entries: (_key, row) => [{ ik: (row as { store: string }).store, value: null }] },
            { name: 'by_units', keyType: IntegerType, valueType: StringType, entries: (_key, row) => [{ ik: (row as { units: bigint }).units, value: (row as { store: string }).store }] },
        ],
        commits: commitChain(250, new Date(NOW - 60_000)),
    });
    return api;
}

const shows = (m: Mounted, line: number, pattern: RegExp) => () => pattern.test(m.lines()[line] ?? '');

describe('the record view', () => {
    test('the State tab: the title lines, the rows, the footer and the hints (S19)', async () => {
        mounted = await mountApp({ api: repo(), feeds: true, view: recordView('main', 'ledger') });
        await mounted.waitFor(() => /k0000/.test(mounted!.lines()[5] ?? '') && /300 rows/.test(mounted!.lines()[2] ?? ''));
        const lines = mounted.lines();
        assert.match(lines[0]!, /^ e3-ui  demo-repo › main › ledger\s+● CONNECTED$/);
        assert.match(lines[2]!, /^ ledger   ▌1 State▐  2 History\s+RECORD · 300 rows · 2 mutations · 2 indexes$/);
        assert.match(lines[3]!, /^ \.records\.ledger · Dict<String, Struct> · 300 entries · [\d.]+ KB · [0-9a-f]{12}$/);
        assert.match(lines[4]!, /^┄+$/);
        assert.match(lines[5]!, /^▌▾ k0000\s+Bakery · 2025-09-01 00:00:00 · 1000\s+▲$/);
        assert.match(lines[6]!, /^   · Store\s+"Bakery"/);
        assert.match(lines[31]!, /^ rows 1–26 of [\d,]+ · 0\.\d\d%.*▾ expand all  ▸ collapse all  s save \.beast2$/);
        assert.match(lines[35]!, /^ ↑↓ move   → expand   ← collapse   \/find <key>   \/goto <row\|%>   \/index <name>   s save   2 history$/);
    });

    test('/index pages through an index by its key, /find searches its key, /index primary goes back', async () => {
        const api = repo();
        mounted = await mountApp({ api, feeds: true, view: recordView('main', 'ledger') });
        await mounted.waitFor(shows(mounted, 5, /k0000/));
        await mounted.type('/index by_store');
        await mounted.press(KEY.enter);
        await mounted.waitFor(shows(mounted, 5, /Bakery/));
        assert.match(mounted.lines()[3]!, /^ \.records\.ledger · index by_store · String key · joins each row · 300 entries · [\d.]+ KB$/);
        // An entry is one line until opened: the row's key and the row it names.
        assert.match(mounted.lines()[5]!, /^▌▸ Bakery\s+/);
        assert.match(mounted.lines()[6]!, /^ ▸ Bakery\s+/);
        await mounted.press(KEY.right);
        assert.match(mounted.lines()[6]!, /^   · Key\s+"k0000"/);
        assert.match(mounted.lines()[7]!, /^   ▸ Row\s+Bakery · 2025-09-01 00:00:00 · 1000/);
        await mounted.type('/find Deli');
        await mounted.press(KEY.enter);
        await mounted.waitFor(shows(mounted, 7, /^▌▸ Deli/));
        assert.match(mounted.lines()[33]!, /prefix · 100 matches from row 101/);
        assert.ok(api.calls.some(c => c.startsWith('datasetFindKey main.records.ledger') && c.includes('"index":"by_store"')));
        await mounted.press(KEY.escape);
        await mounted.type('/index by_units');
        await mounted.press(KEY.enter);
        await mounted.waitFor(shows(mounted, 3, /index by_units/));
        assert.match(mounted.lines()[3]!, /index by_units · Integer key · projects String · 300 entries/);
        await mounted.type('/index nope');
        await mounted.press(KEY.enter);
        assert.match(mounted.lines()[33]!, /ledger has no index nope — it has by_store, by_units/);
        await mounted.type('/index primary');
        await mounted.press(KEY.enter);
        await mounted.waitFor(shows(mounted, 5, /^▌▾ k0000/));
        assert.match(mounted.lines()[3]!, /^ \.records\.ledger · Dict<String, Struct> · 300 entries/);
    });

    test('/index completes the record\'s indexes, with primary first', async () => {
        mounted = await mountApp({ api: repo(), feeds: true, view: recordView('main', 'ledger') });
        await mounted.waitFor(() => /2 indexes/.test(mounted!.lines()[2] ?? ''));
        await mounted.type('/index ');
        const frame = mounted.lines();
        const first = frame.findIndex(l => /\/index\s+primary/.test(l));
        assert.ok(first > 0, frame.join('\n'));
        assert.match(frame[first]!, /\/index\s+primary\s+String key\s+the rows/);
        assert.match(frame[first + 1]!, /\/index\s+by_store\s+String key\s+joins each row/);
        assert.match(frame[first + 2]!, /\/index\s+by_units\s+Integer key\s+projects String/);
    });

    test('the History tab: newest first, the head marked, older pages read as the selection nears the last', async () => {
        const api = repo();
        // The history is held back, so the tab is seen before its first page
        // lands, however long the mount takes: nothing is counted then.
        let release!: () => void;
        api.hold = { prefix: 'recordHistory ', until: new Promise<void>((resolve) => { release = resolve; }) };
        mounted = await mountApp({ api, feeds: true, view: recordView('main', 'ledger', 'history') });
        await mounted.waitFor(shows(mounted, 6, /loading…/));
        assert.match(mounted.lines()[35]!, /esc back\s*$/);
        api.hold = null;
        release();
        await mounted.waitFor(shows(mounted, 35, /100\+ commits$/));
        const lines = mounted.lines();
        assert.match(lines[2]!, /^ ledger    1 State  ▌2 History▐\s+RECORD · 300 rows/);
        assert.match(lines[5]!, /^\s+WHEN\s+MUTATION\s+ACTOR\s+COMMIT\s*$/);
        assert.match(lines[6]!, /^ ▌2026-09-08 11:59:00\s+set_status\s+bob\s+[0-9a-f]{4}…[0-9a-f]{2}   ← head\s+▲$/);
        assert.match(lines[7]!, /^  2026-09-08 11:58:00\s+set_status\s+alice\s+[0-9a-f]{4}…[0-9a-f]{2}\s+[█│]$/);
        assert.match(lines[35]!, /^ ↑↓ move   1 state   esc back/);
        await mounted.press('G');
        await mounted.waitFor(shows(mounted, 35, /200\+ commits$/));
        await mounted.press('G');
        await mounted.waitFor(shows(mounted, 35, / 250 commits$/));
        // G goes to the oldest commit read; the page it read goes further.
        assert.match(mounted.lines()[31]!, /^ ▌2026-09-08 08:40:00\s+set_status/);
        await mounted.press('G');
        assert.match(mounted.lines()[31]!, /^ ▌2026-09-08 07:50:00\s+\$init\s+alice\s+[0-9a-f]{4}…[0-9a-f]{2}\s+▼$/);
        assert.equal(api.calls.filter(c => c.startsWith('recordHistory main.ledger ') && !c.endsWith('+1')).filter(c => !c.includes(' head+')).length, 2, 'two pages after the newest');
        await mounted.press('1');
        await mounted.waitFor(shows(mounted, 5, /k0000/));
    });

    test('the ways in: the RECORDS table, /record, /dataset .records.<name>, a fuzzy jump and a ui task\'s Reads tab', async () => {
        const api = repo();
        api.task('main', {
            name: 'board',
            status: variant('up-to-date', { cached: false }),
            inputs: [],
            dependsOn: [],
            manifest: { paths: [[variant('field', 'records'), variant('field', 'ledger')]], functions: [], records: ['ledger'], pages: [] },
        });
        mounted = await mountApp({ api, feeds: true, view: dashboardView() });
        await mounted.waitFor(() => mounted!.lines().some(l => /set_status · bob · 1m ago/.test(l)));
        const at = mounted.lines().findIndex(l => /^ RECORDS/.test(l));
        assert.match(mounted.lines()[at + 1]!, /^\s+NAME\s+ROWS\s+SIZE\s+INDEXES\s+LAST COMMIT/);
        assert.match(mounted.lines()[at + 2]!, /^  ledger\s+300\s+[\d.]+ KB\s+by_store, by_units\s+set_status · bob · 1m ago/);
        const inRecord = () => /^ ledger   ▌1 State▐/.test(mounted!.lines()[2] ?? '');
        await mounted.press('G');
        assert.match(mounted.lines()[at + 2]!, /^ ▌ledger/);
        await mounted.press(KEY.enter);
        await mounted.waitFor(inRecord);
        await mounted.press(KEY.escape);
        assert.equal(mounted.store.getState().view.kind, 'dashboard', 'back to the table');
        for (const command of ['/record ledger', '/dataset .records.ledger']) {
            await mounted.type(command);
            await mounted.press(KEY.enter);
            await mounted.waitFor(inRecord);
            await mounted.press(KEY.escape);
        }
        await mounted.type('edger');
        assert.match(mounted.lines().find(l => /record\s+ledger/.test(l)) ?? '', /record\s+ledger\s+main\s+300 rows/);
        await mounted.press(KEY.enter);
        await mounted.waitFor(inRecord);
        mounted.controller.openTask('main', 'board', 'reads');
        await mounted.waitFor(() => mounted!.lines().some(l => /RECORDS/.test(l)) && /Reads/.test(mounted!.lines()[2] ?? ''));
        await mounted.press('j');
        await mounted.press(KEY.enter);
        await mounted.waitFor(inRecord);
        assert.deepEqual(mounted.store.getState().history.map(v => v.kind), ['dashboard', 'record', 'task'], 'each opened from where it was shown, back to it');
    });
});
