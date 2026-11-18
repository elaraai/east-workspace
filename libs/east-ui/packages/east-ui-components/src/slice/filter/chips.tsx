/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A row of filter chips (#1673) — the part Slice's filter and a Studio page's
 * filters both draw: each filter a chip that opens its editor, a `+N more`
 * chip the row folds its last chips into, and a dashed `+ FILTER` chip that
 * opens the editor of a new one. What a filter is — a Slice predicate, a jq
 * condition — is its host's: this draws the chips, and holds which editor is
 * open.
 *
 * Every chip is a button (#1231): a filter's chip opens its editor, whose
 * foot removes it (Remove filter); its xmark is the pointer's, as a Sheet
 * tab's is (#860) — with a mouse it removes the filter, the keyboard removes
 * a focused one with Delete, and on a coarse pointer it is not drawn: the
 * chip is one target, 44px by its halo, as `+N more` and `+ FILTER` are.
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Box, chakra, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faChevronDown, faXmark } from "@fortawesome/free-solid-svg-icons";
import { coarseHitArea } from "../../style/hit-area.js";
import { SliceFieldChip } from "../choice.js";
import { useOverflowCount } from "../../hooks/useOverflowCount";
import { SliceEditPopover } from "../edit";

/** One filter of the row, as its chip shows it. */
export interface SliceFilterChip {
    /** Its words. */
    readonly label: string;
    /** Its editor's head. */
    readonly editLabel: ReactNode;
    /** Its editor, drawn while it is open; `close` puts it away. */
    readonly editor: (close: () => void) => ReactNode;
    /** Its editor's popover at its large size; its default unless given. */
    readonly large?: boolean | undefined;
}

/** Slice's own view inside `+N more`: the filters saved as a cohort under a name. */
export interface SliceFilterSave {
    /** The name typed. */
    readonly name: string;
    /** Told each change of the name. */
    readonly onName: (name: string) => void;
    /** Saves the filters under the name. */
    readonly onSave: () => void;
}

/** Props of {@link SliceFilterChips}. */
export interface SliceFilterChipsProps {
    /** The filters, in order. */
    readonly chips: readonly SliceFilterChip[];
    /** `compact`: one row that folds; `editor`: every chip, wrapping; `focused`: every chip, wrapping, in a host's own frame. */
    readonly density: "compact" | "focused" | "editor";
    /**
     * Compact only: how many trailing chips fold into `+N more`, as the shared toolbar decides it (#952) — it folds
     * them as forms of its one ladder. Absent, the chips fold to fit the row by their own measure.
     */
    readonly foldChips?: number | undefined;
    /** Takes the filter at a place out. */
    readonly onRemove: (index: number) => void;
    /** Takes every filter out. */
    readonly onClear: () => void;
    /** A new filter's editor, drawn while it is open; `close` puts it away. */
    readonly add: (close: () => void) => ReactNode;
    /** Whether it opens with a new filter's editor showing. */
    readonly seedOpen?: boolean | undefined;
    /** Saving the filters as a set, offered inside `+N more` while there are two or more; none unless given. */
    readonly save?: SliceFilterSave | undefined;
}

/**
 * A row of filter chips — see the module docs.
 *
 * @param props - The filters, the density, how many fold, and what removing, clearing and adding do
 * @returns The row
 */
export function SliceFilterChips({ chips, density, foldChips, onRemove, onClear, add, seedOpen = false, save }: SliceFilterChipsProps) {
    const chip = useRecipe({ key: "chip" });
    const btn = useRecipe({ key: "button" });
    const inp = useRecipe({ key: "input" });
    const edit = useSlotRecipe({ key: "sliceEdit" })();
    const compact = density === "compact";

    // Compact eyebrow is one row that never wraps/clips — Priority+ overflow: as
    // many chips as fit, the rest collapse into `+N more`. The hook measures the
    // rendered chips once per resize / count change (see its doc) — unless the
    // shared toolbar decides the fold (`foldChips`, #952).
    const controlled = foldChips !== undefined;
    const ownFold = useOverflowCount(chips.length, !controlled);
    const rowRef = ownFold.rowRef;
    const visibleCount = controlled ? Math.max(0, chips.length - foldChips) : ownFold.visibleCount;
    const measuring = !controlled && ownFold.measuring;

    // null = closed; "add" = a new filter's editor; "more" = overflow list;
    // "save" = save-as-a-set form; a number = editing the filter at that index.
    const [open, setOpen] = useState<"add" | "more" | "save" | number | null>(seedOpen ? "add" : null);
    const close = () => setOpen(null);

    // A filter removed by Delete hands the focus on once the chips have drawn
    // again, as a Sheet tab's close does (#860): to the filter that takes its
    // place, else the one before it, else `+N more`, else `+ FILTER`.
    const focusAfter = useRef<{ chips: Element; index: number } | null>(null);
    useLayoutEffect(() => {
        const after = focusAfter.current;
        if (after === null) return;
        focusAfter.current = null;
        const clauses = after.chips.querySelectorAll<HTMLElement>("[data-slice-clause]");
        const next = clauses[after.index] ?? clauses[after.index - 1]
            ?? after.chips.querySelector<HTMLElement>("[data-slice-more]")
            ?? after.chips.querySelector<HTMLElement>("[data-slice-add='filter']");
        next?.focus();
    });
    const onClauseKey = (i: number) => (e: KeyboardEvent<HTMLElement>) => {
        if (e.key !== "Delete") return;
        e.preventDefault();
        const row = e.currentTarget.closest("[data-slice-filter]");
        if (row !== null) focusAfter.current = { chips: row, index: i };
        onRemove(i);
    };

    // A filter's chip: one button opening its editor (Slice.Edit), whose foot
    // removes the filter; its xmark the pointer's (#1231).
    const clausePill = (held: SliceFilterChip, i: number) => (
        <SliceEditPopover
            key={i}
            open={open === i}
            onOpenChange={o => setOpen(o ? i : null)}
            label={held.editLabel}
            {...(held.large === true ? { size: "lg" as const } : {})}
            footLeft={<chakra.button type="button" css={edit.footDanger} onClick={() => { setOpen(null); onRemove(i); }}>Remove filter</chakra.button>}
            footActions={<chakra.button type="button" css={btn({ variant: "outline", size: "xs" })} onClick={close}>Cancel</chakra.button>}
            trigger={
                <SliceFieldChip label={held.label} active data-slice-clause={i}
                    onKeyDown={onClauseKey(i)} onRemove={() => onRemove(i)} />
            }
        >
            {open === i ? held.editor(close) : null}
        </SliceEditPopover>
    );

    const addPopover = (
        <SliceEditPopover
            open={open === "add"}
            onOpenChange={o => setOpen(o ? "add" : null)}
            label="Add filter"
            size="lg"
            footActions={<chakra.button type="button" css={btn({ variant: "outline", size: "xs" })} onClick={close}>Done</chakra.button>}
            trigger={
                // A 44px touch target on a coarse pointer, by its halo: the row keeps its height (#346, #1221).
                <chakra.button type="button" css={[chip({ tone: "dashed", caps: true }), coarseHitArea({ position: true })]} cursor="pointer"
                    data-slice-add="filter" aria-label="Add filter">
                    <FontAwesomeIcon icon={faPlus} style={{ fontSize: "9px" }} />
                    <Box as="span">{compact ? "filter" : "add filter"}</Box>
                </chakra.button>
            }
        >
            {/* Adding applies the filter and CLOSES the popover — consistent with
                the edit path — so the new chip appearing in the rail is the
                visible confirmation; the lazy-mounted editor unmounts and the
                next open starts fresh (#164). */}
            {open === "add" ? add(close) : null}
        </SliceEditPopover>
    );

    if (density === "editor") {
        // The sectioned editor is the terminal surface: every filter shows
        // (wrapping vertically — the editor scrolls), nothing folds, and the
        // filter / add-filter editors expand inline via `SliceEditPopover`'s
        // editor-density disclosure.
        return (
            <Box display="flex" gap="{spacing.2}" alignItems="center" flexWrap="wrap" minWidth="0" data-slice-filter="">
                {chips.map((held, i) => clausePill(held, i))}
                {addPopover}
            </Box>
        );
    }

    if (compact) {
        // During the measure pass every chip is in flow; once measured we show
        // the leading `visibleCount` and collapse the rest into `+N more`.
        const shown = measuring ? chips : chips.slice(0, visibleCount);
        const overflow = chips.length - (measuring ? 0 : visibleCount);
        // Reserve the `+N more` chip's width during measuring (worst-case count)
        // so it never collapses one chip too many once it appears.
        const showMore = measuring ? chips.length > 0 : overflow > 0;
        const saving = save !== undefined && open === "save";
        // The row clips sideways only: a chip's touch halo reaches above and below it (#1221).
        return (
            <Box ref={rowRef} position="relative" display="flex" gap="{spacing.2}" alignItems="center" flexWrap="nowrap" overflowX="clip" minWidth="0" data-slice-filter="">
                {shown.map((held, i) => (
                    <Box key={i} data-overflow-item flexShrink="0" display="inline-flex">
                        {clausePill(held, i)}
                    </Box>
                ))}
                <Box data-overflow-rest display="inline-flex" alignItems="center" gap="{spacing.2}" flexShrink="0">
                    {showMore && (
                        <SliceEditPopover
                            open={open === "more" || open === "save"}
                            onOpenChange={o => setOpen(o ? "more" : null)}
                            label={saving ? "Save as cohort" : `${chips.length} active filters`}
                            size="lg"
                            footLeft={save !== undefined && !saving && chips.length >= 2 ? <chakra.button type="button" css={edit.footLink} onClick={() => setOpen("save")}>Save as cohort →</chakra.button> : undefined}
                            footActions={saving
                                ? (
                                    <>
                                        <chakra.button type="button" css={btn({ variant: "outline", size: "xs" })} onClick={() => setOpen("more")}>Cancel</chakra.button>
                                        <chakra.button type="button" css={btn({ variant: "solid", size: "xs" })} disabled={save.name.trim() === ""} onClick={() => { save.onSave(); setOpen(null); }}>Save</chakra.button>
                                    </>
                                )
                                : (
                                    <>
                                        <chakra.button type="button" css={btn({ variant: "outline", size: "xs" })} onClick={() => { onClear(); setOpen(null); }}>Clear all</chakra.button>
                                        <chakra.button type="button" css={btn({ variant: "outline", size: "xs" })} onClick={close}>Done</chakra.button>
                                    </>
                                )}
                            trigger={
                                // A 44px touch target on a coarse pointer, by its halo (#1231).
                                <chakra.button type="button" css={[chip({ tone: "more" }), coarseHitArea({ position: true })]} cursor="pointer"
                                    data-slice-more="">
                                    <Box as="span">{`+${measuring ? chips.length : overflow} more`}</Box>
                                    <FontAwesomeIcon icon={faChevronDown} style={{ fontSize: "8px" }} />
                                </chakra.button>
                            }
                        >
                            {saving && (
                                <Box display="flex" flexDirection="column" gap="{spacing.1}">
                                    <chakra.input css={inp({ size: "sm" })} value={save.name} onChange={e => save.onName(e.target.value)} placeholder="Cohort name" aria-label="Cohort name" required aria-required="true" aria-invalid={save.name.trim() === ""} autoFocus />
                                    {save.name.trim() === "" && <Box as="span" fontFamily="mono" fontSize="10px" color="fg.muted">Give the cohort a name to save it.</Box>}
                                </Box>
                            )}
                            {(open === "more" || open === "save") && chips.map((held, i) => (
                                <Box key={i} css={edit.moreRow}>
                                    <Box as="span">{held.label}</Box>
                                    {open === "more" && (
                                        <chakra.button type="button" css={edit.moreRowRemove} onClick={() => onRemove(i)} aria-label="Remove filter">
                                            <FontAwesomeIcon icon={faXmark} />
                                        </chakra.button>
                                    )}
                                </Box>
                            ))}
                        </SliceEditPopover>
                    )}
                    <Box data-overflow-keep display="inline-flex">{addPopover}</Box>
                </Box>
            </Box>
        );
    }

    return (
        <Box display="flex" gap="{spacing.2}" flexWrap="wrap" alignItems="center" data-slice-filter="">
            {chips.map((held, i) => clausePill(held, i))}
            {addPopover}
        </Box>
    );
}
