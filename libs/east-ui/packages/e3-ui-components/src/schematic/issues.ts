/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The drawing's issues (#1391, `Schematic Builder Spec.md` §9, SC16) — pure
 * and React-free: what the inspector's Issues tab lists, each naming what a
 * click on it selects.
 *
 * - **A link or a net naming an item no kind holds** — an end or a member of
 *   a slot no item kind has, or of an item kind read whole that holds no row
 *   of its key, the drafts in place. A kind read through its source is asked
 *   nothing: what its narrowing leaves out, the drawing cannot say is gone.
 * - **An item outside the extent** — its centre past the drawing's bounds.
 * - **Geometry outside its entity's box** — an item's footprint past its box
 *   about its centre, a zone's shape past its box: its vertices, the arcs its
 *   bulges draw (as the painter draws them), and a band's half-width.
 * - **A colour naming no theme colour** (D14) — an item's, a zone's or a
 *   layer's, which draws its tone instead.
 * - **The app's `ready` refusals** — they hold Save.
 * - **A Save's conflict or refusal**, while it stands.
 *
 * The last two block, and come first; the rest warn, and Save goes ahead with
 * them. Two items of one key in one kind can't arise: each kind is a record
 * keyed by String.
 *
 * @packageDocumentation
 */

import { StringType, equalFor, type ValueTypeOf, type option } from "@elaraai/east";
import type { Schematic } from "@elaraai/e3-ui/internal";
import type { EditIssue, EditSession } from "@elaraai/east-ui-components";
import { arcFromBulge } from "./canvas/paint.js";
import { entityId, refOfId, type SchematicDrawn, type SchematicRef } from "./canvas/drawn.js";
import { recordSlot } from "./record-keys.js";

/** Shape geometry, decoded. */
type Geometry = ValueTypeOf<typeof Schematic.Types.Geometry>;

const stringEqual = equalFor(StringType);

/** How far past its bound a shape may reach and still be within it: float noise, never a drawing's. */
const EPSILON = 1e-6;

/** What an issue says, before its words. */
export type SchematicIssueWord =
    /** An end or a member naming an item no kind holds: its kind's name — or its slot, for one no item kind has — and its key. */
    | { readonly issue: "missing"; readonly kind: string; readonly key: string }
    /** An item whose centre lies outside the drawing's extent. */
    | { readonly issue: "outside" }
    /** A footprint, or a zone's shape, reaching past its box. */
    | { readonly issue: "geometry" }
    /** A colour naming no theme colour token: it draws its tone. */
    | { readonly issue: "colour"; readonly colour: string }
    /** The app's check refusing a drafted row, which holds Save — its field, if it names one. */
    | { readonly issue: "ready"; readonly field: string | undefined; readonly message: string }
    /** A Save's conflict or refusal, in the source's own words. */
    | { readonly issue: "save"; readonly field: string | undefined; readonly message: string };

/** One issue of the drawing, as the Issues tab lists it. */
export interface SchematicIssue {
    /** What a click on it selects: an entity, by its id; `undefined` for nothing — a layer, or a row the drawing doesn't draw. */
    readonly at: string | undefined;
    /** Whether it blocks — the app's check holds Save, or a Save was stopped — rather than warns. */
    readonly blocking: boolean;
    /** What it names: its kind's name — `undefined` for a layer — and its own name, as the Schematic names it everywhere. */
    readonly where: { readonly kind: string | undefined; readonly name: string };
    /** What it says. */
    readonly word: SchematicIssueWord;
}

/** What the drawing's issues are worked out from. */
export interface SchematicIssueArgs {
    /** What the canvas draws: the stored rows, the drafts in place. */
    readonly drawn: SchematicDrawn;
    /** The drawing's world bounds. */
    readonly extent: { readonly width: number; readonly height: number };
    /** Each kind's name, by its slot. */
    readonly names: ReadonlyMap<string, string>;
    /**
     * Each entity's name, by its id, as the Schematic names it everywhere (`inspect.ts`' `entityNames`): what an issue's
     * row names it — a link by its ends, a net by its label or its ends, never a key the Schematic minted.
     */
    readonly nameOf: (id: string) => string;
    /**
     * Whether an item is held: `false` for one of a slot no item kind has, or one an item kind read whole holds no row
     * of; `undefined` where it can't be said — a kind read through its source.
     */
    readonly holds: (ref: SchematicRef) => boolean | undefined;
    /** The layers: each its key, its name and its colour. */
    readonly layers: readonly { readonly key: string; readonly label: string; readonly color: option<string> }[];
    /** The theme colour tokens a colour may name. */
    readonly colours: ReadonlySet<string>;
}

/** A shape's reach about its anchor: its least and greatest offsets along each axis. */
export interface ShapeExtent {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
}

/** A point about the anchor. */
type Pt = { readonly x: number; readonly y: number };

/**
 * Whether an angle lies on an arc's sweep, as `CanvasRenderingContext2D.arc`
 * draws it from its start to its end.
 */
function onSweep(angle: number, start: number, end: number, anticlockwise: boolean): boolean {
    const turn = 2 * Math.PI;
    const wrap = (a: number) => ((a % turn) + turn) % turn;
    return anticlockwise ? wrap(start - angle) <= wrap(start - end) : wrap(angle - start) <= wrap(end - start);
}

/**
 * The points an edge reaches: its two ends, and — for an arc its bulge draws —
 * each of the arc's extremes along an axis that lies on its sweep.
 */
function edgeReach(p1: Pt, p2: Pt, bulge: number): Pt[] {
    const out: Pt[] = [p1, p2];
    const arc = arcFromBulge(p1, p2, bulge);
    if (arc === null) return out;
    for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
        if (onSweep(angle, arc.startAngle, arc.endAngle, arc.anticlockwise)) {
            out.push({ x: arc.cx + arc.radius * Math.cos(angle), y: arc.cy + arc.radius * Math.sin(angle) });
        }
    }
    return out;
}

/**
 * A shape's reach about its anchor (D22): a circle's radius every way; a
 * polygon's or a polyline's vertices and the arcs their bulges draw — a
 * polygon's closing edge among them — and a polyline's band half its width
 * past them; nothing for the box itself.
 *
 * @param geometry - The shape
 * @returns Its reach; `undefined` for the box (`rect`) or a shape with no vertex
 */
export function shapeExtent(geometry: Geometry): ShapeExtent | undefined {
    switch (geometry.type) {
        case "rect": return undefined;
        case "circle": {
            const r = geometry.value.radius;
            return { minX: -r, minY: -r, maxX: r, maxY: r };
        }
        case "polygon":
        case "polyline": {
            const vertices = geometry.value.vertices;
            if (vertices.length === 0) return undefined;
            const closed = geometry.type === "polygon";
            const points: Pt[] = [];
            for (let i = 0; i < vertices.length; i++) {
                const v = vertices[i]!;
                const next = vertices[i + 1] ?? (closed ? vertices[0] : undefined);
                if (next === undefined) points.push(v);
                else points.push(...edgeReach(v, next, v.bulge));
            }
            const band = geometry.type === "polyline" && geometry.value.width.type === "some" ? geometry.value.width.value / 2 : 0;
            return {
                minX: Math.min(...points.map((p) => p.x)) - band, minY: Math.min(...points.map((p) => p.y)) - band,
                maxX: Math.max(...points.map((p) => p.x)) + band, maxY: Math.max(...points.map((p) => p.y)) + band,
            };
        }
    }
}

/**
 * Whether a shape reaches past a box about its anchor.
 *
 * @param geometry - The shape
 * @param width - The box's width
 * @param height - The box's height
 * @returns Whether some of it lies outside the box
 */
export function outsideBox(geometry: Geometry, width: number, height: number): boolean {
    const reach = shapeExtent(geometry);
    if (reach === undefined) return false;
    const hw = width / 2 + EPSILON, hh = height / 2 + EPSILON;
    return reach.minX < -hw || reach.maxX > hw || reach.minY < -hh || reach.maxY > hh;
}

/**
 * The drawing's own issues (see the module docs): its items' — outside the
 * extent, a footprint past its box, a colour naming no theme colour — then its
 * zones', its links' and its nets' — an end or a member no kind holds — and
 * its layers', each in the drawing's order. Each warns.
 *
 * @param args - The drawing, its extent, its kinds' names, what the item kinds hold, its layers and the theme's colours
 * @returns Its issues
 */
export function drawingIssues(args: SchematicIssueArgs): SchematicIssue[] {
    const { drawn, extent, names, nameOf, holds, layers, colours } = args;
    const out: SchematicIssue[] = [];
    const kindOf = (slot: string) => names.get(slot) ?? slot;
    const warn = (at: string | undefined, where: SchematicIssue["where"], word: SchematicIssueWord) => out.push({ at, blocking: false, where, word });
    const badColour = (colour: option<string>): string | undefined => (colour.type === "some" && !colours.has(colour.value) ? colour.value : undefined);
    for (const item of drawn.items) {
        const where = { kind: kindOf(item.ref.kind), name: nameOf(item.key) };
        if (item.x < -EPSILON || item.y < -EPSILON || item.x > extent.width + EPSILON || item.y > extent.height + EPSILON) warn(item.key, where, { issue: "outside" });
        if (item.footprint.type === "some" && item.width.type === "some" && item.height.type === "some"
            && outsideBox(item.footprint.value, item.width.value, item.height.value)) warn(item.key, where, { issue: "geometry" });
        const colour = badColour(item.color);
        if (colour !== undefined) warn(item.key, where, { issue: "colour", colour });
    }
    for (const zone of drawn.zones) {
        const where = { kind: kindOf(zone.ref.kind), name: nameOf(zone.key) };
        if (zone.geometry.type === "some" && outsideBox(zone.geometry.value, zone.width, zone.height)) warn(zone.key, where, { issue: "geometry" });
        const colour = badColour(zone.color);
        if (colour !== undefined) warn(zone.key, where, { issue: "colour", colour });
    }
    // An end or a member no kind holds: named by its kind's name and its key.
    const missing = (at: string, where: SchematicIssue["where"], member: string) => {
        const ref = refOfId(member);
        if (ref === undefined || holds(ref) !== false) return;
        warn(at, where, { issue: "missing", kind: kindOf(ref.kind), key: ref.key });
    };
    // A link or a net named as the Schematic names it: by its ends, a net by its label first.
    for (const link of drawn.links) {
        const where = { kind: kindOf(link.ref.kind), name: nameOf(link.key) };
        missing(link.key, where, link.from);
        if (!stringEqual(link.from, link.to)) missing(link.key, where, link.to);
    }
    for (const net of drawn.nets) {
        const where = { kind: kindOf(net.ref.kind), name: nameOf(net.key) };
        for (const member of [...net.sources, ...net.destinations]) missing(net.key, where, member);
    }
    for (const layer of layers) {
        const colour = badColour(layer.color);
        if (colour !== undefined) warn(undefined, { kind: undefined, name: layer.label }, { issue: "colour", colour });
    }
    return out;
}

/** A record's session as Issues reads it: the kind or the details record it is, and where its Save stands. */
export interface SchematicIssueSession {
    /** The record's key in the history: a kind's slot, or its details record's (`detailsKey`). */
    readonly kind: string;
    /** Its session: where its latest Save stands, its source's words, and its drafts' readiness. */
    readonly session: Pick<EditSession<unknown>, "status" | "issues" | "readiness">;
}

/**
 * The issues each record's session raises (see the module docs): the app's
 * check refusing its drafted rows, and its latest Save's conflict or refusal
 * while it stands — each blocking, naming the entity of its row.
 *
 * @param sessions - Each record's session
 * @param names - Each kind's name, by its slot
 * @param labelOf - An entity's name by its id: its label, where the drawing draws it
 * @returns The issues, in the sessions' order
 */
export function sessionIssues(sessions: readonly SchematicIssueSession[], names: ReadonlyMap<string, string>,
    labelOf: (id: string) => string | undefined): SchematicIssue[] {
    const out: SchematicIssue[] = [];
    for (const part of sessions) {
        const slot = recordSlot(part.kind);
        const kind = names.get(slot) ?? slot;
        const raise = (issue: EditIssue, word: "ready" | "save") => {
            const field = issue.field.type === "some" ? issue.field.value : undefined;
            // The source's own words name no row: they stand for the kind's record.
            const named = !stringEqual(issue.entry, "");
            const id = named ? entityId({ kind: slot, key: issue.entry }) : undefined;
            out.push({
                at: id, blocking: true,
                where: { kind, name: id === undefined ? kind : labelOf(id) ?? issue.entry },
                word: { issue: word, field, message: issue.message },
            });
        };
        const readiness = part.session.readiness;
        if (readiness.type !== "ready") for (const issue of readiness.value) raise(issue, "ready");
        const status = part.session.status;
        if (status === "conflict" || status === "rejected") for (const issue of part.session.issues) raise(issue, "save");
    }
    return out;
}
