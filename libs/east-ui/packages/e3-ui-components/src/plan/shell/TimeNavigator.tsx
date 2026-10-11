/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { ReactNode } from "react";

import { some } from "@elaraai/east";
import { useFormatters, useSliceReactivity } from "@elaraai/east-ui-components";
import { RecordSliceFieldEditor, SliceRangeContent, setRecordSliceWindow } from "@elaraai/east-ui-components/internal";
import { TimeNavigator } from "../../shared/time/navigation.js";
import { rangeOf } from "../axis.js";
import type { PlanChrome } from "../root/chrome.js";

/** Calendar/Roster navigation over Plan's existing Slice window and scale. */
export function PlanTimeNavigator({ chrome, compact = false, controls }: { chrome: PlanChrome; compact?: boolean; controls?: ReactNode }) {
    const { scale, slice, recordChrome } = chrome;
    const record = recordChrome?.slice;
    useSliceReactivity(record?.key ?? slice?.key);
    const words = useFormatters();
    if (scale.window.min.type !== "time" || scale.window.max.type !== "time") return null;
    const from = scale.window.min.value;
    const to = new Date(scale.window.max.value.getTime() - 1);
    const field = record?.config.range.type === "some"
        ? record.config.fields.find(f => f.fieldId === record.config.range.value) : undefined;
    const navigate = (date: number) => {
        // Preserve the number of visible buckets. Month/year windows use the
        // scale's calendar arithmetic, never a fixed number of milliseconds.
        const min = scale.floor(scale.fromNumber(date));
        const max = scale.offset(min, scale.n);
        if (record !== undefined) setRecordSliceWindow(record, scale.toNumber(min), scale.toNumber(max));
        else slice?.setRange(some(rangeOf("datetime", min, max)));
    };
    const rangeEditor = record !== undefined && field !== undefined
        ? <RecordSliceFieldEditor slice={record} field={field} />
        : slice !== undefined ? <SliceRangeContent slice={slice} fallback={rangeOf("datetime", scale.window.min, scale.window.max)} /> : undefined;
    return <TimeNavigator scope="plan" label={controls === undefined ? "Choose plan dates" : "View"} date={from.getTime()} period={scale.resolution ?? "day"}
        sunday={false} compact={compact} onChange={navigate}
        rangeLabel={scale.resolution === "hour" ? `${words.dateTime(from)} – ${words.dateTime(to)}` : words.range(from, to)}
        rangeEditor={rangeEditor} controls={controls} />;
}
