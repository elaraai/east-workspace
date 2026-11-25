/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Studio's pages record through a deploy (#1669, #1759) — run with
 * `E3_UI_INTEGRATION=1`, as the specs here that run on a stock runner are.
 *
 * A workspace's pages were stored with a placement holding a component's key,
 * then with a placement holding content — a component, a visual or a text
 * block. A release whose entries hold what they are, their project, their
 * title and their tags as fields of their own carries either with the pages
 * record's rows steps, `Studio.migrations.cellContent` then
 * `Studio.migrations.entryFields`, which a deploy runs on a runner:
 *
 * - **M1**: from the first form, the deploy plans both steps and applies each
 *   in a commit of its own; every placement's key is `component(key)` after
 *   them, in a page's draft, its live version and a template, each layout with
 *   no starting filters (#1673); and each entry holds its fields — a page its
 *   draft and its live version, a template its layout as its draft.
 * - **M2**: the record at the new type, without its steps, is refused, and the
 *   workspace keeps what it held.
 * - **M3**: from the second form — a workspace the first step was deployed to
 *   — the deploy plans the second step alone, and builds the indexes the
 *   release declares over the carried entries.
 *
 * What a later release that changes an entry's form owes — a step of its own —
 * is refused where the record is declared, with no deploy, as a record that
 * lists the first step alone is: e3-ui's `test/studio/migrations.spec.ts`
 * holds both.
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
type Pages = ValueTypeOf<typeof Studio.Types.Pages>;

/** One entry of the pages record as it was stored before a placement held content: the type the first step takes. */
const EntryBefore = (Expr.type(Studio.migrations.cellContent) as { inputs: readonly EastType[] }).inputs[1]!;
/** One entry as it was stored once a placement held content, before an entry held its fields: the type the second step takes. */
const EntryContent = (Expr.type(Studio.migrations.entryFields) as { inputs: readonly EastType[] }).inputs[1]!;
/** The pages record's type under each. */
const PagesBefore = DictType(Studio.Types.Key, EntryBefore);
const PagesContent = DictType(Studio.Types.Key, EntryContent);

const keys = compareFor(Studio.Types.Key);
const samePages = equalFor(Studio.Types.Pages);
const pagesPath = [variant('field', 'records'), variant('field', 'pages')];

const OVERVIEW: Key = { project: 'ops', page: 'overview' };
const DETAIL: Key = { project: 'ops', page: 'detail' };
const STARTER: Key = { project: 'ops', page: 'tpl-starter' };

/** A placement's layout and title, which the steps leave as they were. */
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
/** A layout's placements as they were first stored: each a component's key. */
const cellsBefore = (cells: Held) => cells.map(([key, row, span, title, component]) => ({ ...placed(key, row, span, title), component }));
/** The same placements, each its content. */
const cellsAfter = (cells: Held) => cells.map(([key, row, span, title, component]) => ({ ...placed(key, row, span, title), content: Studio.visual.component(component) }));

/** The record a workspace first held: a page published as v3 and edited since, a page never published, and a template. */
const SEED = new SortedMap<Key, unknown>([
    [OVERVIEW, variant('page', {
        draft: { title: 'Overview', cells: cellsBefore(HELD.overview) },
        live: some({ version: 3n, page: { title: 'Overview', cells: cellsBefore(HELD.live) } }),
    })],
    [DETAIL, variant('page', { draft: { title: 'Detail', cells: cellsBefore(HELD.detail) }, live: none })],
    [STARTER, variant('template', { title: 'Starter', cells: cellsBefore(HELD.starter) })],
], keys);

/** The same record once a placement held content: each layout with no starting filters. */
const SEED_CONTENT = new SortedMap<Key, unknown>([
    [OVERVIEW, variant('page', {
        draft: { title: 'Overview', cells: cellsAfter(HELD.overview), filters: [] },
        live: some({ version: 3n, page: { title: 'Overview', cells: cellsAfter(HELD.live), filters: [] } }),
    })],
    [DETAIL, variant('page', { draft: { title: 'Detail', cells: cellsAfter(HELD.detail), filters: [] }, live: none })],
    [STARTER, variant('template', { title: 'Starter', cells: cellsAfter(HELD.starter), filters: [] })],
], keys);

/** The same record, carried: each entry what it was, under its key's project and its layout's title, with no tags. */
const CARRIED: Pages = Studio.value([
    {
        key: OVERVIEW,
        draft: { title: 'Overview', cells: cellsAfter(HELD.overview), filters: [] },
        live: { version: 3n, page: { title: 'Overview', cells: cellsAfter(HELD.live), filters: [] } },
    },
    { key: DETAIL, draft: { title: 'Detail', cells: cellsAfter(HELD.detail), filters: [] } },
    { key: STARTER, template: { title: 'Starter', cells: cellsAfter(HELD.starter), filters: [] } },
]);

/** The release a workspace was first on: its pages stored with a component's key in each placement. */
const before1 = () => e3.package('studio', '1.0.0', e3.record('pages', PagesBefore, {
    initial: SEED as ValueTypeOf<typeof PagesBefore>,
    mutations: (mutation) => ({ patch: mutation.patch() }),
}));

/** The release after it: its placements hold content, carried there by the first step. */
const before2 = () => e3.package('studio', '1.5.0', e3.record('pages', PagesContent, {
    initial: SEED_CONTENT as ValueTypeOf<typeof PagesContent>,
    mutations: (mutation) => ({ patch: mutation.patch() }),
    migrations: (migration) => [migration.rows('cell_content', Studio.migrations.cellContent)],
}));

/** The release whose entries hold their fields, with both steps and the indexes a page lists the entries by. */
const withSteps = (version: string) => e3.package('studio', version, e3.record('pages', Studio.Types.Pages, {
    initial: Studio.value([]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
    indexes: (index) => ({
        pages_by_kind: index.on(['kind']),
        pages_by_kind_project: index.on(['kind', 'project']),
        pages_by_kind_tag: index.on(['kind', 'tags']),
        pages_by_kind_title: index.on(['kind', 'title']),
    }),
    migrations: (migration) => [
        migration.rows('cell_content', Studio.migrations.cellContent),
        migration.rows('entry_fields', Studio.migrations.entryFields),
    ],
}));

/** The same release, its steps left out. */
const withoutSteps = () => e3.package('studio', '2.0.1', e3.record('pages', Studio.Types.Pages, {
    initial: Studio.value([]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
}));

describe('the Studio\'s pages record through a deploy, from the form whose placements held a component\'s key (E3_UI_INTEGRATION=1)', { skip: !enabled }, () => {
    // A repository a test, its workspace on the release a workspace was first on.
    const suite = recordDeploy('studio-migration', before1);

    it('M1: a deploy carries the pages a workspace held — both steps, a commit each, every placement its component\'s content and every entry its fields', async () => {
        const plans = await suite.deploy(withSteps('2.0.0'));
        assert.deepEqual(plans, [{ record: 'records/pages', action: variant('migrate', { steps: ['cell_content', 'entry_fields'] }) }]);
        // Each step in a commit of its own, in order, then the indexes the release declares, built in one of theirs.
        assert.deepEqual((await suite.history('pages')).slice(0, 3), ['$reindex', '$migrate:entry_fields', '$migrate:cell_content']);

        const carried = await suite.read(pagesPath) as Pages;
        assert.ok(samePages(carried, CARRIED), 'every placement holds its component as content, and every entry what it is, its project, its title and no tags: a page its draft and its live version, the template its layout as its draft');

        // The steps are applied once: the next deploy of the release keeps the record.
        assert.deepEqual((await suite.deploy(withSteps('2.0.2'))).map((plan) => plan.action.type), ['keep']);
        assert.ok(samePages(await suite.read(pagesPath) as Pages, CARRIED));
    });

    it('M2: the record at the new type without its steps is refused, naming what changed, and the workspace keeps what it held', async () => {
        await assertRefusedWithoutStep(suite, withoutSteps(), 'pages');
    });
});

describe('the Studio\'s pages record through a deploy, from the form whose placements hold content (E3_UI_INTEGRATION=1)', { skip: !enabled }, () => {
    // A repository a test, its workspace on the release the first step was deployed with.
    const suite = recordDeploy('studio-migration-content', before2);

    it('M3: a deploy plans the second step alone — the first is the workspace\'s already — carries each entry to its fields, and builds the indexes over them', async () => {
        const plans = await suite.deploy(withSteps('2.0.0'));
        assert.deepEqual(plans, [{ record: 'records/pages', action: variant('migrate', { steps: ['entry_fields'] }) }]);
        assert.deepEqual((await suite.history('pages')).slice(0, 2), ['$reindex', '$migrate:entry_fields']);
        assert.ok(samePages(await suite.read(pagesPath) as Pages, CARRIED), 'each entry holds what it is, its project, its title and no tags, its layouts as they were');

        // The indexes, each led by what an entry is, are built over the carried entries: each by its name, whether an
        // entry may stand under several of its keys, and whether the record holds it built.
        assert.deepEqual(
            await suite.indexes('pages'),
            [['pages_by_kind', false, true], ['pages_by_kind_project', false, true], ['pages_by_kind_tag', true, true], ['pages_by_kind_title', false, true]],
            'the index on a Set files an entry once under each tag it holds',
        );
    });
});
