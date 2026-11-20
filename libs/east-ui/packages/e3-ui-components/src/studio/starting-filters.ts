/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A page's starting filters, as the builder edits them (#1673): what every
 * reader of the page starts with, set on the rail over the canvas's grid. They
 * are the open page's draft's, held by an editing session of their own — the
 * shared session (`useEditSession`) over the draft's filters, each drafted
 * whole and keyed by the session (`randomKeys`) — joined under the canvas's one
 * history (`SnapGridEditor`'s `joined`). Each edit on the rail is one step of
 * that history, among the placements', which Undo and Redo walk in the order
 * they were made; Save sends the filters' change as its own request — one
 * patch on them alone through the record's patch write (e3-ui's
 * `saveFilters`) — beside the placements'.
 *
 * The rail edits them as it edits a reader's filters ({@link PageFilters}):
 * added after the rest, changed or removed in their place, cleared; each
 * gesture's entries are the shared list gesture's (`shared/list-gesture.ts`).
 *
 * @packageDocumentation
 */

import { useCallback, useMemo } from "react";
import { ArrayType, StringType, StructType, decodeBeast2For, encodeBeast2For, equalFor, none, some, toEastTypeValue, variant, type ValueTypeOf } from "@elaraai/east";
import { Editing, EditingDraftFieldType } from "@elaraai/east-ui/internal";
import { StudioPageFilterType } from "@elaraai/e3-ui/internal";
import {
    randomKeys, useEditSession,
    type EditHistory, type EditSession, type EditingValue, type Origin, type SnapGridEntryRef,
} from "@elaraai/east-ui-components";
import { startingOf, type PageFilter, type StartingFilter } from "../query/visual/filters.js";
import { listUpdates, type ListEntries } from "../shared/list-gesture.js";
import type { PageFilters } from "./page-filters.js";

/** A batch of the starting filters' changes, as their Apply takes it. */
export type StartingFiltersBatch = ValueTypeOf<ReturnType<typeof Editing.Types.ChangeSet<typeof StudioPageFilterType>>>;
/** What their Apply answers. */
type ApplyResult = ValueTypeOf<typeof Editing.Types.ApplyResult>;

const encodeFilters = encodeBeast2For(ArrayType(StudioPageFilterType));
const encodeFilter = encodeBeast2For(StudioPageFilterType);
const decodeBatch = decodeBeast2For(Editing.Types.ChangeSet(StudioPageFilterType));
/** The session's entries and their drafts: each filter drafted whole. */
const FILTER_TYPE = toEastTypeValue(StudioPageFilterType);
const FILTER_DRAFT_TYPE = toEastTypeValue(EditingDraftFieldType(StudioPageFilterType));
/** A filter as the canvas's history holds its sessions' entries: its key. */
const RefType = StructType({ id: StringType });
const stringEqual = equalFor(StringType);
/** Each new filter's key, as the session makes it. */
const KEYS = randomKeys();
const idOfRef = (ref: SnapGridEntryRef): string => ref.id;

/** The filters as a gesture reads them: each by its key, compared whole, held by the history by its key. */
const FILTERS: ListEntries<StartingFilter, SnapGridEntryRef> = {
    idOf: (filter) => filter.key,
    same: equalFor(StudioPageFilterType),
    wireOf: (filter) => ({ id: filter.key }),
};

/** The labels of the rail's gestures in the history, in the builder's words. */
export interface StartingFilterLabels {
    /** A filter added. */
    readonly add: string;
    /** A filter changed. */
    readonly change: string;
    /** A filter removed. */
    readonly remove: string;
    /** Every filter removed. */
    readonly clear: string;
}

/** What the starting filters' session needs. */
export interface StartingFiltersOptions {
    /** The open page's key, printed: what its session is kept under. */
    readonly page: string;
    /** The page's starting filters, as its draft saved them. */
    readonly saved: readonly StartingFilter[];
    /** Their Apply: a batch of their changes, one patch on the page's filters. */
    readonly apply: (batch: StartingFiltersBatch) => Promise<ApplyResult>;
    /** The history the canvas keeps, which every gesture of theirs is a step of. */
    readonly history: EditHistory<SnapGridEntryRef>;
    /** The builder's storage key. */
    readonly storageKey: string;
    /** The gestures' labels. */
    readonly labels: StartingFilterLabels;
    /** Told once a gesture of theirs is a step of the history. */
    readonly onEdit?: (() => void) | undefined;
}

/**
 * A page's starting filters, as the builder edits them.
 *
 * @property key - The session's key in the canvas's history
 * @property session - The session, which the canvas's history holds beside its own
 * @property drafted - The filters as the builder draws them: its drafts in place
 * @property filters - The filters as the rail edits them, each edit a step of the history
 */
export interface StartingFilters {
    /** The session's key in the canvas's history. */
    readonly key: string;
    /** The session, which the canvas's history holds beside its own. */
    readonly session: EditSession<SnapGridEntryRef>;
    /** The filters as the builder draws them: its drafts in place. */
    readonly drafted: readonly StartingFilter[];
    /** The filters as the rail edits them, each edit a step of the history. */
    readonly filters: PageFilters;
}

/**
 * The open page's starting filters, as the builder edits them — see the module docs.
 *
 * @param options - The page, its filters as saved, their Apply, the canvas's history and the labels
 * @returns The session, the filters as drafted, and the rail's edits of them
 */
export function useStartingFilters(options: StartingFiltersOptions): StartingFilters {
    const { page, saved, apply, history, storageKey, labels, onEdit } = options;
    const sourceId = `studio.filters:${page}`;
    const snapshot = useMemo(() => encodeFilters([...saved]), [saved]);
    const editing = useMemo((): EditingValue => ({
        sourceId,
        entryType: FILTER_TYPE,
        idField: some("key"),
        draftType: FILTER_DRAFT_TYPE,
        children: none,
        keyType: none,
        snapshot: some(snapshot),
        readEntry: (id: string) => {
            const filter = saved.find((held) => stringEqual(held.key, id));
            return filter === undefined ? none : some(encodeFilter(filter));
        },
        onPatch: none,
        // Apply: the batch, one patch on the page's filters through the record's patch write.
        onApply: some(variant("async", (bytes: Uint8Array) => apply(decodeBatch(bytes)))),
        // The filters' Save is the builder's own, over one entry of the pages record: it has no draft form.
        toDraft: none,
    }), [sourceId, snapshot, saved, apply]);
    const rows = useMemo(() => saved.map((filter): SnapGridEntryRef => ({ id: filter.key })), [saved]);
    const positions = useMemo(() => rows.map((_, i) => i), [rows]);
    const { session, original, available, version } = useEditSession<SnapGridEntryRef>(
        editing, undefined, rows, positions, `${storageKey}.filters`, { idOf: idOfRef, keys: KEYS, wireType: RefType });

    // The filters as the drafts stand, this moment — after a gesture in the same event too.
    const current = useCallback((): readonly StartingFilter[] => (session.applied() as readonly StartingFilter[] | undefined) ?? saved, [session, saved]);
    const drafted = useMemo(() => current(),
        // A gesture moves the session's version, not its identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [current, version]);
    /** One gesture: the filters it leaves, as one step of the canvas's history. */
    const gesture = useCallback((next: readonly StartingFilter[], origin: Origin, label: string) => {
        if (!available) return;
        const updates = listUpdates(current(), next, FILTERS, (id) => session.entries.get(id) ?? original(id));
        if (updates.length > 0 && history.record([{ key: sourceId, updates }], origin, label)) onEdit?.();
    }, [available, current, session, original, history, sourceId, onEdit]);

    const filters = useMemo((): PageFilters => {
        /** A filter as the page holds it: under a key the session makes; `undefined` where it makes none. */
        const keyed = (filter: PageFilter, taken: ReadonlySet<string>): StartingFilter | undefined => {
            const key = session.mint(undefined, taken);
            return key === undefined ? undefined : { key, source: filter.source, where: filter.where };
        };
        return {
            filters: startingOf(drafted),
            add: (filter) => {
                const made = keyed(filter, new Set());
                if (made !== undefined) gesture([...current(), made], "insert", labels.add);
            },
            change: (index, filter) => gesture(current().map((held, i) => (i === index ? { ...held, source: filter.source, where: filter.where } : held)), "typed", labels.change),
            remove: (index) => gesture(current().filter((_held, i) => i !== index), "remove", labels.remove),
            clear: () => gesture([], "remove", labels.clear),
            // The filters whole, in their places: each place keeps the key it held, and one past them is a new filter's.
            set: (next) => {
                const held = current();
                const made: StartingFilter[] = [];
                for (const [i, filter] of next.entries()) {
                    const was = held[i];
                    const one = was === undefined ? keyed(filter, new Set(made.map((m) => m.key))) : { key: was.key, source: filter.source, where: filter.where };
                    if (one === undefined) return;
                    made.push(one);
                }
                gesture(made, "typed", labels.change);
            },
        };
    }, [drafted, current, gesture, session, labels]);

    return { key: sourceId, session, drafted, filters };
}
