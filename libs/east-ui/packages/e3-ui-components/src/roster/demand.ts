/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The People layout's work requirement (#1568): each shift's hours rostered against those needed — a day's, a week's
 * and a skill's — summed from the coverage the Shifts layout works out for each slot, so the two layouts never
 * disagree (K1), over the span in view: a week, or a month's weeks. A group's band sums its own slots; where the layout
 * draws no bands (#1567), one block sums every group's. Rostered is every duty's hours — the permanent staff's, agency
 * staff's and the agencies' requests' — as the Shifts layout counts them (ruled 8 Nov 2026).
 *
 * @packageDocumentation
 */
import { none, some } from "@elaraai/east";
import type { Coverage, RosterValue, Shift, Slot, Week } from "./model.js";

/** A week of the span, as the work requirement reads it: its targets, and each slot's coverage over it. */
export interface DemandWeek {
    /** The week's targets, by slot. */
    readonly requirements: Week["requirements"];
    /** Each slot's coverage over the week. */
    readonly coverage: ReadonlyMap<Slot, Coverage>;
}

/** Hours over a set of slots: those needed against those rostered, and what the slots are short, each its own. */
export interface DemandFigures {
    /** Whether a slot of the set has a target: where none has, its cell says so and draws no bar (A3.6). */
    readonly target: boolean;
    /** The hours the slots' targets need. */
    readonly needed: number;
    /** Every duty's hours on the slots: the permanent staff's, agency staff's and the agencies' requests'. */
    readonly rostered: number;
    /** The permanent staff's part of them. */
    readonly permanent: number;
    /** Agency staff's part of them. */
    readonly agency: number;
    /** The agencies' requests' part of them. */
    readonly requested: number;
    /** The hours short, each slot's own summed: no slot's surplus nets another's shortfall (K4). */
    readonly short: number;
    /** How many of the slots are short. */
    readonly shortSlots: number;
}

/** A skill's hours over a set of slots: those its duties are assigned against those the slots' targets need. */
export interface SkillFigures {
    /** The hours the targets need of the skill. */
    readonly needed: number;
    /** The hours of duties assigned the skill. */
    readonly assigned: number;
}

/** A skill row under an open lane (A4): the skill's hours each day and over the span. */
export interface DemandSkill {
    /** The skill's key. */
    readonly skill: string;
    /** Each day's, the span's first day first, seven a week: `undefined` where none of the day's slots needs the skill. */
    readonly days: readonly (SkillFigures | undefined)[];
    /** The span's. */
    readonly total: SkillFigures;
}

/** A lane (A3): a shift a target of the scope names in the span, its slots each day and over the span. */
export interface DemandLane {
    /** The shift. */
    readonly shift: Shift;
    /** Each day's, the span's first day first, seven a week: the shift's slots of the scope's groups that day. */
    readonly days: readonly DemandFigures[];
    /** The span's. */
    readonly total: DemandFigures;
    /** Its skill rows: one a skill its slots' targets need hours of, in the activities' order (A4.1). */
    readonly skills: readonly DemandSkill[];
}

/** A scope's work requirement over the span: a group's, or every group's where the layout draws no bands. */
export interface Demand {
    /** Its lanes: one a shift a target of the scope names in the span, in the shifts' order (A3.1); none without a target. */
    readonly lanes: readonly DemandLane[];
    /** Each day's over every slot of the scope, the span's first day first (A2.2): a week's eyebrow's figures. */
    readonly days: readonly DemandFigures[];
    /** Each week's over every slot of the scope (A2.2): a month's eyebrow's figures. */
    readonly weeks: readonly DemandFigures[];
    /** The span's over every slot of the scope: the band's figures (A1.2). */
    readonly total: DemandFigures;
}

/**
 * A day's mark in a month's lane or skill row (A3.5, A4.4): its state — off where it has no target (a skill's, where
 * none of the day's slots needs it), short where it is, requested where requests make up part of its hours, else
 * covered — and the difference its figure says.
 */
export interface DemandMark {
    readonly state: "off" | "short" | "requested" | "covered";
    /** Rostered — a skill's assigned — less needed. */
    readonly difference: number;
}

/** The hours under which a difference is none: a sum of fractional hours lands a hair either side of zero. */
const EPSILON = 1e-6;
/** The days of a week. */
const WEEK_DAYS = 7;

/**
 * Rostered less needed, a hair either side of zero none at all.
 *
 * @param rostered - The hours rostered
 * @param needed - The hours needed
 * @returns The difference: below zero where short, above where over, zero where exact
 */
export function difference(rostered: number, needed: number): number {
    const d = rostered - needed;
    return Math.abs(d) < EPSILON ? 0 : d;
}

/**
 * How a difference is toned (K3): the warning where short, muted where over, positive where exact.
 *
 * @param d - The difference, as {@link difference} gives it
 * @returns Its tone
 */
export function toneOf(d: number): "short" | "over" | "exact" {
    return d < 0 ? "short" : d > 0 ? "over" : "exact";
}

/**
 * A difference as its figure reads (A3.3): `+4`, `−6` with a true minus, and nothing at zero — or `zero` where a figure
 * always shows, as the band's `+0`.
 *
 * @param number - The locale's number formatter
 * @param d - The difference
 * @param zero - What zero reads; nothing by default
 * @returns The figure
 */
export function signed(number: (n: number) => string, d: number, zero = ""): string {
    const at = Math.abs(d) < EPSILON ? 0 : d;
    return at === 0 ? zero : `${at > 0 ? "+" : "−"}${number(Math.abs(at))}`;
}

/**
 * A lane's day as a month's mark draws it (A3.5): off with no target; short by its difference; requested where the
 * agencies' requests make up part of its hours, which count as rostered, as the week's bar draws them dashed; else
 * covered, over by its difference or exact.
 *
 * @param f - The lane's day
 * @returns Its mark
 */
export function laneMark(f: DemandFigures): DemandMark {
    const d = difference(f.rostered, f.needed);
    return { state: !f.target ? "off" : d < 0 ? "short" : f.requested > EPSILON ? "requested" : "covered", difference: d };
}

/**
 * A skill row's day as a month's mark draws it (A4.4): off where none of the day's slots needs the skill; short by its
 * difference; else covered.
 *
 * @param f - The skill's day, `undefined` where none of its slots needs it
 * @returns Its mark
 */
export function skillMark(f: SkillFigures | undefined): DemandMark {
    if (f === undefined) return { state: "off", difference: 0 };
    const d = difference(f.assigned, f.needed);
    return { state: d < 0 ? "short" : "covered", difference: d };
}

/** A slot as the figures read it: its coverage, and whether it has a target. */
interface Entry {
    readonly coverage: Coverage;
    readonly target: boolean;
}

/** The figures of a set of slots, summed: their hours, and what each is short (K4). */
function sumOf(slots: readonly Entry[]): DemandFigures {
    let target = false, needed = 0, rostered = 0, permanent = 0, agency = 0, requested = 0, short = 0, shortSlots = 0;
    for (const slot of slots) {
        const hours = slot.coverage.hours;
        target ||= slot.target;
        needed += hours.needed; rostered += hours.rostered;
        permanent += hours.permanent; agency += hours.agency; requested += hours.requested;
        const d = difference(hours.rostered, hours.needed);
        if (d < 0) { short -= d; shortSlots += 1; }
    }
    return { target, needed, rostered, permanent, agency, requested, short, shortSlots };
}

/** A lane's skill rows: each skill its slots' lines need, summed each day, in the activities' order as the lines are. */
function skillsOf(value: Pick<RosterValue, "activities">, days: readonly (readonly Entry[])[]): DemandSkill[] {
    const by = new Map<string, (SkillFigures | undefined)[]>();
    days.forEach((entries, day) => {
        for (const { coverage } of entries) for (const line of coverage.lines) {
            let row = by.get(line.skill);
            if (row === undefined) { row = Array.from({ length: days.length }, () => undefined); by.set(line.skill, row); }
            const at = row[day];
            row[day] = { needed: (at?.needed ?? 0) + line.needed, assigned: (at?.assigned ?? 0) + line.assigned };
        }
    });
    return value.activities.flatMap(activity => {
        const row = by.get(activity.key);
        if (row === undefined) return [];
        const total = row.reduce<SkillFigures>((sum, day) => day === undefined ? sum : { needed: sum.needed + day.needed, assigned: sum.assigned + day.assigned }, { needed: 0, assigned: 0 });
        return [{ skill: activity.key, days: row, total }];
    });
}

/**
 * A scope's work requirement over the span (#1568): a lane a shift a target of the scope names in any of the span's
 * weeks, its days' and its span's hours summed over the scope's groups' slots — each slot's as the Shifts layout draws
 * it — and its skill rows; and the scope's days', weeks' and span's over every one of its slots, a shift with no
 * target's included, as the Shifts layout's band sums them.
 *
 * @param value - The payload: its shifts and activities, in their orders
 * @param weeks - The span's weeks, its first first: each one's targets and coverage
 * @param groups - The scope's groups: a band's own, or every group where the layout draws no bands
 * @returns The scope's lanes and figures
 */
export function demandOf(value: Pick<RosterValue, "shifts" | "activities">, weeks: readonly DemandWeek[], groups: readonly string[]): Demand {
    const days = weeks.length * WEEK_DAYS;
    const scopeDays: Entry[][] = Array.from({ length: days }, () => []);
    const lanes: DemandLane[] = [];
    for (const shift of value.shifts) {
        const laneDays: Entry[][] = Array.from({ length: days }, () => []);
        let targeted = false;
        weeks.forEach(({ requirements, coverage }, w) => {
            for (let day = 0; day < WEEK_DAYS; day++) for (const group of groups) {
                const slot = { day: BigInt(day), group, shift: shift.key };
                const slotCoverage = coverage.get(slot);
                if (slotCoverage === undefined) continue;
                const entry = { coverage: slotCoverage, target: requirements.has(slot) };
                targeted ||= entry.target;
                laneDays[w * WEEK_DAYS + day]!.push(entry);
                scopeDays[w * WEEK_DAYS + day]!.push(entry);
            }
        });
        if (targeted) lanes.push({ shift, days: laneDays.map(sumOf), total: sumOf(laneDays.flat()), skills: skillsOf(value, laneDays) });
    }
    return {
        lanes, days: scopeDays.map(sumOf),
        weeks: weeks.map((_, w) => sumOf(scopeDays.slice(w * WEEK_DAYS, (w + 1) * WEEK_DAYS).flat())),
        total: sumOf(scopeDays.flat()),
    };
}

/**
 * Coverage summed over slots (#1568): a shift's day across the groups, as the inspector draws it — positions, people,
 * hours and cost added, a lead or a trainer where any slot has one, and each skill's line summed over the slots whose
 * targets need it, in the activities' order, its holders and capacity where any slot counts them.
 *
 * @param value - The payload: its activities, in their order
 * @param list - The slots' coverage
 * @returns Their sum, a coverage the coverage detail draws as it draws a slot's
 */
export function summedCoverage(value: Pick<RosterValue, "activities">, list: readonly Coverage[]): Coverage {
    let positions = 0n, filled = 0n, open = 0n, people = 0n, cost = 0, lead = false, trainer = false;
    let permanent = 0, agency = 0, requested = 0, needed = 0, rostered = 0;
    const lines = new Map<string, { needed: number; assigned: number; gap: number; holders: bigint | undefined; capacity: number | undefined }>();
    for (const c of list) {
        positions += c.positions; filled += c.filled; open += c.open; people += c.people; cost += c.cost;
        lead ||= c.lead; trainer ||= c.trainer;
        permanent += c.hours.permanent; agency += c.hours.agency; requested += c.hours.requested; needed += c.hours.needed; rostered += c.hours.rostered;
        for (const line of c.lines) {
            const at = lines.get(line.skill) ?? { needed: 0, assigned: 0, gap: 0, holders: undefined, capacity: undefined };
            lines.set(line.skill, {
                needed: at.needed + line.needed, assigned: at.assigned + line.assigned, gap: at.gap + line.gap,
                holders: line.holders.type === "some" ? (at.holders ?? 0n) + line.holders.value : at.holders,
                capacity: line.capacity.type === "some" ? (at.capacity ?? 0) + line.capacity.value : at.capacity,
            });
        }
    }
    return {
        positions, filled, open, people, cost, lead, trainer,
        hours: { permanent, agency, requested, needed, rostered },
        lines: value.activities.flatMap(activity => {
            const line = lines.get(activity.key);
            return line === undefined ? [] : [{
                skill: activity.key, needed: line.needed, assigned: line.assigned, gap: line.gap,
                holders: line.holders === undefined ? none : some(line.holders), capacity: line.capacity === undefined ? none : some(line.capacity),
            }];
        }),
    };
}
