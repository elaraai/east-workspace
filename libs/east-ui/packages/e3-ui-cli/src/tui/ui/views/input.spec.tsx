/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Frame specs for the input view (mocks S12, S12b): the leaf editor for
 * each kind, add / remove / tag / set, the commit bar and the dirty pill,
 * apply through `datasetSet`, discard and the quit / leave confirmations,
 * the conflict banner with reload-and-replay, and a paged input.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayType, BooleanType, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType, StringType, StructType, VariantType, none, variant } from '@elaraai/east';
import { dictOf, fakeRepo, type FakeApi } from '../../api.fake.js';
import { inputView } from '../../state/actions.js';
import { KEY, mountApp, type Mounted } from '../../testing/harness.js';

let mounted: Mounted | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

const ParamsType = StructType({
    horizon_days: IntegerType,
    seasonality: VariantType({ weekly: NullType, monthly: NullType }),
    smoothing: FloatType,
    min_confidence: FloatType,
    stores: ArrayType(StringType),
    holidays: DictType(StringType, DateTimeType),
    notes: OptionType(StringType),
    enabled: BooleanType,
});

const params = () => ({
    horizon_days: 14n,
    seasonality: variant('weekly', null),
    smoothing: 0.35,
    min_confidence: 0.5,
    stores: ['Bakery', 'Deli', 'Produce'],
    holidays: new Map([['xmas', new Date('2025-12-25T00:00:00Z')]]),
    notes: none,
    enabled: true,
});

function repo(): FakeApi {
    const api = fakeRepo();
    api.input('main', { name: 'params', type: ParamsType, value: params() });
    api.input('main', { name: 'big', type: dictOf(1_200).type, value: dictOf(1_200).value });
    api.task('main', { name: 'features', status: variant('up-to-date', { cached: false }), inputs: ['.inputs.params'], dependsOn: [] });
    api.task('main', { name: 'forecast', status: variant('up-to-date', { cached: false }), inputs: ['.inputs.params', '.tasks.features.output'], dependsOn: ['features'] });
    return api;
}

const stored = (api: FakeApi) => api.stored('main', '.inputs.params')!.value as ReturnType<typeof params>;

describe('the input view', () => {
    test('edits every leaf kind, adds, removes, tags and sets, then applies (S12)', async () => {
        const api = repo();
        mounted = await mountApp({ api, feeds: true, view: inputView('main', 'params') });
        await mounted.waitFor(() => /Horizon days/.test(mounted!.frame()));
        let lines = mounted.lines();
        assert.match(lines[2]!, /^ params   ▌Value▐\s+INPUT · ● UP-TO-DATE · read by features, forecast$/);
        assert.match(lines[3]!, /^ \.inputs\.params · Struct · \d+ B · [0-9a-f]{12}$/);
        assert.match(lines[5]!, /^▌· Horizon days\s+14\s*$/);
        assert.match(lines[6]!, /^ · Seasonality\s+Weekly\s+t tag ▾\s*$/);
        assert.match(lines[9]!, /^ ▾ Stores\s+3 items\s*$/);
        assert.match(lines[13]!, /^   \+ Add item\s*$/);
        assert.match(lines[14]!, /^ ▾ Holidays\s+1 entry\s*$/);
        assert.match(lines[15]!, /^   · xmas\s+2025-12-25 00:00:00\s*$/);
        assert.match(lines[16]!, /^   \+ Add entry\s*$/);
        assert.match(lines[17]!, /^ · Notes\s+Not set\s+t set\s*$/);
        assert.match(lines[18]!, /^ · Enabled\s+true\s*$/);
        assert.match(lines[35]!, /^ e edit   a add   x remove   t tag\/set   ↑↓ move   → ←   ⏎ apply all   esc discard\s*$/);
        // A float, through the editor.
        await mounted.press('j'); await mounted.press('j'); await mounted.press('j');
        await mounted.press('e');
        lines = mounted.lines();
        assert.match(lines[8]!, /^▌· Min confidence\s+0\.5_\s+⏎ apply · esc cancel\s*$/);
        assert.match(lines[35]!, /editing$/);
        await mounted.type('x');
        await mounted.press(KEY.enter);
        assert.match(mounted.lines()[8]!, /0\.5x_\s+a number, like 0\.35/);
        await mounted.press(KEY.backspace);
        await mounted.type('7');
        await mounted.press(KEY.enter);
        lines = mounted.lines();
        assert.match(lines[8]!, /^[▌┆]· Min confidence\s+0\.57\s+edited\s*$/);
        assert.match(lines[0]!, /◆ 1 DIRTY  ● CONNECTED$/);
        assert.match(lines[31]!, /^ ◆ 1 change pending   min_confidence\s+⏎ APPLY     esc DISCARD$/);
        assert.match(lines[35]!, /dirty$/);
        // A variant tag.
        await mounted.press('k'); await mounted.press('k');
        await mounted.type('/tag monthly');
        await mounted.press(KEY.enter);
        assert.match(mounted.lines()[6]!, /^[▌┆]· Seasonality\s+Monthly\s+edited\s*$/);
        // An integer, by ⏎ on the row (nothing pending on it is not the case, so /apply-free: use e).
        await mounted.press('k');
        await mounted.press('e');
        await mounted.press(KEY.backspace); await mounted.press(KEY.backspace);
        await mounted.type('21');
        await mounted.press(KEY.enter);
        assert.match(mounted.lines()[5]!, /^[▌┆]· Horizon days\s+21\s+edited/);
        // A list item added on the Add row, then one removed.
        for (let i = 0; i < 8; i++) await mounted.press('j');
        assert.match(mounted.lines()[13]!, /^▌  \+ Add item/);
        await mounted.press('a');
        assert.match(mounted.lines()[13]!, /^▌  · Item 4\s+""/, 'the new item takes the selection, ready to edit');
        assert.match(mounted.lines()[14]!, /^   \+ Add item/);
        await mounted.press('k'); await mounted.press('k');
        assert.match(mounted.lines()[11]!, /^▌  · Item 2\s+"Deli"/);
        await mounted.press('x');
        assert.match(mounted.lines()[11]!, /^▌  · Item 2\s+"Produce"/);
        // A dictionary entry, then its datetime edited.
        for (let i = 0; i < 5; i++) await mounted.press('j');
        assert.match(mounted.lines()[16]!, /^▌  \+ Add entry/);
        await mounted.press('a');
        assert.match(mounted.lines()[33]!, /^ › \/add _/);
        await mounted.type('easter');
        await mounted.press(KEY.enter);
        // The new entry sorts first; the selection stays on its row index (now xmas).
        await mounted.press('k');
        assert.match(mounted.lines()[15]!, /^▌  · easter\s+1970-01-01 00:00:00/);
        await mounted.press('e');
        for (let i = 0; i < 24; i++) await mounted.press(KEY.backspace);
        await mounted.type('2026-04-05T00:00:00Z');
        await mounted.press(KEY.enter);
        assert.match(mounted.lines()[15]!, /^[▌┆]  · easter\s+2026-04-05 00:00:00/);
        // An option set then filled; a boolean toggled with space.
        await mounted.press('G');
        assert.match(mounted.lines()[19]!, /^▌· Enabled\s+true/);
        await mounted.press('e');
        await mounted.press(' ');
        assert.match(mounted.lines()[19]!, /false_/);
        await mounted.press(KEY.enter);
        assert.match(mounted.lines()[19]!, /^[▌┆]· Enabled\s+false\s+edited/);
        await mounted.press('k');
        await mounted.type('/tag some');
        await mounted.press(KEY.enter);
        assert.match(mounted.lines()[18]!, /^[▌┆]· Notes\s+""\s+edited/);
        await mounted.press('e');
        await mounted.type('hello');
        await mounted.press(KEY.enter);
        assert.match(mounted.lines()[18]!, /^[▌┆]· Notes\s+"hello"\s+edited/);
        assert.match(mounted.lines()[0]!, /◆ 10 DIRTY/);
        // Apply: the value lands on the server and the tree reloads clean.
        await mounted.type('/apply');
        await mounted.press(KEY.enter);
        await mounted.waitFor(() => mounted!.store.getState().edit === null);
        assert.match(mounted.lines()[33]!, /applied 10 changes to \.inputs\.params/);
        const value = stored(api);
        assert.equal(value.min_confidence, 0.57);
        assert.equal(value.horizon_days, 21n);
        assert.equal((value.seasonality as { type: string }).type, 'monthly');
        assert.deepEqual(value.stores, ['Bakery', 'Produce', '']);
        assert.deepEqual([...value.holidays.keys()].sort(), ['easter', 'xmas']);
        assert.equal(value.holidays.get('easter')?.toISOString(), '2026-04-05T00:00:00.000Z');
        assert.equal((value.notes as unknown as { type: string; value: string }).type, 'some');
        assert.equal((value.notes as unknown as { type: string; value: string }).value, 'hello');
        assert.equal(value.enabled, false);
        await mounted.waitFor(() => /^ · Horizon days\s+21\s*$/.test(mounted!.lines()[5] ?? '') && !/DIRTY/.test(mounted!.lines()[0] ?? ''));
        assert.doesNotMatch(mounted.frame(), /┆/);
    });

    test('esc asks before discarding; quitting and leaving ask too; /discard --then continues', async () => {
        const api = repo();
        mounted = await mountApp({ api, feeds: true, view: inputView('main', 'params') });
        await mounted.waitFor(() => /Horizon days/.test(mounted!.frame()));
        await mounted.press('j'); await mounted.press('j');
        await mounted.press('e');
        await mounted.type('9');
        await mounted.press(KEY.enter);
        assert.match(mounted.lines()[7]!, /^[▌┆]· Smoothing\s+0\.359\s+edited/);
        await mounted.press(KEY.escape);
        assert.match(mounted.lines()[33]!, /^ › discard 1 unsaved edit\?\s+⏎ yes · esc no/);
        await mounted.press(KEY.enter);
        assert.match(mounted.lines()[7]!, /^▌· Smoothing\s+0\.35\s*$/);
        assert.equal(mounted.store.getState().edit, null);
        await mounted.press('e');
        await mounted.type('9');
        await mounted.press(KEY.enter);
        await mounted.press('q');
        assert.match(mounted.lines()[33]!, /^ › quit with 1 unsaved edit\?/);
        await mounted.press(KEY.escape);
        assert.deepEqual(mounted.exits, []);
        await mounted.type('/task features');
        await mounted.press(KEY.enter);
        assert.match(mounted.lines()[33]!, /^ › discard 1 unsaved edit and open task features\?/);
        await mounted.press(KEY.enter);
        await mounted.waitFor(() => mounted!.store.getState().view.kind === 'task');
        assert.equal(mounted.store.getState().edit, null);
        assert.equal(stored(api).smoothing, 0.35);
    });

    test('a value changed on the server while editing: the banner, reload-and-replay, or keep editing (S12b)', async () => {
        const api = repo();
        mounted = await mountApp({ api, feeds: true, view: inputView('main', 'params') });
        await mounted.waitFor(() => /Horizon days/.test(mounted!.frame()));
        await mounted.press('j'); await mounted.press('j');
        await mounted.press('e');
        await mounted.type('9');
        await mounted.press(KEY.enter);
        api.store('main', '.inputs.params', ParamsType, { ...params(), horizon_days: 99n });
        mounted.feeds.fire('dataset:main:.inputs.params');
        await mounted.waitFor(() => /CHANGED ON THE SERVER/.test(mounted!.frame()));
        let lines = mounted.lines();
        assert.match(lines[3]!, /^ ◐ CHANGED ON THE SERVER while you were editing · [0-9a-f]{4}… → [0-9a-f]{4}…\s+⏎ reload and re-apply · esc keep editing$/);
        assert.match(lines[6]!, /^ · Horizon days\s+14/);
        assert.match(lines[8]!, /^[▌┆]· Smoothing\s+0\.359\s+edited/);
        await mounted.press(KEY.enter);
        await mounted.waitFor(() => !/CHANGED ON THE SERVER/.test(mounted!.frame()) && /Horizon days\s+99/.test(mounted!.frame()));
        lines = mounted.lines();
        assert.match(lines[5]!, /^ · Horizon days\s+99/);
        assert.match(lines[7]!, /^[▌┆]· Smoothing\s+0\.359\s+edited/);
        assert.match(lines[33]!, /reloaded [0-9a-f]{4}… and re-applied 1 change/);
        assert.match(lines[0]!, /◆ 1 DIRTY/);
        // Keep editing: the banner goes, the base stays.
        api.store('main', '.inputs.params', ParamsType, { ...params(), horizon_days: 7n });
        mounted.feeds.fire('dataset:main:.inputs.params');
        await mounted.waitFor(() => /CHANGED ON THE SERVER/.test(mounted!.frame()));
        await mounted.press(KEY.escape);
        assert.doesNotMatch(mounted.frame(), /CHANGED ON THE SERVER/);
        assert.match(mounted.lines()[5]!, /^ · Horizon days\s+99/);
        assert.match(mounted.lines()[0]!, /◆ 1 DIRTY/);
    });

    test('a paged input is read-only here', async () => {
        mounted = await mountApp({ api: repo(), feeds: true, view: inputView('main', 'big') });
        await mounted.waitFor(() => /k0000/.test(mounted!.frame()));
        assert.match(mounted.lines()[35]!, /^ paged inputs are read-only here · e3 dataset set/);
        assert.match(mounted.lines()[31]!, /read-only · e3 dataset set$/);
        await mounted.press('e');
        assert.match(mounted.lines()[33]!, /a paged input is read-only here/);
    });
});
