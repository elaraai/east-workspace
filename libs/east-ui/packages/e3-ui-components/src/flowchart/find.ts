/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Find state (#1504, `Flowchart Records Spec.md` R17): the toolbar's search
 * over the states — every builder's Search Records
 * (`shared/schedule/search-records.ts`), the shared key search's item, its box
 * folding to its icon.
 *
 * - **States read through their source of the rail** are sought in their
 *   record through e3, as every builder's sources are: with no choice of the
 *   viewer's, and on a page whose source holds a scope (#1621), among the
 *   scope's rows alone — each row a list shows made its roles by the kind's
 *   `read` — so a state the rail's choices hide is found by its key.
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
 * do, in the shared hidden pick's words (`shared/schedule/hidden.ts`), or,
 * under `"dim"`, the words for a row drawn as context. A pick hands the frame
 * the state and what leaves it out (`onPick`): the frame clears just those
 * choices and selects the state once it is drawn as itself. The box asks its
 * query again as the record or the drawn states move, and lists its lines again
 * as the narrowing comes to dim or to hide what it leaves out.
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useMemo, useRef } from "react";
import { StringType, equalFor, some, type ValueTypeOf } from "@elaraai/east";
import type { DatasetKeyQuery, RecordSliceBindType } from "@elaraai/east-ui/internal";
import type { KeySearchSource } from "@elaraai/east-ui-components";
import { hiddenLine, type RowHidden, type SourceHidden } from "../shared/schedule/hidden.js";
import { STRING_KEYS, type KindKeys } from "../shared/schedule/kind-keys.js";
import type { RowCodec } from "../shared/schedule/records.js";
import { keyMatches, readsRows, useSearchRecords, type SoughtSource } from "../shared/schedule/search-records.js";
import { dimmedWords } from "../shared/schedule/words.js";
import type { FlowchartWords } from "./messages.js";
import type { FlowchartStateRoles } from "./model.js";

const keyEqual = equalFor(StringType);

/** A record Slice's part: the states' source of the rail. */
type RecordPart = ValueTypeOf<RecordSliceBindType>;

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
 * How a found state reads in Find's list: its key, its label where it is not its key, and — where the narrowing leaves
 * it out — which of the rail's choices do (`hiddenLine`), or, under `"dim"`, which dim it (`dimmedWords`).
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
 * key finds, as every source read whole is sought (`keyMatches`), but those `listed` says the record's matches hold;
 * and, for bare text, those whose label holds it, in any case.
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
    const byKey = new Set(keyMatches(states, (state) => state.key, query, keys).map((state) => state.key));
    // Bare text finds a label that holds it too.
    const text = "prefix" in query && !("fields" in query) ? query.prefix.toLocaleLowerCase(locale) : undefined;
    return keys.order(byText.keys()).map(({ text: key }) => byText.get(key)!).filter((state) => (byKey.has(state.key)
        ? !listed(state.key)
        : text !== undefined && text.length > 0 && state.label !== undefined && state.label.toLocaleLowerCase(locale).includes(text)));
}

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
    const sources = useMemo((): SoughtSource<FindableState>[] => [
        // The record's matches, a state the canvas draws named as it draws it, the drafts in place.
        ...(part === undefined ? [] : [{
            part, keys, pick,
            read: readsRows((id, row): FindableState => {
                const { drawn: states, read: readRoles, codec: rows } = latest.current;
                const drawnAs = states.find((state) => keyEqual(state.key, id));
                return { key: id, label: drawnAs !== undefined ? drawnAs.label : labelOf(readRoles(rows.encode(row), id)), dimmed: false };
            }),
        }]),
        // Then the drawn states', but those the record's matches list.
        ...(drawn.length === 0 ? [] : [{
            rows: () => some(drawn), idOf: (state: FindableState) => state.key, keys,
            matches: (states: readonly FindableState[], query: DatasetKeyQuery) => {
                const { part: source, stored: held, words: w, keys: stateKeys } = latest.current;
                return drawnMatches(states, query, w.locale, (key) => source !== undefined && held.has(key), stateKeys);
            },
        }]),
    ], [part, keys, pick, drawn]);
    const said = (state: FindableState, hidden: readonly RowHidden[] | undefined): FoundState => ({ key: state.key, label: state.label, hidden });
    return useSearchRecords({
        name: "Flowchart", resetKey: "flowchart", sources,
        // A pick shows the state's key in the box: what its query is typed against.
        line: ({ item, hidden }) => ({ label: foundLine(said(item, hidden), latest.current.words, latest.current.dim), text: item.key }),
        onPick: ({ item, hidden }) => { latest.current.onPick(said(item, hidden)); },
        noMatchesText: words.m.findNoMatches(),
        // A state drawn as context is left out by the narrowing: e3 is asked which choices dim it.
        hidings: (states) => {
            const hidden = latest.current.pick;
            return states.map((state) => (state.dimmed && hidden !== undefined ? [{ pick: hidden, id: state.key }] : []));
        },
        // The box asks its query again as the drawn states move, and lists its lines again as the narrowing comes to dim
        // what it leaves out, or to hide it, which its lines word.
        requeryBy: [drawn],
        relistBy: [dim],
    });
}
