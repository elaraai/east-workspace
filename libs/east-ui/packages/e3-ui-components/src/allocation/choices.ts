/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a Table cell's Chooser offers (`Allocation Spec.md` A48), pure: an
 * event cell's events and a resource cell's resources, in sections, each
 * option's line and its state the fit's answer (F4). The board's own words say
 * only what the answer does not: the current choice, an event's meta, and
 * where an event already on the board is.
 *
 * @packageDocumentation
 */

import type { ChooserOption, ChooserSection } from "@elaraai/east-ui-components/internal";
import { formatDatePattern } from "@elaraai/east-ui-components/internal";
import { compareDate, compareFloat, compareString, partsOf, type Context, type Day, type Fit, type FitResult } from "./model.js";

/** The words a Chooser's lines are written with: a quantity with its unit and without, and a lane's name. */
export interface ChoiceWords {
    quantity: (value: number) => string;
    number: (value: number) => string;
    lane: (key: string) => string;
}

/** A pending answer's line: the fit has not said yet (F2). */
const CHECKING = "checking fits…";

/** An option from a verdict: its line the fit's reason, refused when the fit refuses it. */
function judged(base: Omit<ChooserOption, "state" | "line">, verdict: Fit): ChooserOption {
    return verdict.type === "fits" ? { ...base, line: verdict.value.why, state: "enabled" } : { ...base, line: verdict.value.reason, state: "refused" };
}

/**
 * An event cell's Chooser (A48): the row's own event (Current), the events
 * the plan has not booked — fitting the row's resource, or all of them where
 * the row has none — those that don't fit, and the events already on the
 * board, which cannot be chosen.
 *
 * @param args - The row and what the board knows
 * @returns The sections, in order
 */
export function eventChoices(args: {
    plan: Day; context: Context; day: Date; words: ChoiceWords;
    /** The row's bin, when it shows one (a bin or a reservation). */
    bin: string | undefined;
    /** The resource the row's bin is on, if any: what the events are asked onto. */
    resource: string | undefined;
    /** The fit's answer to `take` the resource, asked of the day without the row's bin. */
    answer: FitResult | undefined;
}): ChooserSection[] {
    const { plan, context, day, words, bin, resource, answer } = args;
    const own = bin === undefined ? undefined : plan.bins.get(bin);
    const booked = new Set<string>();
    for (const [, b] of plan.bins) if (b.event.type === "some") booked.add(b.event.value);
    // The events still to book, overdue first, each in the events' key order.
    const overdue = (key: string) => { const due = context.events.get(key)?.due; return due?.type === "some" && compareDate(due.value, day) < 0; };
    const free = [...context.events.keys()].filter(key => !booked.has(key)).sort((a, b) => Number(overdue(b)) - Number(overdue(a)));
    const name = resource === undefined ? undefined : context.resources.get(resource)?.label ?? resource;
    const sections: ChooserSection[] = [];
    if (own !== undefined && own.event.type === "some") {
        const event = context.events.get(own.event.value);
        sections.push({ label: "Current", options: [{ key: own.event.value, label: event?.label ?? own.event.value, state: "current",
            line: event?.meta.type === "some" ? event.meta.value : undefined, range: words.quantity(own.quantity) }] });
    }
    const options = free.map((key): ChooserOption => {
        const event = context.events.get(key)!;
        const base = { key, label: event.label, range: words.quantity(event.quantity), warn: overdue(key) };
        const meta = [event.meta.type === "some" ? event.meta.value : "", overdue(key) ? "overdue" : ""].filter(p => p !== "").join(" · ") || undefined;
        if (resource === undefined) return { ...base, line: meta, state: "enabled" };
        const verdict = answer?.events.get(key);
        return verdict === undefined ? { ...base, line: CHECKING, state: "disabled" } : judged(base, verdict);
    });
    const fits = options.filter(o => o.state !== "refused"), refused = options.filter(o => o.state === "refused");
    if (fits.length > 0) sections.push({ label: name !== undefined ? `Fits ${name}` : own !== undefined && own.event.type === "some" ? "Replace with" : "Book here", options: fits });
    if (refused.length > 0) sections.push({ label: `Doesn’t fit ${name}`, options: refused });
    // The events already on the board, where they are: not to be chosen.
    const where = new Map<string, { id: string; at: Date; lane: string; resource: string | undefined; quantity: number; more: number }>();
    for (const [id, b] of plan.bins) {
        if (b.event.type !== "some" || id === bin) continue;
        const was = where.get(b.event.value);
        if (was === undefined) where.set(b.event.value, { id, at: b.at, lane: b.lane, resource: partsOf(b)[0]?.key, quantity: b.quantity, more: 0 });
        else {
            const first = compareDate(b.at, was.at) < 0;
            where.set(b.event.value, { ...(first ? { id, at: b.at, lane: b.lane, resource: partsOf(b)[0]?.key } : was), quantity: was.quantity + b.quantity, more: was.more + 1 });
        }
    }
    const labelOf = (key: string) => context.events.get(key)?.label ?? key;
    const allocated = [...where].sort(([a], [b]) => compareString(labelOf(a), labelOf(b))).map(([key, w]): ChooserOption => ({
        key: `allocated:${key}`, label: context.events.get(key)?.label ?? key, range: words.quantity(w.quantity), state: "disabled",
        line: `in ${words.lane(w.lane)} ${formatDatePattern("HH:mm", w.at)}${w.resource === undefined ? " · not linked" : ` on ${context.resources.get(w.resource)?.label ?? w.resource}`}${w.more > 0 ? ` · +${w.more} more` : ""}`,
    }));
    if (allocated.length > 0) sections.push({ label: "Allocated", options: allocated });
    return sections;
}

/**
 * A resource cell's Chooser (A48): the row's resource (Current), the
 * resources that fit — `Gaps that fit` a bin, `Can be reserved` for a free row
 * or a reservation — best first, and those that don't.
 *
 * @param args - The row and what the board knows
 * @returns The sections, in order
 */
export function resourceChoices(args: {
    context: Context; words: ChoiceWords;
    /** Whether the row is a bin with an event: its fits are gaps, a free row's or a reservation's reservations. */
    binRow: boolean;
    /** The resource the row's bin is on, if any. */
    current: string | undefined;
    /** The fit's answer to placing the row's bin, or a reservation in its slot. */
    answer: FitResult | undefined;
}): ChooserSection[] {
    const { context, words, binRow, current, answer } = args;
    const range = (key: string) => { const r = context.resources.get(key)!; return `${words.number(r.min)}–${words.quantity(r.max)}`; };
    const sections: ChooserSection[] = [];
    if (current !== undefined && context.resources.has(current)) {
        sections.push({ label: "Current", options: [{ key: current, label: context.resources.get(current)!.label, line: "current", range: range(current), state: "current" }] });
    }
    const others = [...context.resources.keys()].filter(key => key !== current);
    const heading = binRow ? "Gaps that fit" : "Can be reserved";
    if (answer === undefined) {
        sections.push({ label: heading, options: others.map(key => ({ key, label: context.resources.get(key)!.label, line: CHECKING, range: range(key), state: "disabled" })) });
        return sections;
    }
    const fits: { option: ChooserOption; score: number }[] = [];
    const refused: ChooserOption[] = [];
    for (const key of others) {
        const verdict = answer.resources.get(key);
        if (verdict === undefined) continue;
        const option = judged({ key, label: context.resources.get(key)!.label, range: range(key) }, verdict);
        if (verdict.type === "fits") fits.push({ option, score: verdict.value.score }); else refused.push(option);
    }
    fits.sort((a, b) => compareFloat(b.score, a.score));
    if (fits.length > 0) sections.push({ label: heading, options: fits.map(f => f.option) });
    if (refused.length > 0) sections.push({ label: "Doesn’t fit", options: refused });
    return sections;
}
