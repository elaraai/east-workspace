/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The board's drags on the shared drag grammar (`Allocation Spec.md` §9.4,
 * §9.5, §10; A22–A40): what is dragged — a bin's body, its connector or one of
 * its links — and onto what — a lane hour, a card, a resource row, the fits
 * marker — each as a `CellCoord` of the board's one surface, and the one
 * verdict a drop gets: its caption, its refusal, and the command it runs. A
 * drag onto a resource takes the app's fit's verdict; while that answer is
 * on its way the caption says so, and the drop waits for it (F2). Library
 * drags join with the Library.
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

/** What a drag carries: a bin's body (A24), its connector, or one of its links. */
export type Grip = { kind: "body"; bin: string } | { kind: "port"; bin: string } | { kind: "link"; bin: string; resource: string };

/**
 * Where a drag rests: a lane hour (a card in it names the card; a Table row's
 * event cell is its slot's, `table`), a resource's row, or a Table row's
 * resource cell.
 */
export type Target =
    | { kind: "lane"; lane: string; at: Date; card: string | undefined; table?: boolean }
    | { kind: "resource"; resource: string }
    | { kind: "cell"; row: string };

/** A grip as the drag grammar's coordinate. */
export function gripCoord(surface: string, grip: Grip): Required<CellCoord> {
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

/** The grip a drag grammar's reference names. */
export function gripOf(ref: { row: string; slot: string; event: option<string> }): Grip | undefined {
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
    /** The fit's answer is still on its way. */
    pending: boolean;
    /** The drop's command. */
    run: (() => boolean) | undefined;
}

/** The question a grip asks of the fit (A23, A73): a link's part, a connector's remainder, a body's whole bin. */
export function placeAsk(plan: Day, grip: Grip): { ask: FitAsk; quantity: number } | undefined {
    const bin = plan.bins.get(grip.bin);
    if (bin === undefined) return undefined;
    const quantity = grip.kind === "body" ? bin.quantity : linkedQuantity(bin, grip.kind === "link" ? grip.resource : undefined)?.quantity;
    if (quantity === undefined) return undefined;
    return { ask: variant("place", { subject: variant("bin", grip.bin), quantity }), quantity };
}

/** The resource a grip's link leaves: a link's own, or a connector's largest part (A28: its current resource is never ranked). */
export function currentOf(plan: Day, grip: Grip): string | undefined {
    if (grip.kind === "link") return grip.resource;
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
    plan: Day;
    context: Context;
    slots: readonly Slot[];
    fit: AllocationFit;
    commands: AllocationCommands;
    /** The day without a reservation: what a fill asks the fit of, as the mock asks it. */
    without: (reservation: string) => Day;
    /** A lane's label. */
    laneLabel: (lane: string) => string;
    /** The board's nouns, as its captions and refusals write them. */
    nouns: Nouns;
}

/** A bin's event's code. */
function codeOf(scene: DropScene, bin: string): string {
    const event = scene.plan.bins.get(bin)?.event;
    return event?.type === "some" ? scene.context.events.get(event.value)?.label ?? event.value : "The reservation";
}

/** A resource's name. */
const nameOf = (scene: DropScene, resource: string) => scene.context.resources.get(resource)?.label ?? resource;

/** Where a bin lands in a lane slot (A37): the slot's time, or a minute after the last bin already in it. */
export function landing(slots: readonly Slot[], plan: Day, lane: string, at: Date, bin: string | undefined): Date {
    const slot = slots.find(s => s.lane === lane && compareDate(s.at, at) === 0);
    const others = (slot?.bins ?? []).filter(id => id !== bin).map(id => plan.bins.get(id)?.at).filter((when): when is Date => when !== undefined);
    if (others.length === 0) return at;
    const last = others.reduce((a, b) => compareDate(a, b) >= 0 ? a : b);
    return new Date(last.getTime() + 60_000);
}

const refused = (caption: string, refusal: Refusal): Verdict => ({ allowed: false, caption, warn: false, refusal, pending: false, run: undefined });
const waiting: Verdict = { allowed: true, caption: "checking fits…", warn: false, refusal: undefined, pending: true, run: undefined };

/** A fit's verdict for a placement on a resource, its caption and its refusal. */
function onResource(scene: DropScene, grip: Grip, resource: string, of: Day | undefined, word: string, verb: string, run: () => boolean, ranks: readonly string[]): Verdict {
    const asked = placeAsk(of ?? scene.plan, grip);
    if (asked === undefined) return refused("not on the board", { word, text: "The bin is no longer on the board." });
    if (scene.fit.error !== undefined) return refused("fits unavailable", { word, text: `Fits couldn't be checked: ${scene.fit.error}.` });
    const answer = scene.fit.answer(asked.ask, of);
    // Unanswered, it is asked: the fill's question is the reservation's own (A23).
    if (answer === undefined) { scene.fit.ask(asked.ask, of); return waiting; }
    const verdict: Fit | undefined = answer.resources.get(resource);
    // A fit that gives a resource no verdict refuses it: the board decides none of its own (F4).
    if (verdict === undefined) return refused("no verdict from the fit", { word, text: `The fit gave no verdict for ${nameOf(scene, resource)}.` });
    const name = nameOf(scene, resource);
    if (verdict.type === "refused") return refused(verdict.value.reason, { word, text: `${codeOf(scene, grip.bin)} can’t go into ${name}: ${verdict.value.reason}.` });
    const rank = ranks.indexOf(resource);
    const warn = verdict.value.warn.type === "some" ? verdict.value.warn.value : undefined;
    return { allowed: true, caption: `${verb}${name}${rank >= 0 ? ` · #${rank + 1}` : ""}${warn === undefined ? "" : ` · ${warn}`}`, warn: warn !== undefined,
        refusal: undefined, pending: false, run };
}

/**
 * A drop's verdict (see the module docs, §10).
 *
 * @param scene - What the board knows
 * @param grip - What is dragged
 * @param target - Where it rests
 * @param ranks - The three best fits, best first
 * @returns The verdict
 */
export function verdictOf(scene: DropScene, grip: Grip, target: Target, ranks: readonly string[]): Verdict {
    const code = codeOf(scene, grip.bin);
    const { lane, event, resource: noun } = scene.nouns;
    // A Table row's resource cell takes a resource's drag only (A33).
    if (target.kind === "cell") return refused(`drop on the ${one(event)} cell`, { word: "Not booked", text: `Drop ${code} on a row’s ${one(event)} cell to book it.` });
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
            if (resource === undefined) return { allowed: true, caption: `to ${scene.laneLabel(card.lane)} ${formatDatePattern("HH:mm", card.at)}`, warn: false, refusal: undefined, pending: false, run: () => scene.commands.fill(grip.bin, reservation) };
            // The Table names the reserved row's slot, as its row reads (A33).
            const verb = target.table === true ? `to ${scene.laneLabel(card.lane)} ${formatDatePattern("HH:mm", card.at)} on ` : "into the reservation on ";
            return onResource(scene, grip, resource, scene.without(reservation), "Not moved", verb, () => scene.commands.fill(grip.bin, reservation), []);
        }
        const bin = scene.plan.bins.get(grip.bin);
        const at = landing(scene.slots, scene.plan, target.lane, target.at, grip.bin);
        const home = bin !== undefined && bin.lane === target.lane && (scene.slots.find(s => s.lane === target.lane && compareDate(s.at, target.at) === 0)?.bins.includes(grip.bin) ?? false);
        // Its own lane hour: nothing (A37).
        return { allowed: true, caption: `to ${scene.laneLabel(target.lane)} ${formatDatePattern("HH:mm", home && bin !== undefined ? bin.at : at)}`, warn: false, refusal: undefined, pending: false,
            run: home ? () => false : () => scene.commands.move(grip.bin, target.lane, at) };
    }
    if (target.kind === "lane") {
        return refused(`drop on ${a(noun)}`, { word: "Not allocated", text: `To allocate ${code}, drop its link on ${a(noun)} row.` });
    }
    // A connector's or a link's drop on a resource links what it carries there; its current resource, nothing (A39).
    const current = currentOf(scene.plan, grip);
    if (grip.kind === "link" && current === target.resource) {
        return { allowed: true, caption: "already on it", warn: false, refusal: undefined, pending: false, run: () => false };
    }
    return onResource(scene, grip, target.resource, undefined, "Not allocated", "to ",
        () => scene.commands.link(grip.bin, target.resource, grip.kind === "link" ? grip.resource : undefined), ranks);
}

/** The grip a drag's payload carries, if it is one of the board's. */
export function gripOfPayload(payload: DragPayload): Grip | undefined {
    if (payload.kind !== "event") return undefined;
    return gripOf({ row: payload.from.row, slot: payload.from.slot, event: some(payload.from.event) });
}

/** The target a cell's coordinate names. */
export function targetOfCoord(coord: CellCoord): Target | undefined {
    return targetOf({ row: coord.row, slot: coord.slot, event: coord.event === undefined ? none : some(coord.event) });
}

/** The board's drags, as its parts read them. */
export interface AllocationDrag {
    /** The board's one drag surface. */
    surface: string;
    /** Whether the day takes drags: an editable day, and not the narrow layout. */
    enabled: boolean;
    /** What is being dragged, while a drag is under way. */
    grip: Grip | undefined;
    /** The grip under a pointer-down: the fit is asked about it before the drag needs it (A23). */
    arm: (grip: Grip) => void;
    /** The fit's answer about the dragged connector's or link's quantity (A27–A29). */
    answer: FitResult | undefined;
    /** Its three best fits, best first (A28). */
    ranks: readonly string[];
    /** A drop's verdict where a drag rests, kept for this drag, these drafts and this answer (A35). */
    verdict: (grip: Grip, target: Target) => Verdict;
}

/**
 * The board's drags (see the module docs): its one drag target, what is
 * dragged, and each drop's verdict.
 *
 * @param surface - The board's drag surface
 * @param enabled - Whether the day takes drags
 * @param scene - What the board knows
 * @param onRefuse - A refused drop's reason (A40), or `undefined` once a drop is taken
 * @returns The drags
 */
export function useAllocationDrag(surface: string, enabled: boolean, scene: DropScene, onRefuse: (refusal: Refusal | undefined) => void): AllocationDrag {
    const layer = useDragLayerOptional();
    const [armed, setArmed] = useState<Grip>();
    const grip = layer?.active === true ? armed : undefined;
    // The question the armed connector or link asks: its quantity, onto every resource — asked as it is armed,
    // and again when the drafts change (A23, F1).
    const asked = armed === undefined || armed.kind === "body" ? undefined : placeAsk(scene.plan, armed);
    const { fit } = scene;
    const armedKey = armed === undefined ? "" : `${armed.kind}|${armed.bin}|${armed.kind === "link" ? armed.resource : ""}`;
    useEffect(() => { if (asked !== undefined) fit.ask(asked.ask); },
        // The question stands for the armed grip and the drafts it reads.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [armedKey, scene.plan, fit.ask]);
    const answer = asked === undefined ? undefined : fit.answer(asked.ask);
    const ranks = useMemo(() => armed === undefined ? [] : rankOf(answer, currentOf(scene.plan, armed)), [answer, armed, scene.plan]);
    // Verdicts, kept for this drag, these drafts and this answer: pointer motion asks again, and nothing is recomputed (A35).
    // What the verdicts read is the cache's key: a new key, a new cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const kept = useMemo(() => new Map<string, Verdict>(), [scene.plan, scene.slots, answer, ranks, fit.error]);
    const verdict = (g: Grip, target: Target): Verdict => {
        const where = target.kind === "resource" ? `r:${target.resource}` : target.kind === "cell" ? `c:${target.row}`
            : `l:${target.lane}|${target.at.getTime()}|${target.card ?? ""}|${target.table === true ? "t" : ""}`;
        const key = `${g.kind}|${g.bin}|${g.kind === "link" ? g.resource : ""}|${where}`;
        const known = kept.get(key);
        if (known !== undefined && !known.pending) return known;
        const next = verdictOf(scene, g, target, ranks);
        kept.set(key, next);
        return next;
    };
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
    const config = useMemo((): DragTargetConfig => ({
        id: surface, sources: [], kinds: { add: false, move: true, remove: false, resize: false, trash: false },
        onDrag: (event: DragEventValue) => {
            if (event.type !== "move") return false;
            const g = gripOf(event.value.from), target = targetOf(event.value.to);
            if (g === undefined || target === undefined) return false;
            const now = live.current;
            const drop = verdictOf(now.scene, g, target, now.ranks);
            if (drop.pending) { deferred.current = { grip: g, target }; return true; }
            if (!drop.allowed) { now.onRefuse(drop.refusal); return false; }
            now.onRefuse(undefined);
            return drop.run?.() ?? false;
        },
    }), [surface]);
    useDragTarget(enabled ? config : null);
    return { surface, enabled, grip, arm: setArmed, answer, ranks, verdict };
}

