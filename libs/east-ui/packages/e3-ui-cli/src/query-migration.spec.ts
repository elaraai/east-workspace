/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's saved queries record through a deploy (#1758) — run
 * with `E3_UI_INTEGRATION=1`, as the specs here that run on a stock runner
 * are.
 *
 * A workspace's saved queries were stored without the names of the data
 * sources each reads, and without tags. A release whose saved queries hold
 * both carries them with one rows step, `Query.migrations.sourcesAndTags`,
 * which a deploy runs on a runner:
 *
 * - **M1**: the deploy plans the one step and applies it in a commit of its
 *   own; each query's sources are the names of its root and it has no tags
 *   after it, its name, description, program, root and time as they were; and
 *   the indexes the release declares over the new fields — by data source and
 *   by tag — are built over the carried rows in the commit after it, beside
 *   those by name and by when it was saved.
 * - **M2**: the record at the new type, without the step, is refused, and the
 *   workspace keeps what it held.
 *
 * What a later release that adds a field owes — a step of its own — is
 * refused where the record is declared, with no deploy: e3-ui's
 * `test/query/migrations.spec.ts` holds it.
 *
 * Each test deploys to a local repository of its own, on a runner held to this
 * checkout's build (`testing/record-deploy.ts`).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import e3 from '@elaraai/e3';
import {
    ArrayType, DictType, Expr, FloatType, IntegerType, SortedMap, SortedSet, StringType, StructType, checkJq, compareFor, equalFor, none, some, variant,
    type EastType, type ValueTypeOf,
} from '@elaraai/east';
import { Query } from '@elaraai/e3-ui';
import { assertRefusedWithoutStep, recordDeploy } from './testing/record-deploy.js';

const enabled = process.env['E3_UI_INTEGRATION'] === '1';

type SavedQuery = ValueTypeOf<typeof Query.Types.SavedQuery>;
type Saved = ValueTypeOf<typeof Query.Types.Saved>;

/** A saved query as it was stored before it held its data sources' names and its tags: the type the step takes. */
const SavedQueryBefore = (Expr.type(Query.migrations.sourcesAndTags) as { inputs: readonly EastType[] }).inputs[1]!;
/** The saved queries record's type then. */
const SavedBefore = DictType(StringType, SavedQueryBefore);

const names = compareFor(StringType);
const sameSaved = equalFor(Query.Types.Saved);
const queriesPath = [variant('field', 'records'), variant('field', 'queries')];

/** The data sources the queries read. */
const orders = e3.input('orders', ArrayType(StructType({ customer_id: StringType, id: IntegerType, total: FloatType })), variant('value', []));
const customers = e3.input('customers', DictType(StringType, StructType({ name: StringType, region: StringType })), variant('value', new Map()));
const ROOT = StructType({ orders: orders.type, customers: customers.type });

/** A program as a saved query keeps it. */
function programOf(jq: string): SavedQuery['program'] {
    const checked = checkJq(jq, ROOT, { root: true });
    if (checked.program === null) assert.fail(`${jq} does not check: ${checked.diagnostics.map((d) => d.message).join('; ')}`);
    return checked.program;
}

/** What a workspace held of each query: its name, its description, its jq, and the data sources it reads. */
const HELD = [
    { name: 'Big orders', description: some('Orders of 1,000 or more.'), jq: '.orders | map(select(.total >= 1000))', reads: [orders] },
    { name: 'Named orders', description: none, jq: '.customers as $c | .orders | map({id, name: $c[.customer_id].name})', reads: [orders, customers] },
    { name: 'Customer count', description: none, jq: '.customers | length', reads: [customers] },
] as const;

/** A held query's fields that the step leaves as they were. */
const kept = (query: typeof HELD[number]) => ({
    name: query.name,
    description: query.description,
    program: programOf(query.jq),
    root: query.reads.map((source) => ({ name: source.name, path: source.path })),
    saved_at: new Date(Date.UTC(2026, 8, 30, 9, 0)),
});

/** The record a workspace held. */
const SEED = new SortedMap<string, unknown>(HELD.map((query) => [query.name, kept(query)]), names);

/** The same record, carried: each query's sources the names of its root, and no tags. */
const CARRIED: Saved = new SortedMap<string, SavedQuery>(HELD.map((query) => [query.name, {
    ...kept(query),
    tags: new SortedSet<string>([], names),
    sources: new SortedSet(query.reads.map((source) => source.name), names),
}]), names);

/** The release a workspace was on: its saved queries stored without their sources' names or tags. */
const before1 = () => e3.package('queries', '1.0.0', orders, customers, e3.record('queries', SavedBefore, {
    initial: SEED as ValueTypeOf<typeof SavedBefore>,
    mutations: (mutation) => ({ patch: mutation.patch() }),
}));

/** The release whose saved queries hold both, with its one step and the indexes a page lists them by. */
const withStep = (version: string) => e3.package('queries', version, orders, customers, e3.record('queries', Query.Types.Saved, {
    initial: new SortedMap<string, SavedQuery>([], names),
    mutations: (mutation) => ({ patch: mutation.patch() }),
    indexes: (index) => ({
        queries_by_source: index.on(['sources']),
        queries_by_tag: index.on(['tags']),
        queries_by_name: index.on(['name']),
        queries_by_saved_at: index.on(['saved_at']),
    }),
    migrations: (migration) => [migration.rows('sources_and_tags', Query.migrations.sourcesAndTags)],
}));

/** The same release, its step left out. */
const withoutStep = () => e3.package('queries', '2.0.1', orders, customers, e3.record('queries', Query.Types.Saved, {
    initial: new SortedMap<string, SavedQuery>([], names),
    mutations: (mutation) => ({ patch: mutation.patch() }),
}));

describe('the query builder\'s saved queries record through a deploy (E3_UI_INTEGRATION=1)', { skip: !enabled }, () => {
    // A repository a test, its workspace on the release a workspace was on.
    const suite = recordDeploy('query-migration', before1);

    it('M1: a deploy carries the saved queries a workspace held — one step, one commit, each query its sources\' names and no tags — and builds the indexes over them', async () => {
        const plans = await suite.deploy(withStep('2.0.0'));
        assert.deepEqual(plans, [{ record: 'records/queries', action: variant('migrate', { steps: ['sources_and_tags'] }) }]);
        // The step in a commit of its own, then the indexes the release declares, built in one of theirs.
        assert.deepEqual((await suite.history('queries')).slice(0, 2), ['$reindex', '$migrate:sources_and_tags']);

        const carried = await suite.read(queriesPath) as Saved;
        assert.ok(sameSaved(carried, CARRIED), 'each query holds the names of the data sources it reads and no tags, and nothing else of it changed');

        // The indexes over the new fields are built over the carried rows, beside those by name and by time: each by its
        // name, whether a row may stand under several of its keys, and whether the record holds it built.
        assert.deepEqual(
            await suite.indexes('queries'),
            [['queries_by_name', false, true], ['queries_by_saved_at', false, true], ['queries_by_source', true, true], ['queries_by_tag', true, true]],
            'a Set\'s index files a query once under each data source it reads and each tag it holds',
        );

        // The step is applied once: the next deploy of the release keeps the record.
        assert.deepEqual((await suite.deploy(withStep('2.0.2'))).map((plan) => plan.action.type), ['keep']);
        assert.ok(sameSaved(await suite.read(queriesPath) as Saved, CARRIED));
    });

    it('M2: the record at the new type without its step is refused, naming what changed, and the workspace keeps what it held', async () => {
        await assertRefusedWithoutStep(suite, withoutStep(), 'queries');
    });
});
