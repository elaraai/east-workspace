/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Slice.Rail` — the slice affordance cluster, both as the standalone strip
 * component and as the pieces every slice-chrome host mounts: the Table,
 * Deck, Library, Schematic and chart eyebrows, the Plan's and the Sheet's
 * toolbars, the decision queue's header.
 *
 * The rail folds as items of the shared toolbar (`src/toolbar/`, #952) — one
 * item per CLUSTER. A host lists its clusters: the Plan two (its narrowing
 * affordances, and the range between its segments), every other host one. A
 * cluster's forms run widest first, and the ranks of the steps between them
 * are the rail's order:
 *   - rank 0 — the filter's trailing clause chips fold into `+M more`, one at
 *     a time;
 *   - ranks 1–5 — an affordance collapses into its cluster's summary chips,
 *     in the shared rail's collapse order: search 1, range 2, cohort and presets 3,
 *     breakdown 4, the filter builder 5 — the rest stay live;
 *   - rank 6 — the folded chips merge into one terminal chip that *names its
 *     contents* (`Filter · Search +1`, or `3 filters · EU +1` when narrowing)
 *     — never the bare verb "narrow";
 *   - rank 7 — the icon alone, its tooltip naming the contents.
 * A one-affordance cluster's floor is its summary chip: it has nothing to
 * merge, and an icon would say less than the chip. The toolbar merges these
 * steps with its other items', so the rail folds first, a record rail's
 * summary next ({@link SUMMARY_RANK}; the Filters editor counts each source
 * in its heading, #1358), and a host's own items ({@link HOST_RANK} and up)
 * after it.
 *
 * Every folded chip, the terminal chip and the icon open the sectioned
 * `Slice.Edit` popover (every affordance of the cluster flat, in `editor`
 * density, under its family caption), floating over whatever sits below —
 * the host never changes height. The editor is the terminal surface: nothing
 * folds inside it and nothing opens a further popover. While it is open the
 * cluster is held: the popover hangs from its trigger, so the toolbar keeps
 * the cluster's form and folds the rest of the row around it. A held cluster
 * keeps the forms it had as its editor opened (#1231): a clause added there
 * would put a chip's fold step before the held form, and the form it holds
 * would be another one — the trigger growing under its popover. Its trigger
 * is one button (#1231), named for what it folds.
 */

import { useEffect, memo, type ReactNode } from "react";
import "../record/rail.js";
import { some, none, variant } from "@elaraai/east";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { faFilter, faLayerGroup, faUsers, faMagnifyingGlass, faCalendar, type IconDefinition } from "@fortawesome/free-solid-svg-icons";
import { type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { boundRangeDomain, boundRangeHistogram, enableSlicePersistence } from "../../platform/slice";
import { railAffordanceKinds } from "../rail-kinds.js";
// Function-declaration import across the rail ↔ charts module cycle is safe
// (hoisted; charts/spec imports SliceRailCluster from here the same way).
import { tickFormatter, type TickFormat } from "../../charts/spec/index.js";
import { useFormatters } from "../../format/index.js";
import { BrushStrip } from "../brush-strip.js";
import { useSliceReactivity } from "../use-slice-reactivity";
import { EastChakraSliceFilter } from "../filter";
import { EastChakraSliceSearch } from "../search";
import { EastChakraSliceBreakdown } from "../breakdown";
import { EastChakraSliceRange } from "../range";
import { EastChakraSliceCohort, cohortGroupOf } from "../cohort";
import { EastChakraSliceLegend } from "../legend";
import { Toolbar, type ToolbarItem } from "../../toolbar/index.js";
import { useSliceRailItems, type SliceRailClusterSpec } from "./toolbar.js";
export type { SliceRailClusterSpec } from "./toolbar.js";
export { HOST_RANK, SUMMARY_RANK } from "./ranks.js";

/** The bound slice handle, decoded. */
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;

/** Per-affordance icon + label — section headers in the editor, count chips on the ladder. */
const AFFORDANCE_META: Record<string, { icon: IconDefinition; label: string }> = {
    filter:    { icon: faFilter,          label: "Filter" },
    breakdown: { icon: faLayerGroup,      label: "Split" },
    cohort:    { icon: faUsers,           label: "Cohort" },
    presets:   { icon: faUsers,           label: "Presets" },
    search:    { icon: faMagnifyingGlass, label: "Search" },
    range:     { icon: faCalendar,        label: "Range" },
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
            // Idle, with families: name them (`state · status`) rather than count the whole registry.
            const families = [...new Set(state.cohorts.map(c => cohortGroupOf(c)).filter((g): g is string => g !== undefined))];
            if (families.length > 0) {
                return { kind, icon, text: families.length <= 2 ? families.join(" · ") : `${families.slice(0, 2).join(" · ")} +${families.length - 2}`, active: false };
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

/** Mount the real Slice.* component for one affordance of a cluster. */
function renderAffordance(slice: SliceBindValue, kind: string, i: number, foldChips: number | undefined): ReactNode {
    const v = { slice } as never;
    switch (kind) {
        case "filter":    return <EastChakraSliceFilter key={`af-${i}`} value={v} foldChips={foldChips} />;
        case "breakdown": return <EastChakraSliceBreakdown key={`af-${i}`} value={v} />;
        case "cohort":    return <EastChakraSliceCohort key={`af-${i}`} value={v} />;
        // Curated preset bar (#163) — Slice.Cohort pinned to toggle mode.
        case "presets":   return <EastChakraSliceCohort key={`af-${i}`} value={{ slice, mode: some(variant("toggle", null)) } as never} />;
        case "search":    return <EastChakraSliceSearch key={`af-${i}`} value={v} />;
        case "range":     return <EastChakraSliceRange key={`af-${i}`} value={v} />;
        default:          return null;
    }
}

/**
 * The rail's clusters as items of the shared toolbar (#952): each cluster's
 * forms, widest first, and the ranks of the steps between them, in the
 * rail's order (see the module doc). A cluster with nothing to mount is left
 * out. Each item carries the slice's version, so a narrowing that changes
 * what the rail shows has its forms measured again; and the cluster whose
 * editor is open is held.
 *
 * @param slice - The bound slice handle (undefined ⇒ no items)
 * @param clusters - The clusters, in the order the host lays them out
 * @returns One toolbar item per cluster
 */
export function useSliceToolbarItems(slice: SliceBindValue | undefined, clusters: ReadonlyArray<SliceRailClusterSpec>): ToolbarItem[] {
    const version = useSliceReactivity(slice?.key);
    const state = slice?.read();
    const dimensions = slice?.dimensions() ?? [];
    return useSliceRailItems(slice === undefined || state === undefined ? undefined : {
        version,
        activeCount: activeNarrowingCount(state),
        filterChips: state.filters.length,
        describe: kind => ({ ...affordanceDescriptor(kind, state, dimensions), label: AFFORDANCE_META[kind]?.label ?? kind }),
        render: (kind, i, foldChips) => renderAffordance(slice, kind, i, foldChips),
    }, clusters);
}

export interface SliceRailClusterProps {
    /** The bound slice closure struct (decoded `Slice.bind` handle). */
    slice: SliceBindValue;
    /** Affordance kinds to mount, in order (`"filter"`, `"search"`, …). */
    affordanceKinds: ReadonlyArray<string>;
    /** Where the chips sit in a row wider than they are: at its start (the
     *  default), or hugging its end — a toolbar's trailing cluster. */
    align?: "start" | "end" | undefined;
}

/**
 * The rail as a toolbar of its own — for hosts whose header holds just the
 * rail (the Table, Deck, Library, Schematic and chart eyebrows, the decision
 * queue, `Slice.Rail`). A host with more chrome than the rail (the Plan, the
 * Sheet) lays the rail's clusters out as items of its own toolbar
 * ({@link useSliceToolbarItems}), so its whole row folds on one ladder.
 */
export function SliceRailCluster({ slice, affordanceKinds, align = "start" }: SliceRailClusterProps) {
    const items = useSliceToolbarItems(slice, [{ key: "rail", kinds: affordanceKinds, side: align }]);
    return <Toolbar items={items} />;
}

/** East Slice.Rail value type. */
export type SliceRailValue = ValueTypeOf<typeof Slice.Types.Rail>;

export interface EastChakraSliceRailProps {
    value: SliceRailValue;
}

/** Resolved brush-strip presentation (#190) — rich by default. */
interface BrushStyle { axis: boolean; count: boolean; buckets: number; }

/** Default histogram resolution. */
const BRUSH_BUCKETS = 32;

/**
 * A range's bounds on the brush domain's own numbers — epoch ms for a
 * datetime, the value for an integer or a float — read off the range's arm.
 * `undefined` for a preset, which has no literal bounds, and for an arm that
 * is not the range field's kind: the engine leaves such a range inert, so it
 * draws no window.
 *
 * @param range - The applied range
 * @param kind - The range field's kind ({@link boundRangeDomain})
 * @returns The window's bounds, or `undefined` when it has none to draw
 */
export function rangeBounds(range: ValueTypeOf<typeof Slice.Types.Range>, kind: "datetime" | "integer" | "float"): { from: number; to: number } | undefined {
    if (range.type !== kind) return undefined;
    switch (range.type) {
        case "datetime": return { from: range.value.from.getTime(), to: range.value.to.getTime() };
        case "integer":  return { from: Number(range.value.from), to: Number(range.value.to) };
        case "float":    return { from: range.value.from, to: range.value.to };
        default:         return undefined;
    }
}

/**
 * The range a brushed window writes, in the arm of the range field's kind — a
 * datetime window as its instants, an integer window widened to the whole
 * Integers it spans, a float window as it is. The inverse of
 * {@link rangeBounds}: an arm of another kind would be inert in the engine,
 * which reads a range only in its field's own kind (#167).
 *
 * @param kind - The range field's kind
 * @param lo - The window's lower bound, on the domain's own numbers
 * @param hi - The window's upper bound
 * @returns The range to set
 */
export function rangeOfWindow(kind: "datetime" | "integer" | "float", lo: number, hi: number): ValueTypeOf<typeof Slice.Types.Range> {
    switch (kind) {
        case "datetime": return variant("datetime", { from: new Date(lo), to: new Date(hi) });
        case "integer":  return variant("integer", { from: BigInt(Math.floor(lo)), to: BigInt(Math.ceil(hi)) });
        case "float":    return variant("float", { from: lo, to: hi });
    }
}

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
    // The axis labels, in the app's locale (#850).
    const { locale } = useFormatters();
    const domain = boundRangeDomain(slice.key);
    if (domain === undefined || domain.max <= domain.min) return null;

    const span = domain.max - domain.min;
    // A grabbable window needs literal bounds of the field's kind — a preset
    // has none, so it renders as no window.
    const applied = getSomeorUndefined(slice.read().range);
    const bounds = applied !== undefined ? rangeBounds(applied, domain.kind) : undefined;
    const winFrom = bounds !== undefined ? Math.max(0, (bounds.from - domain.min) / span) : 0;
    const winTo = bounds !== undefined ? Math.min(1, (bounds.to - domain.min) / span) : 1;
    const winValid = bounds !== undefined && Number.isFinite(winFrom) && Number.isFinite(winTo);
    const fromFraction = (f: number) => domain.min + Math.max(0, Math.min(1, f)) * span;

    // Density histogram (#190) — self-excluding row counts per bucket,
    // max-normalised for bar heights. Empty/flat data renders no bars.
    const counts = style.count ? boundRangeHistogram(slice.key, style.buckets) : undefined;

    // Formatted axis labels (#190) — the range field's declared `format`
    // wins; else the kind default (datetime → a UTC date, numeric → number).
    const rangeFieldId = getSomeorUndefined(slice.rangeFieldId());
    const fieldFormat: TickFormat | undefined = rangeFieldId !== undefined
        ? getSomeorUndefined(slice.fields().find(f => f.fieldId === rangeFieldId)?.format)
        : undefined;
    const fmt = tickFormatter(fieldFormat, domain.kind === "datetime" ? "time" : "linear", locale);
    const axisLabel = (f: number) => {
        const v = fromFraction(f);
        return fmt(domain.kind === "datetime" ? new Date(v) : v);
    };
    const commit = (fromFrac: number, toFrac: number) => {
        // The arm matches the range field's TRUE kind (#167).
        slice.setRange(some(rangeOfWindow(domain.kind, fromFraction(fromFrac), fromFraction(toFrac))));
    };
    const trackHeight = style.count ? 28 : 18;

    return (
        <Box css={frameStyles.brushStack}>
            <BrushStrip
                counts={counts}
                window={winValid ? { from: winFrom, to: winTo } : undefined}
                height={trackHeight}
                barHeight={trackHeight - 9}
                onCommit={commit}
                onClear={() => slice.setRange(none)}
            />
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
 * Place above components reading `Slice.rows(slice)`; the strip
 * narrows them all. A cohort created via "Save as cohort" appends a cohort
 * affordance even when the author didn't list one (unless a `presets` bar —
 * which is already the cohort surface — is mounted, #319). With `"brush"` listed
 * (and a `rangeFieldId` on the config) a slim brush strip renders beneath
 * the chips — drag a window to set the range.
 */
export const EastChakraSliceRail = memo(function EastChakraSliceRail({ value }: EastChakraSliceRailProps) {
    const styles = useSlotRecipe({ key: "sliceFrame" })();
    const { slice } = value;
    useSliceReactivity(slice.key);
    // Opt-in persistence (#168): hydrate once on mount from the chosen store
    // (localStorage / sessionStorage / URL param), then every mutation
    // debounce-writes back. Keyed by the slice key; registration is once-only.
    const persistMode = getSomeorUndefined(value.persist)?.type;
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
    const brushOpts = getSomeorUndefined(value.brush);
    const buckets = getSomeorUndefined(brushOpts?.buckets);
    const brushStyle: BrushStyle = {
        axis:    getSomeorUndefined(brushOpts?.axis) ?? true,
        count:   getSomeorUndefined(brushOpts?.count) ?? true,
        buckets: buckets !== undefined ? Number(buckets) : BRUSH_BUCKETS,
    };
    return (
        <Box css={styles.railStack}>
            <Box css={styles.railRow}>
                <SliceRailCluster slice={slice} affordanceKinds={affordanceKinds} />
            </Box>
            {brushEnabled && <RailBrushStrip slice={slice} style={brushStyle} />}
            {legendEnabled && <EastChakraSliceLegend value={{ slice } as never} />}
        </Box>
    );
}, () => false);
