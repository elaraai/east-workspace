/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan toolbar (44px, `Plan Spec.html` §1) — slice chrome + the
 * resolution segment. Slice affordances mount through the shared
 * `SliceRailCluster` (the rail's measured ladder, verbatim); `resolution`
 * renders the WEEK/DAY `seg` strip (a slice write via the machine), `summary`
 * the right-edge `N of M · narrowings` line.
 */

import { useMemo, useState } from "react";
import { Box, chakra, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLayerGroup } from "@fortawesome/free-solid-svg-icons";
import { type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { SliceRailCluster } from "../../../slice/rail/index.js";
import { railAffordanceKinds } from "../../../slice/rail-kinds.js";
import { usePlanDispatch } from "../context.js";
import { DatasetKeySearch } from "../../key-search/index.js";
import { SliceEditPopover } from "../../../slice/edit/index.js";
import { EastChakraPickPanel } from "../../../pick/panel/index.js";
import { transportLabel, type PlanTransport } from "./transport.js";
import type { PlanSearch } from "../use-seek.js";

/** Narrowing affordances whose meaning CHANGES on a paged canvas: they narrow
 *  whatever the host fed, which is the prefix that happened to land. `search`
 *  is here only for a source that cannot seek — where it can, `search` is
 *  replaced outright by the key search rather than badged. */
const NARROWING_KINDS = new Set(["filter", "cohort", "presets", "breakdown", "search"]);

type Styles = Record<string, Record<string, unknown>>;
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;

/** The compact chrome segment strip (`seg` recipe). */
export function Seg({ items, active, onPick }: {
    items: ReadonlyArray<{ key: string; label: string }>;
    active: string;
    onPick: (key: string) => void;
}) {
    const seg = useSlotRecipe({ key: "seg" });
    const ss = useMemo(() => seg({}) as unknown as Styles, [seg]);
    return (
        <Box css={ss.root} data-slot="seg">
            {items.map((it) => (
                <Box key={it.key} as="button" css={ss.item} data-state={it.key === active ? "on" : undefined}
                    onClick={() => onPick(it.key)}>
                    {it.label}
                </Box>
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
    /** Paged transport state — omitted on an inline canvas. */
    transport?: PlanTransport | undefined;
    /** Key search over the source — mounted IN PLACE of the slice `search`
     *  affordance when the paged source declares `seek` (#574). */
    search?: PlanSearch | undefined;
    /** The bound series library (#590) — mounts the right-edge Series button,
     *  which opens the library in the shared slice-editor popover. */
    pick?: unknown;
}

/** The 44px toolbar band. */
export function PlanToolbar({ styles, slice, affordances, resolution, resolutions, transport, search, pick }: PlanToolbarProps) {
    const dispatch = usePlanDispatch();
    const btn = useRecipe({ key: "button" });
    const [libraryOpen, setLibraryOpen] = useState(false);
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
        [affordances, slice, search],
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
        if (transport !== undefined) return transportLabel(transport);
        const total = Number(slice.totalCount());
        const result = Number(slice.resultCount());
        const active = Number(slice.activeCount());
        return `${result} of ${total}${active > 0 ? ` · ${active} narrowing${active > 1 ? "s" : ""}` : ""}`;
    }, [showSummary, slice, transport]);

    return (
        <Box css={styles.toolbar} data-slot="toolbar">
            {slice !== undefined && clusterKinds.length > 0 && (
                <SliceRailCluster slice={slice} affordanceKinds={clusterKinds} />
            )}
            {scoped && (
                <Box css={styles.footerItem} data-slot="scopeBadge">loaded rows only</Box>
            )}
            {search !== undefined && (
                <DatasetKeySearch keyType={search.keyType} onFind={search.find}
                    onListRange={search.listRange} onJump={search.jump} onClear={search.clear} />
            )}
            <Box css={styles.toolbarGroup}>
                {slice !== undefined && rangeKinds.length > 0 && (
                    <SliceRailCluster slice={slice} affordanceKinds={rangeKinds} />
                )}
                {resolutions.length > 0 && (
                    <Seg
                        items={resolutions.map((r) => ({ key: r, label: r.toUpperCase() }))}
                        active={resolution}
                        onPick={(r) => dispatch({ t: "resolution.set", resolution: r })}
                    />
                )}
            </Box>
            {/* The right edge: the summary line, then the library button. Both
                are trailing chrome, so they share one auto-margined group
                rather than each claiming `marginLeft: auto` and fighting. */}
            {(summary !== undefined || pick !== undefined) && (
                <Box css={styles.toolbarGroup} marginLeft="auto">
                    {summary !== undefined && (
                        <Box css={styles.footerItem} data-slot="toolbarSummary">{summary}</Box>
                    )}
                    {pick !== undefined && (
                        <PlanLibraryButton pick={pick} open={libraryOpen} onOpenChange={setLibraryOpen} btn={btn} />
                    )}
                </Box>
            )}
        </Box>
    );
}

/** One pickable thing, as the panel reads it — enough to count what is shown. */
type PickItemLike = { id: string };
type PickBindLike = { items: ReadonlyArray<PickItemLike>; state: { read: () => string[] } };

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
 * The count rides the popover's head, not the panel's — the popover brings its
 * own heading, and two of them saying the same thing is why the panel has a
 * frameless mode.
 */
function PlanLibraryButton({ pick, open, onOpenChange, btn }: {
    pick: unknown;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    btn: ReturnType<typeof useRecipe>;
}) {
    const bind = pick as PickBindLike;
    const hidden = new Set(bind.state.read());
    const shown = bind.items.filter((i) => !hidden.has(i.id)).length;
    return (
        <SliceEditPopover
            open={open}
            onOpenChange={onOpenChange}
            size="lg"
            label={<>Series · <Box as="span" color="{colors.brand.700}" fontWeight="700">{`${shown} of ${bind.items.length}`}</Box></>}
            trigger={
                <chakra.button type="button" css={btn({ variant: "ghost", size: "xs" })}
                    data-slot="planLibraryTrigger" aria-label="Series library" aria-expanded={open}>
                    <FontAwesomeIcon icon={faLayerGroup} style={{ fontSize: "11px" }} />
                    <Box as="span">Series</Box>
                </chakra.button>
            }
        >
            <EastChakraPickPanel value={{ pick, title: "Series" } as never} bare />
        </SliceEditPopover>
    );
}
