/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan toolbar (44px, `Plan Spec.html` §1) — slice chrome and the grain
 * and resolution segments. Slice affordances mount through the shared
 * `SliceRailCluster` (the rail's measured ladder, verbatim); `resolution`
 * renders the WEEK/DAY `seg` strip (a slice write via the machine), `summary`
 * the right-edge `N of M · narrowings` line. The GROUP · RESOURCE strip is
 * the canvas's own (#632): a canvas with a root group mounts it, slice or no
 * slice, between the search and the range — where the §1 mock puts it.
 */

import { useMemo, useState, type KeyboardEvent } from "react";
import { Box, chakra, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLayerGroup } from "@fortawesome/free-solid-svg-icons";
import { type ValueTypeOf } from "@elaraai/east";
import { Pick, Slice } from "@elaraai/east-ui/internal";
import { SliceRailCluster } from "../../../slice/rail/index.js";
import { railAffordanceKinds } from "../../../slice/rail-kinds.js";
import { useSliceReactivity } from "../../../slice/use-slice-reactivity.js";
import { usePlanDispatch } from "../context.js";
import { PLAN_GRAINS, type PlanGrain } from "../plan-state.js";
import { DatasetKeySearch } from "../../key-search/index.js";
import { SliceEditPopover } from "../../../slice/edit/index.js";
import { EastChakraPickPanel } from "../../../pick/panel/index.js";
import { SliceDensityContext } from "../../../slice/density.js";
import { transportLabel, type PlanTransport } from "./transport.js";
import { usePlanWords } from "../words.js";
import { PlanDiagnosticChips, hasDiagnostics, type PlanDiagnostics } from "./Diagnostics.js";
import type { PlanSearch } from "../use-seek.js";

/** Narrowing affordances whose meaning CHANGES on a paged canvas: they narrow
 *  whatever the host fed, which is the prefix that happened to land. `search`
 *  is here only for a source that cannot seek — where it can, `search` is
 *  replaced outright by the key search rather than badged. */
const NARROWING_KINDS = new Set(["filter", "cohort", "presets", "breakdown", "search"]);

type Styles = Record<string, Record<string, unknown>>;
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;
/** The decoded pick bind — DERIVED from the East type, never mirrored (#617). */
type PickBindValue = ValueTypeOf<typeof Pick.Types.Bind>;

/**
 * The compact chrome segment strip (`seg` recipe) — a radio group (#632).
 * It is ONE tab stop, on the checked segment (the first while none is);
 * ← / → and Home / End move between the segments and pick the one they land
 * on, as the WAI-ARIA radio group pattern has it, and a click, Enter or Space
 * picks the one it is on.
 */
export function Seg<K extends string>({ label, name, items, active, onPick }: {
    /** What the strip picks — its radio group's accessible name. */
    label: string;
    /** Which strip it is, as `data-plan-seg` says. */
    name: string;
    /** The segments, in order. */
    items: ReadonlyArray<{ key: K; label: string }>;
    /** The checked segment's key — any other string checks none. */
    active: string;
    /** Picks a segment. */
    onPick: (key: K) => void;
}) {
    const seg = useSlotRecipe({ key: "seg" });
    const ss = useMemo(() => seg({}) as unknown as Styles, [seg]);
    const stop = items.some((it) => it.key === active) ? active : items[0]?.key;
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const radios = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[role='radio']"));
        const i = radios.indexOf(e.target as HTMLElement);
        if (i < 0) return;
        const last = radios.length - 1;
        let j: number;
        switch (e.key) {
            case "ArrowRight": case "ArrowDown": j = i === last ? 0 : i + 1; break;
            case "ArrowLeft": case "ArrowUp": j = i === 0 ? last : i - 1; break;
            case "Home": j = 0; break;
            case "End": j = last; break;
            default: return;
        }
        // Handled: the page does not scroll, and the canvas's own keys skip it.
        e.preventDefault();
        radios[j]!.focus();
        const it = items[j];
        if (it !== undefined && it.key !== active) onPick(it.key);
    };
    return (
        <Box css={ss.root} data-slot="seg" data-plan-seg={name} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
            {items.map((it) => (
                <chakra.button key={it.key} type="button" css={ss.item} role="radio"
                    aria-checked={it.key === active} tabIndex={it.key === stop ? 0 : -1}
                    data-state={it.key === active ? "on" : undefined}
                    onClick={() => onPick(it.key)}>
                    {it.label}
                </chakra.button>
            ))}
        </Box>
    );
}

export interface PlanToolbarProps {
    styles: Styles;
    /** The bound slice handle (undefined ⇒ segments only). */
    slice: SliceBindValue | undefined;
    /** The toolbar affordance kinds, in order (decoded `SliceChromeType`). */
    affordances: ReadonlyArray<string>;
    resolution: string;
    /** The resolution segment options (`[]` ⇒ no segment). */
    resolutions: ReadonlyArray<string>;
    /** The active grain, when the canvas has a root group for it to fold —
     *  it mounts the GROUP · RESOURCE segment (#632). Absent on a canvas with
     *  no root group, where the grain changes nothing. */
    grain?: PlanGrain | undefined;
    /** Paged transport state — omitted on an inline canvas. */
    transport?: PlanTransport | undefined;
    /** Key search over the source — mounted IN PLACE of the slice `search`
     *  affordance when the paged source declares `seek` (#574). */
    search?: PlanSearch | undefined;
    /** The bound series library (#590) — mounts the right-edge Series button,
     *  which opens the library in the shared slice-editor popover. */
    pick?: PickBindValue | undefined;
    /** The canvas's local failures, as chips (#811) — skipped rows, a source
     *  or search failure, a truncated axis. */
    diagnostics?: PlanDiagnostics | undefined;
}

/** The 44px toolbar band. */
export function PlanToolbar({ styles, slice, affordances, resolution, resolutions, grain, transport, search, pick, diagnostics }: PlanToolbarProps) {
    const dispatch = usePlanDispatch();
    const words = usePlanWords();
    // The segments' strips — every grain and resolution, by its name (#820).
    const grainItems = useMemo(
        () => PLAN_GRAINS.map((g) => ({ key: g, label: words.m.grainName({ grain: g }) })),
        [words]);
    const resolutionItems = useMemo(
        () => resolutions.map((r) => ({ key: r, label: words.m.resolutionName({ resolution: r }) })),
        [resolutions, words]);
    const btn = useRecipe({ key: "button" });
    const [libraryOpen, setLibraryOpen] = useState(false);
    // Self-subscribe on the slice key (#611): a store write does not change
    // any prop identity here, so a memo over STORE READS must key on the
    // store's own version — a re-render alone never busts a memo whose deps
    // did not move. This is what keeps the cohort chip, the summary counts
    // and the scope badge honest on a chrome-only bound slice, where a state
    // change re-derives no rows.
    const sliceVersion = useSliceReactivity(slice?.key);
    // Rail-cluster affordances (the Table adopter pattern): route the listed
    // kinds through `railAffordanceKinds` (auto-appended cohort etc.), then
    // drop the kinds that mount as Plan chrome bands rather than rail chips —
    // `brush` (the horizon strip), `legend`, and the Plan's two new arms
    // (`resolution` segment, `summary` count line). `range` splits into its
    // own cluster so the §2 zone order holds: [cohort · filter · search]
    // [range] [resolution] [summary].
    // A seek-capable paged source replaces `search` entirely: filtering the
    // loaded prefix and seeking the whole source are different operations, and
    // mounting both would offer the same word for both meanings.
    const railKinds = useMemo(
        () => (slice === undefined ? [] : railAffordanceKinds(affordances, slice.read())
            .filter((k) => k !== "brush" && k !== "legend" && k !== "resolution" && k !== "summary")
            .filter((k) => !(k === "search" && search !== undefined))),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sliceVersion IS the dependency of `slice.read()`: the auto-injected cohort chip appears when the STORE moves, not when a prop does (#611)
        [affordances, slice, search, sliceVersion],
    );
    const clusterKinds = useMemo(() => railKinds.filter((k) => k !== "range"), [railKinds]);
    const rangeKinds = useMemo(() => railKinds.filter((k) => k === "range"), [railKinds]);
    // A narrowing affordance on a paged canvas reports over the LOADED prefix
    // while looking like it reports over the whole source — so say so, rather
    // than removing a capability the user can still use on what has landed.
    const scoped = transport !== undefined && clusterKinds.some((k) => NARROWING_KINDS.has(k));
    const showSummary = slice !== undefined && affordances.includes("summary");
    const summary = useMemo(() => {
        if (!showSummary || slice === undefined) return undefined;
        // `N of M matching` counts what the slice narrowed. On a paged canvas
        // that M is the prefix, not the source, so the honest count is the
        // transport's — in ELEMENTS (#567 D9).
        if (transport !== undefined) return transportLabel(transport, words);
        const total = Number(slice.totalCount());
        const result = Number(slice.resultCount());
        const active = Number(slice.activeCount());
        return words.m.summary({
            result: words.number(result), total: words.number(total), n: active, active: words.number(active),
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sliceVersion IS the dependency of the count reads: they move with the STORE, not with any prop (#611)
    }, [showSummary, slice, transport, sliceVersion, words]);

    return (
        <Box css={styles.toolbar} data-slot="toolbar">
            {/* The cluster folds all the way to its icon; this floor is that
                icon's width, so the fixed groups beside it never crush it. */}
            {slice !== undefined && clusterKinds.length > 0 && (
                <Box display="flex" flex="1 1 0" minWidth="min(100%, 52px)" data-slot="toolbarCluster">
                    <SliceRailCluster slice={slice} affordanceKinds={clusterKinds} />
                </Box>
            )}
            {scoped && (
                <Box css={styles.footerItem} data-slot="scopeBadge">{words.m.scopeBadge()}</Box>
            )}
            {search !== undefined && (
                <DatasetKeySearch keyType={search.keyType} onFind={search.find}
                    onListRange={search.listRange} onJump={search.jump} onClear={search.clear} />
            )}
            <Box css={styles.toolbarGroup}>
                {/* The grain is canvas state, not a slice write: the segment
                    drives the same `grain.set` the `g` key does, bound slice
                    or not. It leads the group — after the search, before the
                    range, where the §1 mock puts it. */}
                {grain !== undefined && (
                    <Seg label={words.m.grainLabel()} name="grain" items={grainItems} active={grain}
                        onPick={(g) => dispatch({ t: "grain.set", grain: g })} />
                )}
                {slice !== undefined && rangeKinds.length > 0 && (
                    <SliceRailCluster slice={slice} affordanceKinds={rangeKinds} />
                )}
                {/* The segment is a SLICE write (`slice.setResolution`) —
                    without a bound slice the effect runner drops it, so
                    mounting it would offer a control that does nothing. The
                    unbound-canvas fallback story is #572's (resolution
                    persist fallback); until then, no slice ⇒ no segment. */}
                {slice !== undefined && resolutions.length > 0 && (
                    <Seg
                        label={words.m.resolutionLabel()}
                        name="resolution"
                        items={resolutionItems}
                        active={resolution}
                        onPick={(r) => dispatch({ t: "resolution.set", resolution: r })}
                    />
                )}
            </Box>
            {hasDiagnostics(diagnostics) && <PlanDiagnosticChips diagnostics={diagnostics} styles={styles} />}
            {/* The right edge: the summary line, then the library button. Both
                are trailing chrome, so they share one auto-margined group
                rather than each claiming `marginLeft: auto` and fighting. */}
            {(summary !== undefined || pick !== undefined) && (
                <Box css={styles.toolbarTrailing} data-slot="toolbarTrailing">
                    {summary !== undefined && (
                        <Box css={styles.footerItem} data-slot="toolbarSummary">{summary}</Box>
                    )}
                    {pick !== undefined && (
                        <PlanLibraryButton pick={pick} open={libraryOpen} onOpenChange={setLibraryOpen}
                            btn={btn} styles={styles} />
                    )}
                </Box>
            )}
        </Box>
    );
}

/**
 * The right-edge **Series** button — the library's only chrome at rest.
 *
 * @remarks
 * A docked panel costs 320px of canvas on every Plan that has one, forever,
 * whether or not anyone is picking. A trigger costs a button. It opens into
 * `SliceEditPopover`, the single overlay shape every compact slice affordance
 * already uses, so the library reads as one more piece of the same toolbar
 * rather than a surface of its own.
 *
 * The count rides the popover's head, not the panel's. The panel drops its own
 * frame because the popover provides `editor` density — the house mechanism for
 * "you are inside the terminal surface now", the same one `Slice.Rail` uses
 * around its editor content and `SliceEditPopover` reads to decide whether to
 * nest. No per-call flag.
 */
function PlanLibraryButton({ pick, open, onOpenChange, btn, styles }: {
    pick: PickBindValue;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    btn: ReturnType<typeof useRecipe>;
    styles: Styles;
}) {
    // Self-subscribe on the pick's store key — `PickBindType.key` exists for
    // exactly this ("renderers self-subscribe on it"). Without it, a toggle
    // that changes no rows (a zero-row series) re-renders nothing, and the
    // per-render read below never runs again (#611).
    useSliceReactivity(pick.key);
    const words = usePlanWords();
    const hidden = new Set(pick.state.read());
    const shown = pick.items.filter((i) => !hidden.has(i.id)).length;
    const series = words.m.seriesButton();
    return (
        <SliceEditPopover
            open={open}
            onOpenChange={onOpenChange}
            size="lg"
            flush
            label={<>{series} · <Box as="span" css={styles.toolbarLibraryCount}>
                {words.m.seriesCount({ shown: words.number(shown), total: words.number(pick.items.length) })}
            </Box></>}
            trigger={
                <chakra.button type="button" css={btn({ variant: "ghost", size: "xs" })}
                    data-slot="planLibraryTrigger" aria-label={words.m.seriesLibrary()} aria-expanded={open}>
                    <FontAwesomeIcon icon={faLayerGroup} style={{ fontSize: "11px" }} />
                    <Box as="span">{series}</Box>
                </chakra.button>
            }
        >
            <SliceDensityContext.Provider value="editor">
                <EastChakraPickPanel value={{ pick, title: series }} />
            </SliceDensityContext.Provider>
        </SliceEditPopover>
    );
}
