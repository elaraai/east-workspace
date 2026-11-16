/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An event's key, wherever a builder names an event by one string: East's
 * print of its `Schedule.Types.EventRef` — its kind's slot and its own key —
 * and its reading back. Every element an event draws carries it, a selection
 * holds it, and a Plan's link kind names its links the same way, by its slot
 * and its row's key. No two kinds' events share a key, whatever their keys
 * hold, and nothing is joined or split by a delimiter.
 *
 * One printer and one parser, which the Plan's parts, the Calendar's and the
 * shared schedule parts all name an event by.
 *
 * @packageDocumentation
 */

import { parseFor, printFor } from "@elaraai/east";
import { ScheduleEventRefType } from "@elaraai/e3-ui/internal";

/** Prints an event's reference — `(kind="job", key="J-1001")`: its key on a canvas. */
export const printEventRef = printFor(ScheduleEventRefType);

/** Reads a key back as an event's reference; a failure for a string that is none. */
export const parseEventRef = parseFor(ScheduleEventRefType);
