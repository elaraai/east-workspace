/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Find state (#1504, `Flowchart Records Spec.md` R17): the toolbar's search
 * over the states — the shared key search's item (`useKeySearchToolbarItem`),
 * its box folding to its icon.
 *
 * - **States read through their source of the rail** are sought in their
 *   record through e3, as the Schematic's kinds are (`schematic/find.ts`):
 *   `recordSliceSeek` with no narrowing places the query's matches by key,
 *   `recordSlicePage` reads the rows a list shows by their place, each made
 *   its roles by the kind's `read`, and `recordSliceWithin` asks, in one
 *   request, which of them the rail's narrowing holds — so a state the
 *   narrowing hides is found by its key.
 * - **The states the canvas draws** are sought by key and by label: those a
 *   key's start, a quoted key or a range finds, and — for bare text — those
 *   whose label holds it, in any case. Beside a record sought through e3 they
 *   add what its matches leave out: a state found by its label alone, and a new
 *   one, which the record holds no row of yet.
 *
 * Keys are case-sensitive, as every builder's Search Records takes them, and
 * sought at the states' key type (#1549): a String key by its start, any other
 * as typed — `10` finds the state keyed by the number 10 — and the empty box
 * lists the first states only where they are keyed by String. The matches are
 * one list: the record's in its keys' order, then the drawn states' in theirs,
 * at their type. A line names a state by its key, its label where it has
 * one, and — where the narrowing leaves it out — which of the rail's choices
 * do, in the shared hidden pick's words (`shared/schedule/hidden.ts`), asked
 * of e3 for the rows a list shows, or, under `"dim"`, the words for a row
 * drawn as context. A pick hands the frame the state and what leaves it out
 * (`onPick`): the frame clears just those choices and selects the state once
 * it is drawn as itself. The box asks its query again as the record, its
 * narrowing or the drawn states move — a pick standing — and lists its lines
 * again as e3 says which choices leave a row out, or as the narrowing comes to
 * dim or to hide what it leaves out (`relist`).
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StringType, equalFor, match, none, printFor, type ValueTypeOf, type option } from "@elaraai/east";
import { RecordSliceWhereType, findKeyInline, type DatasetKeyMatchRange, type DatasetKeyQuery, type RecordSliceBindType } from "@elaraai/east-ui/internal";
import { useTrackedEvaluation, type KeySearchSource } from "@elaraai/east-ui-components";
import { awaitTracked, recordSlicePage, recordSliceRevision, recordSliceSeek, recordSliceWithin, toSeekQuery } from "@elaraai/east-ui-components/internal";
import { askHiding, hiddenLine, hiddenOf, useRelist, type RowHidden, type SourceHidden } from "../shared/schedule/hidden.js";
import { STRING_KEYS, type KindKeys } from "../shared/schedule/kind-keys.js";
import type { RowCodec } from "../shared/schedule/records.js";
import type { HiddenWords } from "../shared/schedule/words.js";
import type { FlowchartMessages, FlowchartWords } from "./messages.js";
import type { FlowchartStateRoles } from "./model.js";

const keyEqual = equalFor(StringType);
const printWhere = printFor(RecordSliceWhereType);

/** No narrowing: the record's own rows, in its order. */
const WHOLE: ValueTypeOf<typeof RecordSliceWhereType> = new Map();

/** An empty box lists the first of the states. */
const BROWSE_QUERY: DatasetKeyQuery = { prefix: "" };

/** An Option's value, or `undefined`. */
const someOf = <T,>(opt: option<T>): T | undefined => match(opt, { some: (value) => value }, undefined);

/** A record Slice's part: the states' source of the rail. */
type RecordPart = ValueTypeOf<RecordSliceBindType>;

/** An entry of a record's page, as every record Slice binding reads one: its key, at the record's key type, and its row, joined. */
interface RecordEntry {
    readonly key: unknown;
    readonly row: option<unknown>;
}

/** One state as Find seeks it among those the canvas draws: its key, its label, and whether it draws as context. */
export interface FindableState {
    /** Its key. */
    readonly key: string;
    /** Its card's name; `undefined` for none. */
    readonly label: string | undefined;
    /** Whether the narrowing leaves it out, drawn as context (`"dim"`). */
    readonly dimmed: boolean;
}

/** One state Find found. */
export interface FoundState {
    /** Its key. */
    readonly key: string;
    /** Its card's name — the drafts in place, where the canvas draws it; `undefined` for none. */
    readonly label: string | undefined;
    /**
     * What leaves it out on the rail — the states' source, and which of its choices e3 has said do (the shared hidden
     * pick) — which a pick of it clears; `undefined` while the narrowing holds it.
     */
    readonly hidden: readonly RowHidden[] | undefined;
}

/**
 * The words a line names the choices that leave a state out in, where the narrowing draws what it leaves out as context
 * (`"dim"`): they dim it, never hide it.
 *
 * @param m - The Flowchart's message table
 * @returns Its dimmed words, as the shared hidden pick's line takes them
 */
function dimmedWords(m: FlowchartMessages): HiddenWords {
    return { hiddenByFilters: m.dimmedByFilters, hiddenBy: m.dimmedBy };
}

/**
 * How a found state reads in Find's list: its key, its label where it is not its key, and — where the narrowing leaves
 * it out — which of the rail's choices do (`hiddenLine`), or, under `"dim"`, which dim it.
 *
 * @param found - The state
 * @param words - The Flowchart's words
 * @param dim - Whether the narrowing draws what it leaves out as context (`"dim"`), rather than hiding it
 * @returns Its line
 */
export function foundLine(found: FoundState, words: FlowchartWords, dim: boolean): string {
    const named = found.label === undefined || keyEqual(found.label, found.key) ? [found.key] : [found.key, found.label];
    const hidden = found.hidden === undefined ? [] : [hiddenLine(found.hidden, words, dim ? dimmedWords(words.m) : words.m)];
    return [...named, ...hidden].join(" · ");
}

/**
 * The drawn states a query finds, in East's order of their keys at the states' key type (see the module docs): those its
 * key finds — a key's start, a quoted key, a range, as the server finds a key (`findKeyInline`) — but those `listed` says
 * the record's matches hold; and, for bare text, those whose label holds it, in any case.
 *
 * @param states - The states the canvas draws, in any order
 * @param query - The query the box parsed
 * @param locale - The app's locale, which a label and the text are compared in
 * @param listed - Whether the record's matches list a state its key finds: one the states' read holds, where the record is
 *   sought through e3; none where it is not
 * @param keys - The states' keys (#1549): each key's text read back once at their key type, and their order; String's by default
 * @returns The states found, in key order
 */
export function drawnMatches(states: readonly FindableState[], query: DatasetKeyQuery, locale: string,
    listed: (key: string) => boolean, keys: KindKeys = STRING_KEYS): FindableState[] {
    const byText = new Map(states.map((state) => [state.key, state] as const));
    const order = keys.order(byText.keys());
    const sorted = order.map(({ text }) => byText.get(text)!);
    // The keys the query is sought among: a text no key prints as is found by its label alone.
    const sought = order.filter(({ key }) => key !== undefined);
    const range = findKeyInline(keys.keyType, sought.map(({ key }) => key), query);
    const byKey = new Set(range.found ? sought.slice(range.row, range.row + range.count).map(({ text }) => text) : []);
    // Bare text finds a label that holds it too.
    const text = "prefix" in query && !("fields" in query) ? query.prefix.toLocaleLowerCase(locale) : undefined;
    return sorted.filter((state) => (byKey.has(state.key)
        ? !listed(state.key)
        : text !== undefined && text.length > 0 && state.label !== undefined && state.label.toLocaleLowerCase(locale).includes(text)));
}

/** What the last find found: the record's matches, from `start` in its own order — sought through e3 — then the drawn states'. */
interface Found {
    /** The record's matches: the states' source, where they start, and how many; `undefined` for states read whole. */
    readonly record: { readonly part: RecordPart; readonly start: number; readonly count: number } | undefined;
    /** The drawn states' matches, in key order. */
    readonly drawn: readonly FindableState[];
}

/** Nothing found. */
const NOTHING: Found = { record: undefined, drawn: [] };

/** A state's label as a line names it: none for an empty one. */
function labelOf(roles: FlowchartStateRoles): string | undefined {
    return roles.label.length === 0 ? undefined : roles.label;
}

/** Props of {@link useFlowchartFind}. */
export interface FlowchartFindProps {
    /** The states' source of the rail, whose record they are sought in through e3; `undefined` for states read whole. */
    readonly part: RecordPart | undefined;
    /** A stored state's roles, from its bytes and its key: the states' `read`. */
    readonly read: (bytes: Uint8Array, key: string) => FlowchartStateRoles;
    /** The states' rows, as bytes and back. */
    readonly codec: RowCodec;
    /** The states' keys (#1549): the key type the box parses typed text at, each key's text, and their order. */
    readonly keys: KindKeys;
    /** The states the canvas draws, the drafts in place — as themselves or as context — never a ghost. */
    readonly drawn: readonly FindableState[];
    /** The states the read holds, by key: a drawn state of one is listed among the record's matches, found by its key. */
    readonly stored: ReadonlyMap<string, unknown>;
    /** The states' hidden pick (`hidden-pick.tsx`' `HideSources`); `undefined` for states read whole. */
    readonly pick: SourceHidden | undefined;
    /** Whether the narrowing draws what it leaves out as context (`"dim"`): a line names the choices that dim a state. */
    readonly dim: boolean;
    /** The Flowchart's words. */
    readonly words: FlowchartWords;
    /** Told the state a pick lands on. */
    readonly onPick: (found: FoundState) => void;
}

/**
 * Find state's source, for the shared key search's toolbar item (see the module docs).
 *
 * @param props - The states' source, their read, their keys, the drawn states, the hidden pick, whether the narrowing dims,
 *   the words and the pick
 * @returns The source; `undefined` with no state to seek — none drawn, and none sought through e3
 */
export function useFlowchartFind({ part, read, codec, keys, drawn, stored, pick, dim, words, onPick }: FlowchartFindProps): KeySearchSource | undefined {
    // What a find reads, and whom a pick tells: the latest — the box calls what it captured before the find answered.
    const latest = useRef({ part, read, codec, keys, drawn, stored, pick, dim, words, onPick });
    useLayoutEffect(() => { latest.current = { part, read, codec, keys, drawn, stored, pick, dim, words, onPick }; });
    // What the last find found; a find answered after a newer one asked finds nothing here.
    const found = useRef<Found>(NOTHING);
    const asked = useRef(0);
    const find = useCallback(async (query: DatasetKeyQuery): Promise<DatasetKeyMatchRange> => {
        const mine = ++asked.current;
        const { part: source, keys: stateKeys, drawn: states, stored: held, words: w } = latest.current;
        let record: Found["record"];
        if (source !== undefined) {
            const range = await awaitTracked(() => recordSliceSeek(source, WHOLE, toSeekQuery(query)));
            record = { part: source, start: range.found ? Number(range.row) : 0, count: range.found ? Number(range.count) : 0 };
        }
        const matches = drawnMatches(states, query, w.locale, (key) => source !== undefined && held.has(key), stateKeys);
        if (mine === asked.current) found.current = { record, drawn: matches };
        const count = (record?.count ?? 0) + matches.length;
        return { found: count > 0, row: 0, count };
    }, []);
    /** The matches at the list's rows `[row, row + limit)`, each with the row it is at. */
    const statesAt = useCallback(async (row: number, limit: number): Promise<{ at: number; state: FoundState }[]> => {
        const { record, drawn: matches } = found.current;
        const { read: readRoles, codec: rows, keys: stateKeys, drawn: states, pick: hidden } = latest.current;
        const out: { at: number; state: FoundState }[] = [];
        const inRecord = record?.count ?? 0;
        if (record !== undefined && row < inRecord) {
            const { part: source } = record;
            const from = record.start + row;
            const n = Math.min(limit, inRecord - row);
            // Each entry by its key's text (#1549), the narrowing asked of it at its key.
            const entries = await awaitTracked(() => recordSlicePage(source, { where: WHOLE, area: none }, BigInt(from), BigInt(n))) as readonly RecordEntry[];
            const listed = entries.map((entry) => ({ key: stateKeys.textOf(entry.key), at: entry.key, row: someOf(entry.row) }));
            const present = listed.flatMap(({ key, at, row: value }) => (value === undefined ? [] : [{ key, at, row: value }]));
            const where = source.read().where;
            const within = where.size === 0 ? undefined
                : await awaitTracked(() => recordSliceWithin(source, where, present.map(({ at, row: value }) => ({ key: at, row: value }))));
            // Whether the narrowing holds each row read; every entry of the page with it — one with no row asks nothing.
            const held = present.map((_row, i) => within === undefined || within[i] === true);
            let at = 0;
            const holds = listed.map(({ row: value }) => (value === undefined ? true : held[at++]!));
            if (within !== undefined && hidden !== undefined) hidden.rows.askListed(from, listed.map(({ key }) => key), holds);
            // A state the canvas draws is named as it draws it, the drafts in place.
            const labels = new Map(states.map((state) => [state.key, state.label] as const));
            present.forEach(({ key, row: value }, i) => out.push({
                at: row + i,
                state: {
                    key,
                    label: labels.has(key) ? labels.get(key) : labelOf(readRoles(rows.encode(value), key)),
                    hidden: held[i] || hidden === undefined ? undefined : hiddenOf([{ pick: hidden, id: key }]),
                },
            }));
        }
        const from = Math.max(row, inRecord) - inRecord;
        const to = row + limit - inRecord;
        if (to > from) {
            const listed = matches.slice(from, to);
            // A state drawn as context is left out by the narrowing: e3 is asked which choices dim it.
            if (hidden !== undefined) askHiding(listed.filter((state) => state.dimmed).map((state) => ({ pick: hidden, id: state.key })), true);
            listed.forEach((state, i) => out.push({
                at: inRecord + from + i,
                state: {
                    key: state.key, label: state.label,
                    hidden: state.dimmed && hidden !== undefined ? hiddenOf([{ pick: hidden, id: state.key }]) : undefined,
                },
            }));
        }
        return out;
    }, []);
    const listRange = useCallback(async (row: number, limit: number) => {
        const { words: w, dim: dimmed } = latest.current;
        // A pick shows the state's key in the box: what its query is typed against.
        return (await statesAt(row, limit)).map(({ at, state }) => ({ row: at, label: foundLine(state, w, dimmed), text: state.key }));
    }, [statesAt]);
    const jump = useCallback((row: number) => {
        void statesAt(row, 1).then(([hit]) => { if (hit !== undefined) latest.current.onPick(hit.state); })
            .catch((error: unknown) => { console.error("[Flowchart] Find state could not read the state it found:", error); });
    }, [statesAt]);
    const clear = useCallback(() => {
        asked.current++;
        found.current = NOTHING;
    }, []);
    // The box asks its query again as what its lines are read from moves: the states' record and its narrowing — read
    // through the source, so a page landing moves none of it — and the states the canvas draws.
    const readAnswers = useCallback(() => (part === undefined ? ""
        : `${someOf(recordSliceRevision(part)) ?? ""}\u0000${printWhere(part.read().where)}`), [part]);
    const { result } = useTrackedEvaluation(readAnswers);
    const answers = result.ok ? result.value : "";
    const [requery, setRequery] = useState(0);
    const seen = useRef({ answers, drawn });
    useEffect(() => {
        if (keyEqual(seen.current.answers, answers) && Object.is(seen.current.drawn, drawn)) return;
        seen.current = { answers, drawn };
        setRequery((n) => n + 1);
    }, [answers, drawn]);
    // It lists its lines again as e3 says which choices leave out a state they show, or the pick comes to ask — and as the
    // narrowing comes to dim what it leaves out, or to hide it, which its lines word.
    const relist = useRelist(pick === undefined ? [] : [pick], [dim]);
    const noMatches = words.m.findNoMatches();
    const any = part !== undefined || drawn.length > 0;
    // Typed text parses at the states' key type; the empty box lists the first of them where a key's start finds them all.
    const keyType = keys.keyType;
    const browse = keys.text ? BROWSE_QUERY : undefined;
    return useMemo(() => (any ? {
        resetKey: "flowchart", requery, relist, keyType, find, listRange, jump, clear, browseQuery: browse, noMatchesText: noMatches,
    } : undefined), [any, requery, relist, keyType, find, listRange, jump, clear, browse, noMatches]);
}
