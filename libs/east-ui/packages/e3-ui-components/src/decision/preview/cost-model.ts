/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a Roster target's map by cost draws (`Decision Queue Spec.md` P7,
 * P24, P25): the week a change lands in, before it and after it, assembled as
 * the Roster assembles its week, and the app's pay asked of each — a person at
 * a time, by the Roster's own cache — totalled by the app's own pay codes; a
 * row a code, its change a bar from zero on one axis either side, a saving a
 * ghost and an added cost glowing, at most five codes, those the change moves
 * first. The Roster knows no pay code in advance: the rows are the codes the
 * app's pay answers with. Pure: the preview reads the rows, and this works out
 * what they draw.
 *
 * @packageDocumentation
 */

import { FloatType, StringType, compareFor, equalFor } from "@elaraai/east";
import {
    NO_PERIOD, costsOf, placeDrafted, placeStored, weekOf,
    type Context, type DraftedDuty, type RosterDomain, type StoredDuty, type Week, type WeekPay,
} from "../../roster/model.js";
import { niceCeil } from "./record-model.js";
import { NO_TARGETS, overlay } from "./roster-model.js";

/** The most pay codes the map draws (P7). */
export const COST_CODES = 5;

const compareString = compareFor(StringType);
const compareNumber = compareFor(FloatType);
const sameAmount = equalFor(FloatType);

/** One pay code the map draws. */
export interface CostRow {
    /** The app's pay code. */
    readonly code: string;
    /** The week's cost in it before the change, and after. */
    readonly was: number;
    readonly now: number;
    /** The change: after less before. */
    readonly change: number;
    /** Its bar, in percent of the plot: where it starts, and how wide it is — from the middle, its zero. */
    readonly left: number;
    readonly width: number;
}

/** What the map by cost draws. */
export interface CostModel {
    /** The week's first day. */
    readonly start: Date;
    /** Its codes, in the codes' order. */
    readonly rows: readonly CostRow[];
    /** The axis's reach either side of zero. */
    readonly axis: number;
    /** Whether a person's or an agency's pay threw: its duties cost nothing here. */
    readonly failed: boolean;
}

/** What {@link costPreview} works from. */
export interface CostPreviewInput {
    /** The duty row type's domain. */
    readonly domain: RosterDomain;
    /** The Roster's complete configuration. */
    readonly context: Context;
    /** The week's first day. */
    readonly start: Date;
    /** The week's stored duties, as the duty kind's `rows` read them. */
    readonly stored: ReadonlyMap<string, StoredDuty>;
    /** The queue's drafts of the duty record, by key: `undefined` for one removed. */
    readonly drafts: ReadonlyMap<string, DraftedDuty | undefined>;
    /** Each duty the change touches as it stands: `undefined` for one it creates. */
    readonly before: ReadonlyMap<string, DraftedDuty | undefined>;
    /** Each as the change leaves it: `undefined` for one it removes. */
    readonly after: ReadonlyMap<string, DraftedDuty | undefined>;
    /** The app's pay over a week, asked a person at a time: the week before the change, or after it. */
    readonly pay: (week: Week, side: "was" | "now") => WeekPay;
}

/**
 * The codes the map draws from the week's costs by code, before the change and after it: those the change moves
 * first, then the rest, at most {@link COST_CODES}, in the codes' order; the axis the nice reach over the largest
 * change, and each change's bar from the middle — left for a saving, right for an added cost.
 *
 * @param was - The week's cost by code before the change
 * @param now - After it
 * @returns The rows and the axis's reach either side of zero
 */
export function costRows(was: ReadonlyMap<string, number>, now: ReadonlyMap<string, number>): Pick<CostModel, "rows" | "axis"> {
    const codes = [...new Set([...was.keys(), ...now.keys()])].sort(compareString);
    const all = codes.map(code => {
        const w = was.get(code) ?? 0, n = now.get(code) ?? 0;
        return { code, was: w, now: n, change: n - w };
    });
    const moved = all.filter(row => !sameAmount(row.change, 0)), held = all.filter(row => sameAmount(row.change, 0));
    const shown = [...moved, ...held].slice(0, COST_CODES).sort((a, b) => compareString(a.code, b.code));
    const axis = niceCeil(Math.max(0, ...shown.map(row => Math.abs(row.change))));
    return {
        axis,
        rows: shown.map((row): CostRow => {
            const width = (Math.min(Math.abs(row.change), axis) / axis) * 50;
            return { ...row, width, left: compareNumber(row.change, 0) < 0 ? 50 - width : 50 };
        }),
    };
}

/**
 * What a Roster target's map by cost draws (see the module docs).
 *
 * @param input - The week's rows, the queue's drafts, the change's duties and the app's pay
 * @returns The codes, their changes and the axis
 */
export function costPreview(input: CostPreviewInput): CostModel {
    const { domain, context, start, stored, drafts, before, after } = input;
    const base = placeStored(domain, stored, start, context);
    const was = placeDrafted(domain, base, overlay(drafts, before), start, context);
    const now = placeDrafted(domain, base, overlay(drafts, after), start, context);
    const payWas = input.pay(weekOf(was, NO_TARGETS, NO_PERIOD), "was");
    const payNow = input.pay(weekOf(now, NO_TARGETS, NO_PERIOD), "now");
    return {
        start,
        failed: payWas.failed.length > 0 || payNow.failed.length > 0,
        ...costRows(costsOf(payWas.pay, was.assignments.keys()).byCode, costsOf(payNow.pay, now.assignments.keys()).byCode),
    };
}
