/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Slice.Rail` — the slice affordance cluster, both as the standalone strip
 * component and as the internal piece every slice-chrome host mounts
 * (`Slice.Frame`'s eyebrow today; Table / Chart / DecisionQueue headers as
 * they gain the `slice` chrome option).
 *
 * One row that never wraps, compressing along the chip ladder:
 * rung 0 — the live affordance bar (the affordances fold their own trailing
 * chips into `+M more`, so spec rungs ① and ② live inside them);
 * rung 1 — each active family collapses to its count chip;
 * rung 2 — terminal: one `N narrowed` chip.
 * Rungs 1–2 open the sectioned `Slice.Edit` popover (every affordance flat,
 * in `editor` density, under its family caption), floating over whatever
 * sits below — the host never changes height. The editor is the terminal
 * surface: nothing folds inside it and nothing opens a further popover.
 */

import { useEffect, useLayoutEffect, useRef, useState, memo, type ReactNode } from "react";
import { some, none, variant } from "@elaraai/east";
import { Box, chakra, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFilter, faLayerGroup, faUsers, faMagnifyingGlass, faCalendar, faChevronDown, type IconDefinition } from "@fortawesome/free-solid-svg-icons";
import { type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { boundRangeDomain, boundRangeHistogram, enableSlicePersistence, type SlicePersistMode } from "../../platform/slice";
// Function-declaration import across the rail ↔ charts module cycle is safe
// (hoisted; charts/spec imports SliceRailCluster from here the same way).
import { tickFormatter, type TickFormat } from "../../charts/spec/index.js";
import { SliceDensityContext } from "../density";
import { useSliceReactivity } from "../use-slice-reactivity";
import { SliceEditPopover } from "../edit";
import { EastChakraSliceFilter } from "../filter";
import { EastChakraSliceSearch } from "../search";
import { EastChakraSliceBreakdown } from "../breakdown";
import { EastChakraSliceRange } from "../range";
import { EastChakraSliceCohort } from "../cohort";
import { EastChakraSliceLegend } from "../legend";

/** Per-affordance icon + label — section headers in the editor, count chips on the ladder. */
const AFFORDANCE_META: Record<string, { icon: IconDefinition; label: string }> = {
    filter:    { icon: faFilter,          label: "Filter" },
    breakdown: { icon: faLayerGroup,      label: "Split" },
    cohort:    { icon: faUsers,           label: "Cohort" },
    presets:   { icon: faUsers,           label: "Presets" },
    search:    { icon: faMagnifyingGlass, label: "Search" },
    range:     { icon: faCalendar,        label: "Range" },
};

/** The compress-ladder rung — see the module doc. */
type Rung = 0 | 1 | 2;

/**
 * The active-narrowing summary per family — drives the rung-1 count chips
 * and the editor's `N active` head count.
 */
function familySummary(
    state: ValueTypeOf<typeof Slice.Types.State>,
    dimensions: ReadonlyArray<ValueTypeOf<typeof Slice.Types.Dimension>>,
): Array<{ kind: string; icon: IconDefinition; text: string; count: number }> {
    const parts: Array<{ kind: string; icon: IconDefinition; text: string; count: number }> = [];
    const cohorts = state.activeCohorts.size;
    if (cohorts > 0) parts.push({ kind: "cohort", icon: faUsers, text: cohorts === 1 ? [...state.activeCohorts][0]! : `${cohorts} cohorts`, count: cohorts });
    const n = state.filters.length;
    if (n > 0) parts.push({ kind: "filter", icon: faFilter, text: `${n} filter${n > 1 ? "s" : ""}`, count: n });
    const breakdown = getSomeorUndefined(state.breakdown);
    if (breakdown !== undefined) {
        parts.push({ kind: "breakdown", icon: faLayerGroup, text: dimensions.find(d => d.fieldId === breakdown.fieldId)?.label ?? breakdown.fieldId, count: 1 });
    }
    if (getSomeorUndefined(state.range) !== undefined) parts.push({ kind: "range", icon: faCalendar, text: "Range", count: 1 });
    const q = getSomeorUndefined(state.search);
    if (q !== undefined && q !== "") parts.push({ kind: "search", icon: faMagnifyingGlass, text: `"${q}"`, count: 1 });
    return parts;
}

export interface SliceRailClusterProps {
    /** The bound slice closure struct (decoded `Slice.bind` handle). */
    slice: ValueTypeOf<typeof Slice.Types.Bind>;
    /** Affordance kinds to mount, in order (`"filter"`, `"search"`, …). */
    affordanceKinds: ReadonlyArray<string>;
}

/**
 * The cluster itself — for hosts that already own a header row. Renders the
 * measured ladder + sectioned editor inline; the host provides the row
 * container (and meta zone) around it.
 */
export function SliceRailCluster({ slice, affordanceKinds }: SliceRailClusterProps) {
    const styles = useSlotRecipe({ key: "sliceFrame" })();
    const chip = useRecipe({ key: "chip" });
    const btn = useRecipe({ key: "button" });

    // Mount the real Slice.* component for each listed affordance, in order.
    const renderAffordance = (kind: string, i: number) => {
        const v = { slice } as never;
        switch (kind) {
            case "filter":    return <EastChakraSliceFilter key={`af-${i}`} value={v} />;
            case "breakdown": return <EastChakraSliceBreakdown key={`af-${i}`} value={v} />;
            case "cohort":    return <EastChakraSliceCohort key={`af-${i}`} value={v} />;
            // Curated preset bar (#163) — Slice.Cohort pinned to toggle mode.
            case "presets":   return <EastChakraSliceCohort key={`af-${i}`} value={{ slice, mode: some(variant("toggle", null)) } as never} />;
            case "search":    return <EastChakraSliceSearch key={`af-${i}`} value={v} />;
            case "range":     return <EastChakraSliceRange key={`af-${i}`} value={v} />;
            default:          return null;
        }
    };

    // Ladder measurement: render the current rung, and if the row overflows,
    // escalate. The affordances run their own internal fold pass (all chips in
    // flow while measuring), so a bump only commits when the overflow persists
    // across two animation frames — otherwise the transient measure pass would
    // drive the rung straight to terminal. A width change resets to rung 0 and
    // re-measures down. The row never wraps; chips render whole or not at all.
    const rowRef = useRef<HTMLDivElement | null>(null);
    const [rung, setRung] = useState<Rung>(0);
    // Width changes force a render even when the rung is already 0, so the
    // escalation effect below re-measures after every resize (without this a
    // shrink at rung 0 would clip instead of folding).
    const [, bumpMeasure] = useState(0);
    useLayoutEffect(() => {
        const el = rowRef.current;
        if (!el || rung >= 2) return;
        const overflowing = () => el.scrollWidth > el.clientWidth + 1;
        if (!overflowing()) return;
        let raf2 = 0;
        const raf1 = requestAnimationFrame(() => {
            raf2 = requestAnimationFrame(() => {
                if (overflowing()) setRung(r => (r + 1) as Rung);
            });
        });
        return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    });
    useLayoutEffect(() => {
        const el = rowRef.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        let width = el.clientWidth;
        const ro = new ResizeObserver(() => {
            if (el.clientWidth !== width) {
                width = el.clientWidth;
                setRung(0);
                bumpMeasure(n => n + 1);
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // The sectioned editor — one Slice.Edit popover holding every affordance
    // flat in `editor` density, complete regardless of how far the ladder
    // compressed. The editor is terminal: affordances show everything and
    // edit inline (no nested popovers, no nested cards).
    const [editorOpen, setEditorOpen] = useState(false);

    const state = slice.read();
    const summary = familySummary(state, typeof slice.dimensions === "function" ? slice.dimensions() : []);
    const activeCount = summary.reduce((acc, p) => acc + p.count, 0);

    const countChip = (key: string, icon: IconDefinition, text: string): ReactNode => (
        <Box key={key} as="span" css={chip({ tone: "brand", numeric: true, shape: "pill" })} cursor="pointer" flexShrink={0}>
            <FontAwesomeIcon icon={icon} style={{ fontSize: "9px" }} />
            <Box as="span" whiteSpace="nowrap">{text}</Box>
        </Box>
    );

    const ladderContent = rung === 0 ? (
        affordanceKinds.map((kind, i) => {
            const m = AFFORDANCE_META[kind];
            return (
                <Box key={`af-${kind}-${i}`} display="inline-flex" alignItems="center" gap="{spacing.1.5}" flexShrink="0" minWidth="0" title={m?.label}>
                    <Box as="span" css={styles.frameAffordanceIcon}>
                        {m && <FontAwesomeIcon icon={m.icon} style={{ fontSize: "10px" }} />}
                    </Box>
                    {renderAffordance(kind, i)}
                </Box>
            );
        })
    ) : (
        <SliceEditPopover
            open={editorOpen}
            onOpenChange={setEditorOpen}
            label={<>Narrowing · <Box as="span" color="{colors.brand.700}" fontWeight="700">{`${activeCount} active`}</Box></>}
            size="lg"
            footActions={
                <chakra.button type="button" css={btn({ variant: "solid", size: "xs" })} onClick={() => setEditorOpen(false)}>
                    Done
                </chakra.button>
            }
            trigger={
                <Box display="inline-flex" alignItems="center" gap="{spacing.1.5}" cursor="pointer" onClick={() => setEditorOpen(true)}>
                    {rung === 1 && summary.length > 0
                        ? summary.map(p => countChip(p.kind, p.icon, p.text))
                        : countChip("all", faFilter, activeCount > 0 ? `${activeCount} narrowed` : "narrow")}
                    <FontAwesomeIcon icon={faChevronDown} style={{ fontSize: "8px", opacity: 0.6 }} />
                </Box>
            }
        >
            <SliceDensityContext.Provider value="editor">
                <Box display="flex" flexDirection="column" gap="{spacing.3}">
                    {affordanceKinds.map((kind, i) => (
                        <Box key={`sec-${kind}-${i}`} display="flex" flexDirection="column" gap="{spacing.1.5}">
                            <Box as="span" textStyle="caption.eyebrow" color="fg.subtle">
                                {AFFORDANCE_META[kind]?.label ?? kind}
                            </Box>
                            <Box display="flex" alignItems="center" flexWrap="wrap" gap="{spacing.1.5}" minWidth="0">
                                {renderAffordance(kind, i)}
                            </Box>
                        </Box>
                    ))}
                </Box>
            </SliceDensityContext.Provider>
        </SliceEditPopover>
    );

    return (
        <SliceDensityContext.Provider value="compact">
            <Box
                ref={rowRef}
                display="flex"
                flexDirection="row"
                flexWrap="nowrap"
                alignItems="center"
                gap="{spacing.3}"
                overflow="hidden"
                minWidth="0"
                flex="1"
                // overflow:hidden (ladder measurement) would clip the focus
                // halo of inputs at the row's vertical edges — pad the ring's
                // width in and compensate the layout.
                paddingY="4px"
                marginY="-4px"
            >
                {ladderContent}
            </Box>
        </SliceDensityContext.Provider>
    );
}

export interface EastChakraSliceRailProps {
    value: {
        slice: unknown;
        affordances: ReadonlyArray<{ type: string }>;
        persist: { type: "some"; value: { type: SlicePersistMode } } | { type: "none"; value: null };
        brush:
            | { type: "some"; value: { axis: { type: string; value: boolean | null }; count: { type: string; value: boolean | null }; buckets: { type: string; value: bigint | null } } }
            | { type: "none"; value: null };
    };
}

/** Resolved brush-strip presentation (#190) — rich by default. */
interface BrushStyle { axis: boolean; count: boolean; buckets: number; }

/** Default histogram resolution. */
const BRUSH_BUCKETS = 32;

/**
 * The standalone rail's brush strip — a track over the range field's full
 * bound domain; drag a window to write the slice's range (a sub-threshold
 * drag clears it). The gesture form of the `range` pill, for compositions
 * with no chart or timeline to brush on. Rich by default (#190): a
 * row-count histogram behind the track (self-excluding, so it never
 * collapses under its own window) and a formatted min / tick / max axis
 * beneath it, per the range field's declared `format` or a kind default.
 */
function RailBrushStrip({ slice, style }: { slice: ValueTypeOf<typeof Slice.Types.Bind>; style: BrushStyle }) {
    const frameStyles = useSlotRecipe({ key: "sliceFrame" })();
    const domain = boundRangeDomain(slice.key);
    const [drag, setDrag] = useState<{ x1: number; x2: number; width: number } | null>(null);
    if (domain === undefined || domain.max <= domain.min) return null;

    const span = domain.max - domain.min;
    const applied = getSomeorUndefined(slice.read().range) as
        { type: string; value: { from: Date | number; to: Date | number } } | undefined;
    const toMs = (v: Date | number) => (v instanceof Date ? v.getTime() : Number(v));
    const winFrom = applied !== undefined ? Math.max(0, (toMs(applied.value.from) - domain.min) / span) : 0;
    const winTo = applied !== undefined ? Math.min(1, (toMs(applied.value.to) - domain.min) / span) : 1;
    const fromFraction = (f: number) => domain.min + Math.max(0, Math.min(1, f)) * span;

    // Density histogram (#190) — self-excluding row counts per bucket,
    // max-normalised for bar heights. Empty/flat data renders no bars.
    const counts = style.count ? boundRangeHistogram(slice.key, style.buckets) : undefined;
    const maxCount = counts !== undefined ? Math.max(...counts) : 0;

    // Formatted axis labels (#190) — the range field's declared `format`
    // wins; else the kind default (datetime → locale date, numeric → number).
    const rangeFieldId = (getSomeorUndefined(slice.rangeFieldId() as never) ?? undefined) as string | undefined;
    const fieldFormat = rangeFieldId !== undefined
        ? getSomeorUndefined((slice.fields().find(f => f.fieldId === rangeFieldId) as { format?: never } | undefined)?.format as never) as TickFormat | undefined
        : undefined;
    const fmt = tickFormatter(fieldFormat, domain.kind === "datetime" ? "time" : "linear");
    const axisLabel = (f: number) => {
        const v = fromFraction(f);
        return fmt(domain.kind === "datetime" ? new Date(v) : v);
    };
    const commit = (x1: number, x2: number, width: number) => {
        const [a, b] = [Math.min(x1, x2), Math.max(x1, x2)];
        if (b - a < 5) { slice.setRange(none); return; }
        const lo = fromFraction(a / width);
        const hi = fromFraction(b / width);
        // The arm must match the range field's TRUE kind — an Integer field
        // needs bigint bounds or the range is inert (isValueOf guard, #167).
        slice.setRange(some(domain.kind === "datetime"
            ? variant("datetime", { from: new Date(lo), to: new Date(hi) })
            : domain.kind === "integer"
                ? variant("integer", { from: BigInt(Math.floor(lo)), to: BigInt(Math.ceil(hi)) })
                : variant("float", { from: lo, to: hi })));
    };

    return (
        <Box display="flex" flexDirection="column" gap="2px" minWidth="0">
            <Box
                position="relative"
                height={style.count ? "28px" : "18px"}
                borderRadius="4px"
                background="bg.muted"
                cursor="crosshair"
                overflow="hidden"
                onPointerDown={(e) => {
                    const el = e.currentTarget as HTMLElement;
                    el.setPointerCapture(e.pointerId);
                    const rect = el.getBoundingClientRect();
                    setDrag({ x1: e.clientX - rect.left, x2: e.clientX - rect.left, width: rect.width });
                }}
                onPointerMove={(e) => {
                    if (!drag) return;
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setDrag({ ...drag, x2: e.clientX - rect.left });
                }}
                onPointerUp={() => {
                    if (!drag) return;
                    setDrag(null);
                    commit(drag.x1, drag.x2, drag.width);
                }}
            >
                {/* density histogram — row counts per bucket (#190); geometry is data-driven */}
                {counts !== undefined && maxCount > 0 && counts.map((c, i) => (
                    c > 0 && (
                        <Box
                            key={i}
                            data-brush-bar
                            position="absolute"
                            bottom={0}
                            left={`${(i / counts.length) * 100}%`}
                            width={`${(1 / counts.length) * 100}%`}
                            height={`${Math.max(8, (c / maxCount) * 100)}%`}
                            background="border.strong"
                            opacity={0.55}
                            borderRadius="1px"
                            pointerEvents="none"
                        />
                    )
                ))}
                {/* applied window (or full domain when no range) */}
                <Box
                    position="absolute"
                    top={0}
                    bottom={0}
                    left={`${winFrom * 100}%`}
                    width={`${Math.max(0, winTo - winFrom) * 100}%`}
                    background="accent.brand"
                    opacity={applied !== undefined ? 0.3 : 0.12}
                    borderRadius="4px"
                    pointerEvents="none"
                />
                {/* in-flight drag selection */}
                {drag && (
                    <Box
                        position="absolute"
                        top={0}
                        bottom={0}
                        left={`${Math.min(drag.x1, drag.x2)}px`}
                        width={`${Math.abs(drag.x2 - drag.x1)}px`}
                        background="accent.brand"
                        opacity={0.35}
                        borderXWidth="1px"
                        borderColor="accent.brand"
                        pointerEvents="none"
                    />
                )}
            </Box>
            {/* formatted scale beneath the track (#190) — min · ⅓ · ⅔ · max */}
            {style.axis && (
                <Box css={frameStyles.brushAxis} aria-hidden="true">
                    <Box as="span">{axisLabel(0)}</Box>
                    <Box as="span">{axisLabel(1 / 3)}</Box>
                    <Box as="span">{axisLabel(2 / 3)}</Box>
                    <Box as="span">{axisLabel(1)}</Box>
                </Box>
            )}
        </Box>
    );
}

/**
 * Renders an East UI `Slice.Rail` — the cluster as a standalone strip.
 * Place above components reading `Slice.rows([RowType], slice)`; the strip
 * narrows them all. A cohort created via "Save as cohort" appends a cohort
 * affordance even when the author didn't list one. With `"brush"` listed
 * (and a `rangeFieldId` on the config) a slim brush strip renders beneath
 * the chips — drag a window to set the range.
 */
export const EastChakraSliceRail = memo(function EastChakraSliceRail({ value }: EastChakraSliceRailProps) {
    const slice = value.slice as ValueTypeOf<typeof Slice.Types.Bind>;
    useSliceReactivity(slice.key);
    // Opt-in persistence (#168): hydrate once on mount from the chosen store
    // (localStorage / sessionStorage / URL param), then every mutation
    // debounce-writes back. Keyed by the slice key; registration is once-only.
    const persistMode = value.persist.type === "some" ? value.persist.value.type : undefined;
    useEffect(() => {
        if (persistMode !== undefined) enableSlicePersistence(slice.key, persistMode);
    }, [slice.key, persistMode]);
    const state = slice.read();
    const configuredKinds = value.affordances.map(a => a.type);
    const withCohort = state.cohorts.length > 0 && !configuredKinds.includes("cohort")
        ? [...configuredKinds, "cohort"]
        : configuredKinds;
    // `brush` and `legend` render beneath the cluster, not as rail chips.
    const affordanceKinds = withCohort.filter(k => k !== "brush" && k !== "legend");
    const brushEnabled = configuredKinds.includes("brush");
    // Explicit only (#187) — the legend renders when listed, never implicitly.
    const legendEnabled = configuredKinds.includes("legend");
    // Brush presentation (#190) — rich by default; opt out per option.
    // (Optional-chained: fabricated host payloads may predate the field.)
    const brushOpts = value.brush?.type === "some" ? value.brush.value : undefined;
    const brushStyle: BrushStyle = {
        axis:    (brushOpts?.axis.type === "some" ? brushOpts.axis.value as boolean : undefined) ?? true,
        count:   (brushOpts?.count.type === "some" ? brushOpts.count.value as boolean : undefined) ?? true,
        buckets: brushOpts?.buckets.type === "some" ? Number(brushOpts.buckets.value as bigint) : BRUSH_BUCKETS,
    };
    return (
        <Box display="flex" flexDirection="column" gap="{spacing.1.5}" minWidth="0">
            <Box display="flex" alignItems="center" minWidth="0">
                <SliceRailCluster slice={slice} affordanceKinds={affordanceKinds} />
            </Box>
            {brushEnabled && <RailBrushStrip slice={slice} style={brushStyle} />}
            {legendEnabled && <EastChakraSliceLegend value={{ slice } as never} />}
        </Box>
    );
}, () => false);
