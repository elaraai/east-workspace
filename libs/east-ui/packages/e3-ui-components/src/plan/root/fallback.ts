/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The period a Plan's columns fall back to by themselves (#1799), and what the
 * frame says of what no period shows.
 *
 * The columns take the period the window's range and the plot's width give
 * (#1740, `shared/time/period.ts`), which say nothing of how much the range
 * holds. Past what a view may draw, the readers show what is in view from a
 * summary instead — the event kinds' cells (`events.ts`, `../../shared/schedule/cells.ts`)
 * and the rows' own collections (`nested.ts`) — and a summary shades a period
 * only where its tile divides the period's columns: a wide plot gives a long
 * range weeks that only months can show. Each reader then names what it shows
 * nothing of, with the tiles a summary shades it by; the canvas takes the
 * finest coarser period those show it at (`../../shared/schedule/fallback-period.ts`),
 * its window hold keeping it while the range moves along (`window.ts`), and
 * says nothing. A frame drawn while it is on its way says nothing either: the
 * next one draws the coarser period.
 *
 * A reader's notices are of the period its read was made at, which the reader
 * hands on beside them (`PlanEventLead.cellsPeriod`, `PlanNestedLead.resolution`):
 * the canvas's render after a fallback still holds what the readers handed it
 * before, and acting on those again would fall back past where the readers'
 * next reads come to rest. So notices of another period than the columns' now
 * are none of what the canvas acts on, nor says.
 *
 * What is left — what no period the axis offers shows: a kind no summary of
 * its source keeps, a collection whose index keeps no totals — the frame says
 * in one plain line ({@link PlanOver}).
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useMemo } from "react";
import type { ScheduleCellNotice } from "../../shared/schedule/cells.js";
import { scheduleFallbackPeriod } from "../../shared/schedule/fallback-period.js";
import type { PlanResolution, PlanScale } from "../scale.js";
import type { PlanEventLead } from "./events.js";
import type { PlanNestedLead, PlanNestedNotice } from "./nested.js";
import type { PlanWindowHold } from "./window.js";

/**
 * What the Plan can show at no period it offers (#1799): the event kinds with more events in view than it draws and
 * the rows' own collections with more items, none of them shaded at any period — their rows hatched, and the frame's
 * one line naming them. The same object while what it names holds.
 */
export interface PlanOver {
    /** The event kinds, as their reader names them. */
    readonly kinds: readonly ScheduleCellNotice[];
    /** The rows' own collections, as their reader names them. */
    readonly items: readonly PlanNestedNotice[];
}

/** Nothing the Plan cannot show: no line. */
export const NOTHING_OVER: PlanOver = { kinds: [], items: [] };

/** A reader's notices, and the period they were made at. */
export interface PlanNotices<T> {
    /** What it shows nothing of. */
    readonly notices: readonly T[];
    /** The columns' period its read was made at; `undefined` on an axis of no periods. */
    readonly period: PlanResolution | undefined;
}

/** What the canvas does with its readers' notices: the period it falls back to, and what the frame says. */
export interface PlanFallback {
    /** The coarser period the columns take; `undefined` where none shows more than the columns do now. */
    readonly period: PlanResolution | undefined;
    /** What no period shows — nothing while the columns fall back, whose next period shows what it shows. */
    readonly over: PlanOver;
}

/**
 * What the canvas does with its readers' notices (see the module docs): of those made at the columns' period, the
 * period that shows what they show nothing of, else what the frame's line names.
 *
 * @param period - The columns' period now; `undefined` on an axis of no periods, which falls back to none
 * @param offered - The periods the axis offers
 * @param kinds - The event kinds' reader's notices, and the period they were made at; `undefined` for none
 * @param items - The rows' own collections' reader's, the same; `undefined` where the rows read no nested series index
 * @returns The period to fall back to, and what the frame says
 */
export function planFallback(
    period: PlanResolution | undefined, offered: readonly PlanResolution[],
    kinds: PlanNotices<ScheduleCellNotice> | undefined, items: PlanNotices<PlanNestedNotice> | undefined,
): PlanFallback {
    const kindsNow = kinds !== undefined && kinds.period === period ? kinds.notices : NOTHING_OVER.kinds;
    const itemsNow = items !== undefined && items.period === period ? items.notices : NOTHING_OVER.items;
    if (kindsNow.length === 0 && itemsNow.length === 0) return { period: undefined, over: NOTHING_OVER };
    const fallback = period === undefined ? undefined
        : scheduleFallbackPeriod(period, offered, [...kindsNow.map((notice) => notice.shades), ...itemsNow.map((notice) => notice.shades)]);
    return { period: fallback, over: fallback !== undefined ? NOTHING_OVER : { kinds: kindsNow, items: itemsNow } };
}

/**
 * The canvas's fallback (see the module docs): its window hold takes the period {@link planFallback} gives, before the
 * frame paints, and the frame is handed what no period shows.
 *
 * @param scale - The scale the canvas draws with: its columns' period
 * @param offered - The periods the axis offers
 * @param events - The event kinds' reader's lead; `undefined` for a Plan without event kinds
 * @param nested - The rows' own collections' reader's lead; `undefined` where the rows read no nested series index
 * @param hold - The canvas's window hold, which keeps the period fallen back to
 * @returns What the frame says: the same object while it names the same
 */
export function usePlanFallback(
    scale: PlanScale | undefined, offered: readonly PlanResolution[], events: PlanEventLead | undefined, nested: PlanNestedLead | undefined,
    hold: PlanWindowHold,
): PlanOver {
    const period = scale?.resolution;
    // Each reader's notices are the same array while they hold: a lead that moves in anything else asks nothing here.
    const kindNotices = events?.cells?.notices;
    const cellsPeriod = events?.cellsPeriod;
    const itemNotices = nested?.notices;
    const itemsPeriod = nested?.resolution;
    const fallback = useMemo(() => planFallback(period, offered,
        kindNotices === undefined ? undefined : { notices: kindNotices, period: cellsPeriod },
        itemNotices === undefined ? undefined : { notices: itemNotices, period: itemsPeriod }),
    [period, offered, kindNotices, cellsPeriod, itemNotices, itemsPeriod]);
    const to = fallback.period;
    useLayoutEffect(() => { if (to !== undefined) hold.fallBack(to); }, [hold, to]);
    return fallback.over;
}
