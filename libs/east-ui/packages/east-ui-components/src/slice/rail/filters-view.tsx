/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A phone's Filters view (`Mobile Filters Spec.md` SL3–SL9, ruled 3 Nov
 * 2026): the rail's editor, in a builder 560px wide or narrower, as a view
 * over the whole builder rather than a popover — every builder's rail (R5).
 * It is drawn from the rail's model, as the popover is: nothing is new for an
 * author (§7).
 *
 * - It covers the builder edge to edge (ruled 3 Nov 2026, in place of SL3's
 *   48px strip); ← and Done close it, and Esc.
 * - Its head: ← back, `Filters`, how many fields narrow (`2 active`), Done
 *   (SL4).
 * - The presets first, their chips beside a 72px label (SL5); then one 44px
 *   row a field, in the rail's order: its name, its choice or `Any`,
 *   `Applied` while it narrows, and a chevron (SL6). One field is open at a
 *   time, its editor — the rail's own — under its row (SL7). A Slice over
 *   several records heads each source's fields with its name, as the popover
 *   does.
 * - Its foot: what the narrowing leaves (`16,667 of 50,000 rows`), Clear all
 *   and Done (SL8).
 *
 * Styles are the `sliceFiltersView` slot recipe's.
 *
 * @packageDocumentation
 */

import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft, faChevronDown, faChevronUp } from "@fortawesome/free-solid-svg-icons";
import { useSlotStyles } from "../../theme/slot-styles.js";
import { SliceDensityContext } from "../density.js";
import { SliceFiltersViewContext } from "../choice.js";
import { useViewEscape } from "../../layout/builder-frame/view-escape.js";
import type { SliceRailModel } from "./toolbar.js";

/** Props of {@link SliceFiltersView}. */
export interface SliceFiltersViewProps {
    /** The rail's model: its fields, their words and editors, its Clear all and its counts. */
    model: SliceRailModel;
    /** The affordances it holds, in the rail's order. */
    kinds: readonly string[];
    /** Closes the view: ←, Done, Esc. */
    onClose: () => void;
}

/**
 * Renders a phone's Filters view — see the module docs.
 *
 * @param props - The rail's model and kinds, and its close ({@link SliceFiltersViewProps})
 * @returns The view, for the frame's overlay slot
 */
export function SliceFiltersView({ model, kinds, onClose }: SliceFiltersViewProps) {
    const styles = useSlotStyles("sliceFiltersView");
    const [open, setOpen] = useState<string | undefined>(undefined);
    const backRef = useRef<HTMLButtonElement | null>(null);
    useViewEscape(true, onClose);
    // The focus moves into the view as it opens: its ← back.
    useEffect(() => { backRef.current?.focus({ preventScroll: true }); }, []);
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
    };
    const presets = kinds.includes("presets") ? model.describe("presets") : undefined;
    const fields = kinds.filter((kind) => kind !== "presets");
    const active = model.activeCount;
    return (
        <Box css={styles.root} data-slice-filters-view="">
            <Box css={styles.panel} role="dialog" aria-label="Filters" onKeyDown={onKeyDown}>
                <Box css={styles.head}>
                    <chakra.button ref={backRef} type="button" css={styles.back} aria-label="Back" data-filters-back="" onClick={onClose}>
                        <FontAwesomeIcon icon={faArrowLeft} aria-hidden />
                    </chakra.button>
                    <Box as="span" css={styles.title}>Filters</Box>
                    <Box as="span" css={styles.active} data-filters-active="">{active === 0 ? "none active" : `${active} active`}</Box>
                    <chakra.button type="button" css={styles.headDone} data-filters-done="" onClick={onClose}>Done</chakra.button>
                </Box>
                <Box css={styles.body}>
                    <SliceDensityContext.Provider value="editor">
                        {presets !== undefined && (
                            <Box css={styles.presets} data-slice-section="presets">
                                <Box as="span" css={styles.presetsLabel}>{presets.label}</Box>
                                <Box css={styles.presetsChips}>{model.renderEditor?.("presets") ?? model.render("presets", kinds.indexOf("presets"), undefined)}</Box>
                            </Box>
                        )}
                        {fields.map((kind, i) => {
                            const field = model.describe(kind);
                            const shown = open === kind;
                            const group = field.group;
                            const headed = group !== undefined && (i === 0 || model.describe(fields[i - 1]!).group?.key !== group.key);
                            return (
                                <Fragment key={kind}>
                                    {headed && (
                                        <Box css={styles.group} data-slice-group={group.key}>
                                            {group.icon !== undefined && <Box as="span" css={styles.groupIcon} aria-hidden="true"><FontAwesomeIcon icon={group.icon} /></Box>}
                                            <Box as="span" css={styles.groupLabel}>{group.label}</Box>
                                            {group.count !== undefined && <Box as="span" css={styles.groupCount}>{group.count}</Box>}
                                        </Box>
                                    )}
                                    <chakra.button type="button" css={styles.row} aria-expanded={shown} data-slice-section={kind}
                                        data-active={field.active ? "" : undefined} {...(field.attributes ?? {})}
                                        onClick={() => setOpen(shown ? undefined : kind)}>
                                        <Box as="span" css={styles.rowLabel}>{field.label}</Box>
                                        <Box as="span" css={styles.rowChoice} data-any={field.active ? undefined : ""}>
                                            {field.active ? field.choice ?? field.text : "Any"}
                                        </Box>
                                        {field.active && <Box as="span" css={styles.applied}>Applied</Box>}
                                        <Box as="span" css={styles.chevron} aria-hidden="true"><FontAwesomeIcon icon={shown ? faChevronUp : faChevronDown} /></Box>
                                    </chakra.button>
                                    {shown && (
                                        <Box css={styles.editor} data-slice-filters-editor={kind}>
                                            <SliceFiltersViewContext.Provider value={true}>
                                                {model.renderEditor?.(kind) ?? model.render(kind, kinds.indexOf(kind), undefined)}
                                            </SliceFiltersViewContext.Provider>
                                        </Box>
                                    )}
                                </Fragment>
                            );
                        })}
                    </SliceDensityContext.Provider>
                </Box>
                <Box css={styles.foot}>
                    <Box css={styles.count} data-filters-count="">{model.footStatus ?? model.status}</Box>
                    <Box css={styles.actions}>
                        {model.clear !== undefined && (
                            <chakra.button type="button" css={styles.action} data-filters-clear="" disabled={active === 0} onClick={model.clear}>Clear all</chakra.button>
                        )}
                        <chakra.button type="button" css={styles.action} data-primary="" onClick={onClose}>Done</chakra.button>
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
