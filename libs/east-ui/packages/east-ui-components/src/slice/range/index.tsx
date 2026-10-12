/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useState } from "react";
import { Box, chakra, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalendar, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { type ValueTypeOf, some, none, variant, DateTimeType, IntegerType, FloatType, printFor, parseFor } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { boundRangeDomain } from "../../platform/slice/index.js";
import { coarseHitArea } from "../../style/hit-area.js";
import { useFormatters } from "../../format/index.js";
import { SliceChoiceGroup } from "../choice.js";
import { SliceRangeEditor } from "./editor.js";
import { SliceEditPopover } from "../edit";
import { useSliceDensity } from "../density";
import { useSliceReactivity } from "../use-slice-reactivity";
import { PRESETS, presetAnchor, presetWindow, type PresetTag } from "./presets.js";

/** East Slice.Range value type. */
export type SliceRangeValue = ValueTypeOf<typeof Slice.Range.Types.Range>;
/** The active range narrowing, unwrapped. */
type RangeValue = ValueTypeOf<typeof Slice.Types.Range>;

export interface EastChakraSliceRangeProps {
    value: SliceRangeValue;
}

type CompareTag = "previousPeriod" | "previousYear";

const COMPARE: ReadonlyArray<{ label: string; tag: CompareTag | null }> = [
    { label: "— none",          tag: null },
    { label: "Previous period", tag: "previousPeriod" },
    { label: "Previous year",   tag: "previousYear" },
];

/** Resolve the active range to an absolute `{ from, to }` window, or null.
 *  Programmatic `datetimePreset` seeds keep their wall-clock semantics (the
 *  matcher resolves them against now); preset CLICKS pin data-anchored
 *  windows instead (#195). */
function resolveWindow(range: RangeValue | undefined): { from: Date; to: Date } | null {
    if (range === undefined) return null;
    if (range.type === "datetime") {
        return { from: new Date(range.value.from), to: new Date(range.value.to) };
    }
    if (range.type === "datetimePreset") {
        return presetWindow(range.value.type as PresetTag, new Date());
    }
    return null;
}

/** The active NUMERIC range (`float` / `integer` arms — a number-axis Plan's
 *  window, #631) as plain numbers, or null. */
function resolveNumericWindow(range: RangeValue | undefined): { from: number; to: number } | null {
    if (range === undefined) return null;
    if (range.type === "float") return { from: range.value.from, to: range.value.to };
    if (range.type === "integer") return { from: Number(range.value.from), to: Number(range.value.to) };
    return null;
}

/** A resolution tag, decoded. */
export type ResolutionTag = "auto" | "hour" | "day" | "week" | "month" | "quarter" | "year";

/**
 * The bucket-unit segment beside the range pill (`WEEK · DAY`, the `seg`
 * recipe) — reads `state.resolution`, writes via `setResolution` so every
 * bound time-bucketed surface re-buckets together. No segment is active when
 * the state carries `none` (each surface keeps its own default until the user
 * picks one, or the host seeds the state).
 */
export function ResolutionSeg({ options, active, onPick }: {
    options: ReadonlyArray<ResolutionTag>;
    active: ResolutionTag | undefined;
    onPick: (tag: ResolutionTag) => void;
}) {
    const seg = useSlotRecipe({ key: "seg" })();
    return (
        <Box css={seg.root} role="group" aria-label="Resolution">
            {options.map(tag => (
                <chakra.button
                    key={tag}
                    type="button"
                    css={seg.item}
                    data-state={active === tag ? "on" : "off"}
                    aria-pressed={active === tag}
                    onClick={() => onPick(tag)}
                >
                    {tag}
                </chakra.button>
            ))}
        </Box>
    );
}

/** The shared range editor body, for Slice.Range and a builder's time navigator. */
export function SliceRangeContent({ slice, fallback }: { slice: ValueTypeOf<typeof Slice.Types.Bind>; fallback?: RangeValue }) {
    useSliceReactivity(slice.key);
    const edit = useSlotRecipe({ key: "sliceEdit" })();
    const state = slice.read();
    const range = getSomeorUndefined(state.range) ?? fallback;
    const win = resolveWindow(range);
    const numericWin = resolveNumericWindow(range);
    const words = useFormatters();
    const numFmt = words.number;
    const span = (from: Date, to: Date) => words.range(from, to).toLocaleUpperCase(words.locale);
    const compareTag = getSomeorUndefined(state.compare)?.type ?? null;
    // Presets anchor to the DATA (#195): with a datetime domain, the anchor is
    // now clamped into [min, max] — historical data gets windows ending at its
    // last day instead of wall-clock windows that miss every row.
    const domain = boundRangeDomain(slice.key);
    const numericField = domain !== undefined && domain.kind !== "datetime";
    const { anchor, clamped: anchorClamped } = presetAnchor(domain?.kind === "datetime" ? domain : undefined);

    // A pinned window that (still) equals a preset's resolution highlights
    // that preset's chip; the tolerance absorbs render-to-render `now` drift
    // for live-anchored pins within a session.
    const PIN_TOLERANCE_MS = 5 * 60_000;
    const matchesPreset = (tag: PresetTag): boolean => {
        if (range?.type !== "datetime" || win === null) return false;
        const p = presetWindow(tag, anchor);
        return Math.abs(p.from.getTime() - win.from.getTime()) <= PIN_TOLERANCE_MS
            && Math.abs(p.to.getTime() - win.to.getTime()) <= PIN_TOLERANCE_MS;
    };
    const activePresetTag = range?.type === "datetimePreset"
        ? range.value.type
        : PRESETS.find(p => matchesPreset(p.tag))?.tag;
    const [forcedCustom, setForcedCustom] = useState(false);
    const customActive = range?.type === "datetime" && (forcedCustom || activePresetTag === undefined);
    const allActive = range === undefined;

    // A preset click PINS its data-anchored window (#195) — the state carries
    // the concrete dates (what you saw is what persists/shares); the rolling
    // `datetimePreset` arm remains for programmatic seeds.
    const setPreset = (tag: PresetTag) => {
        setForcedCustom(false);
        const p = presetWindow(tag, anchor);
        slice.setRange(some(variant("datetime", { from: p.from, to: p.to })));
    };
    const setAll = () => {
        setForcedCustom(false);
        slice.setRange(none);
    };
    // Write an exact pinned window; inverted input pairs are ignored rather
    // than silently swapped (the from/to controls stay authoritative).
    const writeCustom = (from: Date, to: Date) => {
        if (from.getTime() <= to.getTime()) slice.setRange(some(variant("datetime", { from, to })));
    };
    // "Custom…" pins the currently-resolved window (a preset's absolute dates,
    // or last-30-days when nothing is active) as the STARTING point — the
    // from/to inputs below then author the exact window. It no longer
    // hard-overwrites to a fixed 30-day window with nothing to adjust (#167).
    const setCustom = () => {
        setForcedCustom(true);
        if (win !== null) { writeCustom(win.from, win.to); return; }
        const p = presetWindow("last30d", anchor);
        writeCustom(p.from, p.to);
    };
    const setCompareTag = (tag: CompareTag | null) =>
        slice.setCompare(tag === null ? none : some(variant(tag, null)));

    return <>
            <SliceChoiceGroup choices={[
                { id: "all", label: "All", active: allActive },
                ...(!numericField ? PRESETS.map(p => ({ id: p.tag, label: p.tag === "today" && anchorClamped ? "Last day" : p.label, active: activePresetTag === p.tag })) : []),
                ...(!numericField ? [{ id: "custom", label: "Custom…", active: customActive, dashed: true }] : []),
            ]} onPick={id => { if (id === "all") setAll(); else if (id === "custom") setCustom(); else setPreset(id as PresetTag); }} />
            {customActive && win !== null && <SliceRangeEditor kind="datetime" label="Time range" immediate
                from={printFor(DateTimeType)(win.from)} to={printFor(DateTimeType)(win.to)}
                onApply={(from, to) => { const a = parseFor(DateTimeType)(from); const b = parseFor(DateTimeType)(to); if (a.success && b.success) writeCustom(a.value, b.value); }} />}
            {numericField && <SliceRangeEditor kind={domain.kind === "integer" ? "integer" : "float"} label="Range"
                from={range?.type === "integer" ? printFor(IntegerType)(range.value.from) : range?.type === "float" ? printFor(FloatType)(range.value.from) : ""}
                to={range?.type === "integer" ? printFor(IntegerType)(range.value.to) : range?.type === "float" ? printFor(FloatType)(range.value.to) : ""}
                onApply={(from, to) => {
                    if (domain.kind === "integer") { const a = parseFor(IntegerType)(from); const b = parseFor(IntegerType)(to); if (a.success && b.success) slice.setRange(some(variant("integer", { from: a.value, to: b.value }))); }
                    else { const a = parseFor(FloatType)(from); const b = parseFor(FloatType)(to); if (a.success && b.success) slice.setRange(some(variant("float", { from: a.value, to: b.value }))); }
                }} />}
            <Box as="span" css={edit.fieldLabel}>COMPARE WITH</Box>
            <SliceChoiceGroup choices={COMPARE.map(c => ({ id: c.tag ?? "none", label: c.label, active: compareTag === c.tag }))}
                onPick={id => setCompareTag(id === "none" ? null : id as CompareTag)} />
            {win && (
                <Box css={edit.resolveLine}>{`Resolves to ${span(win.from, win.to)}`}</Box>
            )}
            {numericWin && (
                <Box css={edit.resolveLine}>{`Resolves to ${numFmt(numericWin.from)} – ${numFmt(numericWin.to)}`}</Box>
            )}
            {/* All active on a numeric field: the data's actual extent. */}
            {numericWin === null && win === null && domain !== undefined && numericField && (
                <Box css={edit.resolveLine}>{`All data · ${numFmt(domain.min)} – ${numFmt(domain.max)}`}</Box>
            )}
            {/* All active: show the data's actual extent instead of a window (#195). */}
            {win === null && domain !== undefined && domain.kind === "datetime" && (
                <Box css={edit.resolveLine}>{`All data · ${span(new Date(domain.min), new Date(domain.max))}`}</Box>
            )}
    </>;
}

/**
 * Renders an East UI `Slice.Range` — a single chip showing the active window
 * (`AUG 14 – SEP 13 · 30d`); clicking opens the `Slice.Edit` picker with the
 * presets, the compare-with row, and the resolved window. Reads `state.range` /
 * `state.compare` reactively; writes via `setRange` / `setCompare`.
 */
export const EastChakraSliceRange = memo(function EastChakraSliceRange({ value }: EastChakraSliceRangeProps) {
    const chip = useRecipe({ key: "chip" });
    const btn = useRecipe({ key: "button" });
    const edit = useSlotRecipe({ key: "sliceEdit" })();
    const { slice } = value;
    useSliceReactivity(slice.key);
    // In a Slice.Frame the block supplies the calendar identity, so the pill
    // drops its own; standalone it keeps it.
    // `editor` takes the framed (flat pill) form; its picker inlines via the editor-density disclosure.
    const framed = useSliceDensity() !== "focused";
    const state = slice.read();

    const range = getSomeorUndefined(state.range);
    const win = resolveWindow(range);
    // A numeric range field (a number-axis Plan's slice, #631) prints its
    // window as numbers; the date presets have no meaning against it.
    const numericWin = resolveNumericWindow(range);
    // Numbers and dates in the app's locale; dates in UTC, capitalised like
    // the chip's other words (#850).
    const words = useFormatters();
    const numFmt = words.number;
    const day = (d: Date) => words.monthDay(d).toLocaleUpperCase(words.locale);
    const compareTag = getSomeorUndefined(state.compare)?.type ?? null;

    // Resolution segment (Plan spec §8) — configured bucket units beside the
    // pill; reads `state.resolution`, writes via `setResolution`.
    const resolutionTags = (getSomeorUndefined(value.resolutions) ?? []).map(r => r.type as ResolutionTag);
    const activeResolution = getSomeorUndefined(state.resolution)?.type as ResolutionTag | undefined;
    const pickResolution = (tag: ResolutionTag) => slice.setResolution(some(variant(tag, null)));

    const domain = boundRangeDomain(slice.key);
    const numericField = domain !== undefined && domain.kind !== "datetime";
    const dayCount = win ? Math.max(1, Math.round((win.to.getTime() - win.from.getTime()) / 86_400_000)) : undefined;
    const [open, setOpen] = useState(getSomeorUndefined(value.editOpen) ?? false);
    const setCompareTag = (tag: CompareTag | null) => slice.setCompare(tag === null ? none : some(variant(tag, null)));

    const picker = (
        <SliceEditPopover
            open={open}
            onOpenChange={setOpen}
            label={numericField ? "Range" : "Time range"}
            footLeft={compareTag !== null ? <chakra.button type="button" css={edit.footLink} onClick={() => setCompareTag(null)}>Clear compare</chakra.button> : undefined}
            footActions={<chakra.button type="button" css={btn({ variant: "outline", size: "xs" })} onClick={() => setOpen(false)}>Done</chakra.button>}
            trigger={
                // A button the keyboard reaches; a 44px touch target on a coarse pointer, by its halo (#1231).
                <chakra.button type="button" css={[chip({ tone: range !== undefined ? "brand" : "neutral", numeric: true }), coarseHitArea({ position: true })]} cursor="pointer"
                    data-slice-range="">
                    {!framed && <FontAwesomeIcon icon={faCalendar} data-chip-icon="" />}
                    {/* The range's own bounds — both inclusive, as a slice
                        range is — with an en dash between them (#949):
                        numbers close up (`1–8`), dates stand apart
                        (`JUN 29 – SEP 20`). */}
                    <Box as="span" data-slice-range-label>{win
                        ? `${day(win.from)} – ${day(win.to)}`
                        : numericWin
                            ? `${numFmt(numericWin.from)}–${numFmt(numericWin.to)}`
                            : numericField ? "All" : "All time"}</Box>
                    {dayCount !== undefined && <Box as="span" data-chip-meta="">{`${dayCount}d`}</Box>}
                    <FontAwesomeIcon icon={faChevronDown} data-chip-caret="" />
                </chakra.button>
            }
        >
            <SliceRangeContent slice={slice} />
        </SliceEditPopover>
    );

    if (resolutionTags.length === 0) return picker;
    return (
        <Box css={edit.controlRow}>
            {picker}
            <ResolutionSeg options={resolutionTags} active={activeResolution} onPick={pickResolution} />
        </Box>
    );
}, () => false);
