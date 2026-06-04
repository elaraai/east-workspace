/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Slice.*>` tags — the slice-bound component family. Each component takes a
 * single flat options object whose required `slice` field is the bound handle,
 * so the tags are plain `optionsTag`s: `<Slice.Filter slice={slice} unit="events"
 * density="compact" />`. `Slice.Frame` houses one consumer (Table / Chart) as its
 * child (a `content` tag). The platform API (`Slice.config` / `Slice.bind` /
 * `Slice.state` / `Slice.apply` / `Slice.Types`) is carried through so one import
 * wires the whole surface.
 */

import { Slice as SliceFactory } from "../slice/index.js";
import { optionsTag, content, type OptionsProps, type ContentProps, type JsxTag } from "./combinators.js";

/** The `<Slice.Chart.*>` slice-bound chart tags. */
type SliceChartTags = {
    Line: JsxTag<OptionsProps<typeof SliceFactory.Chart.Line>>;
    Bar: JsxTag<OptionsProps<typeof SliceFactory.Chart.Bar>>;
    Area: JsxTag<OptionsProps<typeof SliceFactory.Chart.Area>>;
    Scatter: JsxTag<OptionsProps<typeof SliceFactory.Chart.Scatter>>;
};

/** The `<Slice.*>` tag namespace: component tags + the carried platform API. */
type SliceTags = {
    Summary: JsxTag<OptionsProps<typeof SliceFactory.Summary.Root>>;
    Range: JsxTag<OptionsProps<typeof SliceFactory.Range.Root>>;
    Filter: JsxTag<OptionsProps<typeof SliceFactory.Filter.Root>>;
    Breakdown: JsxTag<OptionsProps<typeof SliceFactory.Breakdown.Root>>;
    Legend: JsxTag<OptionsProps<typeof SliceFactory.Legend.Root>>;
    Search: JsxTag<OptionsProps<typeof SliceFactory.Search.Root>>;
    Cohort: JsxTag<OptionsProps<typeof SliceFactory.Cohort.Root>>;
    Frame: JsxTag<ContentProps<typeof SliceFactory.Frame.Root>>;
    Chart: SliceChartTags;
    config: typeof SliceFactory.config;
    bind: typeof SliceFactory.bind;
    state: typeof SliceFactory.state;
    apply: typeof SliceFactory.apply;
    Types: typeof SliceFactory.Types;
};

export const Slice: SliceTags = {
    Summary: optionsTag(SliceFactory.Summary.Root),
    Range: optionsTag(SliceFactory.Range.Root),
    Filter: optionsTag(SliceFactory.Filter.Root),
    Breakdown: optionsTag(SliceFactory.Breakdown.Root),
    Legend: optionsTag(SliceFactory.Legend.Root),
    Search: optionsTag(SliceFactory.Search.Root),
    Cohort: optionsTag(SliceFactory.Cohort.Root),
    Frame: content(SliceFactory.Frame.Root),
    Chart: {
        Line: optionsTag(SliceFactory.Chart.Line),
        Bar: optionsTag(SliceFactory.Chart.Bar),
        Area: optionsTag(SliceFactory.Chart.Area),
        Scatter: optionsTag(SliceFactory.Chart.Scatter),
    },
    config: SliceFactory.config,
    bind: SliceFactory.bind,
    state: SliceFactory.state,
    apply: SliceFactory.apply,
    Types: SliceFactory.Types,
};
