/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Shared Slice rail presentation: local and record adapters use one ladder. */
import { useState, type ReactNode } from "react";
import { Accordion, Box, chakra, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFilter, faChevronDown, type IconDefinition } from "@fortawesome/free-solid-svg-icons";
import type { ToolbarItem } from "../../toolbar/index.js";
import { SliceDensityContext } from "../density.js";
import { SliceEditPopover } from "../edit/index.js";
import { SliceClearButton } from "../choice.js";

/** One affordance's display, independent of its query engine. */
export interface SliceRailDescriptor {
    kind: string;
    icon: IconDefinition;
    label: string;
    text: string;
    active: boolean;
    /** Optional position in the shared ladder; host items still fold after it. */
    rank?: number;
}

/** Presentation callbacks supplied by a local or record Slice adapter. */
export interface SliceRailModel {
    /** The version that invalidates measured forms. */
    version: unknown;
    activeCount: number;
    /** Only the local predicate builder has separately folding clause chips. */
    filterChips?: number;
    describe: (kind: string) => SliceRailDescriptor;
    render: (kind: string, index: number, foldChips: number | undefined) => ReactNode;
    /** Direct editor bodies use one shared accordion, without nested field triggers. */
    renderEditor?: (kind: string) => ReactNode;
    clear?: () => void;
    /** Complete status retained inside the editor when its toolbar item folds away. */
    status?: ReactNode;
}

/** One field heading, one open editor; Chakra owns keyboard and disclosure semantics. */
function RailSections({ model, kinds }: { model: SliceRailModel; kinds: readonly string[] }) {
    const styles = useSlotRecipe({ key: "sliceFrame" })();
    const chip = useRecipe({ key: "chip" });
    const [expanded, setExpanded] = useState<string[]>([]);
    return <Accordion.Root css={styles.railAccordion} collapsible value={expanded}
        onValueChange={details => setExpanded(details.value)} lazyMount unmountOnExit>
        {kinds.map(kind => {
            const field = model.describe(kind);
            const label = field.active ? field.text : field.label;
            return <Accordion.Item key={kind} value={kind} data-slice-section={kind}>
                <Accordion.ItemTrigger css={styles.railAccordionTrigger} title={label}
                    {...(kind.startsWith("field:") ? { "data-record-slice-field": kind.slice(6) } : {})}>
                    <Accordion.ItemIndicator><FontAwesomeIcon icon={faChevronDown} /></Accordion.ItemIndicator>
                    <Box as="span" css={styles.railAccordionLabel} data-active={field.active ? "" : undefined}>{label}</Box>
                    {field.active && <Box as="span" css={[chip({ tone: "brand", caps: true, size: "sm" }), styles.railAccordionState]}>
                        {kind === "presets" ? "Selected" : "Applied"}
                    </Box>}
                </Accordion.ItemTrigger>
                <Accordion.ItemContent css={styles.railAccordionContent}>
                    {model.renderEditor?.(kind)}
                </Accordion.ItemContent>
            </Accordion.Item>;
        })}
    </Accordion.Root>;
}

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

/**
 * Build one shared-toolbar item per Slice cluster. The adapters own data and
 * control actions; this hook owns folding, held anchors and editor density.
 * @param model - Display callbacks; undefined means no controls.
 * @param clusters - Affordances in each host cluster.
 * @returns Items for the host's one Toolbar.
 */
export function useSliceRailItems(model: SliceRailModel | undefined, clusters: ReadonlyArray<SliceRailClusterSpec>): ToolbarItem[] {
    const styles = useSlotRecipe({ key: "sliceFrame" })();
    const chip = useRecipe({ key: "chip" });
    const btn = useRecipe({ key: "button" });
    // Every slice change can move what the rail shows — the chips, their words.
    // The cluster whose sectioned editor is open, and how many clause chips
    // its filter had as it opened: its forms keep that many chip steps while
    // it is held (#1231). The editor is the terminal surface: every affordance
    // of the cluster flat, in `editor` density, complete however far the
    // cluster has folded.
    const [open, setOpen] = useState<{ key: string; chips: number } | null>(null);
    if (model === undefined) return [];
    const { version, activeCount } = model;

    const summaryChip = (key: string, d: SliceRailDescriptor): ReactNode => (
        <Box key={key} as="span" css={chip({ tone: d.active ? "brand" : "neutral", numeric: true })} data-slice-fold={d.kind}>
            <FontAwesomeIcon icon={d.icon} data-chip-icon="" />
            <Box as="span">{d.label}</Box>
        </Box>
    );

    return clusters.filter((cluster) => cluster.kinds.length > 0).map((cluster): ToolbarItem => {
        const kinds = cluster.kinds;
        // Fold order: mount indices, lowest COLLAPSE_RANK first (a kind with
        // no entry folds mid-pack).
        const foldOrder = kinds
            .map((kind, i) => ({ i, rank: model.describe(kind).rank ?? COLLAPSE_RANK[kind] ?? 3 }))
            .sort((a, b) => a.rank - b.rank || a.i - b.i);
        const liveChips = kinds.includes("filter") ? (model.filterChips ?? 0) : 0;
        const held = open !== null && open.key === cluster.key;
        const chipCount = held ? open.chips : liveChips;
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

        // Keep labels and ordering independent of selections: changing a
        // filter must not resize its trigger or move the open popover.
        const folded = (form: RailForm): SliceRailDescriptor[] => form.show === "chips"
            ? foldOrder.slice(0, form.folded).map((o) => model.describe(kinds[o.i]!))
            : kinds.map(kind => model.describe(kind));

        // What the folded families show: their summary chips in fold order;
        // at the terminal form a stable Filters label; past it the icon
        // alone. The accessible name and editor retain the selected values.
        const trigger = (form: RailForm): ReactNode => {
            if (form.show === "chips") {
                return foldOrder.slice(0, form.folded).map((o) => {
                    const d = model.describe(kinds[o.i]!);
                    return summaryChip(`fold-${d.kind}-${o.i}`, d);
                });
            }
            const descriptors = folded(form);
            const labels = descriptors.map((d) => d.text);
            const anyActive = descriptors.some((d) => d.active);
            const icon = faFilter;
            if (form.show === "icon") {
                return (
                    <Box key="icon" as="span" css={chip({ tone: anyActive ? "brand" : "neutral", numeric: true })}
                        title={labels.length > 0 ? labels.join(" · ") : "Slice"} data-rail-rung="icon">
                        <FontAwesomeIcon icon={icon} data-chip-icon="" />
                    </Box>
                );
            }
            return summaryChip("all", { kind: "all", label: "Filters", icon, text: "Filters", active: anyActive });
        };

        const editor = (form: RailForm): ReactNode => (
            <SliceEditPopover
                open={held}
                onOpenChange={(o) => setOpen(o ? { key: cluster.key, chips: liveChips } : null)}
                label={<>Narrowing · <Box as="span" css={styles.railActiveCount}>{`${activeCount} active`}</Box></>}
                size="lg"
                footLeft={model.clear === undefined ? undefined : <SliceClearButton label="Clear all" onClick={model.clear} />}
                footActions={
                    <chakra.button type="button" css={btn({ variant: "solid", size: "xs" })} onClick={() => setOpen(null)}>
                        Done
                    </chakra.button>
                }
                trigger={
                    // One button, named for what it folds (#1231) — the icon alone draws no words.
                    <chakra.button type="button" css={styles.railTrigger} data-slot="railTrigger"
                        aria-label={`Filters: ${folded(form).map((d) => d.text).join(" · ")}`}>
                        {trigger(form)}
                        <FontAwesomeIcon icon={faChevronDown} data-rail-caret="" />
                    </chakra.button>
                }
            >
                <SliceDensityContext.Provider value="editor">
                    <Box css={styles.railSections}>
                        {model.renderEditor !== undefined ? <RailSections model={model} kinds={kinds} /> : kinds.map((kind, i) => (
                            <Box key={`sec-${kind}-${i}`} css={styles.railSection}>
                                <Box as="span" css={styles.railSectionCaption}>{model.describe(kind).label}</Box>
                                <Box css={styles.railSectionBody}>{model.render(kind, i, undefined)}</Box>
                            </Box>
                        ))}
                        {model.status}
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
                            const meta = model.describe(kind);
                            return (
                                <Box key={`af-${kind}-${i}`} css={styles.railAffordance} title={meta?.label}>
                                    <Box as="span" css={styles.frameAffordanceIcon}>
                                        {meta !== undefined && <FontAwesomeIcon icon={meta.icon} />}
                                    </Box>
                                    {model.render(kind, i, kind === "filter" ? form.chips : undefined)}
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
            held,
        };
    });
}
