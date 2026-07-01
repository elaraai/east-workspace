/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useState } from "react";
import { Box, chakra, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
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
}

/**
 * Renders an East UI `Slice.Filter`. **Compact** (in a `Slice.Frame` eyebrow):
 * one row of as many brand pills as fit with remove `×`, a `+N more` pill opening a
 * `Slice.Edit` list, and a dashed `+ filter` pill opening the builder popover.
 * **Focused** (standalone): the same chip rail plus a `SHOWING N {unit}` footer
 * and `Save view →`. The add-filter builder always lives in a `Slice.Edit`
 * popover, so opening it never re-flows the surface.
 */
export const EastChakraSliceFilter = memo(function EastChakraSliceFilter({ value }: EastChakraSliceFilterProps) {
    const chip = useRecipe({ key: "chip" });
    const btn = useRecipe({ key: "button" });
    const inp = useRecipe({ key: "input" });
    const frame = useSlotRecipe({ key: "sliceFrame" })();
    const edit = useSlotRecipe({ key: "sliceEdit" })();
    const { slice } = value;
    useSliceReactivity(slice.key);
    const density = useSliceDensity(getSomeorUndefined(value.density)?.type as ("compact" | "focused" | undefined));
    const compact = density === "compact";

    const state = slice.read();
    const filters = state.filters;
    const fields = slice.fields();
    const unit = getSomeorUndefined(value.unit);
    const seedOpen = getSomeorUndefined(value.editOpen) ?? false;

    // Compact eyebrow is one row that never wraps/clips — Priority+ overflow: as
    // many clause chips as fit, the rest collapse into `+N more`. The hook
    // measures the rendered chips once per resize / count change (see its doc).
    const { rowRef, visibleCount, measuring } = useOverflowCount(filters.length);

    // null = closed; "add" = add-builder; "more" = overflow list; "save" =
    // save-as-cohort form; a number = editing the clause at that index.
    const [open, setOpen] = useState<"add" | "more" | "save" | number | null>(seedOpen ? "add" : null);
    const [cohortName, setCohortName] = useState("");

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
        slice.defineCohort({ id, name, filters: [...filters] });
        slice.toggleCohort(id);
        setCohortName("");
        setOpen(null);
    };

    // A clause chip: the label opens the op/value editor (Slice.Edit), the × removes.
    const clausePill = (pred: PredicateValue, i: number) => (
        <SliceEditPopover
            key={i}
            open={open === i}
            onOpenChange={o => setOpen(o ? i : null)}
            label={<>{"Edit · "}<Box as="span" css={edit.clauseField}>{pred.value.fieldId}</Box></>}
            footActions={<chakra.button type="button" css={btn({ variant: "outline", size: "xs" })} onClick={() => setOpen(null)}>Cancel</chakra.button>}
            trigger={
                <Box css={chip({ tone: "brand", numeric: true, shape: compact ? "pill" : "rounded" })} cursor="pointer" flexShrink={0}>
                    <Box as="span" whiteSpace="nowrap">{formatPredicate(pred)}</Box>
                    <chakra.button type="button" cursor="pointer" color="{colors.brand.600}" flexShrink="0" onClick={e => { e.stopPropagation(); slice.removeFilter(BigInt(i)); }} aria-label="Remove filter">×</chakra.button>
                </Box>
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
                <Box css={chip({ tone: "dashed", numeric: true, shape: compact ? "pill" : "rounded" })} cursor="pointer">
                    <FontAwesomeIcon icon={faPlus} style={{ fontSize: "9px" }} />
                    <Box as="span">{compact ? "filter" : "add filter"}</Box>
                </Box>
            }
        >
            {open === "add" ? <SlicePredicateBuilder fields={fields} onAdd={pred => { slice.addFilter(pred); }} /> : null}
        </SliceEditPopover>
    );

    if (density === "editor") {
        // The sectioned editor is the terminal surface: every clause shows
        // (wrapping vertically — the editor scrolls), nothing folds, and the
        // clause / add-filter editors expand inline via `SliceEditPopover`'s
        // editor-density disclosure.
        return (
            <Box display="flex" gap="{spacing.2}" alignItems="center" flexWrap="wrap" minWidth="0">
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
        return (
            <Box ref={rowRef} position="relative" display="flex" gap="{spacing.2}" alignItems="center" flexWrap="nowrap" overflow="hidden" minWidth="0">
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
                                <Box css={chip({ tone: "more", numeric: true, shape: "pill" })} cursor="pointer">
                                    <Box as="span">{`+${measuring ? filters.length : overflow} more`}</Box>
                                    <FontAwesomeIcon icon={faChevronDown} style={{ fontSize: "8px" }} />
                                </Box>
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
                                    <Box as="span">{formatPredicate(pred)}</Box>
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
                <Box display="flex" gap="{spacing.2}" flexWrap="wrap" alignItems="center">
                    {filters.map((pred, i) => clausePill(pred, i))}
                    {addPopover}
                </Box>
            </Box>
            <Box css={frame.footer}>
                <Box as="span" css={frame.footerLabel}>
                    {`SHOWING ${Number(slice.resultCount()).toLocaleString()}${unit !== undefined ? ` ${unit}` : ""}`}
                </Box>
                <Box as="span" css={frame.footerAction}>Save view →</Box>
            </Box>
        </Box>
    );
}, () => false);
