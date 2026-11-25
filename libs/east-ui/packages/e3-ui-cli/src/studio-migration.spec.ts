/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Studio's pages record through a deploy (#1669) — run with
 * `E3_UI_INTEGRATION=1`, as the specs here that run on a stock runner are.
 *
 * A workspace's pages were stored with a placement holding a component's key.
 * A release whose placements hold content — a component, a visual or a text
 * block — carries them with one rows step, `Studio.migrations.cellContent`,
 * which a deploy runs on a runner:
 *
 * - **M1**: the deploy plans the one step and applies it in a commit of its
 *   own, and every placement's key is `component(key)` after it, in a page's
 *   draft, its live version and a template, its layout and title as they were,
 *   each layout with no starting filters (#1673).
 * - **M2**: the record at the new type, without the step, is refused, and the
 *   workspace keeps what it held.
 *
 * What a later release that adds a kind of content owes — a step of its own —
 * is refused where the record is declared, with no deploy: e3-ui's
 * `test/studio/migrations.spec.ts` holds it.
 *
 * Each test deploys to a local repository of its own, on a runner held to this
 * checkout's build (`testing/record-deploy.ts`).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import e3 from '@elaraai/e3';
import {
    DictType, Expr, SortedMap, compareFor, equalFor, none, some, variant,
    type EastType, type ValueTypeOf,
} from '@elaraai/east';
import { Studio } from '@elaraai/e3-ui';
import { assertRefusedWithoutStep, recordDeploy } from './testing/record-deploy.js';

const enabled = process.env['E3_UI_INTEGRATION'] === '1';

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;
type Pages = ValueTypeOf<typeof Studio.Types.Pages>;

/** One entry of the pages record as it was stored before a placement held content: the type the step takes. */
const EntryBefore = (Expr.type(Studio.migrations.cellContent) as { inputs: readonly EastType[] }).inputs[1]!;
/** The pages record's type then. */
const PagesBefore = DictType(Studio.Types.Key, EntryBefore);

const keys = compareFor(Studio.Types.Key);
const samePages = equalFor(Studio.Types.Pages);
const pagesPath = [variant('field', 'records'), variant('field', 'pages')];

const OVERVIEW: Key = { project: 'ops', page: 'overview' };
const DETAIL: Key = { project: 'ops', page: 'detail' };
const STARTER: Key = { project: 'ops', page: 'tpl-starter' };

/** A placement's layout and title, which the step leaves as they were. */
const placed = (key: string, row: string, span: bigint, title: string | null) =>
    ({ key, row, span, height: span === 12n ? none : some(240n), align: variant(span === 12n ? 'top' : 'stretch', null), title: title === null ? none : some(title) });

/** The placements a workspace held: `[key, row, span, title, component]`. */
const HELD = {
    overview: [['c-kpi', 'r1', 12n, null, 'kpi_rail'], ['c-trend', 'r2', 8n, 'Revenue', 'revenue_trend'], ['c-bars', 'r2', 4n, null, 'breakdown_bars']],
    live: [['c-kpi', 'r1', 12n, null, 'kpi_rail'], ['c-trend', 'r2', 12n, null, 'revenue_trend']],
    detail: [['d-kpi', 'r1', 12n, null, 'kpi_rail']],
    starter: [['t-kpi', 't1', 12n, null, 'kpi_rail'], ['t-trend', 't2', 12n, 'Trend', 'revenue_trend']],
} as const;

type Held = readonly (readonly [string, string, bigint, string | null, string])[];
/** A layout's placements as they were stored: each a component's key. */
const cellsBefore = (cells: Held) => cells.map(([key, row, span, title, component]) => ({ ...placed(key, row, span, title), component }));
/** The same placements, carried: each its content. */
const cellsAfter = (cells: Held) => cells.map(([key, row, span, title, component]) => ({ ...placed(key, row, span, title), content: Studio.visual.component(component) }));

/** The record a workspace held: a page published as v3 and edited since, a page never published, and a template. */
const SEED = new SortedMap<Key, unknown>([
    [OVERVIEW, variant('page', {
        draft: { title: 'Overview', cells: cellsBefore(HELD.overview) },
        live: some({ version: 3n, page: { title: 'Overview', cells: cellsBefore(HELD.live) } }),
    })],
    [DETAIL, variant('page', { draft: { title: 'Detail', cells: cellsBefore(HELD.detail) }, live: none })],
    [STARTER, variant('template', { title: 'Starter', cells: cellsBefore(HELD.starter) })],
], keys);

/** The same record, carried: each layout with no starting filters. */
const CARRIED: Pages = new SortedMap<Key, Entry>([
    [OVERVIEW, variant('page', {
        draft: { title: 'Overview', cells: cellsAfter(HELD.overview), filters: [] },
        live: some({ version: 3n, page: { title: 'Overview', cells: cellsAfter(HELD.live), filters: [] } }),
    })],
    [DETAIL, variant('page', { draft: { title: 'Detail', cells: cellsAfter(HELD.detail), filters: [] }, live: none })],
    [STARTER, variant('template', { title: 'Starter', cells: cellsAfter(HELD.starter), filters: [] })],
], keys);

/** The release a workspace was on: its pages stored with a component's key in each placement. */
const before1 = () => e3.package('studio', '1.0.0', e3.record('pages', PagesBefore, {
    initial: SEED as ValueTypeOf<typeof PagesBefore>,
    mutations: (mutation) => ({ patch: mutation.patch() }),
}));

/** The release whose placements hold content, with its one step. */
const withStep = (version: string) => e3.package('studio', version, e3.record('pages', Studio.Types.Pages, {
    initial: new SortedMap<Key, Entry>([], keys),
    mutations: (mutation) => ({ patch: mutation.patch() }),
    migrations: (migration) => [migration.rows('cell_content', Studio.migrations.cellContent)],
}));

/** The same release, its step left out. */
const withoutStep = () => e3.package('studio', '2.0.1', e3.record('pages', Studio.Types.Pages, {
    initial: new SortedMap<Key, Entry>([], keys),
    mutations: (mutation) => ({ patch: mutation.patch() }),
}));

describe('the Studio\'s pages record through a deploy (E3_UI_INTEGRATION=1)', { skip: !enabled }, () => {
    // A repository a test, its workspace on the release a workspace was on.
    const suite = recordDeploy('studio-migration', before1);

    it('M1: a deploy carries the pages a workspace held — one step, one commit, every placement its component\'s content', async () => {
        const plans = await suite.deploy(withStep('2.0.0'));
        assert.deepEqual(plans, [{ record: 'records/pages', action: variant('migrate', { steps: ['cell_content'] }) }]);
        assert.equal((await suite.history('pages'))[0], '$migrate:cell_content');

        const carried = await suite.read(pagesPath) as Pages;
        assert.ok(samePages(carried, CARRIED), 'every placement holds its component as content, in the drafts, the live version and the template, its layout and title as they were');

        // The step is applied once: the next deploy of the release keeps the record.
        assert.deepEqual((await suite.deploy(withStep('2.0.2'))).map((plan) => plan.action.type), ['keep']);
        assert.ok(samePages(await suite.read(pagesPath) as Pages, CARRIED));
    });

    it('M2: the record at the new type without its step is refused, naming what changed, and the workspace keeps what it held', async () => {
        await assertRefusedWithoutStep(suite, withoutStep(), 'pages');
    });
});
