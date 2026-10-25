/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { ReactNode } from "react";

import { StringType, equalFor } from "@elaraai/east";
import { useFormatters, useSlicesReactivity } from "@elaraai/east-ui-components";
import { RecordSliceFieldEditor } from "@elaraai/east-ui-components/internal";
import { TimeNavigator } from "../../shared/time/navigation.js";
import type { PlanChrome } from "../root/chrome.js";

const stringEqual = equalFor(StringType);

/**
 * Calendar/Roster navigation over the Plan's one window (#1344): a date
 * picked writes the window, keeping its visible bucket count, into every
 * source of the slice that holds it, as the brush does — else the canvas's
 * own, which a slice with no source holding the window leaves it; its Range
 * panel edits the leading source's range, which the others follow, and with
 * no source holding the window it has none.
 */
export function PlanTimeNavigator({ chrome, compact = false, controls }: { chrome: PlanChrome; compact?: boolean; controls?: ReactNode }) {
    const { scale, windowParts, lead, moveWindow } = chrome;
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
    return <TimeNavigator scope="plan" label={controls === undefined ? "Choose plan dates" : "View"} date={from.getTime()} period={scale.resolution ?? "day"}
        sunday={false} compact={compact} onChange={navigate}
        rangeLabel={scale.resolution === "hour" ? `${words.dateTime(from)} – ${words.dateTime(to)}` : words.range(from, to)}
        rangeEditor={rangeEditor} controls={controls} />;
}
