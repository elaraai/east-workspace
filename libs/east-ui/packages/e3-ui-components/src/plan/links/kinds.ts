/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Plan's link kinds on the canvas (#1541, U10) — pure: each kind's links,
 * rows of the app's record, as the links the canvas draws.
 *
 * - **A link kind's link is a link of the canvas's list.** Its ends are its
 *   two events, each named as `Plan.eventRef` names one — its kind's slot at
 *   no path, its key the run — so the canvas finds each where it draws, the
 *   links focus gathers its rows, and a far end the cells do not hold is read
 *   by its key, all as for a link built in code (`root/events.ts`). Its
 *   quantity is its kind's.
 * - **Its key names its kind and its row**, as East prints a reference
 *   (`(kind="feed", key="F-1")`): no two kinds' links share one, an event's
 *   element none either — a link kind's slot is no event kind's — and what
 *   selects an event's element selects a link, and removes it, by the same
 *   text.
 * - **With its drafts in place**, by the one rule of a kind held whole
 *   (`draftsInPlace`): a stored link as drafted, one its draft deletes
 *   nowhere, one its draft adds after them — a link the Connect tool drew —
 *   and, through a carry-over, one the canvas last drew.
 * - **Saved beside the event kinds**: an editable kind is a record of the
 *   shared editing, its session named by its slot.
 * - **Past the cap, none drawn**: a kind holding more links than an event
 *   kind's events are read under reads none of them, and is named with how
 *   many it holds (`linksOver`), which the frame says in a notice.
 *
 * @packageDocumentation
 */

import { variant, type ValueTypeOf } from "@elaraai/east";
import type { PlanLinkKindType } from "@elaraai/e3-ui/internal";
import { parseEventRef, printEventRef } from "../../shared/schedule/event-ref.js";
import { draftedOf, draftsInPlace, type DraftedRowsByKind, type DraftedStanding } from "../../shared/schedule/drafted-rows.js";
import type { ScheduleEditingRecord } from "../../shared/schedule/editing.js";
import { lowerWord } from "../../shared/schedule/words.js";
import type { PlanLinkValue } from "../model.js";

/** A link kind, as the payload carries it. */
export type PlanLinkKindValue = ValueTypeOf<PlanLinkKindType>;

/** A link's roles, as its kind reads them from its row: its two events and its quantity. */
export type PlanLinkRolesValue = ReturnType<PlanLinkKindValue["read"]>;

/** One kind's stored links, by their keys' text: each one's roles beside its row's bytes. */
export type PlanLinkStoredRows = ReadonlyMap<string, { readonly roles: PlanLinkRolesValue; readonly row: Uint8Array }>;

/** What a read of the link kinds holds: each kind's stored links, by its slot, and the kinds whose links are too many to read. */
export interface PlanLinkKindsRead {
    /** Each kind's stored links, by its slot: none of a kind past the cap. */
    readonly stored: ReadonlyMap<string, PlanLinkStoredRows>;
    /** The kinds holding more links than are read, by their slots, each with how many it holds. */
    readonly over: ReadonlyMap<string, bigint>;
}

/** No link kind. */
export const NO_LINK_KINDS: readonly PlanLinkKindValue[] = [];

/** Nothing read of the link kinds. */
export const NO_LINK_KINDS_READ: PlanLinkKindsRead = { stored: new Map(), over: new Map() };

/** No link of a link kind. */
export const NO_KIND_LINKS: readonly PlanLinkValue[] = [];

/** A link kind holding more links than are read: its slot, its name, and how many it holds. */
export interface PlanLinksOver {
    /** The kind's slot. */
    readonly kind: string;
    /** Its name. */
    readonly name: string;
    /** How many links its record holds. */
    readonly links: number;
}

/** No link kind holds more links than are read. */
export const NO_LINKS_OVER: readonly PlanLinksOver[] = [];

/**
 * A link kind's link's key on the canvas: its kind's slot and its row's key, as East prints a reference.
 *
 * @param slot - The link kind's slot
 * @param id - The link's key's text
 * @returns The key
 */
export function kindLinkKey(slot: string, id: string): string {
    return printEventRef({ kind: slot, key: id });
}

/**
 * The link kind and the row a canvas key names ({@link kindLinkKey}).
 *
 * @param kinds - The link kinds
 * @param key - A link's key on the canvas
 * @returns The kind and the link's key's text; `undefined` for a key that names no link kind's link — a link built in
 *   code, an event's element
 */
export function kindLinkOf(kinds: readonly PlanLinkKindValue[], key: string): { readonly kind: PlanLinkKindValue; readonly id: string } | undefined {
    if (kinds.length === 0) return undefined;
    const ref = parseEventRef(key);
    if (!ref.success) return undefined;
    const kind = kinds.find((one) => one.key === ref.value.kind);
    return kind === undefined ? undefined : { kind, id: ref.value.key };
}

/**
 * A gesture's label in the history over link kinds' links — canonical English, as every history's labels are: one link
 * by its kind's name (`Delete flow`), several by their count (`Delete 3 links`), and links with events by how many
 * there are of both (`Delete 4 selected`).
 *
 * @param verb - What the gesture does (`Delete`, `Edit`)
 * @param kinds - The kind of each link it reaches
 * @param events - How many events it reaches with them; none unless given
 * @returns The label
 */
export function linkStepLabel(verb: string, kinds: readonly PlanLinkKindValue[], events = 0): string {
    if (events > 0) return `${verb} ${kinds.length + events} selected`;
    return kinds.length === 1 ? `${verb} ${lowerWord(kinds[0]!.name)}` : `${verb} ${kinds.length} links`;
}

/**
 * The link kinds bound with their patch door, as records of the shared editing: a session each, named by its slot.
 *
 * @param kinds - The link kinds
 * @returns The records
 */
export function linkKindRecords(kinds: readonly PlanLinkKindValue[]): ScheduleEditingRecord[] {
    return kinds.flatMap((kind) => (kind.editable && kind.editing.type === "some"
        ? [{ key: kind.key, name: kind.name, editing: kind.editing.value, entries: kind.entries, fields: kind.fields }]
        : []));
}

/**
 * The event kinds a link kind's end may name, by their slots: an event of one may be named by a drafted link, so its
 * key is never re-made beneath it.
 *
 * @param kinds - The link kinds
 * @returns The slots
 */
export function linkedEventKinds(kinds: readonly PlanLinkKindValue[]): ReadonlySet<string> {
    return new Set(kinds.flatMap((kind) => [...kind.ends.from, ...kind.ends.to]));
}

/**
 * Reads each link kind's stored links — whole, within its cap. Tracked where it is called: it reads each kind's record.
 *
 * @param kinds - The link kinds
 * @returns Each kind's stored links, and the kinds with more than are read
 */
export function readLinkKinds(kinds: readonly PlanLinkKindValue[]): PlanLinkKindsRead {
    if (kinds.length === 0) return NO_LINK_KINDS_READ;
    const stored = new Map<string, PlanLinkStoredRows>();
    const over = new Map<string, bigint>();
    for (const kind of kinds) {
        const rows = kind.rows();
        if (rows.type === "some") stored.set(kind.key, rows.value);
        else over.set(kind.key, kind.count());
    }
    return { stored, over };
}

/**
 * The link kinds holding more links than are read, in the payload's order: none of such a kind's links is drawn, and
 * the frame says how many it holds.
 *
 * @param kinds - The link kinds
 * @param read - What was read of them
 * @returns Each such kind — one empty list while there is none
 */
export function linksOver(kinds: readonly PlanLinkKindValue[], read: PlanLinkKindsRead): readonly PlanLinksOver[] {
    if (read.over.size === 0) return NO_LINKS_OVER;
    return kinds.flatMap((kind) => {
        const held = read.over.get(kind.key);
        return held === undefined ? [] : [{ kind: kind.key, name: kind.name, links: Number(held) }];
    });
}

/** An event, as a link's end names it: its kind's slot at no path, its key the run. */
function endOf(ref: PlanLinkRolesValue["from"]): PlanLinkValue["from"] {
    return { row: variant("entry", { series: ref.kind, path: [] }), run: ref.key };
}

/**
 * The link kinds' links as the canvas draws them, their drafts in place (see the module docs).
 *
 * @param kinds - The link kinds, in the payload's order
 * @param read - Each kind's stored links
 * @param drafted - Every kind's drafted rows (`useDraftedRows`)
 * @param standing - Which drafted rows stand, and what the canvas last drew, which these links replace
 * @returns The links, each kind's stored ones in their record's order, then those its drafts add
 */
export function kindLinks(kinds: readonly PlanLinkKindValue[], read: PlanLinkKindsRead, drafted: DraftedRowsByKind, standing: DraftedStanding): readonly PlanLinkValue[] {
    if (kinds.length === 0) return NO_KIND_LINKS;
    const out: PlanLinkValue[] = [];
    const drew = new Map<string, ReadonlySet<string>>();
    for (const kind of kinds) {
        const stored = read.stored.get(kind.key);
        if (stored === undefined) continue;
        const drafts = draftedOf<PlanLinkRolesValue>(drafted, kind) ?? NO_DRAFTS;
        for (const { key, roles } of draftsInPlace(kind.key, stored, drafts, standing, drew)) {
            out.push({ key: kindLinkKey(kind.key, key), from: endOf(roles.from), to: endOf(roles.to), quantity: roles.quantity });
        }
    }
    standing.drew(drew);
    return out.length === 0 ? NO_KIND_LINKS : out;
}

/** No draft of a kind. */
const NO_DRAFTS: ReadonlyMap<string, never> = new Map<string, never>();
