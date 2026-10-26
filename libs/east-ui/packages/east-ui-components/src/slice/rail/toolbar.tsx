/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Shared Slice rail presentation: local and record adapters use one ladder. */
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Accordion, Box, chakra, useRecipe } from "@chakra-ui/react";
import { useSlotStyles, type SlotStyles } from "../../theme/slot-styles.js";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFilter, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import type { IconProp } from "@fortawesome/fontawesome-svg-core";
import type { ToolbarItem } from "../../toolbar/index.js";
import { SliceDensityContext } from "../density.js";
import { SliceEditPopover } from "../edit/index.js";
import { SliceClearButton } from "../choice.js";

/** One affordance's display, independent of its query engine. */
export interface SliceRailDescriptor {
    kind: string;
    /** Its icon: the family's, or the source's when its source has one. */
    icon: IconProp;
    label: string;
    text: string;
    active: boolean;
    /** Optional position in the shared ladder; host items still fold after it. */
    rank?: number;
    /** Data attributes naming what its section edits; a record field's by default. */
    attributes?: Readonly<Record<string, string>>;
    /** The group it is headed under in the editor: a source of a Slice over several records, or the presets over them. */
    group?: SliceRailGroup;
}

/** A heading in the rail's editor over the affordances of one group: its name, its icon when it has one, and its count. */
export interface SliceRailGroup {
    /** Its identity: consecutive affordances of one key share one heading. */
    key: string;
    /** Its name, in the small mono caps (`Bays`, `Presets`). */
    label: string;
    /** Its icon, before its name. */
    icon?: IconProp | undefined;
    /** What it counts, at the heading's end: a source's rows, as a Library tab counts them (`6`, `2 of 30`, #1358). */
    count?: ReactNode | undefined;
}

/** Presentation callbacks supplied by a local or record Slice adapter. */
export interface SliceRailModel {
    /** The version that invalidates measured forms. */
    version: unknown;
    /**
     * What the editor's head counts as narrowing (`2 active`): the rail's own choices, those it lists and its Clear all
     * clears — never a narrowing it does not list, such as a source's date window a host's navigation writes.
     */
    activeCount: number;
    /** Only the local predicate builder has separately folding clause chips. */
    filterChips?: number;
    describe: (kind: string) => SliceRailDescriptor;
    render: (kind: string, index: number, foldChips: number | undefined) => ReactNode;
    /** Direct editor bodies use one shared accordion, without nested field triggers. */
    renderEditor?: (kind: string) => ReactNode;
    clear?: () => void;
    /** Status the editor keeps under its fields, as its toolbar item folds away: the counts no group's heading carries. */
    status?: ReactNode;
}

/**
 * One field heading, one open editor; Chakra owns keyboard and disclosure
 * semantics. A group's caption heads its first affordance: a caption, not a
 * control, so the keys move between the fields as they would without it.
 */
function RailSections({ model, kinds }: { model: SliceRailModel; kinds: readonly string[] }) {
    const styles = useSlotStyles("sliceFrame");
    const chip = useRecipe({ key: "chip" });
    const [expanded, setExpanded] = useState<string[]>([]);
    return <Accordion.Root css={styles.railAccordion} collapsible value={expanded}
        onValueChange={details => setExpanded(details.value)} lazyMount unmountOnExit>
        {kinds.map((kind, i) => {
            const field = model.describe(kind);
            const label = field.active ? field.text : field.label;
            const group = field.group;
            const headed = group !== undefined && (i === 0 || model.describe(kinds[i - 1]!).group?.key !== group.key);
            return <Fragment key={kind}>
                {headed && <Box css={styles.railGroupHead} data-slice-group={group.key}>
                    {group.icon !== undefined && <Box as="span" css={styles.railGroupIcon} aria-hidden="true"><FontAwesomeIcon icon={group.icon} /></Box>}
                    <Box as="span" css={styles.railGroupLabel} data-rail-group-label="">{group.label}</Box>
                    {group.count !== undefined && <Box as="span" css={styles.railGroupCount} data-rail-group-count="">{group.count}</Box>}
                </Box>}
                <Accordion.Item value={kind} data-slice-section={kind}>
                    <Accordion.ItemTrigger css={styles.railAccordionTrigger} title={label}
                        {...(field.attributes ?? (kind.startsWith("field:") ? { "data-record-slice-field": kind.slice(6) } : {}))}>
                        <Accordion.ItemIndicator><FontAwesomeIcon icon={faChevronDown} /></Accordion.ItemIndicator>
                        <Box as="span" css={styles.railAccordionLabel} data-active={field.active ? "" : undefined}>{label}</Box>
                        {field.active && <Box as="span" css={[chip({ tone: "brand", caps: true, size: "sm" }), styles.railAccordionState]}>
                            {kind === "presets" ? "Selected" : "Applied"}
                        </Box>}
                    </Accordion.ItemTrigger>
                    <Accordion.ItemContent css={styles.railAccordionContent}>
                        {model.renderEditor?.(kind)}
                    </Accordion.ItemContent>
                </Accordion.Item>
            </Fragment>;
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
 *
 * The items are made again only when what they are drawn from moves (#1398,
 * CL9): the model, the clusters' affordances, and the editor held open. A
 * host that keeps its model the same object while its slices and its words
 * hold — the record adapters do — hands its builder's toolbar the same items
 * at every render, so a builder drawn again at each window landing draws its
 * rail again only when a choice moves.
 *
 * @param model - Display callbacks; undefined means no controls.
 * @param clusters - Affordances in each host cluster.
 * @returns Items for the host's one Toolbar.
 */
export function useSliceRailItems(model: SliceRailModel | undefined, clusters: ReadonlyArray<SliceRailClusterSpec>): ToolbarItem[] {
    const styles = useSlotStyles("sliceFrame");
    const chip = useRecipe({ key: "chip" });
    const btn = useRecipe({ key: "button" });
    // Every slice change can move what the rail shows — the chips, their words.
    // The cluster whose sectioned editor is open, and how many clause chips
    // its filter had as it opened: its forms keep that many chip steps while
    // it is held (#1231). The editor is the terminal surface: every affordance
    // of the cluster flat, in `editor` density, complete however far the
    // cluster has folded.
    const [open, setOpen] = useState<{ key: string; chips: number } | null>(null);
    // The clusters as what they hold: a host's new array of the same clusters makes nothing again.
    const shape = clusters.map((cluster) => `${cluster.key}\u0001${cluster.side ?? ""}\u0001${cluster.kinds.join("\u0002")}`).join("\u0000");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the clusters are read by `shape`, what they hold
    return useMemo(() => railItems(model, clusters, open, setOpen, styles, chip, btn), [model, shape, open, styles, chip, btn]);
}

/** The rail's items, made from its model — what {@link useSliceRailItems} keeps while they hold. */
function railItems(
    model: SliceRailModel | undefined,
    clusters: ReadonlyArray<SliceRailClusterSpec>,
    open: { key: string; chips: number } | null,
    setOpen: (open: { key: string; chips: number } | null) => void,
    styles: SlotStyles,
    chip: ReturnType<typeof useRecipe>,
    btn: ReturnType<typeof useRecipe>,
): ToolbarItem[] {
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
