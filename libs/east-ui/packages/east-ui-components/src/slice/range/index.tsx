/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useState } from "react";
import { Box, chakra, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalendar, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { type ValueTypeOf, some, none, variant } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { boundRangeDomain } from "../../platform/slice/index.js";
import { EastChakraDateTimeInput } from "../../forms/input/index.js";
import { SliceEditPopover } from "../edit";
import { useSliceDensity } from "../density";
import { useSliceReactivity } from "../use-slice-reactivity";

/** East Slice.Range value type. */
export type SliceRangeValue = ValueTypeOf<typeof Slice.Range.Types.Range>;
/** The active range narrowing, unwrapped. */
type RangeValue = ValueTypeOf<typeof Slice.Types.Range>;

export interface EastChakraSliceRangeProps {
    value: SliceRangeValue;
}

type PresetTag = "today" | "last7d" | "last30d" | "last90d" | "ytd";
type CompareTag = "previousPeriod" | "previousYear";

const PRESETS: ReadonlyArray<{ label: string; tag: PresetTag }> = [
    { label: "Today", tag: "today" },
    { label: "7d",    tag: "last7d" },
    { label: "30d",   tag: "last30d" },
    { label: "90d",   tag: "last90d" },
    { label: "YTD",   tag: "ytd" },
];

const COMPARE: ReadonlyArray<{ label: string; tag: CompareTag | null }> = [
    { label: "— none",          tag: null },
    { label: "Previous period", tag: "previousPeriod" },
    { label: "Previous year",   tag: "previousYear" },
];

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const fmtShort = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
const fmtFull = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;

/** Resolve a preset tag to the absolute window ending at `anchor` (#195):
 *  wall-clock now for live data, the data's last day when the domain sits
 *  entirely in the past (or future) — so presets always land ON the data. */
function presetWindow(tag: PresetTag, anchor: Date): { from: Date; to: Date } {
    const to = new Date(anchor);
    let from = new Date(anchor);
    switch (tag) {
        case "today":   from.setHours(0, 0, 0, 0); break;
        case "last7d":  from.setDate(from.getDate() - 7); break;
        case "last30d": from.setDate(from.getDate() - 30); break;
        case "last90d": from.setDate(from.getDate() - 90); break;
        case "ytd":     from = new Date(anchor.getFullYear(), 0, 1); break;
    }
    return { from, to };
}

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

/** Renders a preset / compare chip from the shared `chip` recipe. */
function Chip({ label, active, dashed, onClick }: { label: string; active: boolean; dashed?: boolean; onClick: () => void }) {
    const chip = useRecipe({ key: "chip" });
    return (
        <chakra.button
            type="button"
            onClick={onClick}
            cursor="pointer"
            css={chip({ tone: active ? "brand" : dashed ? "dashed" : "neutral" })}
        >
            {label}
        </chakra.button>
    );
}

/**
 * Renders an East UI `Slice.Range` — a single pill showing the active window
 * (`AUG 14 → SEP 13 · 30d`); clicking opens the `Slice.Edit` picker with the
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
    const compareTag = getSomeorUndefined(state.compare)?.type ?? null;

    // Presets anchor to the DATA (#195): with a datetime domain, the anchor is
    // now clamped into [min, max] — historical data gets windows ending at its
    // last day instead of wall-clock windows that miss every row.
    const domain = boundRangeDomain(slice.key);
    const now = new Date();
    const anchor = domain !== undefined && domain.kind === "datetime"
        ? new Date(Math.max(domain.min, Math.min(domain.max, now.getTime())))
        : now;
    const anchorClamped = anchor.getTime() !== now.getTime();

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

    const [open, setOpen] = useState(getSomeorUndefined(value.editOpen) ?? false);

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
    const inputStyle = some({ size: some(variant("sm", null)) });

    const dayCount = win ? Math.max(1, Math.round((win.to.getTime() - win.from.getTime()) / 86_400_000)) : undefined;

    return (
        <SliceEditPopover
            open={open}
            onOpenChange={setOpen}
            label="Time range"
            footLeft={compareTag !== null ? <chakra.button type="button" css={edit.footLink} onClick={() => setCompareTag(null)}>Clear compare</chakra.button> : undefined}
            footActions={<chakra.button type="button" css={btn({ variant: "outline", size: "xs" })} onClick={() => setOpen(false)}>Done</chakra.button>}
            trigger={
                <Box css={chip({ tone: range !== undefined ? "brand" : "neutral", numeric: true })} cursor="pointer">
                    {!framed && <FontAwesomeIcon icon={faCalendar} style={{ fontSize: "10px" }} />}
                    <Box as="span">{win ? `${fmtShort(win.from)} → ${fmtShort(win.to)}` : "All time"}</Box>
                    {dayCount !== undefined && <Box as="span" color="fg.muted">{`${dayCount}d`}</Box>}
                    <FontAwesomeIcon icon={faChevronDown} style={{ fontSize: "8px" }} />
                </Box>
            }
        >
            <Box display="flex" gap="{spacing.2}" flexWrap="wrap" alignItems="center">
                <Chip label="All" active={allActive} onClick={setAll} />
                {PRESETS.map(p => (
                    <Chip
                        key={p.tag}
                        label={p.tag === "today" && anchorClamped ? "Last day" : p.label}
                        active={activePresetTag === p.tag}
                        onClick={() => setPreset(p.tag)}
                    />
                ))}
                <Chip label="Custom…" active={customActive} dashed onClick={setCustom} />
            </Box>
            {/* An active custom window exposes real from/to date inputs — pick
                the exact fiscal quarter / incident window from the pill (#167). */}
            {customActive && win !== null && (
                <Box display="flex" alignItems="center" gap="{spacing.2}" minWidth="0">
                    <EastChakraDateTimeInput value={{ value: win.from, onChange: some((d: Date) => writeCustom(d, win.to)), style: inputStyle } as never} />
                    <Box as="span" css={edit.clauseConj}>–</Box>
                    <EastChakraDateTimeInput value={{ value: win.to, onChange: some((d: Date) => writeCustom(win.from, d)), style: inputStyle } as never} />
                </Box>
            )}
            <Box as="span" css={edit.clauseConj} textAlign="left">COMPARE WITH</Box>
            <Box display="flex" gap="{spacing.2}" flexWrap="wrap" alignItems="center">
                {COMPARE.map(c => (
                    <Chip key={c.label} label={c.label} active={compareTag === c.tag} onClick={() => setCompareTag(c.tag)} />
                ))}
            </Box>
            {win && (
                <Box css={edit.resolveLine}>{`Resolves to ${fmtShort(win.from)} – ${fmtFull(win.to)}`}</Box>
            )}
            {/* All active: show the data's actual extent instead of a window (#195). */}
            {win === null && domain !== undefined && domain.kind === "datetime" && (
                <Box css={edit.resolveLine}>{`All data · ${fmtShort(new Date(domain.min))} – ${fmtFull(new Date(domain.max))}`}</Box>
            )}
        </SliceEditPopover>
    );
}, () => false);
