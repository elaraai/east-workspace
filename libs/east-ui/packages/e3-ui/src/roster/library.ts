/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Roster's library (#1368): its People and Activities tabs, its Patterns
 * tab (#1406) — the app's week patterns, titled by `Roster.patterns`' `name`,
 * each card dropped on a person's week replacing its seven days — and the app's
 * own tabs over keyed rows — each card dropped on a duty sets the duty's
 * fields that the card's `drop` names, a `Schedule.patch` over the duty kind's
 * row type, as Plan's and the Calendar's tabs do (`schedule/library.ts`).
 *
 * @packageDocumentation
 */

import type { DictType, EastType, SubtypeExprOrValue } from "@elaraai/east";
import type { ScheduleLibraryTabConfig, ScheduleTabDeclaration } from "../schedule/library.js";

/** One library declaration. Omit the library to omit its pane. */
export type RosterLibraryTab = { readonly kind: "people" | "activities" | "patterns" } | ScheduleTabDeclaration;

/**
 * Declares the staff library, the slice's `people` source filtering it, with the agencies' requests.
 *
 * @returns The tab, for the Roster's `library`
 */
export function rosterPeopleTab(): RosterLibraryTab { return { kind: "people" }; }

/**
 * Declares the activities library — each group's skills and the duties — the slice's `activities` source filtering it.
 *
 * @returns The tab, for the Roster's `library`
 */
export function rosterActivitiesTab(): RosterLibraryTab { return { kind: "activities" }; }

/**
 * Declares the week patterns library (#1406): the app's patterns, `Roster.patterns`' rows, under the name and icon it
 * gives, each card dropped on a person's week — its row in Week, its cell in Month — replacing the seven days as one
 * step; the slice's `patterns` source, where it has one, filtering it. Refused without `patterns`, naming it.
 *
 * @returns The tab, for the Roster's `library`
 */
export function rosterPatternsTab(): RosterLibraryTab { return { kind: "patterns" }; }

/**
 * Declares an app's tab over keyed rows, usually a bound record's `read()`:
 * a card per row, which, dropped on a duty, sets the fields its `drop` names.
 *
 * @typeParam K - The rows' key type
 * @typeParam R - The rows' row type
 * @typeParam P - The patch its `drop` returns: `Schedule.Types.Patch` of the duty kind's row type
 * @param rows - The keyed rows
 * @param config - The tab's name and icon, each card's label, second line and group, its `drop` — `Schedule.patch(DutyRowType, { … })` — and the slice's source that filters it
 * @returns The tab, for the Roster's `library`
 * @example
 * ```tsx
 * // Inside the Roster's Reactive body: a card per position, which sets the duty it is dropped on.
 * const positionsTab = Roster.library.tab(roles.read(), {
 *     name: "Positions", icon: "id-badge", label: (p) => p.label, meta: (p) => some(p.code),
 *     drop: (_p, key) => Schedule.patch(Duty, { role: key }),
 * });
 * ```
 */
export function rosterLibraryTab<K extends EastType, R extends EastType, P extends EastType = EastType>(
    rows: SubtypeExprOrValue<DictType<K, R>>, config: ScheduleLibraryTabConfig<K, R, P>,
): RosterLibraryTab {
    return { kind: "tab", rows, config: config as unknown as ScheduleLibraryTabConfig<EastType, EastType> };
}
