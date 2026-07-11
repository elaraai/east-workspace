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
 * One row that never wraps, compressing progressively rather than all at once.
 * With `N` mounted affordances the rung runs `0 … N+1`:
 * rung 0 — every affordance live (each folds its own trailing chips into
 *   `+M more`, so the per-affordance spec rungs live inside them);
 * rung k (1 ≤ k ≤ N) — the `k` lowest-ranked affordances (see `COLLAPSE_RANK`
 *   — search / range fold first, the filter builder last) each collapse to a
 *   single summary chip in a trailing cluster, the rest stay live;
 * rung N+1 — terminal: all fold into one chip that *names its contents*
 *   (`Filter · Search +1`, or `3 filters · EU +1` when narrowing) — never the
 *   bare verb "narrow".
 * Every folded chip and the terminal chip open the sectioned `Slice.Edit`
 * popover (every affordance flat, in `editor` density, under its family
 * caption), floating over whatever sits below — the host never changes height.
 * The editor is the terminal surface: nothing folds inside it and nothing opens
 * a further popover.
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
import { railAffordanceKinds } from "../rail-kinds.js";
// Function-declaration import across the rail ↔ charts module cycle is safe
// (hoisted; charts/spec imports SliceRailCluster from here the same way).
import { tickFormatter, type TickFormat } from "../../charts/spec/index.js";
import { SliceDensityContext } from "../density";
import { brushHitTest, brushDragWindow, brushRelease, brushCursor, type BrushDrag } from "../brush-math.js";
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

/**
 * Fold rank per affordance kind — the order affordances degrade from live
 * control to summary chip under width pressure. Lower folds first: `search`
 * and `range` summarise cheaply, so they go first; the `filter` clause builder
 * is the primary narrowing surface, so it stays live longest. A kind with no
 * entry folds mid-pack. Purely presentational — nothing here reaches East IR.
 */
const COLLAPSE_RANK: Record<string, number> = {
    search: 1,
    range: 2,
    cohort: 3,
    presets: 3,
    breakdown: 4,
    filter: 5,
};

/** A folded affordance's summary chip: `active` when the family is narrowing
 *  (`3 filters`, `"EU"`), else its idle capability (`Filter`, `2 cohorts`). */
interface AffordanceDescriptor { kind: string; icon: IconDefinition; text: string; active: boolean }

/**
 * The summary descriptor for one affordance — capability when idle, active
 * narrowing when engaged. Drives the folded count chips, the terminal merged
 * chip, and (summed over active families) the editor's `N active` head count.
 */
export function affordanceDescriptor(
    kind: string,
    state: ValueTypeOf<typeof Slice.Types.State>,
    dimensions: ReadonlyArray<ValueTypeOf<typeof Slice.Types.Dimension>>,
): AffordanceDescriptor {
    const icon = AFFORDANCE_META[kind]?.icon ?? faFilter;
    switch (kind) {
        case "filter": {
            const n = state.filters.length;
            return { kind, icon, text: n > 0 ? `${n} filter${n > 1 ? "s" : ""}` : "Filter", active: n > 0 };
        }
        case "breakdown": {
            const breakdown = getSomeorUndefined(state.breakdown);
            return breakdown !== undefined
                ? { kind, icon, text: dimensions.find(d => d.fieldId === breakdown.fieldId)?.label ?? breakdown.fieldId, active: true }
                : { kind, icon, text: "Split", active: false };
        }
        case "cohort":
        case "presets": {
            const active = [...state.activeCohorts];
            if (active.length > 0) {
                const name = (id: string) => state.cohorts.find(c => c.id === id)?.name ?? id;
                return { kind, icon, text: active.length === 1 ? name(active[0]!) : `${name(active[0]!)} +${active.length - 1}`, active: true };
            }
            const avail = state.cohorts.length;
            return { kind, icon, text: avail === 1 ? "1 cohort" : `${avail} cohorts`, active: false };
        }
        case "range":
            return { kind, icon, text: "Range", active: getSomeorUndefined(state.range) !== undefined };
        case "search": {
            const q = getSomeorUndefined(state.search);
            const active = q !== undefined && q !== "";
            return { kind, icon, text: active ? `"${q}"` : "Search", active };
        }
        default:
            return { kind, icon, text: AFFORDANCE_META[kind]?.label ?? kind, active: false };
    }
}

/** Total count of active narrowings — the editor's `N active` head count.
 *  Filters count individually; each other engaged family counts once. */
function activeNarrowingCount(state: ValueTypeOf<typeof Slice.Types.State>): number {
    let n = state.filters.length + state.activeCohorts.size;
    if (getSomeorUndefined(state.breakdown) !== undefined) n += 1;
    if (getSomeorUndefined(state.range) !== undefined) n += 1;
    const q = getSomeorUndefined(state.search);
    if (q !== undefined && q !== "") n += 1;
    return n;
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

    // Fold order (mount indices, lowest COLLAPSE_RANK first) and the ladder
    // ceiling: rung 0 all live, rungs 1..N fold that many affordances into the
    // trailing cluster, rung N+1 merges into one terminal chip.
    const foldOrder = affordanceKinds
        .map((kind, i) => ({ i, rank: COLLAPSE_RANK[kind] ?? 3 }))
        .sort((a, b) => a.rank - b.rank || a.i - b.i)
        .map(o => o.i);
    const maxRung = affordanceKinds.length + 1;

    // Ladder measurement: render the current rung, and if the row overflows,
    // escalate by one (fold the next-ranked affordance). The affordances run
    // their own internal fold pass (all chips in flow while measuring), so a
    // bump only commits when the overflow persists across two animation frames
    // — otherwise the transient measure pass would over-collapse. A width
    // change resets to rung 0 and re-measures down. The row never wraps; chips
    // render whole or not at all.
    const rowRef = useRef<HTMLDivElement | null>(null);
    const [rung, setRung] = useState(0);
    // Width changes force a render even when the rung is already 0, so the
    // escalation effect below re-measures after every resize (without this a
    // shrink at rung 0 would clip instead of folding).
    const [, bumpMeasure] = useState(0);
    useLayoutEffect(() => {
        const el = rowRef.current;
        if (!el || rung >= maxRung) return;
        const overflowing = () => el.scrollWidth > el.clientWidth + 1;
        if (!overflowing()) return;
        let raf2 = 0;
        const raf1 = requestAnimationFrame(() => {
            raf2 = requestAnimationFrame(() => {
                if (overflowing()) setRung(r => Math.min(r + 1, maxRung));
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
    const dimensions = typeof slice.dimensions === "function" ? slice.dimensions() : [];
    const activeCount = activeNarrowingCount(state);

    const countChip = (key: string, icon: IconDefinition, text: string, active: boolean): ReactNode => (
        <Box key={key} as="span" css={chip({ tone: active ? "brand" : "neutral", numeric: true, shape: "pill" })} cursor="pointer" flexShrink={0}>
            <FontAwesomeIcon icon={icon} style={{ fontSize: "9px" }} />
            <Box as="span" whiteSpace="nowrap">{text}</Box>
        </Box>
    );

    // rung 0..N: the folded affordances (lowest-ranked `rung` of them) collapse
    // into a trailing summary cluster; the rest stay live, in mount order.
    const collapsedIdx = new Set(foldOrder.slice(0, Math.min(rung, affordanceKinds.length)));
    const liveKinds = affordanceKinds.map((kind, i) => ({ kind, i })).filter(({ i }) => !collapsedIdx.has(i));

    // The trailing collapsed cluster's trigger content: at the terminal rung a
    // single chip that *names the rail's contents* (active families first, so
    // an engaged narrowing leads); below that, one summary chip per folded
    // family in fold order.
    const clusterTrigger: ReactNode = rung >= maxRung ? (() => {
        const descriptors = affordanceKinds
            .map(kind => affordanceDescriptor(kind, state, dimensions))
            .map((d, idx) => ({ d, idx }))
            .sort((a, b) => (b.d.active ? 1 : 0) - (a.d.active ? 1 : 0) || a.idx - b.idx)
            .map(o => o.d);
        const labels = descriptors.map(d => d.text);
        const head = labels.slice(0, 2).join(" · ");
        const extra = labels.length > 2 ? ` +${labels.length - 2}` : "";
        const anyActive = descriptors.some(d => d.active);
        return countChip("all", descriptors[0]?.icon ?? faFilter, labels.length > 0 ? head + extra : "Slice", anyActive);
    })() : (
        foldOrder.slice(0, rung).map(i => {
            const d = affordanceDescriptor(affordanceKinds[i]!, state, dimensions);
            return countChip(`fold-${d.kind}-${i}`, d.icon, d.text, d.active);
        })
    );

    const collapsedCluster = rung === 0 ? null : (
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
                <Box display="inline-flex" alignItems="center" gap="{spacing.1.5}" flexShrink="0" cursor="pointer" onClick={() => setEditorOpen(true)}>
                    {clusterTrigger}
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

    const ladderContent = (
        <>
            {liveKinds.map(({ kind, i }) => {
                const m = AFFORDANCE_META[kind];
                return (
                    <Box key={`af-${kind}-${i}`} display="inline-flex" alignItems="center" gap="{spacing.1.5}" flexShrink="0" minWidth="0" title={m?.label}>
                        <Box as="span" css={styles.frameAffordanceIcon}>
                            {m && <FontAwesomeIcon icon={m.icon} style={{ fontSize: "10px" }} />}
                        </Box>
                        {renderAffordance(kind, i)}
                    </Box>
                );
            })}
            {collapsedCluster}
        </>
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
 * drag on empty track clears it). The gesture form of the `range` pill,
 * for compositions with no chart or timeline to brush on. Rich by default
 * (#190): a row-count histogram behind the track (self-excluding, so it
 * never collapses under its own window) and a formatted min / tick / max
 * axis beneath it, per the range field's declared `format` or a kind
 * default. The applied window is a full brush selection (#192): drag its
 * body to slide it (width preserved, `grab`/`grabbing` cursors), drag an
 * edge hot zone to resize that bound (`ew-resize`).
 */
function RailBrushStrip({ slice, style }: { slice: ValueTypeOf<typeof Slice.Types.Bind>; style: BrushStyle }) {
    const frameStyles = useSlotRecipe({ key: "sliceFrame" })();
    const domain = boundRangeDomain(slice.key);
    const [drag, setDrag] = useState<BrushDrag | null>(null);
    if (domain === undefined || domain.max <= domain.min) return null;

    const span = domain.max - domain.min;
    const applied = getSomeorUndefined(slice.read().range) as
        { type: string; value: { from: Date | number; to: Date | number } } | undefined;
    const toMs = (v: Date | number) => (v instanceof Date ? v.getTime() : Number(v));
    const winFrom = applied !== undefined ? Math.max(0, (toMs(applied.value.from) - domain.min) / span) : 0;
    const winTo = applied !== undefined ? Math.min(1, (toMs(applied.value.to) - domain.min) / span) : 1;
    // A grabbable window needs literal bounds — a `datetimePreset` arm has
    // none (its fractions come out NaN), so it renders the decorative tint.
    const winValid = applied !== undefined && Number.isFinite(winFrom) && Number.isFinite(winTo);
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
    const commit = (loPx: number, hiPx: number, width: number) => {
        const lo = fromFraction(loPx / width);
        const hi = fromFraction(hiPx / width);
        // The arm must match the range field's TRUE kind — an Integer field
        // needs bigint bounds or the range is inert (isValueOf guard, #167).
        slice.setRange(some(domain.kind === "datetime"
            ? variant("datetime", { from: new Date(lo), to: new Date(hi) })
            : domain.kind === "integer"
                ? variant("integer", { from: BigInt(Math.floor(lo)), to: BigInt(Math.ceil(hi)) })
                : variant("float", { from: lo, to: hi })));
    };
    const draft = drag !== null ? brushDragWindow(drag) : undefined;

    return (
        <Box display="flex" flexDirection="column" gap="2px" minWidth="0">
            <Box
                position="relative"
                height={style.count ? "28px" : "18px"}
                borderRadius="4px"
                background="bg.muted"
                cursor={drag !== null ? brushCursor(drag.mode) : "crosshair"}
                overflow="hidden"
                data-brush-track
                onPointerDown={(e) => {
                    const el = e.currentTarget as HTMLElement;
                    try { el.setPointerCapture(e.pointerId); } catch { /* jsdom has no active pointers */ }
                    const rect = el.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const win = winValid ? { lo: winFrom * rect.width, hi: winTo * rect.width } : undefined;
                    setDrag({ mode: brushHitTest(x, win), start: x, current: x, width: rect.width, win });
                }}
                onPointerMove={(e) => {
                    if (!drag) return;
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setDrag({ ...drag, current: e.clientX - rect.left });
                }}
                onPointerUp={() => {
                    if (!drag) return;
                    setDrag(null);
                    const release = brushRelease(drag);
                    if (release.kind === "clear") slice.setRange(none);
                    else if (release.kind === "commit") commit(release.lo, release.hi, drag.width);
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
                {/* applied window (#192) — grabbable body (slide) + edge-resize
                    hot zones; events bubble to the track, which owns the mode
                    machine. Hidden mid-drag so the draft is the only window. */}
                {drag === null && winValid && (
                    <>
                        <Box
                            data-brush-window
                            css={frameStyles.brushWindow}
                            left={`${winFrom * 100}%`}
                            width={`${Math.max(0, winTo - winFrom) * 100}%`}
                            opacity={0.3}
                        />
                        <Box data-brush-handle="lo" css={frameStyles.brushHandle} left={`${winFrom * 100}%`} />
                        <Box data-brush-handle="hi" css={frameStyles.brushHandle} left={`${winTo * 100}%`} />
                    </>
                )}
                {/* decorative full-domain tint when nothing is applied */}
                {drag === null && !winValid && (
                    <Box
                        position="absolute"
                        top={0}
                        bottom={0}
                        left="0%"
                        width="100%"
                        background="accent.brand"
                        opacity={0.12}
                        borderRadius="4px"
                        pointerEvents="none"
                    />
                )}
                {/* in-flight drag window (draw / slide / resize) */}
                {draft !== undefined && (
                    <Box
                        position="absolute"
                        top={0}
                        bottom={0}
                        left={`${draft.lo}px`}
                        width={`${draft.hi - draft.lo}px`}
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
 * affordance even when the author didn't list one (unless a `presets` bar —
 * which is already the cohort surface — is mounted, #319). With `"brush"` listed
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
    // `brush` and `legend` render beneath the cluster, not as rail chips.
    const affordanceKinds = railAffordanceKinds(configuredKinds, state).filter(k => k !== "brush" && k !== "legend");
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
