/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { ReactNode } from "react";

import { DateTimeType, StringType, equalFor } from "@elaraai/east";
import { useFormatters, useSlicesReactivity } from "@elaraai/east-ui-components";
import { RecordSliceFieldEditor } from "@elaraai/east-ui-components/internal";
import { DAY, weekStart } from "../../shared/schedule/window.js";
import { TimeNavigator } from "../../shared/time/navigation.js";
import type { PlanChrome } from "../root/chrome.js";

const stringEqual = equalFor(StringType);
const sameDate = equalFor(DateTimeType);

/** What {@link PlanTimeNavigator} is drawn from: the window's facts of the canvas's chrome, which hold while a window lands. */
export type PlanTimeNavigatorWindow = Pick<PlanChrome, "scale" | "windowParts" | "lead" | "moveWindow">;

/**
 * Calendar/Roster navigation over the Plan's one window (#1344): a date
 * picked writes the window, keeping its visible bucket count, into every
 * source of the slice that holds it, as the brush does — else the canvas's
 * own, which a slice with no source holding the window leaves it; its Range
 * panel edits the leading source's range, which the others follow, and with
 * no source holding the window it has none.
 *
 * An arrow steps the window its own length, a screenful (#1740): a week of
 * days by a week, where a step of one column would leave six of its seven
 * days on screen. Its popover opens first on Weeks where the window is whole
 * weeks, whatever its columns are.
 */
export function PlanTimeNavigator({ scale, windowParts, lead, moveWindow, compact = false, shortLabel = false, controls }: PlanTimeNavigatorWindow & { compact?: boolean; shortLabel?: boolean; controls?: ReactNode }) {
    useSlicesReactivity(windowParts.map(({ part }) => part.key));
    const words = useFormatters();
    if (scale.window.min.type !== "time" || scale.window.max.type !== "time") return null;
    const from = scale.window.min.value;
    const to = new Date(scale.window.max.value.getTime() - 1);
    const range = lead?.part.config.range;
    const field = lead !== undefined && range?.type === "some"
        ? lead.part.config.fields.find((f) => stringEqual(f.fieldId, range.value)) : undefined;
    const navigate = (date: number) => {
        // Preserve the number of visible buckets. Month/year windows use the
        // scale's calendar arithmetic, never a fixed number of milliseconds.
        const min = scale.floor(scale.fromNumber(date));
        const max = scale.offset(min, scale.n);
        moveWindow(scale.toNumber(min), scale.toNumber(max));
    };
    const rangeEditor = lead !== undefined && field !== undefined
        ? <RecordSliceFieldEditor slice={lead.part} field={field} source={lead.source} />
        : undefined;
    // A window from a Monday over a count of weeks is chosen by the week, at days as at weeks.
    const wholeWeeks = sameDate(weekStart(from, false), from) && (scale.window.max.value.getTime() - from.getTime()) % (7 * DAY) === 0;
    // Its window spans several periods: the short label names them, first to last, as the range label names the range.
    return <TimeNavigator scope="plan" label={controls === undefined ? "Choose plan dates" : "View"} date={from.getTime()} end={to.getTime()} period={scale.resolution ?? "day"}
        sunday={false} compact={compact} shortLabel={shortLabel} stride={scale.n} {...(wholeWeeks ? { initialPanel: "week" as const } : {})} onChange={navigate}
        rangeLabel={scale.resolution === "hour" ? `${words.dateTime(from)} – ${words.dateTime(to)}` : words.range(from, to)}
        rangeEditor={rangeEditor} controls={controls} />;
}
