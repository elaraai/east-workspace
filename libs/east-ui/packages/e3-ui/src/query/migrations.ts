/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The saved queries record's migrations (#1758) — the steps a solution lists
 * in its record's `migrations`, so a deploy carries a workspace's saved
 * queries from the type an earlier release stored them as to the one this
 * release reads.
 *
 * ```ts
 * export const queries = e3.record("queries", Query.Types.Saved, {
 *     initial: new Map(),
 *     mutations: (mutation) => ({ patch: mutation.patch() }),
 *     migrations: (migration) => [migration.rows("sources_and_tags", Query.migrations.sourcesAndTags)],
 * });
 * ```
 *
 * A step's types are frozen as they were released, as the Studio's pages
 * record's are (`studio/migrations.ts`): the type it takes and the type it
 * leaves never change, whatever the saved queries' type becomes after it. So
 * each is spelled out here, a copy of what the query builder declared when the
 * step shipped, and none is read from the types it declares now — nor is what
 * the step computes: it is written out here, and a test holds it to
 * `querySources` while the two types are one. A release that changes the saved
 * queries' type adds a step that takes the type the last one leaves, and
 * spells out its own.
 *
 * jq and a dataset's path are east's and e3's own wires, read here by name: a
 * change of one changes every record that holds it, and is those packages' to
 * migrate.
 *
 * @packageDocumentation
 */

import { ArrayType, DateTimeType, East, JqType, OptionType, SetType, StringType, StructType } from "@elaraai/east";
import { TreePathType } from "@elaraai/e3-types";

// ============================================================================
// A saved query as `sources_and_tags` leaves it — frozen
// ============================================================================
//
// A copy, never edited once the step has shipped: the saved query the release
// that ships `sources_and_tags` reads. Until then it follows the query
// builder's type, held to it by `migrations.spec.ts`.

/** A data source of a saved query's root. */
const RootEntryV1 = StructType({ name: StringType, path: TreePathType });

/**
 * A saved query as `sources_and_tags` leaves it: the first type that holds
 * the names of the data sources it reads, and its tags. Frozen — see the
 * module docs.
 */
export const SavedQueryV1Type = StructType({
    name: StringType,
    description: OptionType(StringType),
    tags: SetType(StringType),
    program: JqType,
    root: ArrayType(RootEntryV1),
    sources: SetType(StringType),
    saved_at: DateTimeType,
});

/** Type representing a saved query as `sources_and_tags` leaves it. */
export type SavedQueryV1Type = typeof SavedQueryV1Type;

// ============================================================================
// sources_and_tags — a saved query names the data sources it reads, and its tags
// ============================================================================

/** A saved query as it was stored before it held its data sources' names and its tags. */
const SavedQueryBeforeSourcesType = StructType({
    name: StringType,
    description: OptionType(StringType),
    program: JqType,
    root: ArrayType(RootEntryV1),
    saved_at: DateTimeType,
});

/**
 * Carries one saved query to the type that holds the names of the data
 * sources it reads and its tags: its `sources` are the names of its root, it
 * starts with no tags, and nothing else changes — its name, its description,
 * its program, its root and when it was saved are as they were.
 *
 * @remarks
 * A solution lists it as a rows step of its saved queries record:
 * `migration.rows("sources_and_tags", Query.migrations.sourcesAndTags)`. A
 * workspace applies it once, at the deploy that brings the release in. It
 * leaves a saved query as {@link SavedQueryV1Type}, whatever the saved
 * queries' type is now: while that is the query builder's own, the step is the
 * record's last; once the type moves on, the release that moves it ships the
 * step after.
 */
export const sourcesAndTags = East.function(
    [StringType, SavedQueryBeforeSourcesType],
    SavedQueryV1Type,
    (_$, _name, saved) => ({
        name: saved.name,
        description: saved.description,
        tags: East.value(new Set<string>(), SetType(StringType)),
        program: saved.program,
        root: saved.root,
        sources: saved.root.toSet((_$2, entry) => entry.name),
        saved_at: saved.saved_at,
    }),
);

/** The saved queries record's migration steps, on the `Query` namespace. */
export interface QueryMigrationsNamespace {
    /** A saved query names the data sources it reads, and its tags ({@link sourcesAndTags}): `migration.rows("sources_and_tags", Query.migrations.sourcesAndTags)`. */
    sourcesAndTags: typeof sourcesAndTags;
}

/** The saved queries record's migration steps. */
export const QueryMigrations: QueryMigrationsNamespace = { sourcesAndTags };
