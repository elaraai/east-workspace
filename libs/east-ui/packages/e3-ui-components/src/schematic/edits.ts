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
 *   its key minted (SC7, SC9).
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
 * are (SC9).
 *
 * A library card's drop (#1390, `drop.ts`) writes its rows as edits too: an
 * item template's new item, a backlog row placed, a link or net template's
 * values written over a link or a net of its kind, and an author's card's
 * fields set on an entity.
 *
 * @packageDocumentation
 */

import { StringType, equalFor, some, type ValueTypeOf, type option } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import { refOfId, type SchematicDrawn, type SchematicRef } from "./canvas/drawn.js";
import type { SchematicValue } from "./data.js";

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
 * - `set`: the fields an author's card sets, every other field as it was
 *   (#1390);
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
    | { readonly op: "set"; readonly ref: SchematicRef; readonly sets: readonly SchematicFieldWrite[] }
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

/** The Schematic's kinds, as the edits read them: which write, and what each link's ends and each net's sides hold. */
export interface EditKinds {
    /** The slots of the item kinds that write: bound with their patch door, and the Schematic not read only. */
    readonly items: ReadonlySet<string>;
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
 *   would leave naming an item no kind holds.
 */
export type EditRefusal =
    | { readonly why: "end"; readonly kind: string; readonly end: "start" | "end"; readonly item: string }
    | { readonly why: "named"; readonly item: string; readonly kind: string; readonly key: string };

/** An item a gesture names: its reference, and its label for a refusal's words. */
export interface EditItem {
    readonly ref: SchematicRef;
    readonly label: string;
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

/** What a Connect drag would write, before it lands: the kind it writes, and why it can't, if it can't. */
export interface ConnectCandidate {
    /** The slot of the link or net kind it writes; `undefined` where none can be written. */
    readonly kind: string | undefined;
    /** Why its kind can't hold the pair; `undefined` when it can. */
    readonly refusal: EditRefusal | undefined;
}

/**
 * What a Connect drag would write (SC9): a link of the Connect tool's kind —
 * or, a Shift-drag in an open session, the session's net: its own, or the
 * first editable net kind's whose sides hold the session's members, else a
 * link. The kind it writes is what the veto hears (`Candidate.kind`), and its
 * refusal what the draft shows.
 *
 * @param kinds - The Schematic's kinds
 * @param args - The drag
 * @returns The kind it writes, and why it can't
 */
export function connectCandidate(kinds: EditKinds, args: ConnectDragArgs): ConnectCandidate {
    const link = args.linkKind === undefined ? undefined : kinds.links.get(args.linkKind);
    const plain = (): ConnectCandidate => (link === undefined || !link.editable ? { kind: undefined, refusal: undefined }
        : { kind: args.linkKind, refusal: linkRefusal(link, args.from, args.to) });
    const open = grows(args);
    if (open === undefined) return plain();
    const sides = foldPair(open.sides, { from: args.from.ref, to: args.to.ref });
    if (open.net !== undefined) {
        const net = kinds.nets.get(open.net.kind);
        return net === undefined || !net.editable ? { kind: undefined, refusal: undefined } : { kind: open.net.kind, refusal: netRefusal(net, sides, args.labelOf) };
    }
    const grown = netKindFor(kinds, sides);
    return grown !== undefined ? { kind: grown, refusal: undefined } : plain();
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
 * one writing its sides — else another link.
 *
 * @param kinds - The Schematic's kinds
 * @param args - The drag
 * @param mint - A new key for a row of a kind
 * @param values - What a new link's or net's other fields take, by its kind's slot: the values of the template of that kind
 *   the library has selected (§4.3, #1390); `none`, their types' defaults
 * @returns The step; `undefined` for a drag that writes nothing — one its kind refuses, or one between two members of the net
 */
export function connectStep(kinds: EditKinds, args: ConnectDragArgs, mint: (slot: string) => string, values: (slot: string) => option<Uint8Array>): ConnectStep | undefined {
    const candidate = connectCandidate(kinds, args);
    const slot = candidate.kind;
    if (slot === undefined || candidate.refusal !== undefined) return undefined;
    const pair: ConnectPair = { from: args.from.ref, to: args.to.ref };
    const open = grows(args);
    if (kinds.links.has(slot)) {
        // A link: the session's first, or one more of a session no net kind holds.
        const ref = { kind: slot, key: mint(slot) };
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
    const net = { kind: slot, key: mint(slot) };
    return {
        edits: [...open.links.map((ref): SchematicEdit => ({ op: "remove", ref })), { op: "net", ref: net, sides, values: values(slot) }],
        session: { links: [], net },
    };
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

/**
 * What an Extend writes (SC10): an item added to a net's destinations.
 *
 * @param net - The net: its reference and its sides
 * @param target - The item it adds
 * @returns The edits; none for an item the net holds already
 */
export function extendEdits(net: { readonly ref: SchematicRef; readonly sides: SchematicSides }, target: SchematicRef): SchematicEdit[] {
    if (holds(net.sides.sources, target) || holds(net.sides.destinations, target)) return [];
    return [{ op: "sides", ref: net.ref, sides: { sources: net.sides.sources, destinations: [...net.sides.destinations, target] } }];
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
