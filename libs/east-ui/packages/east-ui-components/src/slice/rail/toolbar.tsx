/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Shared Slice rail presentation: local and record adapters use one ladder.
 *
 * What folds, in which order, and what is held open are the rail engine's
 * (`../../toolbar/rail/`, #1673): this module draws the engine's forms — the
 * live affordances, the summary chips, the folded trigger, the editor's
 * popover and a phone's Filters button and view.
 */
import { Fragment, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { Accordion, Box, chakra, useRecipe } from "@chakra-ui/react";
import { useSlotStyles, type SlotStyles } from "../../theme/slot-styles.js";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFilter, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import type { IconProp } from "@fortawesome/fontawesome-svg-core";
import type { ToolbarItem } from "../../toolbar/index.js";
import { foldedAt, useRail, type RailAffordance, type RailCluster, type RailClusterState, type RailForm } from "../../toolbar/rail/index.js";
import { SliceDensityContext } from "../density.js";
import { SliceEditPopover } from "../edit/index.js";
import { SliceClearButton } from "../choice.js";
import { FrameOverlaySlot } from "../../layout/builder-frame/overlay-slot.js";
import { SliceFiltersView } from "./filters-view.js";
import { SliceRailHold } from "./hold.js";

/**
 * One affordance's display, independent of its query engine: what the rail
 * engine reads of it — whether it narrows, and its own place in the shared
 * ladder, where it gives one (host items still fold after it) — and what the
 * rail draws.
 */
export interface SliceRailDescriptor extends RailAffordance {
    kind: string;
    /** Its icon: the family's, or the source's when its source has one. */
    icon: IconProp;
    label: string;
    text: string;
    /** Its choice alone, while it holds one (`Ready`, `Nov 2 – Nov 8`): what a phone's Filters view says beside its label; `text` where none is given. */
    choice?: string;
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
    /** What a phone's Filters view counts at its foot, whatever narrows (`16,667 of 50,000 rows`); `status` where none is given. */
    footStatus?: ReactNode;
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

/** Props of {@link RailPhoneFilters}. */
interface RailPhoneFiltersProps {
    model: SliceRailModel;
    kinds: readonly string[];
    /** Whether the rail's editor is open. */
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The Filters button: given a click, the view's opener. */
    button: (onClick?: () => void, ref?: Ref<HTMLButtonElement>) => ReactElement;
    /** The editor's popover around the button: what it opens with no phone's frame around it. */
    popover: ReactNode;
}

/**
 * A phone's Filters button (`Mobile Filters Spec.md` SL2, SL3): in a phone's
 * frame it opens the Filters view in the frame's overlay slot, over the whole
 * builder, and the focus comes back to it as the view closes; with no phone's
 * frame around it, the editor's popover.
 */
function RailPhoneFilters({ model, kinds, open, onOpenChange, button, popover }: RailPhoneFiltersProps) {
    const slot = useContext(FrameOverlaySlot);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const wasOpen = useRef(open);
    useEffect(() => {
        if (wasOpen.current && !open) buttonRef.current?.focus({ preventScroll: true });
        wasOpen.current = open;
    }, [open]);
    if (slot === null) return <>{popover}</>;
    return (
        <>
            {button(() => onOpenChange(!open), buttonRef)}
            {open && createPortal(<SliceFiltersView model={model} kinds={kinds} onClose={() => onOpenChange(false)} />, slot)}
        </>
    );
}

/** One cluster of the rail — one item of the shared toolbar: the rail engine's. */
export type { RailCluster as SliceRailClusterSpec } from "../../toolbar/rail/index.js";

/**
 * Build one shared-toolbar item per Slice cluster. The adapters own data and
 * control actions; the rail engine owns folding and the held editor
 * (`useRail`); this hook draws the engine's forms, in each density.
 *
 * The items are made again only when what they are drawn from moves (#1398,
 * CL9): the engine's rail — its model, the clusters' affordances, and the
 * editor held open. A host that keeps its model the same object while its
 * slices and its words hold — the record adapters do — hands its builder's
 * toolbar the same items at every render, so a builder drawn again at each
 * window landing draws its rail again only when a choice moves.
 *
 * @param model - Display callbacks; undefined means no controls.
 * @param clusters - Affordances in each host cluster.
 * @returns Items for the host's one Toolbar.
 */
export function useSliceRailItems(model: SliceRailModel | undefined, clusters: ReadonlyArray<RailCluster>): ToolbarItem[] {
    const styles = useSlotStyles("sliceFrame");
    const phoneStyles = useSlotStyles("toolbarPhone");
    const chip = useRecipe({ key: "chip" });
    const btn = useRecipe({ key: "button" });
    // Every slice change can move what the rail shows — the chips, their words. The editor is the terminal surface:
    // every affordance of the cluster flat, in `editor` density, complete however far the cluster has folded.
    const rail = useRail(model, clusters);
    return useMemo(() => railItems(model, rail, styles, phoneStyles, chip, btn), [model, rail, styles, phoneStyles, chip, btn]);
}

/** The rail's items, drawn from its model and the engine's forms — what {@link useSliceRailItems} keeps while they hold. */
function railItems(
    model: SliceRailModel | undefined,
    rail: ReadonlyArray<RailClusterState>,
    styles: SlotStyles,
    phoneStyles: SlotStyles,
    chip: ReturnType<typeof useRecipe>,
    btn: ReturnType<typeof useRecipe>,
): ToolbarItem[] {
    if (model === undefined) return [];
    const { version, activeCount } = model;

    const summaryChip = (key: string, d: SliceRailDescriptor): ReactNode => (
        <Box key={key} as="span" css={chip({ tone: d.active ? "brand" : "neutral" })} data-slice-fold={d.kind}>
            <FontAwesomeIcon icon={d.icon} data-chip-icon="" />
            <Box as="span">{d.label}</Box>
        </Box>
    );

    return rail.map(({ cluster, forms, ranks, every, held, open, set, setOpen, hold }): ToolbarItem => {
        const kinds = cluster.kinds;

        // The affordances a form folds, as the engine orders them: labels and ordering independent of selections, so
        // changing a filter never resizes its trigger or moves the open popover.
        const folded = (form: RailForm): SliceRailDescriptor[] => foldedAt(form).map((i) => model.describe(kinds[i]!));

        // What the folded families show: their summary chips in fold order;
        // at the terminal form a stable Filters label; past it the icon
        // alone — at the row's floor without the caret too. The accessible
        // name and editor retain the selected values.
        const trigger = (form: RailForm): ReactNode => {
            if (form.show === "chips") {
                return foldedAt(form).map((i) => {
                    const d = model.describe(kinds[i]!);
                    return summaryChip(`fold-${d.kind}-${i}`, d);
                });
            }
            const descriptors = folded(form);
            const labels = descriptors.map((d) => d.text);
            const anyActive = descriptors.some((d) => d.active);
            const icon = faFilter;
            if (form.show === "icon" || form.show === "bare") {
                return (
                    <Box key="icon" as="span" css={chip({ tone: anyActive ? "brand" : "neutral" })}
                        title={labels.length > 0 ? labels.join(" · ") : "Slice"} data-rail-rung="icon">
                        <FontAwesomeIcon icon={icon} data-chip-icon="" />
                    </Box>
                );
            }
            return summaryChip("all", { kind: "all", label: "Filters", icon, text: "Filters", active: anyActive });
        };

        const editor = (form: RailForm, button?: ReactElement): ReactNode => (
            <SliceEditPopover
                open={open}
                onOpenChange={setOpen}
                label={<>Narrowing · <Box as="span" css={styles.railActiveCount}>{`${activeCount} active`}</Box></>}
                size="lg"
                footLeft={model.clear === undefined ? undefined : <SliceClearButton label="Clear all" onClick={model.clear} />}
                footActions={
                    <chakra.button type="button" css={btn({ variant: "solid", size: "xs" })} onClick={() => setOpen(false)}>
                        Done
                    </chakra.button>
                }
                trigger={button ?? (
                    // One button, named for what it folds (#1231) — the icon alone draws no words.
                    <chakra.button type="button" css={styles.railTrigger} data-slot="railTrigger"
                        aria-label={`Filters: ${folded(form).map((d) => d.text).join(" · ")}`}>
                        {trigger(form)}
                        {form.show !== "bare" && <FontAwesomeIcon icon={faChevronDown} data-rail-caret="" />}
                    </chakra.button>
                )}
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
        // An editor of the live row holds the cluster while it is open (#1673).
        const render = (form: RailForm): ReactNode => {
            return (
                <SliceDensityContext.Provider value="compact">
                    <SliceRailHold.Provider value={hold}>
                        <Box css={styles.railCluster} data-slice-rail={cluster.key}>
                            {form.live.map((i) => {
                                const kind = kinds[i]!;
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
                    </SliceRailHold.Provider>
                </SliceDensityContext.Provider>
            );
        };

        // A phone's (`Mobile Filters Spec.md` SL2): the Filters button — the filter icon and, while any field is set, how
        // many — named by every field it holds, after the views and the count and before Search Records. In a phone's
        // frame it opens the Filters view over the whole builder (SL3, R1); with no frame around it, the editor's popover.
        const button = (onClick?: () => void, ref?: Ref<HTMLButtonElement>) => (
            <chakra.button ref={ref} type="button" css={phoneStyles.filters} data-slot="railTrigger" data-rail-phone=""
                data-active={set > 0 ? "" : undefined} aria-label={`Filters: ${folded(every).map((d) => d.text).join(" · ")}`}
                aria-expanded={onClick === undefined ? undefined : open} onClick={onClick}>
                <FontAwesomeIcon icon={faFilter} />
                {set > 0 && <Box as="span" data-rail-set="">{set}</Box>}
            </chakra.button>
        );
        const phone = (
            <Box css={styles.railCluster} data-slice-rail={cluster.key}>
                <RailPhoneFilters model={model} kinds={kinds} open={open} button={button} popover={editor(every, button())}
                    onOpenChange={setOpen} />
            </Box>
        );

        return {
            key: cluster.key,
            side: cluster.side,
            forms: forms.map(render),
            rank: [...ranks],
            version,
            held,
            phone: { form: phone, order: 1 },
        };
    });
}
