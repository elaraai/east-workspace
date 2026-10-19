/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The board's drags on the shared drag grammar (`Allocation Spec.md` §9.4,
 * §9.5, §10; A22–A40): what is dragged — a bin's body, its connector or one of
 * its links, or a Library card: an event, a bin the drafts removed, a
 * resource (#1330) — and onto what — a lane hour, a card, a resource row, the
 * fits marker, a Table cell — each as a `CellCoord` of the board's one
 * surface, and the one verdict a drop gets: its caption, its refusal, and the
 * command it runs. A drop onto a resource, into a reservation, or of a
 * resource takes the app's fit's verdict; while that answer is on its way the
 * caption says so, and the drop waits for it (F2). A pick (A11) is asked and
 * answered as a drag of its card is, and its click runs the same verdict.
 *
 * @packageDocumentation
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { none, some, variant, type option } from "@elaraai/east";
import { useDragLayerOptional, useDragTarget, type CellCoord, type DragEventValue, type DragPayload, type DragTargetConfig } from "@elaraai/east-ui-components";
import { formatDatePattern } from "@elaraai/east-ui-components/internal";
import { linkedQuantity, type AllocationCommands } from "./actions.js";
import type { AllocationFit } from "./fit.js";
import { compareDate, compareFloat, dayKey, parseDay, partsOf, type Context, type Day, type Fit, type FitAsk, type FitResult, type Slot } from "./model.js";
import { a, one, type Nouns } from "./nouns.js";
import { rowOfKey } from "./table-rows.js";

/** What a drag of something on the board carries: a bin's body (A24), its connector, or one of its links. */
export type BoardGrip = { kind: "body"; bin: string } | { kind: "port"; bin: string } | { kind: "link"; bin: string; resource: string };
/** What a Library card carries (#1330): an event to book, a committed bin the drafts removed, or a resource. */
export type LibraryGrip = { kind: "event"; event: string } | { kind: "removed"; bin: string } | { kind: "resource"; resource: string };
/** What a drag carries. */
export type Grip = BoardGrip | LibraryGrip;

/**
 * Where a drag rests: a lane hour (a card in it names the card; a Table row's
 * event cell is its slot's, `table`), a resource's row, or a Table row's
 * resource cell.
 */
export type Target =
    | { kind: "lane"; lane: string; at: Date; card: string | undefined; table?: boolean }
    | { kind: "resource"; resource: string }
    | { kind: "cell"; row: string };

/** A grip on the board as the drag grammar's coordinate. */
export function gripCoord(surface: string, grip: BoardGrip): Required<CellCoord> {
    return { surface, row: grip.kind, slot: grip.kind === "link" ? grip.resource : "", event: grip.bin };
}

/** A lane hour's coordinate, or a card's in it; a Table row's event cell names its slot's (`table`). */
export function laneCoord(surface: string, lane: string, at: Date, card?: string, table = false): CellCoord {
    return { surface, row: `${table ? "table-lane" : "lane"}:${lane}`, slot: dayKey(at), ...(card === undefined ? {} : { event: card }) };
}

/** A Table row's resource cell's coordinate. */
export function resourceCellCoord(surface: string, row: string): CellCoord {
    return { surface, row: "table-resource", slot: row };
}

/** A resource row's coordinate. */
export function rowCoord(surface: string, resource: string): CellCoord {
    return { surface, row: "resource", slot: resource };
}

/** The Library's two lists, by the board's surface: the drag grammar's sources (#1330). */
export interface AllocationLibraries { events: string; resources: string }

/**
 * The Library's ids for a board.
 *
 * @param surface - The board's drag surface
 * @returns Its Events and its Resources lists' ids
 */
export function libraryIds(surface: string): AllocationLibraries {
    return { events: `${surface}.library.events`, resources: `${surface}.library.resources` };
}

/** An Events card's key: an event's, or a removed bin's. */
export function eventCardKey(grip: Extract<LibraryGrip, { kind: "event" | "removed" }>): string {
    return grip.kind === "event" ? `event:${grip.event}` : `removed:${grip.bin}`;
}

/**
 * The grip a Library card's reference names.
 *
 * @param libraries - The board's Library ids
 * @param ref - The card's library and key
 * @returns Its grip, or `undefined` for a card of no list of the board's
 */
export function libraryGripOf(libraries: AllocationLibraries, ref: { library: string; key: string }): LibraryGrip | undefined {
    if (ref.library === libraries.resources) return { kind: "resource", resource: ref.key };
    if (ref.library !== libraries.events) return undefined;
    if (ref.key.startsWith("event:")) return { kind: "event", event: ref.key.slice("event:".length) };
    if (ref.key.startsWith("removed:")) return { kind: "removed", bin: ref.key.slice("removed:".length) };
    return undefined;
}

/** The grip a drag grammar's reference on the board names. */
export function gripOf(ref: { row: string; slot: string; event: option<string> }): BoardGrip | undefined {
    if (ref.event.type !== "some") return undefined;
    const bin = ref.event.value;
    if (ref.row === "body" || ref.row === "port") return { kind: ref.row, bin };
    if (ref.row === "link") return { kind: "link", bin, resource: ref.slot };
    return undefined;
}

/** The target a drag grammar's reference names. */
export function targetOf(ref: { row: string; slot: string; event: option<string> }): Target | undefined {
    if (ref.row === "resource") return { kind: "resource", resource: ref.slot };
    if (ref.row === "table-resource") return { kind: "cell", row: ref.slot };
    const table = ref.row.startsWith("table-lane:");
    if (!table && !ref.row.startsWith("lane:")) return undefined;
    const at = parseDay(ref.slot);
    return at.success ? { kind: "lane", lane: ref.row.slice(table ? "table-lane:".length : "lane:".length), at: at.value,
        card: ref.event.type === "some" ? ref.event.value : undefined, ...(table ? { table: true } : {}) } : undefined;
}

/** A grip's identity, as a cache keys it. */
export function gripKey(grip: Grip): string {
    switch (grip.kind) {
        case "link": return `link|${grip.bin}|${grip.resource}`;
        case "event": return `event|${grip.event}`;
        case "resource": return `resource|${grip.resource}`;
        default: return `${grip.kind}|${grip.bin}`;
    }
}

/** A refusal, as the inspector's note says it (A40, A88): `Not allocated · LD-2232 can't go into K-103: gap too short · next job Tue 18.` */
export interface Refusal { word: string; text: string }

/** A drop's verdict, where the drag rests. */
export interface Verdict {
    /** Whether the drop is taken: a pending answer is (the drop waits for it). */
    allowed: boolean;
    /** The ghost's caption (A33), and whether it warns. */
    caption: string;
    warn: boolean;
    /** Why it is refused. */
    refusal: Refusal | undefined;
    /** The fit's words for it, when the fit gave a verdict: its reason for a fit (`0 d spare to Wed 19 · …`), or for a refusal. */
    reason?: string | undefined;
    /** The fit's answer is still on its way. */
    pending: boolean;
    /** The drop's command. */
    run: (() => boolean) | undefined;
}

/** A question the board asks the fit, of the drafts or of a day derived from them, and the quantity it places. */
export interface Asked { ask: FitAsk; of: Day | undefined; quantity: number }

/** The question a grip on the board asks of the fit (A23, A73): a link's part, a connector's remainder, a body's whole bin. */
export function placeAsk(plan: Day, grip: BoardGrip): { ask: FitAsk; quantity: number } | undefined {
    const bin = plan.bins.get(grip.bin);
    if (bin === undefined) return undefined;
    const quantity = grip.kind === "body" ? bin.quantity : linkedQuantity(bin, grip.kind === "link" ? grip.resource : undefined)?.quantity;
    if (quantity === undefined) return undefined;
    return { ask: variant("place", { subject: variant("bin", grip.bin), quantity }), quantity };
}

/** The resource a grip's link leaves: a link's own, or a connector's largest part (A28: its current resource is never ranked). */
export function currentOf(plan: Day, grip: Grip): string | undefined {
    if (grip.kind === "link") return grip.resource;
    if (grip.kind !== "body" && grip.kind !== "port") return undefined;
    const bin = plan.bins.get(grip.bin);
    return bin === undefined ? undefined : partsOf(bin)[0]?.key;
}

/** The three best fits of an answer, best first, the current resource excepted (A28). */
export function rankOf(answer: FitResult | undefined, current: string | undefined): string[] {
    if (answer === undefined) return [];
    return [...answer.resources].flatMap(([key, fit]) => fit.type === "fits" && key !== current ? [{ key, score: fit.value.score }] : [])
        .sort((a, b) => compareFloat(b.score, a.score)).slice(0, 3).map(f => f.key);
}

/** What the board knows where a drag rests. */
export interface DropScene {
    /** The plan day. */
    day: Date;
    plan: Day;
    /** The day as the record holds it: the bins a Removed from plan card books again. */
    held: Day | undefined;
    context: Context;
    slots: readonly Slot[];
    fit: AllocationFit;
    commands: AllocationCommands;
    /** The day without a reservation: what a fill asks the fit of, as the mock asks it. */
    without: (reservation: string) => Day;
    /** The day with a committed bin the drafts removed back on it, unlinked — and without a reservation it fills: what booking it again asks the fit of. */
    restoring: (bin: string, reservation?: string) => Day | undefined;
    /** The day's first free slot, by time then lane, of the lanes that show (A36). */
    firstFree: () => { lane: string; at: Date } | undefined;
    /** A booking with no free slot left (A36): the banner's words. */
    notice: (refusal: Refusal) => void;
    /** A lane's label. */
    laneLabel: (lane: string) => string;
    /** The board's nouns, as its captions and refusals write them. */
    nouns: Nouns;
}

/** A grip's question of the fit, of the drafts or of a day the board derives from them (`of`, a fill's or a restore's). */
export function askOf(scene: Pick<DropScene, "plan" | "context" | "restoring">, grip: Grip, of?: Day): Asked | undefined {
    switch (grip.kind) {
        case "event": {
            const event = scene.context.events.get(grip.event);
            return event === undefined ? undefined : { ask: variant("place", { subject: variant("event", grip.event), quantity: event.quantity }), of, quantity: event.quantity };
        }
        case "removed": {
            const day = of ?? scene.restoring(grip.bin);
            const bin = day?.bins.get(grip.bin);
            return bin === undefined ? undefined : { ask: variant("place", { subject: variant("bin", grip.bin), quantity: bin.quantity }), of: day, quantity: bin.quantity };
        }
        case "resource": return { ask: variant("take", { resource: grip.resource }), of, quantity: 0 };
        default: {
            const asked = placeAsk(of ?? scene.plan, grip);
            return asked === undefined ? undefined : { ...asked, of };
        }
    }
}

/** An event's code. */
function eventLabel(scene: Pick<DropScene, "context">, event: string): string {
    return scene.context.events.get(event)?.label ?? event;
}

/** A bin's event's code: the drafts', or the record's for a bin the drafts removed. */
function codeOfBin(scene: Pick<DropScene, "context" | "plan" | "held">, bin: string): string {
    const event = (scene.plan.bins.get(bin) ?? scene.held?.bins.get(bin))?.event;
    return event?.type === "some" ? eventLabel(scene, event.value) : "The reservation";
}

/** What a grip's caption and refusal call what it carries. */
function codeOf(scene: Pick<DropScene, "context" | "plan" | "held">, grip: Grip): string {
    switch (grip.kind) {
        case "event": return eventLabel(scene, grip.event);
        case "resource": return nameOf(scene, grip.resource);
        default: return codeOfBin(scene, grip.bin);
    }
}

/** A resource's name. */
const nameOf = (scene: Pick<DropScene, "context">, resource: string) => scene.context.resources.get(resource)?.label ?? resource;

/** A lane slot's words: `B-1 06:15`. */
const slotText = (scene: Pick<DropScene, "laneLabel">, lane: string, at: Date) => `${scene.laneLabel(lane)} ${formatDatePattern("HH:mm", at)}`;

/** Where a bin lands in a lane slot (A37): the slot's time, or a minute after the last bin already in it. */
export function landing(slots: readonly Slot[], plan: Day, lane: string, at: Date, bin: string | undefined): Date {
    const slot = slots.find(s => s.lane === lane && compareDate(s.at, at) === 0);
    const others = (slot?.bins ?? []).filter(id => id !== bin).map(id => plan.bins.get(id)?.at).filter((when): when is Date => when !== undefined);
    if (others.length === 0) return at;
    const last = others.reduce((a, b) => compareDate(a, b) >= 0 ? a : b);
    return new Date(last.getTime() + 60_000);
}

const refused = (caption: string, refusal: Refusal, reason?: string): Verdict => ({ allowed: false, caption, warn: false, refusal, reason, pending: false, run: undefined });
const waiting: Verdict = { allowed: true, caption: "checking fits…", warn: false, refusal: undefined, pending: true, run: undefined };
const taken = (caption: string, run: () => boolean): Verdict => ({ allowed: true, caption, warn: false, refusal: undefined, pending: false, run });
/** No drop here, and nothing to say: a resource's card over a resource row, or a Table event cell. */
const nowhere: Verdict = { allowed: false, caption: "", warn: false, refusal: undefined, pending: false, run: undefined };

/**
 * The fit's answer to a question, as a verdict: refused when the fit gives
 * none (F3, F4), waiting while it is on its way — asked, when `asking`.
 */
function answered(scene: DropScene, asked: Asked | undefined, word: string, asking: boolean, verdict: (answer: FitResult) => Verdict): Verdict {
    if (asked === undefined) return refused("not on the board", { word, text: "The bin is no longer on the board." });
    if (scene.fit.error !== undefined) return refused("fits unavailable", { word, text: `Fits couldn't be checked: ${scene.fit.error}.` });
    const answer = scene.fit.answer(asked.ask, asked.of);
    // Unanswered, it is asked: the fill's question is the reservation's own (A23).
    if (answer === undefined) { if (asking) scene.fit.ask(asked.ask, asked.of); return waiting; }
    return verdict(answer);
}

/** A fit's verdict for a placement on a resource, its caption and its refusal; `suffix` follows a fit's caption (the landing slot, A36). */
function onResource(scene: DropScene, asked: Asked | undefined, code: string, resource: string, word: string, verb: string, run: () => boolean,
    ranks: readonly string[], suffix: string, asking: boolean): Verdict {
    return answered(scene, asked, word, asking, answer => {
        const verdict: Fit | undefined = answer.resources.get(resource);
        // A fit that gives a resource no verdict refuses it: the board decides none of its own (F4).
        if (verdict === undefined) return refused("no verdict from the fit", { word, text: `The fit gave no verdict for ${nameOf(scene, resource)}.` });
        const name = nameOf(scene, resource);
        if (verdict.type === "refused") return refused(verdict.value.reason, { word, text: `${code} can’t go into ${name}: ${verdict.value.reason}.` }, verdict.value.reason);
        const rank = ranks.indexOf(resource);
        const warn = verdict.value.warn.type === "some" ? verdict.value.warn.value : undefined;
        return { allowed: true, caption: `${verb}${name}${rank >= 0 ? ` · #${rank + 1}` : ""}${warn === undefined ? "" : ` · ${warn}`}${suffix}`, warn: warn !== undefined,
            refusal: undefined, reason: verdict.value.why, pending: false, run };
    });
}

/**
 * A Library event's or a removed bin's verdict (§10): booked into a lane hour,
 * after any bins in it (A37); into a reservation, which the fit checks on its
 * resource (A38); onto a resource, at the day's first free slot (A36).
 */
function bookVerdict(scene: DropScene, grip: Extract<LibraryGrip, { kind: "event" | "removed" }>, target: Exclude<Target, { kind: "cell" }>, ranks: readonly string[], asking: boolean): Verdict {
    const code = codeOf(scene, grip);
    const book = (lane: string, at: Date, resource: string | undefined) => grip.kind === "event"
        ? scene.commands.book(grip.event, lane, at, resource) : scene.commands.restore(grip.bin, lane, at, resource);
    if (target.kind === "lane") {
        const card = target.card === undefined ? undefined : scene.plan.bins.get(target.card);
        if (card !== undefined && card.event.type === "none") {
            const reservation = target.card!;
            const into = () => grip.kind === "event" ? scene.commands.fillWith(reservation, grip.event) : scene.commands.restoreInto(grip.bin, reservation);
            const resource = [...card.parts.keys()][0];
            if (resource === undefined) return taken(`to ${slotText(scene, card.lane, card.at)}`, into);
            const of = grip.kind === "event" ? scene.without(reservation) : scene.restoring(grip.bin, reservation);
            // The Table names the reserved row's slot, as its row reads (A33).
            const verb = target.table === true ? `to ${slotText(scene, card.lane, card.at)} on ` : "into the reservation on ";
            return onResource(scene, askOf(scene, grip, of), code, resource, "Not booked", verb, into, [], "", asking);
        }
        const at = landing(scene.slots, scene.plan, target.lane, target.at, undefined);
        return taken(`to ${slotText(scene, target.lane, at)}`, () => book(target.lane, at, undefined));
    }
    const land = scene.firstFree();
    const resource = target.resource;
    return onResource(scene, askOf(scene, grip), code, resource, "Not booked", "to ", () => {
        if (land !== undefined) return book(land.lane, land.at, resource);
        scene.notice({ word: "Not booked", text: `No free bin is left on ${formatDatePattern("ddd D", scene.day)} for ${code}.` });
        return false;
    }, ranks, land === undefined ? "" : ` · ${slotText(scene, land.lane, land.at)}`, asking);
}

/**
 * A Library resource's verdict (§10, A32, A33): a bin it links, a reservation
 * it moves to it, a free lane hour or a free row it reserves — each as the
 * fit's take of it answers; a bin already on it, nothing.
 */
function resourceVerdict(scene: DropScene, resource: string, target: Target, asking: boolean): Verdict {
    const name = nameOf(scene, resource);
    const asked = askOf(scene, { kind: "resource", resource });
    const judged = (pick: (answer: FitResult) => Fit | undefined, word: string, text: (reason: string) => string, caption: string, run: () => boolean) =>
        answered(scene, asked, word, asking, answer => {
            const verdict = pick(answer);
            if (verdict === undefined) return refused("no verdict from the fit", { word, text: `The fit gave no verdict for ${name}.` });
            if (verdict.type === "refused") return refused(verdict.value.reason, { word, text: text(verdict.value.reason) }, verdict.value.reason);
            return { ...taken(caption, run), reason: verdict.value.why };
        });
    const onBin = (id: string): Verdict => {
        const bin = scene.plan.bins.get(id);
        if (bin === undefined) return refused("not on the board", { word: "Not allocated", text: "The bin is no longer on the board." });
        if (bin.parts.has(resource)) return taken("already on it", () => false);
        const reserved = bin.event.type === "none";
        const code = codeOfBin(scene, id);
        return judged(answer => answer.bins.get(id), "Not allocated", reason => `${reserved ? "The reservation" : code} can’t go onto ${name}: ${reason}.`,
            reserved ? "move the reservation here" : `link ${code}`, () => scene.commands.link(id, resource, undefined));
    };
    const onSlot = (lane: string, at: Date): Verdict => judged(answer => answer.reserve.type === "some" ? answer.reserve.value : undefined, "Not reserved",
        reason => `${name} can’t take ${slotText(scene, lane, at)}: ${reason}.`, `reserve ${slotText(scene, lane, at)}`, () => scene.commands.reserve(lane, at, resource));
    if (target.kind === "resource") return nowhere;
    if (target.kind === "cell") {
        const row = rowOfKey(target.row);
        if (row === undefined) return nowhere;
        return "bin" in row ? onBin(row.bin) : onSlot(row.lane, row.at);
    }
    // A Table row's event cell takes no resource (A32).
    if (target.table === true) return nowhere;
    if (target.card !== undefined) return onBin(target.card);
    return onSlot(target.lane, landing(scene.slots, scene.plan, target.lane, target.at, undefined));
}

/**
 * A drop's verdict (see the module docs, §10).
 *
 * @param scene - What the board knows
 * @param grip - What is dragged
 * @param target - Where it rests
 * @param ranks - The three best fits, best first
 * @param asking - Whether an unanswered question is asked: never while the board renders
 * @returns The verdict
 */
export function verdictOf(scene: DropScene, grip: Grip, target: Target, ranks: readonly string[], asking = true): Verdict {
    if (grip.kind === "resource") return resourceVerdict(scene, grip.resource, target, asking);
    const code = codeOf(scene, grip);
    const { lane, event, resource: noun } = scene.nouns;
    // A Table row's resource cell takes a resource's drag only (A33).
    if (target.kind === "cell") return refused(`drop on the ${one(event)} cell`, { word: "Not booked", text: `Drop ${code} on a row’s ${one(event)} cell to book it.` });
    if (grip.kind === "event" || grip.kind === "removed") return bookVerdict(scene, grip, target, ranks, asking);
    if (grip.kind === "body") {
        if (target.kind === "resource") {
            return refused(`${one(lane)} hours only · drag its connector to change the ${one(noun)}`,
                { word: "Not moved", text: `${code} moves between ${one(lane)} hours only. To change its ${one(noun)}, drag its connector.` });
        }
        const card = target.card === undefined ? undefined : scene.plan.bins.get(target.card);
        // A reservation: the bin fills it, if the fit takes the bin on the reservation's resource (A38).
        if (card !== undefined && target.card !== grip.bin && card.event.type === "none") {
            const resource = [...card.parts.keys()][0];
            const reservation = target.card!;
            if (resource === undefined) return taken(`to ${slotText(scene, card.lane, card.at)}`, () => scene.commands.fill(grip.bin, reservation));
            // The Table names the reserved row's slot, as its row reads (A33).
            const verb = target.table === true ? `to ${slotText(scene, card.lane, card.at)} on ` : "into the reservation on ";
            const of = scene.without(reservation);
            return onResource(scene, askOf(scene, grip, of), code, resource, "Not moved", verb, () => scene.commands.fill(grip.bin, reservation), [], "", asking);
        }
        const bin = scene.plan.bins.get(grip.bin);
        const at = landing(scene.slots, scene.plan, target.lane, target.at, grip.bin);
        const home = bin !== undefined && bin.lane === target.lane && (scene.slots.find(s => s.lane === target.lane && compareDate(s.at, target.at) === 0)?.bins.includes(grip.bin) ?? false);
        // Its own lane hour: nothing (A37).
        return taken(`to ${slotText(scene, target.lane, home && bin !== undefined ? bin.at : at)}`, home ? () => false : () => scene.commands.move(grip.bin, target.lane, at));
    }
    if (target.kind === "lane") {
        return refused(`drop on ${a(noun)}`, { word: "Not allocated", text: `To allocate ${code}, drop its link on ${a(noun)} row.` });
    }
    // A connector's or a link's drop on a resource links what it carries there; its current resource, nothing (A39).
    const current = currentOf(scene.plan, grip);
    if (grip.kind === "link" && current === target.resource) return taken("already on it", () => false);
    return onResource(scene, askOf(scene, grip), code, target.resource, "Not allocated", "to ",
        () => scene.commands.link(grip.bin, target.resource, grip.kind === "link" ? grip.resource : undefined), ranks, "", asking);
}

/** The target a cell's coordinate names. */
export function targetOfCoord(coord: CellCoord): Target | undefined {
    return targetOf({ row: coord.row, slot: coord.slot, event: coord.event === undefined ? none : some(coord.event) });
}

/** The board's drags, as its parts read them. */
export interface AllocationDrag {
    /** The board's one drag surface. */
    surface: string;
    /** The Library's lists: the sources of its drags. */
    libraries: AllocationLibraries;
    /** Whether the day takes drags: an editable day, and not the narrow layout. */
    enabled: boolean;
    /** What is being dragged, while a drag is under way. */
    grip: Grip | undefined;
    /** What the board shows the fit's verdicts for: the drag's grip, or, with none under way, the pick (A11). */
    subject: Grip | undefined;
    /** The subject's question of the fit: what the previews place, of which day (A28). */
    asked: Asked | undefined;
    /** The grip under a pointer-down: the fit is asked about it before the drag needs it (A23). */
    arm: (grip: Grip) => void;
    /** The fit's answer about the subject (A27–A29, A32). */
    answer: FitResult | undefined;
    /** Its three best fits, best first (A28). */
    ranks: readonly string[];
    /** A drop's verdict where a drag rests, kept for this drag, these drafts and this answer (A35); it asks the fit what it has not answered. */
    verdict: (grip: Grip, target: Target) => Verdict;
    /** The same verdict, asking nothing: what the board draws while it renders. */
    peek: (grip: Grip, target: Target) => Verdict;
    /** The grip a dragged payload carries, if it is the board's or a card of its Library's. */
    gripOfPayload: (payload: DragPayload) => Grip | undefined;
    /** The grip and the target a completed drag names. */
    gripOfEvent: (event: DragEventValue) => Grip | undefined;
}

/**
 * The board's drags (see the module docs): its one drag target, what is
 * dragged, and each drop's verdict.
 *
 * @param surface - The board's drag surface
 * @param enabled - Whether the day takes drags
 * @param scene - What the board knows
 * @param onRefuse - A refused drop's reason (A40), or `undefined` once a drop is taken
 * @param pick - The picked Library card, if any (A11): its fits show as a drag's do
 * @returns The drags
 */
export function useAllocationDrag(surface: string, enabled: boolean, scene: DropScene, onRefuse: (refusal: Refusal | undefined) => void, pick?: Grip): AllocationDrag {
    const layer = useDragLayerOptional();
    const libraries = useMemo(() => libraryIds(surface), [surface]);
    const [armed, setArmed] = useState<Grip>();
    const grip = layer?.active === true ? armed : undefined;
    const subject = grip ?? (layer?.active === true ? undefined : pick);
    // The questions the armed grip and the pick ask: asked as each is set, and again when the drafts change (A23, F1).
    const { fit } = scene;
    const armedAsk = armed === undefined || armed.kind === "body" ? undefined : askOf(scene, armed);
    const pickAsk = pick === undefined ? undefined : askOf(scene, pick);
    const armedKey = armed === undefined ? "" : gripKey(armed), pickKey = pick === undefined ? "" : gripKey(pick);
    useEffect(() => { if (armedAsk !== undefined) fit.ask(armedAsk.ask, armedAsk.of); },
        // The question stands for the armed grip and the drafts it reads.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [armedKey, scene.plan, fit.ask]);
    useEffect(() => { if (pickAsk !== undefined) fit.ask(pickAsk.ask, pickAsk.of); },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [pickKey, scene.plan, fit.ask]);
    const asked = subject === undefined || subject.kind === "body" ? undefined : askOf(scene, subject);
    const answer = asked === undefined ? undefined : fit.answer(asked.ask, asked.of);
    const ranks = useMemo(() => subject === undefined ? [] : rankOf(answer, currentOf(scene.plan, subject)), [answer, subject, scene.plan]);
    // Verdicts, kept for these drafts and this answer: pointer motion asks again, and nothing is recomputed (A35).
    // What the verdicts read is the cache's key: a new key, a new cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const kept = useMemo(() => new Map<string, Verdict>(), [scene.plan, scene.slots, answer, ranks, fit.error]);
    const judge = (asking: boolean) => (g: Grip, target: Target): Verdict => {
        const where = target.kind === "resource" ? `r:${target.resource}` : target.kind === "cell" ? `c:${target.row}`
            : `l:${target.lane}|${target.at.getTime()}|${target.card ?? ""}|${target.table === true ? "t" : ""}`;
        const key = `${gripKey(g)}|${where}`;
        const known = kept.get(key);
        if (known !== undefined && !known.pending) return known;
        const next = verdictOf(scene, g, target, ranks, asking);
        kept.set(key, next);
        return next;
    };
    const gripOfPayload = useMemo(() => (payload: DragPayload): Grip | undefined => {
        if (payload.kind === "item") return libraryGripOf(libraries, payload.from);
        if (payload.kind !== "event") return undefined;
        return gripOf({ row: payload.from.row, slot: payload.from.slot, event: some(payload.from.event) });
    }, [libraries]);
    const gripOfEvent = useMemo(() => (event: DragEventValue): Grip | undefined => event.type === "move" ? gripOf(event.value.from)
        : event.type === "add" ? libraryGripOf(libraries, event.value.from) : undefined, [libraries]);
    // A drop that came before its answer waits for it, then runs or refuses (F2).
    const deferred = useRef<{ grip: Grip; target: Target } | undefined>(undefined);
    useEffect(() => {
        const waiting = deferred.current;
        if (waiting === undefined) return;
        const settled = verdictOf(scene, waiting.grip, waiting.target, ranks);
        if (settled.pending) return;
        deferred.current = undefined;
        if (!settled.allowed) onRefuse(settled.refusal);
        else { onRefuse(undefined); settled.run?.(); }
    });
    // The drop, checked again through the command (A35).
    const live = useRef({ scene, ranks, onRefuse });
    live.current = { scene, ranks, onRefuse };
    const config = useMemo((): DragTargetConfig => {
        const targetOfEvent = (event: DragEventValue) => event.type === "move" ? targetOf(event.value.to) : event.type === "add" ? targetOf(event.value.into) : undefined;
        return {
            id: surface, sources: [libraries.events, libraries.resources], kinds: { add: true, move: true, remove: false, resize: false, trash: false },
            onDrag: (event: DragEventValue) => {
                const g = gripOfEvent(event), target = targetOfEvent(event);
                if (g === undefined || target === undefined) return false;
                const now = live.current;
                const drop = verdictOf(now.scene, g, target, now.ranks);
                if (drop.pending) { deferred.current = { grip: g, target }; return true; }
                if (!drop.allowed) { now.onRefuse(drop.refusal); return false; }
                now.onRefuse(undefined);
                return drop.run?.() ?? false;
            },
            // A drop a target's veto refused never reaches `onDrag`: its reason is the inspector's note all the same (A40).
            onRefuse: (event: DragEventValue) => {
                const g = gripOfEvent(event), target = targetOfEvent(event);
                if (g === undefined || target === undefined) return;
                const now = live.current;
                const drop = verdictOf(now.scene, g, target, now.ranks);
                if (!drop.allowed && !drop.pending && drop.refusal !== undefined) now.onRefuse(drop.refusal);
            },
        };
    }, [surface, libraries, gripOfEvent]);
    useDragTarget(enabled ? config : null);
    return { surface, libraries, enabled, grip, subject, asked, arm: setArmed, answer, ranks, verdict: judge(true), peek: judge(false), gripOfPayload, gripOfEvent };
}
