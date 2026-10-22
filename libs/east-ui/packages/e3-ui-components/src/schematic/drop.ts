/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic's drops (#1390, `Schematic Builder Spec.md` §7, §8,
 * SC11–SC13) — pure and React-free: what a library card does where it lands,
 * decided as data before anything is drawn or written. The frame records a
 * plan as one step of the editing's history (`use-drop.ts`), and the canvas
 * works out where a drag rests from its own drawing.
 *
 * - **What is dragged** ({@link SchematicDropCard}, {@link dropHostOf}): a
 *   card of a tab that drops — an item kind's template, which adds an item; a
 *   row of the Backlog, which places it; a link or a net kind's template,
 *   which writes its values over a link or a net of its kind; an author's
 *   card, whose patch sets its fields on an entity of the kind it names.
 * - **Where a drag rests** ({@link SchematicDropAtType}, {@link restsAt}): the
 *   point of the drawing under the pointer, for a card that adds or places an
 *   item — at the screen's resolution ({@link dropPoint}), so what the ghost
 *   says is what is written — or the entity of the card's kind under it, for
 *   one that lands on an entity; or nothing of its kind. The shared drag
 *   grammar's `CellRef` carries it in its `row`, printed.
 * - **What a drop does** ({@link planDrop}, {@link dropEdits}): an item added
 *   at the point, its key minted (SC12); a backlog row placed there (SC4); a
 *   template's values written over the link or the net, never its ends, its
 *   sides or its key (SC11); an author's card's fields set — or refused, with
 *   the reason the ghost says in red: outside the drawing, no entity of the
 *   card's kind under it, its kind read only, or its kind's session taking no
 *   edit now.
 * - **⏎ on a card** ({@link planEnter}, SC13): a card that adds or places an
 *   item lands at the view's centre; one that lands on an entity, on the
 *   selection — every selected entity of its kind, as one step.
 * - **Its words** ({@link dropCaption}, {@link dropName}, {@link dropRefusal},
 *   {@link dropLabel}) and **its marks** ({@link markOf}): the point a card
 *   lands at and the zone holding it, or the entity it lands on.
 *
 * @packageDocumentation
 */

import { FloatType, IntegerType, NullType, StringType, StructType, VariantType, equalFor, none, parseFor, printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import type { DragPayload, DropCellOptions, DropVeto } from "@elaraai/east-ui-components";
import type { BacklogEntry } from "./backlog.js";
import { entityId, type SchematicRef } from "./canvas/drawn.js";
import type { SchematicValue } from "./data.js";
import type { SchematicEdit, SchematicFieldWrite } from "./edits.js";
import type { SchematicDropRefusalWord, SchematicWords } from "./messages.js";

const stringEqual = equalFor(StringType);

/** A point of the drawing, in world units. */
type Point = ValueTypeOf<typeof Schematic.Types.Point>;

// ── What is dragged ───────────────────────────────────────────────────────

/** A card the canvas takes, as the Schematic reads it: what its drop does, the kind it writes, and its name. */
export type SchematicDropCard =
    /** An item kind's template: a new item of its kind at the drop point, every other field the template's (SC12). */
    | { readonly does: "add"; readonly kind: string; readonly label: string; readonly values: Uint8Array }
    /** A row of an item kind's backlog: placed at the drop point (SC4). */
    | { readonly does: "place"; readonly ref: SchematicRef; readonly label: string }
    /** A link or a net kind's template: its values written over a link or a net of its kind, never its ends, its sides or its key (SC11). */
    | { readonly does: "retype"; readonly kind: string; readonly label: string; readonly values: Uint8Array }
    /** An author's card: the fields its patch sets, on an entity of the kind its patch names. */
    | { readonly does: "set"; readonly kind: string; readonly label: string; readonly sets: readonly SchematicFieldWrite[] };

/**
 * The slot of the kind a card writes.
 *
 * @param card - The card
 * @returns The kind's slot
 */
export function cardKind(card: SchematicDropCard): string {
    return card.does === "place" ? card.ref.kind : card.kind;
}

/**
 * Whether a card lands at a point of the drawing — a template's new item, a
 * backlog row placed — rather than on an entity.
 *
 * @param card - The card
 * @returns Whether it lands at a point
 */
export function landsAtPoint(card: SchematicDropCard): card is Extract<SchematicDropCard, { readonly does: "add" | "place" }> {
    return card.does === "add" || card.does === "place";
}

/** A kind whose templates the Templates tab lists: its slot, and its templates. */
export interface SchematicTemplatesKind {
    /** The kind's slot. */
    readonly key: string;
    /** Its templates, as the wire carries them: each its key, its name, and its values as bytes. */
    readonly templates: readonly ValueTypeOf<typeof Schematic.Types.Template>[];
}

/** What the canvas takes dropped: its drop target, and each library whose cards drop — its cards by key. */
export interface SchematicDropHost {
    /** The Schematic's drop target: the surface its canvas registers on. */
    readonly surface: string;
    /** Each library whose cards drop, by its id: its cards, by key. */
    readonly libraries: ReadonlyMap<string, ReadonlyMap<string, SchematicDropCard>>;
}

/**
 * What the canvas takes dropped, from the tabs the payload lists: the
 * Templates tab's cards — an item kind's adding an item, a link or a net
 * kind's writing its values over one — keyed as the tab keys them, by their
 * kind's slot and their key; the Backlog's rows, each placed where it is
 * dropped, keyed by its id; and each author's tab whose patch names a kind,
 * its cards by their keys. The Index, the Layers and an author's tab with no
 * `drop` drop nothing.
 *
 * @param surface - The Schematic's drop target
 * @param libraryOf - The library a tab's cards drag from, by the tab's key
 * @param tabs - The tabs the payload lists
 * @param kinds - The payload's item, link and net kinds: their templates
 * @param backlog - The Backlog's rows
 * @returns What the canvas takes
 */
export function dropHostOf(surface: string, libraryOf: (tabKey: string) => string, tabs: SchematicValue["library"],
    kinds: { readonly items: readonly SchematicTemplatesKind[]; readonly links: readonly SchematicTemplatesKind[]; readonly nets: readonly SchematicTemplatesKind[] },
    backlog: readonly BacklogEntry[]): SchematicDropHost {
    const libraries = new Map<string, ReadonlyMap<string, SchematicDropCard>>();
    for (const tab of tabs) {
        switch (tab.type) {
            case "templates": {
                const cards = new Map<string, SchematicDropCard>();
                for (const kind of kinds.items) {
                    for (const template of kind.templates) {
                        cards.set(entityId({ kind: kind.key, key: template.key }), { does: "add", kind: kind.key, label: template.name, values: template.values });
                    }
                }
                for (const kind of [...kinds.links, ...kinds.nets]) {
                    for (const template of kind.templates) {
                        cards.set(entityId({ kind: kind.key, key: template.key }), { does: "retype", kind: kind.key, label: template.name, values: template.values });
                    }
                }
                libraries.set(libraryOf("templates"), cards);
                break;
            }
            case "backlog":
                libraries.set(libraryOf("backlog"), new Map(backlog.map((entry) => [entry.id, { does: "place", ref: entry.ref, label: entry.roles.label }] as const)));
                break;
            case "tab": {
                const lands = tab.value.drop;
                if (lands.type !== "some") break;
                libraries.set(libraryOf(`tab:${tab.value.name}`),
                    new Map(tab.value.cards.map((card) => [card.key, { does: "set", kind: lands.value, label: card.label, sets: card.sets }] as const)));
                break;
            }
            case "index":
            case "layers":
                break;
        }
    }
    return { surface, libraries };
}

/**
 * A card the canvas takes, by its library and its key.
 *
 * @param host - What the canvas takes
 * @param library - The card's library
 * @param key - The card's key
 * @returns The card, or `undefined` for one no tab that drops lists
 */
export function cardOf(host: SchematicDropHost, library: string, key: string): SchematicDropCard | undefined {
    return host.libraries.get(library)?.get(key);
}

// ── Where a drag rests ────────────────────────────────────────────────────

/**
 * A point a card lands at: its coordinates in world units, and how many
 * decimal digits the screen resolved them to — what the words print them at.
 */
export const SchematicDropPointType = StructType({ x: FloatType, y: FloatType, digits: IntegerType });

/** A point a card lands at, decoded. */
export type SchematicDropPoint = ValueTypeOf<typeof SchematicDropPointType>;

/** Where a drag rests over the canvas, for what it carries — what the Schematic's drop `CellRef` names in its `row`, printed. */
export const SchematicDropAtType = VariantType({
    /** A point of the drawing: where a template's item or a backlog row lands. */
    point: SchematicDropPointType,
    /** The entity of the card's kind under the pointer: what a template writes its values over, or an author's card sets its fields on. */
    entity: Schematic.Types.Ref,
    /** Nothing of the card's kind under the pointer. */
    nothing: NullType,
});

/** Where a drag rests, decoded. */
export type SchematicDropAt = ValueTypeOf<typeof SchematicDropAtType>;

/** Where a drag rests, as its `CellRef` carries it. */
export const printDropAt: (at: SchematicDropAt) => string = printFor(SchematicDropAtType);

const parseDropAt = parseFor(SchematicDropAtType);

/**
 * Where a drop's `CellRef` says the drag rests.
 *
 * @param text - The `CellRef`'s `row`
 * @returns Where it rests, or `undefined` when the text names nowhere — a coordinate another surface made
 */
export function readDropAt(text: string): SchematicDropAt | undefined {
    const read = parseDropAt(text);
    return read.success ? read.value : undefined;
}

/** Nothing of a card's kind: where the canvas's drop cell rests before a drag says otherwise. */
export const NOWHERE: SchematicDropAt = variant("nothing", null);

/** The most digits a drop point keeps: a millionth of a unit. */
const MAX_DIGITS = 6;

/**
 * The point a drop lands at, from the pointer's place in the world: each
 * coordinate rounded to the screen's resolution — the fewest decimal digits
 * whose last is no wider than a pixel at the current zoom — so the drop lands
 * within a pixel of the pointer, and the ghost says what is written.
 *
 * @param world - The pointer's place, in world units
 * @param ppu - The canvas's pixels per world unit
 * @returns The point, and its digits
 */
export function dropPoint(world: { readonly x: number; readonly y: number }, ppu: number): SchematicDropPoint {
    const digits = Number.isFinite(ppu) && ppu > 0 ? Math.min(MAX_DIGITS, Math.max(0, Math.ceil(Math.log10(ppu)))) : 0;
    const scale = 10 ** digits;
    // `+ 0` lets a rounded negative zero go: the point prints `0`, never `-0`.
    const round = (v: number): number => Math.round(v * scale) / scale + 0;
    return { x: round(world.x), y: round(world.y), digits: BigInt(digits) };
}

/**
 * Where a drag rests at a point of the canvas, for a card: the point, for one
 * that lands at a point; else the entity of its kind under the pointer, or
 * nothing.
 *
 * @param card - The card dragged
 * @param point - The point under the pointer, at the screen's resolution ({@link dropPoint})
 * @param entityOf - The entity of a kind under the pointer, by the kind's slot; `undefined` for none
 * @returns Where the drag rests
 */
export function restsAt(card: SchematicDropCard, point: SchematicDropPoint, entityOf: (kind: string) => SchematicRef | undefined): SchematicDropAt {
    if (landsAtPoint(card)) return variant("point", point);
    const ref = entityOf(cardKind(card));
    return ref === undefined ? NOWHERE : variant("entity", ref);
}

// ── What a drop does ──────────────────────────────────────────────────────

/** A kind, as a drop reads it: its name, and whether it writes — bound with its patch door, the Schematic not read only. */
export interface SchematicDropKind {
    /** Its name (`Rack`). */
    readonly name: string;
    /** Whether a drop writes it. */
    readonly writes: boolean;
}

/** What a drop reads of the Schematic as it stands. */
export interface SchematicDropContext {
    /** The drawing's world bounds: a card lands at a point inside them. */
    readonly extent: { readonly width: number; readonly height: number };
    /** Each kind, by its slot. */
    readonly kinds: ReadonlyMap<string, SchematicDropKind>;
    /** Whether a kind's session takes a gesture now: its record read, no Save on its way. */
    readonly available: (slot: string) => boolean;
    /** An entity's name, as the words say it; `undefined` for one the drawing no longer draws. */
    readonly nameOf: (ref: SchematicRef) => string | undefined;
    /** The label of the innermost zone holding a point; `undefined` for none. */
    readonly zoneAt: (point: Point) => string | undefined;
}

/**
 * Why a drop is refused where it rests: in its words — the kind named as the
 * kind gives its name — or, what it lands on having left the drawing, in none.
 */
export type SchematicDropRefusal = { readonly why: "gone" } | SchematicDropRefusalWord;

/** What a drop does where it rests. */
export type SchematicDropPlan =
    /** A new item of a kind at a point, its other fields a template's values (SC12): the zone holding the point, for its words. */
    | { readonly kind: "add"; readonly slot: string; readonly at: SchematicDropPoint; readonly zone: string | undefined; readonly values: Uint8Array }
    /** A backlog row placed at a point (SC4). */
    | { readonly kind: "place"; readonly ref: SchematicRef; readonly at: SchematicDropPoint; readonly zone: string | undefined }
    /** A template's values written over a link or a net of its kind (SC11), and its name. */
    | { readonly kind: "retype"; readonly ref: SchematicRef; readonly name: string; readonly values: Uint8Array }
    /** An author's card's fields set on entities of a kind: one's name, or — several, a card's ⏎ — the kind's. */
    | { readonly kind: "set"; readonly refs: readonly SchematicRef[]; readonly name: string | undefined; readonly kindName: string; readonly sets: readonly SchematicFieldWrite[] }
    | { readonly kind: "refused"; readonly why: SchematicDropRefusal };

const refused = (why: SchematicDropRefusal): SchematicDropPlan => ({ kind: "refused", why });
const GONE: SchematicDropPlan = refused({ why: "gone" });

/**
 * The kind a card writes, if a drop of it may write now: refused when the
 * kind is read only, or its session takes no gesture now.
 */
function writable(card: SchematicDropCard, ctx: SchematicDropContext):
    { readonly writes: true; readonly slot: string; readonly kind: SchematicDropKind } | { readonly writes: false; readonly plan: SchematicDropPlan } {
    const slot = cardKind(card);
    const kind = ctx.kinds.get(slot);
    if (kind === undefined) return { writes: false, plan: GONE };
    if (!kind.writes) return { writes: false, plan: refused({ why: "readOnly", kind: kind.name }) };
    if (!ctx.available(slot)) return { writes: false, plan: refused({ why: "busy", kind: kind.name }) };
    return { writes: true, slot, kind };
}

/**
 * What a drop does where it rests — see the module docs. A card of a kind
 * read only, or whose session takes no gesture now, is refused wherever it
 * rests; a card that lands at a point is refused outside the drawing, and one
 * that lands on an entity anywhere but on an entity of its kind; one whose
 * entity has left the drawing is refused in no words.
 *
 * @param card - The card dragged
 * @param at - Where the drag rests
 * @param ctx - The Schematic as it stands
 * @returns What the drop does, or why it is refused
 */
export function planDrop(card: SchematicDropCard, at: SchematicDropAt, ctx: SchematicDropContext): SchematicDropPlan {
    const gate = writable(card, ctx);
    if (!gate.writes) return gate.plan;
    const { slot, kind } = gate;
    if (landsAtPoint(card)) {
        if (at.type !== "point") return refused({ why: "outside" });
        const point = at.value;
        const { width, height } = ctx.extent;
        if (!(point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height)) return refused({ why: "outside" });
        const zone = ctx.zoneAt({ x: point.x, y: point.y });
        return card.does === "add"
            ? { kind: "add", slot, at: point, zone, values: card.values }
            : { kind: "place", ref: card.ref, at: point, zone };
    }
    if (at.type !== "entity" || !stringEqual(at.value.kind, slot)) return refused({ why: "onto", kind: kind.name });
    const name = ctx.nameOf(at.value);
    if (name === undefined) return GONE;
    switch (card.does) {
        case "retype": return { kind: "retype", ref: at.value, name, values: card.values };
        case "set": return { kind: "set", refs: [at.value], name, kindName: kind.name, sets: card.sets };
    }
}

/**
 * What ⏎ on a card does (SC13): a card that adds or places an item lands at
 * the view's centre; a template of a link or a net kind, on the selected link
 * or net of its kind; an author's card, on every selected entity of its kind,
 * as one step. A card the selection holds nothing of its kind for is refused,
 * naming where it lands, as a drag over nothing of its kind is.
 *
 * @param card - The card
 * @param selection - What the canvas has selected, each entity by its reference
 * @param centre - The view's centre, at the screen's resolution; `undefined` while the canvas has no size
 * @param ctx - The Schematic as it stands
 * @returns What the ⏎ does, or why it is refused
 */
export function planEnter(card: SchematicDropCard, selection: readonly SchematicRef[], centre: SchematicDropPoint | undefined,
    ctx: SchematicDropContext): SchematicDropPlan {
    if (landsAtPoint(card)) return planDrop(card, centre === undefined ? NOWHERE : variant("point", centre), ctx);
    const slot = cardKind(card);
    const picked = selection.filter((ref) => stringEqual(ref.kind, slot));
    if (card.does !== "set" || picked.length <= 1) return planDrop(card, picked.length === 0 ? NOWHERE : variant("entity", picked[0]!), ctx);
    // An author's card on several: every one the drawing still draws, as one step.
    const gate = writable(card, ctx);
    if (!gate.writes) return gate.plan;
    const refs = picked.filter((ref) => ctx.nameOf(ref) !== undefined);
    if (refs.length === 0) return GONE;
    return { kind: "set", refs, name: refs.length === 1 ? ctx.nameOf(refs[0]!) : undefined, kindName: gate.kind.name, sets: card.sets };
}

/**
 * The edits a plan writes, one step of the history: a new item under a
 * minted key; a backlog row's centre; a link's or a net's template values;
 * each entity's fields an author's card sets — none for a refusal.
 *
 * @param plan - The plan
 * @param mint - A new key for a row of a kind, by its slot
 * @returns The edits
 */
export function dropEdits(plan: SchematicDropPlan, mint: (slot: string) => string): SchematicEdit[] {
    switch (plan.kind) {
        case "refused": return [];
        case "add": return [{ op: "item", ref: { kind: plan.slot, key: mint(plan.slot) }, at: some({ x: plan.at.x, y: plan.at.y }), values: some(plan.values) }];
        case "place": return [{ op: "place", ref: plan.ref, at: some({ x: plan.at.x, y: plan.at.y }) }];
        case "retype": return [{ op: "retype", ref: plan.ref, values: plan.values }];
        case "set": return plan.refs.map((ref): SchematicEdit => ({ op: "set", ref, sets: plan.sets }));
    }
}

/**
 * The item a drop brings onto the canvas, which it selects: the one a
 * template added — its key the one its edits minted — or the backlog row it
 * placed; none for a drop on an entity.
 *
 * @param plan - The plan
 * @param edits - The edits it wrote
 * @returns The item's reference, or `undefined`
 */
export function droppedItem(plan: SchematicDropPlan, edits: readonly SchematicEdit[]): SchematicRef | undefined {
    if (plan.kind === "place") return plan.ref;
    if (plan.kind !== "add") return undefined;
    const added = edits.find((edit) => edit.op === "item");
    return added?.ref;
}

// ── Its marks ─────────────────────────────────────────────────────────────

/** What the canvas marks while a drag rests where it lands: the point a card lands at, in world units, or the entity it lands on, by its id. */
export type SchematicDropMark =
    | { readonly kind: "point"; readonly x: number; readonly y: number }
    | { readonly kind: "entity"; readonly id: string };

/**
 * What the canvas marks for a plan: the point a template's item or a backlog
 * row lands at, or the entity a card lands on — nothing for a refusal.
 *
 * @param plan - The plan
 * @returns The mark, or `undefined`
 */
export function markOf(plan: SchematicDropPlan): SchematicDropMark | undefined {
    switch (plan.kind) {
        case "add":
        case "place": return { kind: "point", x: plan.at.x, y: plan.at.y };
        case "retype": return { kind: "entity", id: entityId(plan.ref) };
        case "set": return plan.refs.length === 1 ? { kind: "entity", id: entityId(plan.refs[0]!) } : undefined;
        case "refused": return undefined;
    }
}

/**
 * Whether two marks are one: what the canvas draws need not move.
 *
 * @param a - A mark, or none
 * @param b - Another, or none
 * @returns Whether they mark the same
 */
export function markEqual(a: SchematicDropMark | undefined, b: SchematicDropMark | undefined): boolean {
    if (a === undefined || b === undefined) return a === undefined && b === undefined;
    if (a.kind === "point" || b.kind === "point") return a.kind === "point" && b.kind === "point" && a.x === b.x && a.y === b.y;
    return stringEqual(a.id, b.id);
}

// ── Its words ─────────────────────────────────────────────────────────────

/** A drop point, as the words say it: the zone holding it, and its coordinates at the digits the screen resolved, in the drawing's unit. */
function pointWords(at: SchematicDropPoint, zone: string | undefined, words: SchematicWords, unit: string | undefined): string {
    const digits = some(at.digits);
    const fixed = variant("number", { minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: none });
    return words.m.dropAt({ zone, x: words.value(at.x, fixed), y: words.value(at.y, fixed), unit });
}

/** What a plan lands on, as the words say it: the point and its zone, the entity, or — several — the count of them. */
function whereWords(plan: Exclude<SchematicDropPlan, { kind: "refused" }>, words: SchematicWords, unit: string | undefined): string {
    switch (plan.kind) {
        case "add":
        case "place": return pointWords(plan.at, plan.zone, words, unit);
        case "retype": return plan.name;
        case "set": return plan.name ?? words.m.dropMany({
            n: plan.refs.length, count: words.number(plan.refs.length), name: plan.kindName.toLocaleLowerCase(words.locale),
        });
    }
}

/**
 * Why a plan is refused, as its words say it: its kind named as running text
 * writes it.
 */
function refusalWords(why: SchematicDropRefusal, words: SchematicWords): string | undefined {
    if (why.why === "gone") return undefined;
    return words.m.dropRefused(why.why === "outside" ? why : { why: why.why, kind: why.kind.toLocaleLowerCase(words.locale) });
}

/**
 * What the ghost says of a plan: where a card lands — `Cage A · 6.04, 2.91 m`
 * — or what it lands on — `onto A01 → ODF-1` — or, red, why it can't:
 * `Drop onto a fibre run`.
 *
 * @param plan - The plan
 * @param words - The Schematic's words
 * @param unit - The drawing's scale unit, if it has one
 * @returns The caption; `undefined` for a refusal that says nothing
 */
export function dropCaption(plan: SchematicDropPlan, words: SchematicWords, unit: string | undefined): string | undefined {
    if (plan.kind === "refused") return refusalWords(plan.why, words);
    const where = whereWords(plan, words, unit);
    return plan.kind === "retype" || plan.kind === "set" ? words.m.dropOnto({ name: where }) : where;
}

/**
 * Why a plan is refused, as the footer says it for a card's ⏎ (SC13).
 *
 * @param plan - The plan
 * @param words - The Schematic's words
 * @returns The words; `undefined` for a plan that lands, or a refusal that says nothing
 */
export function dropRefusal(plan: SchematicDropPlan, words: SchematicWords): string | undefined {
    return plan.kind === "refused" ? refusalWords(plan.why, words) : undefined;
}

/**
 * Where a plan lands, as a screen reader hears the drag layer say it — the
 * point and its zone, or the entity — or, refused, the canvas.
 *
 * @param plan - The plan
 * @param words - The Schematic's words
 * @param unit - The drawing's scale unit, if it has one
 * @returns The name
 */
export function dropName(plan: SchematicDropPlan, words: SchematicWords, unit: string | undefined): string {
    return plan.kind === "refused" ? words.m.dropCanvas() : whereWords(plan, words, unit);
}

/**
 * A drop's step in the history, and its Save's — `Drop 42U rack · 8 kW at
 * Cage A · 6.04, 2.91 m`.
 *
 * @param plan - The plan: one that lands
 * @param card - The card dropped
 * @param words - The Schematic's words
 * @param unit - The drawing's scale unit, if it has one
 * @returns The name
 */
export function dropLabel(plan: SchematicDropPlan, card: SchematicDropCard, words: SchematicWords, unit: string | undefined): string {
    return words.m.dropLabel({ card: card.label, where: dropName(plan, words, unit), onto: plan.kind === "retype" || plan.kind === "set" });
}

// ── The canvas's part ─────────────────────────────────────────────────────

/**
 * What the canvas hands the drag layer as its one drop cell: built by the
 * frame and held still while the Schematic takes drops, its functions reading
 * the Schematic as it stands. The canvas works out where a drag rests from its
 * own drawing, and marks it.
 */
export interface SchematicCanvasDrop {
    /** The surface the cell registers on: the Schematic's drop target. */
    readonly surface: string;
    /** What a drag carries, as the Schematic reads it — a card a tab of its library drops — or `undefined`. */
    readonly cardOf: (payload: DragPayload) => SchematicDropCard | undefined;
    /** What a drop of a card where a drag rests does, over the Schematic as it stands. */
    readonly plan: (card: SchematicDropCard, at: SchematicDropAt) => SchematicDropPlan;
    /** The veto: whether the drop a candidate event makes lands. */
    readonly canDrop: DropVeto;
    /** What the ghost says where the drag rests, and that place's name for the announcements. */
    readonly options: Required<Pick<DropCellOptions, "caption" | "name">>;
}
