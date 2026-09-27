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
 *     in {@link COLLAPSE_RANK} order: search 1, range 2, cohort and presets 3,
 *     breakdown 4, the filter builder 5 — the rest stay live;
 *   - rank 6 — the folded chips merge into one terminal chip that *names its
 *     contents* (`Filter · Search +1`, or `3 filters · EU +1` when narrowing)
 *     — never the bare verb "narrow";
 *   - rank 7 — the icon alone, its tooltip naming the contents.
 * A one-affordance cluster's floor is its summary chip: it has nothing to
 * merge, and an icon would say less than the chip. The toolbar merges these
 * steps with its other items', so the rail folds first and a host's own items
 * ({@link HOST_RANK} and up) after it.
 *
 * Every folded chip, the terminal chip and the icon open the sectioned
 * `Slice.Edit` popover (every affordance of the cluster flat, in `editor`
 * density, under its family caption), floating over whatever sits below —
 * the host never changes height. The editor is the terminal surface: nothing
 * folds inside it and nothing opens a further popover. While it is open the
 * cluster is held: the popover hangs from its trigger, so the toolbar keeps
 * the cluster's form and folds the rest of the row around it.
 */

import { useEffect, useState, memo, type ReactNode } from "react";
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
import { useFormatters } from "../../format/index.js";
import { SliceDensityContext } from "../density";
import { BrushStrip } from "../brush-strip.js";
import { useSliceReactivity } from "../use-slice-reactivity";
import { SliceEditPopover } from "../edit";
import { EastChakraSliceFilter } from "../filter";
import { EastChakraSliceSearch } from "../search";
import { EastChakraSliceBreakdown } from "../breakdown";
import { EastChakraSliceRange } from "../range";
import { EastChakraSliceCohort, cohortGroupOf } from "../cohort";
import { EastChakraSliceLegend } from "../legend";
import { Toolbar, type ToolbarItem } from "../../toolbar/index.js";

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

/** The rail's own fold ranks around {@link COLLAPSE_RANK}: the filter's
 *  clause chips fold first; the merged terminal chip and the icon last. */
const RAIL_RANK = { chips: 0, terminal: 6, icon: 7 } as const;

/** The first rank a host's own toolbar items fold at — after every step of the rail's. */
export const HOST_RANK = 10;

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

/** One cluster of the rail — one item of the shared toolbar. */
export interface SliceRailClusterSpec {
    /** Its key in the toolbar. */
    key: string;
    /** The affordance kinds it holds, in mount order (`"filter"`, `"search"`, …). */
    kinds: ReadonlyArray<string>;
    /** Where it sits in the row: at its start (the default), or in its end cluster. */
    side?: "start" | "end" | undefined;
}

/**
 * One form of a cluster: how many families have folded (in fold order), how
 * many of the filter's clause chips have folded into `+M more`, and how the
 * folded families show — as their summary chips, merged into the terminal
 * chip, or as the icon alone.
 */
interface RailForm {
    folded: number;
    chips: number;
    show: "chips" | "terminal" | "icon";
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
    const styles = useSlotRecipe({ key: "sliceFrame" })();
    const chip = useRecipe({ key: "chip" });
    const btn = useRecipe({ key: "button" });
    // Every slice change can move what the rail shows — the chips, their words.
    const version = useSliceReactivity(slice?.key);
    // The cluster whose sectioned editor is open. The editor is the terminal
    // surface: every affordance of the cluster flat, in `editor` density,
    // complete however far the cluster has folded.
    const [open, setOpen] = useState<string | null>(null);
    if (slice === undefined) return [];

    const state = slice.read();
    const dimensions = typeof slice.dimensions === "function" ? slice.dimensions() : [];
    const activeCount = activeNarrowingCount(state);

    const summaryChip = (key: string, d: AffordanceDescriptor): ReactNode => (
        <Box key={key} as="span" css={chip({ tone: d.active ? "brand" : "neutral", numeric: true })} data-slice-fold={d.kind}>
            <FontAwesomeIcon icon={d.icon} data-chip-icon="" />
            <Box as="span">{d.text}</Box>
        </Box>
    );

    return clusters.filter((cluster) => cluster.kinds.length > 0).map((cluster): ToolbarItem => {
        const kinds = cluster.kinds;
        // Fold order: mount indices, lowest COLLAPSE_RANK first (a kind with
        // no entry folds mid-pack).
        const foldOrder = kinds
            .map((kind, i) => ({ i, rank: COLLAPSE_RANK[kind] ?? 3 }))
            .sort((a, b) => a.rank - b.rank || a.i - b.i);
        const chipCount = kinds.includes("filter") ? state.filters.length : 0;
        const forms: RailForm[] = [{ folded: 0, chips: 0, show: "chips" }];
        const ranks: number[] = [];
        for (let c = 1; c <= chipCount; c++) {
            forms.push({ folded: 0, chips: c, show: "chips" });
            ranks.push(RAIL_RANK.chips);
        }
        foldOrder.forEach((o, k) => {
            forms.push({ folded: k + 1, chips: chipCount, show: "chips" });
            ranks.push(o.rank);
        });
        if (kinds.length > 1) {
            forms.push({ folded: kinds.length, chips: chipCount, show: "terminal" });
            ranks.push(RAIL_RANK.terminal);
            forms.push({ folded: kinds.length, chips: chipCount, show: "icon" });
            ranks.push(RAIL_RANK.icon);
        }

        // What the folded families show: their summary chips in fold order;
        // at the terminal form one chip that NAMES the cluster's contents
        // (active families first, so an engaged narrowing leads); past it the
        // icon alone, its tooltip naming them.
        const trigger = (form: RailForm): ReactNode => {
            if (form.show === "chips") {
                return foldOrder.slice(0, form.folded).map((o) => {
                    const d = affordanceDescriptor(kinds[o.i]!, state, dimensions);
                    return summaryChip(`fold-${d.kind}-${o.i}`, d);
                });
            }
            const descriptors = kinds
                .map((kind, idx) => ({ d: affordanceDescriptor(kind, state, dimensions), idx }))
                .sort((a, b) => (b.d.active ? 1 : 0) - (a.d.active ? 1 : 0) || a.idx - b.idx)
                .map((o) => o.d);
            const labels = descriptors.map((d) => d.text);
            const anyActive = descriptors.some((d) => d.active);
            const icon = descriptors[0]?.icon ?? faFilter;
            if (form.show === "icon") {
                return (
                    <Box key="icon" as="span" css={chip({ tone: anyActive ? "brand" : "neutral", numeric: true })}
                        title={labels.length > 0 ? labels.join(" · ") : "Slice"} data-rail-rung="icon">
                        <FontAwesomeIcon icon={icon} data-chip-icon="" />
                    </Box>
                );
            }
            const head = labels.slice(0, 2).join(" · ");
            const extra = labels.length > 2 ? ` +${labels.length - 2}` : "";
            return summaryChip("all", { kind: "all", icon, text: labels.length > 0 ? head + extra : "Slice", active: anyActive });
        };

        const editor = (form: RailForm): ReactNode => (
            <SliceEditPopover
                open={open === cluster.key}
                onOpenChange={(o) => setOpen(o ? cluster.key : null)}
                label={<>Narrowing · <Box as="span" css={styles.railActiveCount}>{`${activeCount} active`}</Box></>}
                size="lg"
                footActions={
                    <chakra.button type="button" css={btn({ variant: "solid", size: "xs" })} onClick={() => setOpen(null)}>
                        Done
                    </chakra.button>
                }
                trigger={
                    <Box css={styles.railTrigger} data-slot="railTrigger" onClick={() => setOpen(cluster.key)}>
                        {trigger(form)}
                        <FontAwesomeIcon icon={faChevronDown} data-rail-caret="" />
                    </Box>
                }
            >
                <SliceDensityContext.Provider value="editor">
                    <Box css={styles.railSections}>
                        {kinds.map((kind, i) => (
                            <Box key={`sec-${kind}-${i}`} css={styles.railSection}>
                                <Box as="span" css={styles.railSectionCaption}>{AFFORDANCE_META[kind]?.label ?? kind}</Box>
                                <Box css={styles.railSectionBody}>{renderAffordance(slice, kind, i, undefined)}</Box>
                            </Box>
                        ))}
                    </Box>
                </SliceDensityContext.Provider>
            </SliceEditPopover>
        );

        // One form: the live affordances in mount order — the filter showing
        // the chips this form leaves it — then the folded families' trigger.
        const render = (form: RailForm): ReactNode => {
            const collapsed = new Set(foldOrder.slice(0, form.folded).map((o) => o.i));
            return (
                <SliceDensityContext.Provider value="compact">
                    <Box css={styles.railCluster} data-slice-rail={cluster.key}>
                        {kinds.map((kind, i) => {
                            if (collapsed.has(i)) return null;
                            const meta = AFFORDANCE_META[kind];
                            return (
                                <Box key={`af-${kind}-${i}`} css={styles.railAffordance} title={meta?.label}>
                                    <Box as="span" css={styles.frameAffordanceIcon}>
                                        {meta !== undefined && <FontAwesomeIcon icon={meta.icon} />}
                                    </Box>
                                    {renderAffordance(slice, kind, i, kind === "filter" ? form.chips : undefined)}
                                </Box>
                            );
                        })}
                        {form.folded > 0 && editor(form)}
                    </Box>
                </SliceDensityContext.Provider>
            );
        };

        return {
            key: cluster.key,
            side: cluster.side,
            forms: forms.map(render),
            rank: ranks,
            version,
            held: open === cluster.key,
        };
    });
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
    // The axis labels, in the app's locale (#850).
    const { locale } = useFormatters();
    const domain = boundRangeDomain(slice.key);
    if (domain === undefined || domain.max <= domain.min) return null;

    const span = domain.max - domain.min;
    const applied = getSomeorUndefined(slice.read().range) as
        { type: string; value: { from: Date | number; to: Date | number } } | undefined;
    const toMs = (v: Date | number) => (v instanceof Date ? v.getTime() : Number(v));
    const winFrom = applied !== undefined ? Math.max(0, (toMs(applied.value.from) - domain.min) / span) : 0;
    const winTo = applied !== undefined ? Math.min(1, (toMs(applied.value.to) - domain.min) / span) : 1;
    // A grabbable window needs literal bounds — a `datetimePreset` arm has
    // none (its fractions come out NaN), so it renders as no window.
    const winValid = applied !== undefined && Number.isFinite(winFrom) && Number.isFinite(winTo);
    const fromFraction = (f: number) => domain.min + Math.max(0, Math.min(1, f)) * span;

    // Density histogram (#190) — self-excluding row counts per bucket,
    // max-normalised for bar heights. Empty/flat data renders no bars.
    const counts = style.count ? boundRangeHistogram(slice.key, style.buckets) : undefined;

    // Formatted axis labels (#190) — the range field's declared `format`
    // wins; else the kind default (datetime → a UTC date, numeric → number).
    const rangeFieldId = (getSomeorUndefined(slice.rangeFieldId() as never) ?? undefined) as string | undefined;
    const fieldFormat = rangeFieldId !== undefined
        ? getSomeorUndefined((slice.fields().find(f => f.fieldId === rangeFieldId) as { format?: never } | undefined)?.format as never) as TickFormat | undefined
        : undefined;
    const fmt = tickFormatter(fieldFormat, domain.kind === "datetime" ? "time" : "linear", locale);
    const axisLabel = (f: number) => {
        const v = fromFraction(f);
        return fmt(domain.kind === "datetime" ? new Date(v) : v);
    };
    const commit = (fromFrac: number, toFrac: number) => {
        const lo = fromFraction(fromFrac);
        const hi = fromFraction(toFrac);
        // The arm must match the range field's TRUE kind — an Integer field
        // needs bigint bounds or the range is inert (isValueOf guard, #167).
        slice.setRange(some(domain.kind === "datetime"
            ? variant("datetime", { from: new Date(lo), to: new Date(hi) })
            : domain.kind === "integer"
                ? variant("integer", { from: BigInt(Math.floor(lo)), to: BigInt(Math.ceil(hi)) })
                : variant("float", { from: lo, to: hi })));
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
 * Place above components reading `Slice.rows([RowType], slice)`; the strip
 * narrows them all. A cohort created via "Save as cohort" appends a cohort
 * affordance even when the author didn't list one (unless a `presets` bar —
 * which is already the cohort surface — is mounted, #319). With `"brush"` listed
 * (and a `rangeFieldId` on the config) a slim brush strip renders beneath
 * the chips — drag a window to set the range.
 */
export const EastChakraSliceRail = memo(function EastChakraSliceRail({ value }: EastChakraSliceRailProps) {
    const styles = useSlotRecipe({ key: "sliceFrame" })();
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
        <Box css={styles.railStack}>
            <Box css={styles.railRow}>
                <SliceRailCluster slice={slice} affordanceKinds={affordanceKinds} />
            </Box>
            {brushEnabled && <RailBrushStrip slice={slice} style={brushStyle} />}
            {legendEnabled && <EastChakraSliceLegend value={{ slice } as never} />}
        </Box>
    );
}, () => false);
