/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Find (#1387, #1404, §6.1): the toolbar's search over the item kinds' keys,
 * each kind sought in its own record, never in what the canvas draws — every
 * builder's Search Records (`shared/schedule/search-records.ts`), the shared
 * key search's item (`useKeySearchToolbarItem`), its box folding to its icon,
 * then into the View popover on a phone. ⌘F focuses it (`focusKeySearch`).
 *
 * - **A kind read through its source of the slice** is sought in its record
 *   through e3, as every builder's sources are: with no choice of the
 *   viewer's, and on a page whose source holds a scope (#1621), among the
 *   scope's rows alone — each row a list shows made its roles by the kind's
 *   `read`.
 * - **A kind read whole** is sought in its rows — every row of its record —
 *   its keys in East's order, and asked again as they are read again.
 *
 * Keys are sought at the item kinds' key type where they share one (#1549) —
 * a String key by its start, any other as typed, `10` finding the oven keyed
 * by the number 10 — else at String, a kind keyed otherwise reading the text
 * as typed at its own; the empty box lists the first matches of the kinds
 * keyed by String alone. The matches are one list: each kind's in its keys'
 * order at its key type, the kinds in the order the Schematic lists them.
 *
 * A line names an item by its key, its label where it is not its key, and its
 * kind's name, and says what keeps it off the canvas: its layer, or no
 * position ({@link foundMark}) — and, where its kind's source's narrowing
 * leaves it out, which of the rail's choices do, as every builder's Search
 * Records names them (the shared hidden pick, `shared/schedule/hidden.ts`):
 * `hidden by Owner: Northwind Media — picking it clears that filter`, and
 * `hidden by the filters` until e3 has said — or, where the narrowing draws
 * what it leaves out as context (`narrowed="dim"`), `dimmed by Owner:
 * Northwind Media — …` and `dimmed by the filters`. The lines are listed again
 * as the layers hidden move, and as the narrowing comes to dim what it leaves
 * out or to hide it.
 *
 * A pick hands the frame the item and what it knows of it — what hides it
 * among it (`onPick`) — and the box shows its key; the pick stands until the
 * search is cleared or a new query asked in its place, which the frame hears
 * (`onCleared`), so what it said of where the pick landed goes with it. A
 * query asked again, as what its matches are read from moves, leaves the pick
 * standing — and a window of what the canvas draws moves none of it, so a
 * pick's fly keeps its place among the matches.
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useMemo, useRef } from "react";
import { StringType, compareFor, equalFor, match, none, some, type ValueTypeOf, type option } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import type { KeySearchSource } from "@elaraai/east-ui-components";
import { entityId, type ItemRoles, type SchematicRef } from "./canvas/drawn.js";
import { hiddenLine, type RowHidden } from "../shared/schedule/hidden.js";
import type { HiddenPicks } from "../shared/schedule/hidden-pick.js";
import type { KindKeys } from "../shared/schedule/kind-keys.js";
import type { RowCodec } from "../shared/schedule/records.js";
import { readToken, readsRows, useSearchRecords, type SoughtSource } from "../shared/schedule/search-records.js";
import { dimmedWords } from "../shared/schedule/words.js";
import type { SchematicWords } from "./messages.js";

const compareKey = compareFor(StringType);
const keyEqual = equalFor(StringType);

/** An Option's value, or `undefined`. */
const someOf = <T,>(opt: option<T>): T | undefined => match(opt, { some: (value) => value }, undefined);

/** A record Slice's part, as a kind's source of the slice. */
type RecordPart = ValueTypeOf<RecordSliceBindType>;

/** One item kind, as Find seeks it. */
export interface FindKind {
    /** Its slot. */
    readonly slot: string;
    /** Its name (`Rack`). */
    readonly name: string;
    /** Its source of the slice, whose record it is sought in, through e3; `undefined` for a kind read whole. */
    readonly part: RecordPart | undefined;
    /** Its rows, read whole — every row of its record, by key, each its roles; none while the read is in flight. */
    readonly rows: () => option<ReadonlyMap<string, { readonly roles: ItemRoles }>>;
    /** A stored row's roles, from its bytes and its key. */
    readonly read: (bytes: Uint8Array, key: string) => ItemRoles;
    /** Its record's rows, as bytes and back. */
    readonly codec: RowCodec;
    /** Its keys (#1549): each key's text read back at its record's key type, and their order. */
    readonly keys: KindKeys;
}

/** One item Find found. */
export interface FoundItem {
    /** Its id on the canvas: its reference, printed. */
    readonly id: string;
    /** Its kind's slot and its key. */
    readonly ref: SchematicRef;
    /** Its card's name. */
    readonly label: string;
    /** Its kind's name. */
    readonly kind: string;
    /** Its centre; `undefined` for a row with no position. */
    readonly position: { readonly x: number; readonly y: number } | undefined;
    /** The layer it is on, by the layer's key. */
    readonly layer: string | undefined;
    /**
     * What leaves it out on the rail — its kind's source, and which of its choices e3 has said hide it (the shared hidden
     * pick) — which a pick of it clears; `undefined` while the narrowing holds it.
     */
    readonly hidden: readonly RowHidden[] | undefined;
}

/** What keeps a found item off the canvas but the rail's filters, as its line marks it — or `undefined` while nothing does. */
export type FoundMark = "layer" | "unplaced" | undefined;

/**
 * What keeps a found item off the canvas but the rail's filters, which its line names apart and a pick of it clears: no
 * position first, then a hidden layer.
 *
 * @param item - The item found
 * @param hiddenLayers - The layers hidden, by key
 * @returns Its mark
 */
export function foundMark(item: FoundItem, hiddenLayers: ReadonlySet<string>): FoundMark {
    if (item.position === undefined) return "unplaced";
    return item.layer !== undefined && hiddenLayers.has(item.layer) ? "layer" : undefined;
}

/**
 * How a found item reads in Find's list: its key, its label when it is not its key, its kind's name, what keeps it off
 * the canvas — its layer, or no position — and, last, which of the rail's choices leave it out, as every builder's line
 * names them (`hiddenLine`): `hidden by the filters` until e3 has said which — or, where the narrowing draws what it
 * leaves out as context, `dimmed by the filters`, then the choices that dim it (`dimmedWords`).
 *
 * @param item - The item
 * @param mark - What keeps it off the canvas but the filters
 * @param words - The Schematic's words
 * @param dim - Whether the narrowing draws what it leaves out as context (`narrowed="dim"`), rather than hiding it
 * @returns Its line
 */
export function foundLine(item: FoundItem, mark: FoundMark, words: SchematicWords, dim: boolean): string {
    const parts = keyEqual(item.label, item.ref.key) ? [item.ref.key, item.kind] : [item.ref.key, item.label, item.kind];
    return [
        ...parts,
        ...(mark === undefined ? [] : [words.m.findMark({ mark })]),
        ...(item.hidden === undefined ? [] : [hiddenLine(item.hidden, words, dim ? dimmedWords(words.m) : words.m)]),
    ].join(" · ");
}

/** A row Find found, as its kind read it: the kind, the row's key's text and its roles. */
interface FoundRow {
    readonly kind: FindKind;
    readonly key: string;
    readonly roles: ItemRoles;
}

/** An item found, from its kind's roles of its row, and what leaves it out on the rail. */
function foundOf({ kind, key, roles }: FoundRow, hidden: readonly RowHidden[] | undefined): FoundItem {
    const ref = { kind: kind.slot, key };
    const position = someOf(roles.position);
    return {
        id: entityId(ref), ref, label: roles.label, kind: kind.name,
        position: position === undefined ? undefined : { x: position.x, y: position.y }, layer: someOf(roles.layer), hidden,
    };
}

/**
 * A kind, as Search Records seeks it: through its source of the slice, its hidden pick asking e3 which choices hide a
 * row its list shows; else among its rows read whole, asked again as they are read again.
 *
 * @param kind - The kind
 * @param picks - Each kind's hidden pick, by its slot
 * @returns Its source
 */
function soughtKind(kind: FindKind, picks: HiddenPicks): SoughtSource<FoundRow> {
    const { part, keys } = kind;
    if (part !== undefined) {
        return {
            part, keys, pick: picks.get(kind.slot),
            read: readsRows((id, row) => ({ kind, key: id, roles: kind.read(kind.codec.encode(row), id) })),
        };
    }
    return {
        rows: () => match(kind.rows(), { some: (held) => some([...held].map(([key, { roles }]): FoundRow => ({ kind, key, roles }))) }, none),
        idOf: (row) => row.key, keys,
        token: () => readToken(kind.rows()),
    };
}

/** Props of {@link useSchematicFind}. */
export interface SchematicFindProps {
    /** The item kinds, in the Schematic's order. */
    readonly kinds: readonly FindKind[];
    /** The Schematic's words. */
    readonly words: SchematicWords;
    /**
     * Each kind's hidden pick, by its slot (`hidden-pick.tsx`' `HideSources`): what a kind read through its source asks e3
     * which of the rail's choices leave out a row its list shows.
     */
    readonly picks: HiddenPicks;
    /** The layers hidden, by key. */
    readonly hiddenLayers: ReadonlySet<string>;
    /**
     * Whether the narrowing draws what it leaves out as context (`narrowed="dim"`), the frame's `look.dim`: a line names
     * the choices that dim an item, never that hide it.
     */
    readonly dim: boolean;
    /** Told the item a pick lands on. */
    readonly onPick: (item: FoundItem) => void;
    /** Told the last pick stands no more: the search cleared, or a new query asked in its place — never one asked again. */
    readonly onCleared: () => void;
}

/**
 * Find's source, for the shared key search's toolbar item (see the module docs).
 *
 * @param props - The kinds, the words, each kind's hidden pick, the layers hidden, whether the narrowing dims, the pick,
 *   and the pick let go
 * @returns The source; `undefined` with no item kind, which the Schematic's payload never holds
 */
export function useSchematicFind({ kinds, words, picks, hiddenLayers, dim, onPick, onCleared }: SchematicFindProps): KeySearchSource | undefined {
    // What a line reads, and whom a pick tells: the latest — the box calls what it captured before the find answered.
    const latest = useRef({ words, hiddenLayers, dim, onPick, onCleared });
    useLayoutEffect(() => { latest.current = { words, hiddenLayers, dim, onPick, onCleared }; });
    const sources = useMemo(() => kinds.map((kind) => soughtKind(kind, picks)), [kinds, picks]);
    // The layers hidden, as their keys in order: what a line's mark reads, which moves only as they do.
    const layers = useMemo(() => [...hiddenLayers].sort(compareKey).join("\u0000"), [hiddenLayers]);
    return useSearchRecords({
        name: "Schematic", resetKey: "schematic", sources,
        // A pick shows the item's key in the box: what its query is typed against.
        line: ({ item: row, hidden }) => {
            const { words: w, hiddenLayers: held, dim: dimmed } = latest.current;
            const item = foundOf(row, hidden);
            return { label: foundLine(item, foundMark(item, held), w, dimmed), text: item.ref.key };
        },
        onPick: ({ item: row, hidden }) => { latest.current.onPick(foundOf(row, hidden)); },
        onCleared: () => { latest.current.onCleared(); },
        noMatchesText: words.m.findNoMatches(),
        // Its lines are listed again as the layers hidden move, which their marks read, and as the narrowing comes to dim
        // what it leaves out or to hide it, which their words say.
        relistBy: [layers, dim],
    });
}
