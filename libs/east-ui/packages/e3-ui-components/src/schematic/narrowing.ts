/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the rail's narrowing does to the Schematic's drawing (#1392,
 * `Schematic Builder Spec.md` §10.2, §10.3) — pure: which entities match it,
 * which draw as context, and which it takes out of every list that shows the
 * drawing — Find, the Index, the Backlog, the inspector's Choosers and what an
 * item is joined to, and the footer's counts — and of the selection.
 *
 * A row matches while its kind's source narrows and holds it among its shown
 * keys (`useSourceVisibility`), never by a predicate over the rows. What else
 * the narrowing does follows how a narrowed-out row draws:
 *
 * - **Hidden** (the default): a kind read through its source reads only what
 *   its narrowing holds, so a narrowed-out row is never drawn. A link or a net
 *   draws only while its ends do, so one ending at an item of a kind read
 *   through its source that its read does not hold is out too — a net once a
 *   side of it has no such member left.
 * - **Dimmed** (`narrowed="dim"`): every row is read, and one its kind's
 *   source narrows out draws as context; so does a link ending at one, and a
 *   net whose every member drawn on a side is one. Context is out.
 *
 * A row a gesture created is neither: no read holds it, and it draws as it is.
 *
 * @packageDocumentation
 */

import { match, type ValueTypeOf, type option } from "@elaraai/east";
import type { Schematic } from "@elaraai/e3-ui/internal";
import { refOfId, type SchematicDrawn, type SchematicRef } from "./canvas/drawn.js";
import type { SchematicHeldRows } from "./data.js";

/** No entity. */
const NONE: ReadonlySet<string> = new Set();

/** How a narrowed-out row draws, and what the matches take (§10.3): the payload's `narrowed`, read once. */
export interface SchematicNarrowedLook {
    /** Whether a narrowed-out row draws as context, rather than hidden. */
    readonly dim: boolean;
    /** Context's opacity (0–1). */
    readonly opacity: number;
    /** Whether context is drained of colour. */
    readonly desaturate: boolean;
    /** Whether a context item draws as a bare marker. */
    readonly dot: boolean;
    /** The matches' emphasis: a ring, one that breathes, or none. */
    readonly emphasis: "halo" | "pulse" | undefined;
    /** Whether the matches are boxed. */
    readonly frame: boolean;
    /** Whether the camera flies to the matches when they change. */
    readonly fit: boolean;
}

/**
 * How a narrowed-out row draws, as the payload says it.
 *
 * @param narrowed - The payload's `narrowed`
 * @returns Its look
 */
export function narrowedLook(narrowed: ValueTypeOf<typeof Schematic.Types.Narrowed>): SchematicNarrowedLook {
    return {
        dim: narrowed.show.type === "dim",
        opacity: narrowed.opacity,
        desaturate: narrowed.desaturate,
        dot: narrowed.dot,
        emphasis: match(narrowed.emphasis, { some: (emphasis) => emphasis.type }, undefined),
        frame: narrowed.frame,
        fit: narrowed.fit,
    };
}

/** Whether a look asks anything of the matches: an emphasis, a frame or a fit — what makes a hidden narrowing read its keys. */
export function looksAtMatches(look: SchematicNarrowedLook): boolean {
    return look.emphasis !== undefined || look.frame || look.fit;
}

/** What the narrowing does to the drawing, each entity by its id. */
export interface SchematicNarrowing {
    /** The matches: each entity of a kind whose source narrows, among its shown keys, and drawn as itself — what emphasis rings, frame boxes and fit flies to. */
    readonly matches: ReadonlySet<string>;
    /** What draws as context (`narrowed="dim"`): faded, drained of colour or a bare marker, and never selected. */
    readonly context: ReadonlySet<string>;
    /** What the narrowing takes out of every list and of the selection: the context, and a link or a net whose ends it hides. */
    readonly out: ReadonlySet<string>;
    /** Whether a row the read holds draws as context: one its kind's source narrows out, under `narrowed="dim"` — a backlog row among them. */
    readonly isContext: (ref: SchematicRef) => boolean;
}

/** Nothing narrows. */
export const NO_NARROWING: SchematicNarrowing = { matches: NONE, context: NONE, out: NONE, isContext: () => false };

/** What the narrowing is worked out from. */
export interface SchematicNarrowingArgs {
    /** What the canvas draws: the stored rows, the drafts in place. */
    readonly drawn: SchematicDrawn;
    /** Each kind's rows its read holds, by the kind's slot, then by key. */
    readonly held: SchematicHeldRows;
    /** The kinds read through their source of the slice, by slot. */
    readonly sourced: ReadonlySet<string>;
    /**
     * A kind's source's shown keys, by the kind's slot: `none` while the source narrows nothing; `undefined` for a kind
     * read whole, and for one whose source's keys are not read, or have not yet resolved.
     */
    readonly keys: (slot: string) => option<ReadonlySet<string>> | undefined;
    /** Whether a narrowed-out row draws as context: `narrowed="dim"`. */
    readonly dim: boolean;
}

/**
 * What the narrowing does to the drawing (see the module docs).
 *
 * @param args - The drawing, what each read holds, the kinds read through their source, each source's shown keys and whether a narrowed-out row is dimmed
 * @returns The matches, the context, and what is out
 */
export function schematicNarrowing(args: SchematicNarrowingArgs): SchematicNarrowing {
    const { drawn, held, sourced, keys, dim } = args;
    const holds = (ref: SchematicRef): boolean => held.get(ref.kind)?.has(ref.key) === true;
    // A row its kind's source narrows out: its read holds it, and its source's shown keys do not.
    const outside = (ref: SchematicRef): boolean => {
        const shown = keys(ref.kind);
        return shown !== undefined && shown.type === "some" && holds(ref) && !shown.value.has(ref.key);
    };
    const context = new Set<string>();
    const out = new Set<string>();
    const items = new Set(drawn.items.map((item) => item.key));
    if (dim) {
        for (const item of drawn.items) if (outside(item.ref)) context.add(item.key);
        for (const zone of drawn.zones) if (outside(zone.ref)) context.add(zone.key);
        for (const link of drawn.links) {
            if (outside(link.ref) || context.has(link.from) || context.has(link.to)) context.add(link.key);
        }
        // A side whose every member drawn is context leaves the net context.
        const dimmed = (members: readonly string[]) => {
            const on = members.filter((member) => items.has(member));
            return on.length > 0 && on.every((member) => context.has(member));
        };
        for (const net of drawn.nets) if (outside(net.ref) || dimmed(net.sources) || dimmed(net.destinations)) context.add(net.key);
        for (const id of context) out.add(id);
    } else {
        // An end the narrowing hides: drawn nowhere, of a kind read through its source whose read does not hold it.
        const hidden = (id: string): boolean => {
            if (items.has(id)) return false;
            const ref = refOfId(id);
            return ref !== undefined && sourced.has(ref.kind) && !holds(ref);
        };
        for (const link of drawn.links) if (hidden(link.from) || hidden(link.to)) out.add(link.key);
        const gone = (members: readonly string[]) => members.length > 0 && members.every(hidden);
        for (const net of drawn.nets) if (gone(net.sources) || gone(net.destinations)) out.add(net.key);
    }
    const matches = new Set<string>();
    for (const entity of [...drawn.items, ...drawn.zones, ...drawn.links, ...drawn.nets]) {
        const shown = keys(entity.ref.kind);
        if (shown !== undefined && shown.type === "some" && shown.value.has(entity.ref.key) && !out.has(entity.key)) matches.add(entity.key);
    }
    if (matches.size === 0 && context.size === 0 && out.size === 0) return NO_NARROWING;
    return { matches, context, out, isContext: (ref) => dim && outside(ref) };
}

/**
 * The drawing as the lists show it: what the narrowing takes out left out.
 *
 * @param drawn - What the canvas draws
 * @param out - What the narrowing takes out, by id
 * @returns The drawing; the one given while nothing is out
 */
export function narrowedDrawing(drawn: SchematicDrawn, out: ReadonlySet<string>): SchematicDrawn {
    if (out.size === 0) return drawn;
    return {
        items: drawn.items.filter((item) => !out.has(item.key)),
        zones: drawn.zones.filter((zone) => !out.has(zone.key)),
        links: drawn.links.filter((link) => !out.has(link.key)),
        nets: drawn.nets.filter((net) => !out.has(net.key)),
    };
}
