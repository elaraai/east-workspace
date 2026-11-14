/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic's edits (#1388, `Schematic Builder Spec.md` §7, SC5, SC7–SC10)
 * — pure and React-free: what each gesture on the canvas writes, as the rows
 * of the app's records it changes. The canvas records each gesture's edits as
 * one step of its history (`editing.ts`), each edit through its kind's own
 * `write` or `create`, so a gesture writes only the fields its roles map
 * (SC2).
 *
 * - **Move** places every item it moves by the drag's delta, rigidly: the
 *   delta is clamped so each centre stays within the extent (SC8).
 * - **Connect** adds a link of the Connect tool's kind between two items,
 *   under the key its kind makes (SC7, SC9; `editing.ts`' `newKey`, #1549) —
 *   refused, naming the link, where the key its row builds is taken.
 * - **A Shift session** folds its drags' pairs into a net's two sides, keeping
 *   membership: the first pair sets both sides, a pair from a member adds the
 *   other item downstream, one into a member adds it upstream, and a member
 *   never changes side. Its first Shift-drag makes it a net of the first
 *   editable net kind whose sides hold its members, deleting the links it
 *   absorbs; each later one writes the net's sides. With no such kind, each
 *   drag adds a link.
 * - **Retarget** writes the end of a link it moves; **Extend** adds an item to
 *   a net's destinations (SC10).
 * - **Delete** deletes the selected link or net, or takes a net leg's item
 *   off its side — the net deleted once a side holds none — and deletes the
 *   selected items with every link naming one and every net leg naming one
 *   (D7, SC5). An item a link or a net bound read only names is not deleted:
 *   the gesture is refused, naming it.
 *
 * A gesture onto an item of a slot the kind's end or side holds no keys of is
 * refused before its draft snaps, naming the end, as the connect veto's words
 * are (SC9); so is one naming an item held under a placeholder — a new item's
 * key still to be typed (#1549) — in a link's end or a net's side.
 *
 * **A key built from the row follows the row** (#1549, {@link followBuiltKeys}):
 * a gesture writing the fields its kind's `key` reads moves the row under the
 * key they build, its details row with it, and the links and nets naming an
 * item follow — refused, naming the row, where another row holds that key
 * once the gesture is made, so a swap or a shift passes (#1581), and where a
 * link or net kind that may name a moving item isn't held whole (#1580): its
 * rows the rail's filters hide, its page's scope leaves out (#1621), or not
 * read, would keep the old key; and where
 * what follows a moving row — its details, the rows naming it — takes no edit
 * now (#1584), a Save of it in flight. They follow a new item's key typed in
 * the inspector too; and a Shift session follows its net as its sides move it
 * ({@link followSession}).
 *
 * A library card's drop (#1390, `drop.ts`) writes its rows as edits too: an
 * item template's new item, a backlog row placed, a link or net template's
 * values written over a link or a net of its kind, and an author's card's
 * fields set on an entity. So does the inspector (#1391): a field of its
 * form, of the row or its details row; the row a kind's own Details hands
 * back; an item's centre, or Unplace; a link's ends; a net's sides; and below
 * 480px of main an item's Connect to… (#1394, D15), a link from it as a
 * Connect drag draws one.
 *
 * The host's veto (`canConnect`, #1401, D34) is asked the same way by every
 * route that connects two items ({@link connectVeto}): a Connect drag's draft
 * and its release, a Retarget's and an Extend's, and the inspector's Connect
 * to…, ends and sides — of every pair the gesture newly joins under the kind it
 * writes ({@link vetoOfPairs}): a link's one; a net a Shift session grows into,
 * every pair of its sides, the runs it gathers among them; and a change of a
 * net's sides — a Shift-drag's, an Extend's, the inspector's — each pair it
 * newly joins ({@link joinedPairs}), never the pair dragged alone.
 *
 * @packageDocumentation
 */

import { StringType, equalFor, some, type ValueTypeOf, type option } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import { kindKeys, type KindKeys } from "../shared/schedule/kind-keys.js";
import { entityId, refOfId, type SchematicDrawn, type SchematicRef } from "./canvas/drawn.js";
import type { SchematicValue } from "./data.js";
import type { SchematicMove, SchematicNewKey } from "./editing.js";
import { detailsKey } from "./record-keys.js";

/** A point in world units. */
type Point = ValueTypeOf<typeof Schematic.Types.Point>;
/** A link's ends, as a gesture writes them. */
export type SchematicEnds = ValueTypeOf<typeof Schematic.Types.Ends>;
/** A net's sides, as a gesture writes them. */
export type SchematicSides = ValueTypeOf<typeof Schematic.Types.Sides>;
/** An author's tab, decoded. */
type AuthorTabValue = Extract<SchematicValue["library"][number], { type: "tab" }>["value"];
/** One field an author's card sets (#1390): its path, and its value as bytes at the field's type. */
export type SchematicFieldWrite = AuthorTabValue["cards"][number]["sets"][number];

const stringEqual = equalFor(StringType);
const sidesEqual = equalFor(Schematic.Types.Sides);

/**
 * One row a gesture changes, by its kind's slot and its key, and how — each
 * written through its kind's own `write` or `create`:
 *
 * - `place`: an item's centre — placed, or with `none` unplaced;
 * - `ends`: a link's ends;
 * - `sides`: a net's sides;
 * - `link`, `net`: a new link or net, its key minted, its other fields its
 *   type's defaults or a template's values;
 * - `item`: a new item, its key minted, at its centre, its other fields a
 *   template's values or their types' defaults (#1390);
 * - `retype`: a link's or a net's fields a template of its kind gives, its
 *   ends or its sides and its key as they are (#1390);
 * - `set`: the fields an author's card sets (#1390), or the inspector's
 *   form edits (#1391), every other field as it was — of the row, or of its
 *   details row (`details`);
 * - `row`: the row as a kind's own Details hands it back (`update`, #1391),
 *   whole — the row's, or its details row's;
 * - `move`: the row — or its details row (`details`) — under a new key, as the
 *   gesture finds it, and gone from its own (#1549): a row whose kind builds
 *   its key from its fields, once a gesture moves them; or a new item's
 *   placeholder, once its key is typed. In a swap or a shift (#1581) it
 *   `replaces` the row the gesture moves off its new key — never a new one —
 *   and its own key, which another row the gesture moves takes, is `refilled`:
 *   not deleted;
 * - `remove`: the row deleted.
 */
export type SchematicEdit =
    | { readonly op: "place"; readonly ref: SchematicRef; readonly at: option<Point> }
    | { readonly op: "ends"; readonly ref: SchematicRef; readonly ends: SchematicEnds }
    | { readonly op: "sides"; readonly ref: SchematicRef; readonly sides: SchematicSides }
    | { readonly op: "link"; readonly ref: SchematicRef; readonly ends: SchematicEnds; readonly values: option<Uint8Array> }
    | { readonly op: "net"; readonly ref: SchematicRef; readonly sides: SchematicSides; readonly values: option<Uint8Array> }
    | { readonly op: "item"; readonly ref: SchematicRef; readonly at: option<Point>; readonly values: option<Uint8Array> }
    | { readonly op: "retype"; readonly ref: SchematicRef; readonly values: Uint8Array }
    | { readonly op: "set"; readonly ref: SchematicRef; readonly sets: readonly SchematicFieldWrite[]; readonly details?: true }
    | { readonly op: "row"; readonly ref: SchematicRef; readonly row: Uint8Array; readonly details?: true }
    | { readonly op: "move"; readonly ref: SchematicRef; readonly to: string; readonly details?: true; readonly replaces?: true; readonly refilled?: true }
    | { readonly op: "remove"; readonly ref: SchematicRef };

/** A link kind, as the edits read it: its name, whether it writes, and the item slots each end holds keys of. */
export interface EditLinkKind {
    readonly name: string;
    readonly editable: boolean;
    readonly from: readonly string[];
    readonly to: readonly string[];
}

/** A net kind, as the edits read it: its name, whether it writes, and the item slot each side holds keys of. */
export interface EditNetKind {
    readonly name: string;
    readonly editable: boolean;
    readonly sources: string;
    readonly destinations: string;
}

/** An item kind's keys, as the edits read them (#1549): its name, and its keys — what tells a placeholder. */
export interface EditItemKeys {
    readonly name: string;
    readonly keys: KindKeys;
}

/** The Schematic's kinds, as the edits read them: which write, and what each link's ends and each net's sides hold. */
export interface EditKinds {
    /** The slots of the item kinds that write: bound with their patch door, and the Schematic not read only. */
    readonly items: ReadonlySet<string>;
    /** Every item kind's keys, by its slot (#1549): a gesture naming an item held under a placeholder is refused. */
    readonly itemKeys: ReadonlyMap<string, EditItemKeys>;
    /** Each link kind, by its slot, in the order the Schematic lists them. */
    readonly links: ReadonlyMap<string, EditLinkKind>;
    /** Each net kind, by its slot, in the order the Schematic lists them. */
    readonly nets: ReadonlyMap<string, EditNetKind>;
}

/**
 * The Schematic's kinds as the edits read them: a kind writes when it is bound
 * with its patch door, and none does while the Schematic is read only (SC14).
 *
 * @param value - The payload
 * @returns The kinds
 */
export function editKinds(value: Pick<SchematicValue, "items" | "links" | "nets" | "readOnly">): EditKinds {
    const writes = (editable: boolean) => editable && !value.readOnly;
    return {
        items: new Set(value.items.filter((kind) => writes(kind.editable)).map((kind) => kind.key)),
        itemKeys: new Map(value.items.map((kind) => [kind.key, { name: kind.name, keys: kindKeys(kind.keyType) }] as const)),
        links: new Map(value.links.map((kind) => [kind.key, { name: kind.name, editable: writes(kind.editable), from: kind.ends.from, to: kind.ends.to }] as const)),
        nets: new Map(value.nets.map((kind) => [kind.key, {
            name: kind.name, editable: writes(kind.editable), sources: kind.sides.sources, destinations: kind.sides.destinations,
        }] as const)),
    };
}

/**
 * Why a gesture is refused, for its words:
 *
 * - `end`: a link's end, or a net's side, its kind holds no item of that
 *   slot at — `start` the link's from or the net's sources, `end` the link's
 *   to or the net's destinations;
 * - `named`: an item a link or a net bound read only names, which a Delete
 *   would leave naming an item no kind holds;
 * - `placeholder`: an item held under a placeholder, its key still to be
 *   typed (#1549), which no link's end or net's side names until it is — by its
 *   kind's name.
 */
export type EditRefusal =
    | { readonly why: "end"; readonly kind: string; readonly end: "start" | "end"; readonly item: string }
    | { readonly why: "named"; readonly item: string; readonly kind: string; readonly key: string }
    | { readonly why: "placeholder"; readonly kind: string; readonly item: string };

/** An item a gesture names: its reference, and its label for a refusal's words. */
export interface EditItem {
    readonly ref: SchematicRef;
    readonly label: string;
}

/**
 * Why a gesture can't name an item in a link's end or a net's side (#1549):
 * it is held under a placeholder, its key still to be typed.
 *
 * @param kinds - The Schematic's kinds
 * @param item - The item
 * @returns The refusal; `undefined` for an item under its key
 */
export function placeholderRefusal(kinds: EditKinds, item: EditItem): EditRefusal | undefined {
    const kind = kinds.itemKeys.get(item.ref.kind);
    return kind === undefined || kind.keys.isKey(item.ref.key) ? undefined : { why: "placeholder", kind: kind.name, item: item.label };
}

/**
 * Why the Schematic may not hold every row of a link or net kind (#1580): the rail's filters leave some out; its page's
 * scope holds only some (#1621), which no choice of the viewer's clears; or they are not read.
 */
export type SchematicUnheld = "filtered" | "scoped" | "unread";

/** Why a gesture records nothing (#1549), as the footer says it. */
export type SchematicKeyRefusal =
    /** The key a row builds is held already, by the row of that key. */
    | { readonly refusal: "taken"; readonly ref: SchematicRef }
    /** Its kind's keys are of a type the form can't type — by the type's name — and its kind builds none: by the kind's slot. */
    | { readonly refusal: "untyped"; readonly kind: string; readonly type: string }
    /**
     * An item whose key the gesture moves, which a link or a net kind that writes may name, the Schematic not holding every
     * row of that kind — by its slot, and why (#1580): what names the item there would keep naming its old key; or rows of
     * it naming the item taking no edit now — `busy`, a Save of them in flight (#1584): what follows the item could not.
     */
    | { readonly refusal: "unheld"; readonly ref: SchematicRef; readonly kind: string; readonly why: SchematicUnheld | "busy" }
    /** A row whose key the gesture moves, its details row with it, whose details take no edit now — a Save of them in flight (#1584). */
    | { readonly refusal: "details"; readonly ref: SchematicRef };

/**
 * A new row's key as its kind makes it (`editing.ts`' `newKey`, #1549), or why
 * the gesture records nothing.
 *
 * @param slot - The row's kind
 * @param keyed - What its kind makes
 * @returns The key, or the refusal; `undefined` while the key is still to be read
 */
export function keyedRow(slot: string, keyed: SchematicNewKey | undefined): { readonly key: string } | { readonly refused: SchematicKeyRefusal } | undefined {
    if (keyed === undefined) return undefined;
    if ("taken" in keyed) return { refused: { refusal: "taken", ref: { kind: slot, key: keyed.taken } } };
    if ("untyped" in keyed) return { refused: { refusal: "untyped", kind: slot, type: keyed.untyped } };
    return keyed;
}

// ============================================================================
// Move
// ============================================================================

/** An item a Move moves: its reference, and its centre where the drag found it. */
export interface Mover {
    readonly ref: SchematicRef;
    readonly x: number;
    readonly y: number;
}

/**
 * A drag's delta, clamped so every item it moves keeps its centre within the
 * extent, the items keeping their places to one another (SC8). An item outside
 * the extent already moves no further out, and is never pulled in.
 *
 * @param movers - The items the drag moves, where it found them
 * @param dx - The drag's delta along x, in world units
 * @param dy - The drag's delta along y
 * @param extent - The drawing's world bounds
 * @returns The delta the items move by
 */
export function clampDelta(movers: readonly Mover[], dx: number, dy: number, extent: { readonly width: number; readonly height: number }): { dx: number; dy: number } {
    if (movers.length === 0) return { dx, dy };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const mover of movers) {
        minX = Math.min(minX, mover.x); maxX = Math.max(maxX, mover.x);
        minY = Math.min(minY, mover.y); maxY = Math.max(maxY, mover.y);
    }
    const clamp = (d: number, low: number, high: number) => Math.min(Math.max(d, Math.min(0, low)), Math.max(0, high));
    return { dx: clamp(dx, -minX, extent.width - maxX), dy: clamp(dy, -minY, extent.height - maxY) };
}

/**
 * What a Move writes (SC8): each item's centre, by the delta — none for a drag
 * that moved nothing.
 *
 * @param movers - The items it moves, where the drag found them
 * @param delta - The delta, clamped ({@link clampDelta})
 * @returns The edits
 */
export function moveEdits(movers: readonly Mover[], delta: { readonly dx: number; readonly dy: number }): SchematicEdit[] {
    if (delta.dx === 0 && delta.dy === 0) return [];
    return movers.map((mover) => ({ op: "place", ref: mover.ref, at: some({ x: mover.x + delta.dx, y: mover.y + delta.dy }) }));
}

// ============================================================================
// Connect, and its Shift session
// ============================================================================

/** One drag of a Connect gesture: the item it runs from and the one it runs to. */
export interface ConnectPair {
    readonly from: SchematicRef;
    readonly to: SchematicRef;
}

/**
 * A connect session: the links it absorbs when it grows into a net — those its
 * drags drew, or the selected link it was seeded with — and that net, once it
 * did. Their ends and sides are the drawing's, as they stand when its next
 * drag lands ({@link SessionDrawn}), so Undo, Redo or another gesture between
 * two drags is the session's too.
 */
export interface ConnectSession {
    /** The links it absorbs when it grows into a net. */
    readonly links: readonly SchematicRef[];
    /** The net it grew into, once it did. */
    readonly net: SchematicRef | undefined;
}

/** A session's links and net as the drawing holds them now. */
export interface SessionDrawn {
    /** A link's ends; `undefined` for one the drawing holds none of. */
    readonly ends: (ref: SchematicRef) => ConnectPair | undefined;
    /** A net's sides; `undefined` for one the drawing holds none of. */
    readonly sides: (ref: SchematicRef) => SchematicSides | undefined;
}

const refEqual = (a: SchematicRef, b: SchematicRef): boolean => stringEqual(a.kind, b.kind) && stringEqual(a.key, b.key);
const holds = (refs: readonly SchematicRef[], ref: SchematicRef): boolean => refs.some((held) => refEqual(held, ref));
const NO_SIDES: SchematicSides = { sources: [], destinations: [] };

/**
 * A pair folded onto a net's two sides, keeping membership: onto no sides, it
 * sets both; from a member, it adds the other item downstream; into a member,
 * upstream; between two new items, each to its side; and between two members,
 * nothing — a member never changes side.
 *
 * @param sides - The sides it folds onto
 * @param pair - The pair
 * @returns The sides after it
 */
export function foldPair(sides: SchematicSides, pair: ConnectPair): SchematicSides {
    const member = (ref: SchematicRef) => holds(sides.sources, ref) || holds(sides.destinations, ref);
    if (sides.sources.length === 0 && sides.destinations.length === 0) return { sources: [pair.from], destinations: [pair.to] };
    const from = member(pair.from), to = member(pair.to);
    if (from && to) return sides;
    return {
        sources: from ? sides.sources : [...sides.sources, pair.from],
        destinations: to ? sides.destinations : [...sides.destinations, pair.to],
    };
}

/**
 * Pairs folded into a net's two sides, in order ({@link foldPair}).
 *
 * @param pairs - The pairs
 * @returns The sides
 */
export function foldSession(pairs: readonly ConnectPair[]): SchematicSides {
    return pairs.reduce(foldPair, NO_SIDES);
}

/**
 * The first editable net kind whose sides hold a fold's members: every source
 * of its sources' slot, every destination of its destinations'.
 *
 * @param kinds - The Schematic's kinds
 * @param sides - The fold
 * @returns The net kind's slot; `undefined` for none
 */
export function netKindFor(kinds: EditKinds, sides: SchematicSides): string | undefined {
    for (const [slot, kind] of kinds.nets) {
        if (!kind.editable) continue;
        if (sides.sources.every((ref) => stringEqual(ref.kind, kind.sources)) && sides.destinations.every((ref) => stringEqual(ref.kind, kind.destinations))) return slot;
    }
    return undefined;
}

/**
 * Why a link kind can't run between two items: an end whose field holds no
 * keys of the item's slot.
 *
 * @param kind - The link kind
 * @param from - The item it would run from
 * @param to - The item it would run to
 * @returns The refusal; `undefined` when both ends hold their items
 */
export function linkRefusal(kind: EditLinkKind, from: EditItem, to: EditItem): EditRefusal | undefined {
    if (!kind.from.some((slot) => stringEqual(slot, from.ref.kind))) return { why: "end", kind: kind.name, end: "start", item: from.label };
    if (!kind.to.some((slot) => stringEqual(slot, to.ref.kind))) return { why: "end", kind: kind.name, end: "end", item: to.label };
    return undefined;
}

/**
 * Why a net kind can't hold a fold: the first member of a slot its side holds
 * no keys of, by its label.
 *
 * @param kind - The net kind
 * @param sides - The fold
 * @param labelOf - A member's label
 * @returns The refusal; `undefined` when both sides hold their members
 */
export function netRefusal(kind: EditNetKind, sides: SchematicSides, labelOf: (ref: SchematicRef) => string): EditRefusal | undefined {
    const source = sides.sources.find((ref) => !stringEqual(ref.kind, kind.sources));
    if (source !== undefined) return { why: "end", kind: kind.name, end: "start", item: labelOf(source) };
    const destination = sides.destinations.find((ref) => !stringEqual(ref.kind, kind.destinations));
    if (destination !== undefined) return { why: "end", kind: kind.name, end: "end", item: labelOf(destination) };
    return undefined;
}

/** What a Connect drag is: the session it may grow, whether Shift is held, the Connect tool's kind, and its two items. */
export interface ConnectDragArgs {
    /** The open session; `undefined` for none. */
    readonly session: ConnectSession | undefined;
    /** Whether Shift was held as the drag began: it grows the open session. */
    readonly shift: boolean;
    /** The Connect tool's link kind; `undefined` where no link kind writes. */
    readonly linkKind: string | undefined;
    /** The item it runs from. */
    readonly from: EditItem;
    /** The item it runs to. */
    readonly to: EditItem;
    /** The session's links and net as the drawing holds them now. */
    readonly drawn: SessionDrawn;
    /** A member's label, for a refusal's words. */
    readonly labelOf: (ref: SchematicRef) => string;
}

/**
 * What a Shift-drag grows: the open session's net and its sides, or the sides
 * its links fold into; `undefined` for no session — or one the drawing no
 * longer holds all of, which is over.
 */
function grows(args: ConnectDragArgs): { readonly net: SchematicRef | undefined; readonly sides: SchematicSides; readonly links: readonly SchematicRef[] } | undefined {
    const open = args.shift ? args.session : undefined;
    if (open === undefined) return undefined;
    if (open.net !== undefined) {
        const sides = args.drawn.sides(open.net);
        return sides === undefined ? undefined : { net: open.net, sides, links: [] };
    }
    const pairs: ConnectPair[] = [];
    for (const ref of open.links) {
        const ends = args.drawn.ends(ref);
        if (ends === undefined) return undefined;
        pairs.push(ends);
    }
    return { net: undefined, sides: foldSession(pairs), links: open.links };
}

/** What a Connect drag would write, before it lands: the kind it writes, why it can't, and the pairs it newly joins. */
export interface ConnectCandidate {
    /** The slot of the link or net kind it writes; `undefined` where none can be written. */
    readonly kind: string | undefined;
    /** Why its kind can't hold the pair; `undefined` when it can. */
    readonly refusal: EditRefusal | undefined;
    /**
     * Each pair it newly joins under its kind, in its sides' order — what the host's veto hears of it: a link's one pair;
     * a net a session grows into, every pair of its sides, each run it gathers among them; an open net, each pair its new
     * member joins. None where no kind can be written.
     */
    readonly pairs: readonly ConnectPair[];
}

/** No kind can be written: nothing to ask the veto of. */
const NO_CANDIDATE: ConnectCandidate = { kind: undefined, refusal: undefined, pairs: [] };

/**
 * What a Connect drag would write (SC9): a link of the Connect tool's kind —
 * or, a Shift-drag in an open session, the session's net: its own, or the
 * first editable net kind's whose sides hold the session's members, else a
 * link. The kind it writes is what the veto hears (`Candidate.kind`), of each
 * pair it newly joins — a net's, the runs it gathers among them, never the
 * pair dragged alone — and its refusal what the draft shows.
 *
 * @param kinds - The Schematic's kinds
 * @param args - The drag
 * @returns The kind it writes, why it can't, and the pairs it newly joins
 */
export function connectCandidate(kinds: EditKinds, args: ConnectDragArgs): ConnectCandidate {
    const link = args.linkKind === undefined ? undefined : kinds.links.get(args.linkKind);
    const pair: ConnectPair = { from: args.from.ref, to: args.to.ref };
    // An item held under a placeholder joins nothing until its key is typed (#1549).
    const waiting = placeholderRefusal(kinds, args.from) ?? placeholderRefusal(kinds, args.to);
    const plain = (): ConnectCandidate => (link === undefined || !link.editable ? NO_CANDIDATE
        : { kind: args.linkKind, refusal: waiting ?? linkRefusal(link, args.from, args.to), pairs: [pair] });
    const open = grows(args);
    if (open === undefined) return plain();
    const sides = foldPair(open.sides, pair);
    if (open.net !== undefined) {
        const net = kinds.nets.get(open.net.kind);
        return net === undefined || !net.editable ? NO_CANDIDATE
            : { kind: open.net.kind, refusal: waiting ?? netRefusal(net, sides, args.labelOf), pairs: joinedPairs(open.sides, sides) };
    }
    // Grown from links into a net: each run it gathers is a leg of the net's kind now, as the new pair is.
    const grown = netKindFor(kinds, sides);
    return grown !== undefined ? { kind: grown, refusal: waiting, pairs: joinedPairs(NO_SIDES, sides) } : plain();
}

/** One Connect drag landed: what it writes, and the session it leaves. */
export interface ConnectStep {
    /** The edits: one step of the history. */
    readonly edits: SchematicEdit[];
    /** The session after it. */
    readonly session: ConnectSession;
}

/**
 * What a Connect drag writes as it lands (SC9): a plain drag — or a session's
 * first — a new link of the Connect tool's kind; a Shift-drag in an open
 * session, the session's net — its first making it a net of the kind
 * {@link connectCandidate} names, deleting the links it absorbs, each later
 * one writing its sides — else another link. A new link or net is keyed as
 * its kind makes one (#1549): refused, saying why, where its kind makes none.
 *
 * @param kinds - The Schematic's kinds
 * @param args - The drag
 * @param newKey - A new row's key, as its kind makes one from the edit making it (`editing.ts`' `newKey`)
 * @param values - What a new link's or net's other fields take, by its kind's slot: the values of the template of that kind
 *   the library has selected (§4.3, #1390); `none`, their types' defaults
 * @returns The step, or why it records nothing; `undefined` for a drag that writes nothing — one its kind refuses, one
 *   between two members of the net, or one whose key is still to be read
 */
export function connectStep(kinds: EditKinds, args: ConnectDragArgs, newKey: (made: SchematicEdit) => SchematicNewKey | undefined,
    values: (slot: string) => option<Uint8Array>): ConnectStep | { readonly refused: SchematicKeyRefusal } | undefined {
    const candidate = connectCandidate(kinds, args);
    const slot = candidate.kind;
    if (slot === undefined || candidate.refusal !== undefined) return undefined;
    const pair: ConnectPair = { from: args.from.ref, to: args.to.ref };
    const open = grows(args);
    if (kinds.links.has(slot)) {
        // A link: the session's first, or one more of a session no net kind holds.
        const made = keyedRow(slot, newKey({ op: "link", ref: { kind: slot, key: "" }, ends: pair, values: values(slot) }));
        if (made === undefined || "refused" in made) return made;
        const ref = { kind: slot, key: made.key };
        return { edits: [{ op: "link", ref, ends: pair, values: values(slot) }], session: { links: [...(open?.links ?? []), ref], net: undefined } };
    }
    if (open === undefined) return undefined;
    const sides = foldPair(open.sides, pair);
    if (open.net !== undefined) {
        // A pair between two members changes no side: nothing to write.
        if (sidesEqual(sides, open.sides)) return undefined;
        return { edits: [{ op: "sides", ref: open.net, sides }], session: { links: [], net: open.net } };
    }
    // The session grows into a net, which absorbs its links.
    const made = keyedRow(slot, newKey({ op: "net", ref: { kind: slot, key: "" }, sides, values: values(slot) }));
    if (made === undefined || "refused" in made) return made;
    const net = { kind: slot, key: made.key };
    return {
        edits: [...open.links.map((ref): SchematicEdit => ({ op: "remove", ref })), { op: "net", ref: net, sides, values: values(slot) }],
        session: { links: [], net },
    };
}

/**
 * The session a Connect drag leaves, its net under the key recording the drag moved it to (#1549): a net whose kind
 * builds its key from its sides moves as a Shift-drag writes them, and the session's next drag grows it there — never a
 * link of its own.
 *
 * @param session - The session the drag's step leaves ({@link connectStep}'s)
 * @param moved - The rows recording the step moved under the keys they build ({@link followBuiltKeys}')
 * @returns The session, its net under its key now
 */
export function followSession(session: ConnectSession, moved: readonly SchematicMove[]): ConnectSession {
    if (session.net === undefined) return session;
    const net = session.net;
    const move = moved.find((m) => refEqual(m.ref, net));
    return move === undefined ? session : { links: session.links, net: { kind: net.kind, key: move.to } };
}

/** No session's links or net: what a plain drag reads of the drawing, and the inspector's Connect to… (#1394), which opens none. */
export const NO_SESSION: SessionDrawn = { ends: () => undefined, sides: () => undefined };

// ============================================================================
// The host's veto
// ============================================================================

/** The host's veto of a connection (`canConnect`, #1401, D34), decoded: its words refusing a candidate, or `none` allowing it. */
export type ConnectVeto = Extract<SchematicValue["canConnect"], { readonly type: "some" }>["value"];

/**
 * A connection, as every route asks the host's veto of it: the link or net kind it writes, by its slot, and the item it
 * runs from and the one it runs to, by their ids — its words refusing it, or `undefined` allowing it.
 */
export type ConnectVetoOf = (kind: string, from: string, to: string) => string | undefined;

/**
 * The host's veto as every route that connects two items asks it (#1401, D34): a Connect drag's draft and its release, a
 * Retarget's and an Extend's, and the inspector's Connect to…, ends and sides (#1394). Its verdict on each candidate is
 * kept, so a pointer's moves never ask it again for one; one that throws is logged and allows, so a broken veto never
 * blocks editing.
 *
 * @param veto - The host's veto; `undefined` for none, which allows every connection
 * @param refOf - An item's reference, by its id: what the veto hears it as; `undefined` for one it can't name, which it allows
 * @returns The veto, by the candidate's kind and its items' ids
 */
export function connectVeto(veto: ConnectVeto | undefined, refOf: (id: string) => SchematicRef | undefined): ConnectVetoOf {
    if (veto === undefined) return () => undefined;
    const verdicts = new Map<string, string | null>();
    return (kind, from, to) => {
        const key = `${kind}\u0000${from}\u0000${to}`;
        const kept = verdicts.get(key);
        if (kept !== undefined) return kept ?? undefined;
        let refusal: string | null = null;
        const fromRef = refOf(from), toRef = refOf(to);
        if (fromRef !== undefined && toRef !== undefined) {
            try {
                const said = veto({ kind, from: fromRef, to: toRef });
                refusal = said.type === "some" ? said.value : null;
            } catch (err) {
                console.error("[Schematic] canConnect veto failed (allowing):", err);
            }
        }
        verdicts.set(key, refusal);
        return refusal ?? undefined;
    };
}

/**
 * The host's veto of a gesture, as every route that connects asks it (#1401, D34): of each pair the gesture newly joins
 * under the kind it writes, in order — a link's one pair; a net's, every pair it newly joins, the runs a Shift session
 * gathers into it among them — the first it refuses saying why the gesture is.
 *
 * @param veto - The host's veto ({@link connectVeto})
 * @param kind - The link or net kind the gesture writes, by its slot
 * @param pairs - The pairs it newly joins ({@link connectCandidate}'s, {@link joinedPairs}, {@link extendPairs})
 * @returns The first refusal's words; `undefined` while it refuses none
 */
export function vetoOfPairs(veto: ConnectVetoOf, kind: string, pairs: readonly ConnectPair[]): string | undefined {
    for (const pair of pairs) {
        const said = veto(kind, entityId(pair.from), entityId(pair.to));
        if (said !== undefined) return said;
    }
    return undefined;
}

/**
 * The pairs a change of a net's sides joins that its sides didn't before (#1394): each source with each destination, one
 * of the two new to its side — what the host's veto hears of the change, each pair a net's feeding member and its fed one
 * (`Schematic.Types.Candidate`), as it hears an Extend's. A change that only takes members off joins none.
 *
 * @param before - The sides as they stand
 * @param after - The sides as the change leaves them
 * @returns The pairs, in the sides' order
 */
export function joinedPairs(before: SchematicSides, after: SchematicSides): ConnectPair[] {
    const pairs: ConnectPair[] = [];
    for (const from of after.sources) {
        const was = holds(before.sources, from);
        for (const to of after.destinations) if (!was || !holds(before.destinations, to)) pairs.push({ from, to });
    }
    return pairs;
}

// ============================================================================
// Retarget, Extend
// ============================================================================

/**
 * What a Retarget writes (SC10): the link's end it moves, onto another item.
 *
 * @param link - The link: its reference and its ends
 * @param end - The end it moves
 * @param target - The item it moves onto
 * @returns The edits; none for a move onto the link's other end — a link joins two items
 */
export function retargetEdits(link: { readonly ref: SchematicRef; readonly ends: SchematicEnds }, end: "from" | "to", target: SchematicRef): SchematicEdit[] {
    const ends = end === "from" ? { from: target, to: link.ends.to } : { from: link.ends.from, to: target };
    if (refEqual(ends.from, ends.to) || refEqual(end === "from" ? link.ends.from : link.ends.to, target)) return [];
    return [{ op: "ends", ref: link.ref, ends }];
}

/** A net's sides once an Extend adds an item to its destinations; `undefined` for an item the net holds already. */
function extendedSides(sides: SchematicSides, target: SchematicRef): SchematicSides | undefined {
    if (holds(sides.sources, target) || holds(sides.destinations, target)) return undefined;
    return { sources: sides.sources, destinations: [...sides.destinations, target] };
}

/**
 * What an Extend writes (SC10): an item added to a net's destinations.
 *
 * @param net - The net: its reference and its sides
 * @param target - The item it adds
 * @returns The edits; none for an item the net holds already
 */
export function extendEdits(net: { readonly ref: SchematicRef; readonly sides: SchematicSides }, target: SchematicRef): SchematicEdit[] {
    const sides = extendedSides(net.sides, target);
    return sides === undefined ? [] : [{ op: "sides", ref: net.ref, sides }];
}

/**
 * The pairs an Extend newly joins (SC10, #1394): each of the net's sources with the item it adds to its destinations —
 * what the host's veto hears of it, whichever of its members the drag began at.
 *
 * @param sides - The net's sides as they stand
 * @param target - The item it adds
 * @returns The pairs, in its sources' order; none for an item the net holds already
 */
export function extendPairs(sides: SchematicSides, target: SchematicRef): ConnectPair[] {
    const after = extendedSides(sides, target);
    return after === undefined ? [] : joinedPairs(sides, after);
}

// ============================================================================
// Delete
// ============================================================================

/** A net's leg: the side it is on, and its item's id on the canvas. */
export interface NetLeg {
    readonly end: "source" | "destination";
    readonly item: string;
}

/** What a Delete deletes: the selected items, and the selected link or net — or one of a net's legs. */
export interface DeleteSelection {
    /** The selected items, by their ids on the canvas. */
    readonly items: ReadonlySet<string>;
    /** The selected link or net, by its id, and its leg when a net's leg is selected; `null` for none. */
    readonly link: { readonly key: string; readonly leg: NetLeg | null } | null;
}

/** What a Delete writes, or why it is refused. */
export type DeleteResult = { readonly edits: SchematicEdit[] } | { readonly refusal: EditRefusal };

/**
 * What a Delete writes (SC5, SC10, D7): the selected link or net deleted, or
 * a selected leg's item taken off its side; the selected items of the kinds
 * that write deleted, with every link naming one and every net leg naming
 * one — a net deleted once a side holds none. Refused when a link or a net
 * bound read only names an item it would delete.
 *
 * @param kinds - The Schematic's kinds
 * @param drawn - What the canvas draws: the items, links and nets a Delete finds
 * @param selection - What is selected
 * @returns The edits, one step; or the refusal
 */
export function deleteEdits(kinds: EditKinds, drawn: Pick<SchematicDrawn, "items" | "links" | "nets">, selection: DeleteSelection): DeleteResult {
    const items = drawn.items.filter((item) => selection.items.has(item.key) && kinds.items.has(item.ref.kind));
    const gone = new Set(items.map((item) => item.key));
    const labelOf = new Map(items.map((item) => [item.key, item.label] as const));
    const edits: SchematicEdit[] = items.map((item) => ({ op: "remove", ref: item.ref }));
    const picked = selection.link;
    for (const link of drawn.links) {
        const named = gone.has(link.from) ? link.from : gone.has(link.to) ? link.to : undefined;
        const chosen = picked !== null && stringEqual(picked.key, link.key);
        if (named === undefined && !chosen) continue;
        const kind = kinds.links.get(link.ref.kind);
        if (kind?.editable !== true) {
            // A read-only link naming an item a Delete would take: refused. One merely selected stays, as it is.
            if (named !== undefined) return { refusal: { why: "named", item: labelOf.get(named) ?? named, kind: kind?.name ?? link.ref.kind, key: link.ref.key } };
            continue;
        }
        edits.push({ op: "remove", ref: link.ref });
    }
    for (const net of drawn.nets) {
        const chosen = picked !== null && stringEqual(picked.key, net.key) ? picked : undefined;
        const leg = chosen?.leg ?? null;
        const off = (side: readonly string[], end: NetLeg["end"]) => side.filter((id) => !gone.has(id) && !(leg !== null && leg.end === end && stringEqual(leg.item, id)));
        const sources = off(net.sources, "source");
        const destinations = off(net.destinations, "destination");
        const named = net.sources.find((id) => gone.has(id)) ?? net.destinations.find((id) => gone.has(id));
        const changed = sources.length !== net.sources.length || destinations.length !== net.destinations.length;
        const whole = chosen !== undefined && leg === null;
        if (!changed && !whole) continue;
        const kind = kinds.nets.get(net.ref.kind);
        if (kind?.editable !== true) {
            if (named !== undefined) return { refusal: { why: "named", item: labelOf.get(named) ?? named, kind: kind?.name ?? net.ref.kind, key: net.ref.key } };
            continue;
        }
        if (whole || sources.length === 0 || destinations.length === 0) {
            edits.push({ op: "remove", ref: net.ref });
            continue;
        }
        const refs = (ids: readonly string[]) => ids.flatMap((id) => { const ref = refOfId(id); return ref === undefined ? [] : [ref]; });
        edits.push({ op: "sides", ref: net.ref, sides: { sources: refs(sources), destinations: refs(destinations) } });
    }
    return { edits };
}

// ============================================================================
// A key built from the row
// ============================================================================

/** What a gesture's moves read (#1549): the rows it moves, where a row stands, which records are edited, and what names an item. */
export interface SchematicKeyHolding {
    /** The Schematic's kinds. */
    readonly kinds: EditKinds;
    /**
     * The rows a gesture moves under the keys their fields build once it writes them (`editing.ts`' `moves`).
     *
     * @param edits - The gesture's edits
     */
    readonly moves: (edits: readonly SchematicEdit[]) => readonly SchematicMove[];
    /**
     * Whether a row of a kind stands under a key: drafted, else read — one a draft deletes stands free.
     *
     * @param slot - The kind's slot
     * @param key - The key's text
     */
    readonly stands: (slot: string, key: string) => boolean;
    /**
     * Whether a record is edited: a kind's, or its details' (`detailsKey`).
     *
     * @param record - The record's key in the history
     */
    readonly edited: (record: string) => boolean;
    /** The links and nets the Schematic holds — drawn, and waiting in their sessions — their drafts in place: what names an item. */
    readonly drawn: Pick<SchematicDrawn, "links" | "nets">;
    /**
     * Why the Schematic may not hold every row of a link or net kind (#1580): the rail's filters leave some out, its page's
     * scope holds only some (#1621), or its read hasn't landed or failed; `undefined` where it holds them all.
     *
     * @param slot - The kind's slot
     */
    readonly unheld: (slot: string) => SchematicUnheld | undefined;
    /**
     * Whether a record takes an edit now (#1584): one whose Save is in flight takes none.
     *
     * @param record - The record's key in the history: a kind's slot, or its details' (`detailsKey`)
     */
    readonly takes: (record: string) => boolean;
}

/** A gesture's edits with every row it moves following its key, and the rows moved; or why it records nothing. */
export type FollowedEdits =
    | { readonly edits: readonly SchematicEdit[]; readonly moved: readonly SchematicMove[] }
    | { readonly refused: SchematicKeyRefusal };

/** How many times a row's move can reach another's: an item's to the links and nets naming it, keyed by what they name. */
const FOLLOWS = 4;

/**
 * What names the items a gesture moves, following them (#1549): each link of
 * a kind that writes naming one at an end, and each net of a kind that writes
 * naming one on a side — those drawn and those waiting — written to name it
 * under its new key, every other end and member as it was. A link or a net
 * bound read only is left, naming the key it named.
 *
 * @param holding - What the gesture reads
 * @param moves - The rows it moves
 * @returns The edits writing each one's ends or sides
 */
function namers(holding: SchematicKeyHolding, moves: readonly SchematicMove[]): SchematicEdit[] {
    const follow = (ref: SchematicRef): SchematicRef => {
        const move = moves.find((m) => refEqual(m.ref, ref));
        return move === undefined ? ref : { kind: ref.kind, key: move.to };
    };
    const moving = (ref: SchematicRef): boolean => moves.some((m) => refEqual(m.ref, ref));
    const refs = (ids: readonly string[]) => ids.flatMap((id) => { const ref = refOfId(id); return ref === undefined ? [] : [ref]; });
    const edits: SchematicEdit[] = [];
    for (const link of holding.drawn.links) {
        if (holding.kinds.links.get(link.ref.kind)?.editable !== true) continue;
        const from = refOfId(link.from), to = refOfId(link.to);
        if (from === undefined || to === undefined || (!moving(from) && !moving(to))) continue;
        edits.push({ op: "ends", ref: link.ref, ends: { from: follow(from), to: follow(to) } });
    }
    for (const net of holding.drawn.nets) {
        if (holding.kinds.nets.get(net.ref.kind)?.editable !== true) continue;
        const sources = refs(net.sources), destinations = refs(net.destinations);
        if (!sources.some(moving) && !destinations.some(moving)) continue;
        edits.push({ op: "sides", ref: net.ref, sides: { sources: sources.map(follow), destinations: destinations.map(follow) } });
    }
    return edits;
}

/**
 * Why a gesture can't move the items it moves (#1580): the first link or net
 * kind that writes and may name one — an end or a side holding its slot — whose
 * rows the Schematic doesn't all hold, which {@link namers} can't follow it in.
 * An item under a placeholder no stored row names.
 *
 * @param holding - What the gesture reads
 * @param moves - The rows it moves
 * @returns The refusal; `undefined` where every kind that may name them is held whole
 */
function unheldNamer(holding: SchematicKeyHolding, moves: readonly SchematicMove[]): SchematicKeyRefusal | undefined {
    for (const move of moves) {
        const slot = move.ref.kind;
        const item = holding.kinds.itemKeys.get(slot);
        if (item === undefined || !item.keys.isKey(move.ref.key)) continue;
        const naming = [
            ...[...holding.kinds.links].flatMap(([kind, link]) => (link.editable && [...link.from, ...link.to].some((end) => stringEqual(end, slot)) ? [kind] : [])),
            ...[...holding.kinds.nets].flatMap(([kind, net]) => (net.editable && (stringEqual(net.sources, slot) || stringEqual(net.destinations, slot)) ? [kind] : [])),
        ];
        for (const kind of naming) {
            const why = holding.unheld(kind);
            if (why !== undefined) return { refusal: "unheld", ref: move.ref, kind, why };
        }
    }
    return undefined;
}

/**
 * Why a gesture can't move the rows it moves where what follows one takes no
 * edit now (#1584) — a Save of it in flight: its details, where they are
 * edited, which its details row moves into with it; or the rows of a link or a
 * net kind naming an item, which {@link namers} writes. Recorded, the gesture
 * would record nothing, and say nothing of why.
 *
 * @param holding - What the gesture reads
 * @param moves - The rows it moves
 * @returns The refusal; `undefined` where every record what follows them writes takes an edit
 */
function busyFollower(holding: SchematicKeyHolding, moves: readonly SchematicMove[]): SchematicKeyRefusal | undefined {
    for (const move of moves) {
        const details = detailsKey(move.ref.kind);
        if (holding.edited(details) && !holding.takes(details)) return { refusal: "details", ref: move.ref };
        const busy = namers(holding, [move]).find((edit) => !holding.takes(edit.ref.kind));
        if (busy !== undefined) return { refusal: "unheld", ref: move.ref, kind: busy.ref.kind, why: "busy" };
    }
    return undefined;
}

/**
 * Whether a key a row moves to is held once the gesture is made (#1581):
 * another row moves there too, or a row stands there that the gesture leaves
 * there — a row moving off it frees it, so a swap or a shift passes.
 *
 * @param holding - What the gesture reads
 * @param moves - The rows the gesture moves
 * @param move - The row moving
 * @returns Whether its new key is held
 */
function heldOnceMoved(holding: SchematicKeyHolding, moves: readonly SchematicMove[], move: SchematicMove): boolean {
    const at = (kind: string, key: string): boolean => stringEqual(kind, move.ref.kind) && stringEqual(key, move.to);
    if (moves.some((other) => other !== move && at(other.ref.kind, other.to))) return true;
    return holding.stands(move.ref.kind, move.to) && !moves.some((other) => at(other.ref.kind, other.ref.key));
}

/**
 * A gesture's edits with each row whose kind builds its key from its row
 * moved under the key its fields build once the gesture writes them (#1549):
 * the row moved under its new key before any of its edits — its details row
 * with it, where they are edited — so each writes it there; then what names
 * it following — an item's links and nets — whose own keys, built from what
 * they name, move them in turn. A key another row stands under once the
 * gesture is made, or another moving row takes, refuses the gesture, naming
 * that key — one a row moves off is free, so a swap or a shift passes, the row
 * moving onto it replacing the one moving off, whose key it leaves standing
 * (#1581). A row the gesture moves itself — a new item's key typed in the
 * inspector — is followed the same way by what names it. An item that a link
 * or a net kind the Schematic doesn't hold whole may name refuses the gesture
 * too (#1580): what it leaves out would keep the old key; and so does a row
 * whose details, or the rows naming it, take no edit now (#1584).
 *
 * @param holding - What the gesture reads
 * @param made - The gesture's edits
 * @returns The edits with every move, and the rows moved by the keys they build; or the refusal, where a key is taken,
 *   what may name a moving item isn't held, or what follows a moving row takes no edit now
 */
export function followBuiltKeys(holding: SchematicKeyHolding, made: readonly SchematicEdit[]): FollowedEdits {
    const typed = made.flatMap((edit): SchematicMove[] => (edit.op === "move" && edit.details !== true ? [{ ref: edit.ref, to: edit.to }] : []));
    const unheldTyped = unheldNamer(holding, typed) ?? busyFollower(holding, typed);
    if (unheldTyped !== undefined) return { refused: unheldTyped };
    let edits: readonly SchematicEdit[] = typed.length === 0 ? made : [...made, ...namers(holding, typed)];
    const moved: SchematicMove[] = [];
    for (let pass = 0; pass < FOLLOWS && edits.length > 0; pass++) {
        const moves = holding.moves(edits);
        if (moves.length === 0) break;
        for (const move of moves) {
            if (heldOnceMoved(holding, moves, move)) return { refused: { refusal: "taken", ref: { kind: move.ref.kind, key: move.to } } };
        }
        const unheld = unheldNamer(holding, moves) ?? busyFollower(holding, moves);
        if (unheld !== undefined) return { refused: unheld };
        const to = (ref: SchematicRef) => moves.find((move) => refEqual(move.ref, ref))?.to;
        // A row moving onto a key another moving row leaves replaces that row; a key another moving row takes stays.
        const sameKind = (a: SchematicMove, b: SchematicMove) => stringEqual(a.ref.kind, b.ref.kind);
        const flags = (move: SchematicMove) => ({
            ...(moves.some((other) => sameKind(other, move) && stringEqual(other.ref.key, move.to)) ? { replaces: true as const } : {}),
            ...(moves.some((other) => sameKind(other, move) && stringEqual(other.to, move.ref.key)) ? { refilled: true as const } : {}),
        });
        edits = [
            ...moves.flatMap((move): SchematicEdit[] => [
                { op: "move", ref: move.ref, to: move.to, ...flags(move) },
                ...(holding.edited(detailsKey(move.ref.kind)) ? [{ op: "move", ref: move.ref, to: move.to, details: true, ...flags(move) } as const] : []),
            ]),
            ...edits.map((edit): SchematicEdit => {
                const moving = edit.op === "move" || edit.op === "remove" ? undefined : to(edit.ref);
                return moving === undefined ? edit : { ...edit, ref: { kind: edit.ref.kind, key: moving } };
            }),
            ...namers(holding, moves),
        ];
        moved.push(...moves);
    }
    return { edits, moved };
}
