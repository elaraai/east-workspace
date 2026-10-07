/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Box, chakra, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { none, type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { useFormatters } from "../../format/index.js";
import { coarseHitArea } from "../../style/hit-area.js";
import { useCoarsePointer } from "../../contracts/adaptive.js";
import { useOverflowCount } from "../../hooks/useOverflowCount";
import { formatPredicate } from "../predicate-format";
import { SlicePredicateBuilder } from "../predicate-builder";
import { SliceEditPopover } from "../edit";
import { useSliceDensity } from "../density";
import { useSliceReactivity } from "../use-slice-reactivity";
import { uniqueSlug } from "../slug";

/** East Slice.Filter value type. */
export type SliceFilterValue = ValueTypeOf<typeof Slice.Filter.Types.Filter>;
type PredicateValue = ValueTypeOf<typeof Slice.Types.Predicate>;

export interface EastChakraSliceFilterProps {
    value: SliceFilterValue;
    /** Compact only: how many trailing clause chips fold into `+N more`, as
     *  the shared toolbar decides it (#952) — it folds them as forms of its
     *  one ladder. Absent, the chips fold to fit the row by their own measure. */
    foldChips?: number | undefined;
}

/**
 * Renders an East UI `Slice.Filter`. **Compact** (in a `Slice.Frame` eyebrow):
 * one row of as many brand chips as fit with remove `×`, a `+N more` chip opening a
 * `Slice.Edit` list, and a dashed `+ FILTER` chip opening the builder popover.
 * **Focused** (standalone): the same chip rail plus a `SHOWING N {unit}` footer
 * (result **of** total). The add-filter builder always lives in a `Slice.Edit`
 * popover, so opening it never re-flows the surface.
 *
 * Every chip is a button (#1231): a clause chip opens its clause's editor,
 * whose foot removes it (Remove filter); its × is the pointer's, as a Sheet
 * tab's is (#860) — with a mouse it removes the clause, the keyboard removes
 * a focused clause with Delete, and on a coarse pointer it is not drawn: the
 * chip is one target, 44px by its halo, as `+N more` and `+ FILTER` are.
 */
export const EastChakraSliceFilter = memo(function EastChakraSliceFilter({ value, foldChips }: EastChakraSliceFilterProps) {
    const chip = useRecipe({ key: "chip" });
    const btn = useRecipe({ key: "button" });
    const inp = useRecipe({ key: "input" });
    const frame = useSlotRecipe({ key: "sliceFrame" })();
    const edit = useSlotRecipe({ key: "sliceEdit" })();
    const { slice } = value;
    useSliceReactivity(slice.key);
    const density = useSliceDensity(getSomeorUndefined(value.density)?.type as ("compact" | "focused" | undefined));
    const compact = density === "compact";
    // Counts and clause dates, in the app's locale (#850).
    const words = useFormatters();

    const state = slice.read();
    const filters = state.filters;
    const fields = slice.fields();
    const unit = getSomeorUndefined(value.unit);
    const seedOpen = getSomeorUndefined(value.editOpen) ?? false;

    // Compact eyebrow is one row that never wraps/clips — Priority+ overflow: as
    // many clause chips as fit, the rest collapse into `+N more`. The hook
    // measures the rendered chips once per resize / count change (see its doc)
    // — unless the shared toolbar decides the fold (`foldChips`, #952).
    const controlled = foldChips !== undefined;
    const ownFold = useOverflowCount(filters.length, !controlled);
    const rowRef = ownFold.rowRef;
    const visibleCount = controlled ? Math.max(0, filters.length - foldChips) : ownFold.visibleCount;
    const measuring = !controlled && ownFold.measuring;

    // null = closed; "add" = add-builder; "more" = overflow list; "save" =
    // save-as-cohort form; a number = editing the clause at that index.
    const [open, setOpen] = useState<"add" | "more" | "save" | number | null>(seedOpen ? "add" : null);
    const [cohortName, setCohortName] = useState("");
    // On a touch screen a clause chip draws no × (#1231): the chip is one
    // target, and its editor's foot removes the clause.
    const coarse = useCoarsePointer();

    // A clause removed by Delete hands the focus on once the chips have drawn
    // again, as a Sheet tab's close does (#860): to the clause that takes its
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
    const removeClause = (i: number) => slice.removeFilter(BigInt(i));
    const onClauseKey = (i: number) => (e: KeyboardEvent<HTMLElement>) => {
        if (e.key !== "Delete") return;
        e.preventDefault();
        const chips = e.currentTarget.closest("[data-slice-filter]");
        if (chips !== null) focusAfter.current = { chips, index: i };
        removeClause(i);
    };

    // Replace the clause at `i` in place (op / value edit keeps order).
    const replaceFilter = (i: number, pred: PredicateValue) => slice.write({ ...state, filters: filters.map((f, j) => j === i ? pred : f) });

    // Save the active filter set as a reusable cohort and apply it. The id is
    // deduped against the existing cohorts (the shared `uniqueSlug` the Cohort
    // renderer uses) so a name that slugifies to an existing id yields a fresh
    // one (`eu` → `eu-2`) instead of tripping `defineCohort`'s throw-on-duplicate.
    const saveCohort = () => {
        const name = cohortName.trim();
        if (name === "") return;
        const id = uniqueSlug(name, state.cohorts.map(c => c.id));
        // A saved filter set is a standalone cohort — it ANDs with everything.
        slice.defineCohort({ id, name, filters: [...filters], group: none });
        slice.toggleCohort(id);
        setCohortName("");
        setOpen(null);
    };

    // A clause chip: one button opening the op/value editor (Slice.Edit), whose
    // foot removes the clause; its × the pointer's (#1231).
    const clausePill = (pred: PredicateValue, i: number) => (
        <SliceEditPopover
            key={i}
            open={open === i}
            onOpenChange={o => setOpen(o ? i : null)}
            label={<>{"Edit · "}<Box as="span" css={edit.clauseField}>{pred.value.fieldId}</Box></>}
            footLeft={<chakra.button type="button" css={edit.footDanger} onClick={() => { setOpen(null); removeClause(i); }}>Remove filter</chakra.button>}
            footActions={<chakra.button type="button" css={btn({ variant: "outline", size: "xs" })} onClick={() => setOpen(null)}>Cancel</chakra.button>}
            trigger={
                // A 44px touch target on a coarse pointer, by its halo: the row keeps its height (#346, #1221).
                <chakra.button type="button" css={[chip({ tone: "brand", numeric: true }), coarseHitArea({ position: true })]} cursor="pointer" flexShrink={0}
                    data-slice-clause={i} onKeyDown={onClauseKey(i)}>
                    <Box as="span" whiteSpace="nowrap">{formatPredicate(pred, words)}</Box>
                    {/* The pointer's remove; the keyboard's is Delete on the chip. */}
                    {!coarse && (
                        <Box as="span" data-chip-remove="" aria-hidden="true" title="Remove filter"
                            onClick={(e: MouseEvent) => { e.stopPropagation(); removeClause(i); }}>
                            ×
                        </Box>
                    )}
                </chakra.button>
            }
        >
            {open === i
                ? <SlicePredicateBuilder fields={fields} initial={pred} lockField submitLabel="Apply" onAdd={p => { replaceFilter(i, p); setOpen(null); }} />
                : null}
        </SliceEditPopover>
    );

    const addPopover = (
        <SliceEditPopover
            open={open === "add"}
            onOpenChange={o => setOpen(o ? "add" : null)}
            label="Add filter"
            size="lg"
            footActions={<chakra.button type="button" css={btn({ variant: "outline", size: "xs" })} onClick={() => setOpen(null)}>Done</chakra.button>}
            trigger={
                // A 44px touch target on a coarse pointer, by its halo: the row keeps its height (#346, #1221).
                <chakra.button type="button" css={[chip({ tone: "dashed", numeric: true, caps: true }), coarseHitArea({ position: true })]} cursor="pointer"
                    data-slice-add="filter" aria-label="Add filter">
                    <FontAwesomeIcon icon={faPlus} style={{ fontSize: "9px" }} />
                    <Box as="span">{compact ? "filter" : "add filter"}</Box>
                </chakra.button>
            }
        >
            {/* Add applies the clause and CLOSES the popover — consistent with
                the edit path — so the new chip appearing in the rail is the
                visible confirmation; the lazy-mounted builder unmounts and the
                next open starts fresh (#164). */}
            {open === "add" ? <SlicePredicateBuilder fields={fields} onAdd={pred => { slice.addFilter(pred); setOpen(null); }} /> : null}
        </SliceEditPopover>
    );

    if (density === "editor") {
        // The sectioned editor is the terminal surface: every clause shows
        // (wrapping vertically — the editor scrolls), nothing folds, and the
        // clause / add-filter editors expand inline via `SliceEditPopover`'s
        // editor-density disclosure.
        return (
            <Box display="flex" gap="{spacing.2}" alignItems="center" flexWrap="wrap" minWidth="0" data-slice-filter="">
                {filters.map((pred, i) => clausePill(pred, i))}
                {addPopover}
            </Box>
        );
    }

    if (compact) {
        // During the measure pass every chip is in flow; once measured we show
        // the leading `visibleCount` and collapse the rest into `+N more`.
        const shown = measuring ? filters : filters.slice(0, visibleCount);
        const overflow = filters.length - (measuring ? 0 : visibleCount);
        // Reserve the `+N more` chip's width during measuring (worst-case count)
        // so it never collapses one chip too many once it appears.
        const showMore = measuring ? filters.length > 0 : overflow > 0;
        // The row clips sideways only: a chip's touch halo reaches above and below it (#1221).
        return (
            <Box ref={rowRef} position="relative" display="flex" gap="{spacing.2}" alignItems="center" flexWrap="nowrap" overflowX="clip" minWidth="0" data-slice-filter="">
                {shown.map((pred, i) => (
                    <Box key={i} data-overflow-item flexShrink="0" display="inline-flex">
                        {clausePill(pred, i)}
                    </Box>
                ))}
                <Box data-overflow-rest display="inline-flex" alignItems="center" gap="{spacing.2}" flexShrink="0">
                    {showMore && (
                        <SliceEditPopover
                            open={open === "more" || open === "save"}
                            onOpenChange={o => setOpen(o ? "more" : null)}
                            label={open === "save" ? "Save as cohort" : `${filters.length} active filters`}
                            size="lg"
                            footLeft={open !== "save" && filters.length >= 2 ? <chakra.button type="button" css={edit.footLink} onClick={() => setOpen("save")}>Save as cohort →</chakra.button> : undefined}
                            footActions={open === "save"
                                ? (
                                    <>
                                        <chakra.button type="button" css={btn({ variant: "outline", size: "xs" })} onClick={() => setOpen("more")}>Cancel</chakra.button>
                                        <chakra.button type="button" css={btn({ variant: "solid", size: "xs" })} disabled={cohortName.trim() === ""} onClick={saveCohort}>Save</chakra.button>
                                    </>
                                )
                                : (
                                    <>
                                        <chakra.button type="button" css={btn({ variant: "outline", size: "xs" })} onClick={() => { slice.clearFilters(); setOpen(null); }}>Clear all</chakra.button>
                                        <chakra.button type="button" css={btn({ variant: "outline", size: "xs" })} onClick={() => setOpen(null)}>Done</chakra.button>
                                    </>
                                )}
                            trigger={
                                // A 44px touch target on a coarse pointer, by its halo (#1231).
                                <chakra.button type="button" css={[chip({ tone: "more", numeric: true }), coarseHitArea({ position: true })]} cursor="pointer"
                                    data-slice-more="">
                                    <Box as="span">{`+${measuring ? filters.length : overflow} more`}</Box>
                                    <FontAwesomeIcon icon={faChevronDown} style={{ fontSize: "8px" }} />
                                </chakra.button>
                            }
                        >
                            {open === "save" && (
                                <Box display="flex" flexDirection="column" gap="{spacing.1}">
                                    <chakra.input css={inp({ size: "sm" })} value={cohortName} onChange={e => setCohortName(e.target.value)} placeholder="Cohort name" aria-label="Cohort name" required aria-required="true" aria-invalid={cohortName.trim() === ""} autoFocus />
                                    {cohortName.trim() === "" && <Box as="span" fontFamily="mono" fontSize="10px" color="fg.muted">Give the cohort a name to save it.</Box>}
                                </Box>
                            )}
                            {(open === "more" || open === "save") && filters.map((pred, i) => (
                                <Box key={i} css={edit.moreRow}>
                                    <Box as="span">{formatPredicate(pred, words)}</Box>
                                    {open === "more" && (
                                        <chakra.button type="button" css={edit.moreRowRemove} onClick={() => slice.removeFilter(BigInt(i))} aria-label="Remove filter">×</chakra.button>
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
        <Box css={frame.root}>
            <Box css={frame.body}>
                <Box display="flex" gap="{spacing.2}" flexWrap="wrap" alignItems="center" data-slice-filter="">
                    {filters.map((pred, i) => clausePill(pred, i))}
                    {addPopover}
                </Box>
            </Box>
            {/* No "Save view →" affordance here: full named-view snapshots are
                a tracked follow-up (#168) — the UI must not advertise a
                non-feature. Cohorts cover saving filter bundles. */}
            <Box css={frame.footer}>
                {/* Result OF total (#169) — "1,284 of 50,000 events" gives the
                    denominator context a bare count lacks. */}
                <Box as="span" css={frame.footerLabel}>
                    {`SHOWING ${words.number(Number(slice.resultCount()))}${Number(slice.totalCount()) > 0 ? ` OF ${words.number(Number(slice.totalCount()))}` : ""}${unit !== undefined ? ` ${unit}` : ""}`}
                </Box>
            </Box>
        </Box>
    );
}, () => false);
