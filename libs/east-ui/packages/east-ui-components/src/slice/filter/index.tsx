/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useState } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { none, type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { useFormatters } from "../../format/index.js";
import { formatPredicate } from "../predicate-format";
import { SlicePredicateBuilder } from "../predicate-builder";
import { useSliceDensity } from "../density";
import { useSliceReactivity } from "../use-slice-reactivity";
import { uniqueSlug } from "../slug";
import { SliceFilterChips, type SliceFilterChip } from "./chips.js";

export { SliceFilterChips, type SliceFilterChip, type SliceFilterChipsProps, type SliceFilterSave } from "./chips.js";

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
 * one row of as many brand chips as fit with a remove — Font Awesome's xmark,
 * never a text glyph (#1263) — a `+N more` chip opening a
 * `Slice.Edit` list, and a dashed `+ FILTER` chip opening the builder popover.
 * **Focused** (standalone): the same chip rail plus a `SHOWING N {unit}` footer
 * (result **of** total). The add-filter builder always lives in a `Slice.Edit`
 * popover, so opening it never re-flows the surface.
 *
 * The chips, their fold and their editors' popovers are the shared row's
 * (`./chips.tsx`, #1673), which a Studio page's filters draw too: a clause is
 * a chip of its predicate's words, whose editor is the predicate builder.
 */
export const EastChakraSliceFilter = memo(function EastChakraSliceFilter({ value, foldChips }: EastChakraSliceFilterProps) {
    const frame = useSlotRecipe({ key: "sliceFrame" })();
    const edit = useSlotRecipe({ key: "sliceEdit" })();
    const { slice } = value;
    useSliceReactivity(slice.key);
    const density = useSliceDensity(getSomeorUndefined(value.density)?.type as ("compact" | "focused" | undefined));
    // Counts and clause dates, in the app's locale (#850).
    const words = useFormatters();

    const state = slice.read();
    const filters = state.filters;
    const fields = slice.fields();
    const unit = getSomeorUndefined(value.unit);
    const seedOpen = getSomeorUndefined(value.editOpen) ?? false;
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
        // A saved filter set is a standalone cohort — it ANDs with everything.
        slice.defineCohort({ id, name, filters: [...filters], group: none });
        slice.toggleCohort(id);
        setCohortName("");
    };

    // A clause: a chip of its predicate's words, opening the op/value editor.
    const chips = filters.map((pred, i): SliceFilterChip => ({
        label: formatPredicate(pred, words),
        editLabel: <>{"Edit · "}<Box as="span" css={edit.clauseField}>{pred.value.fieldId}</Box></>,
        editor: (close) => <SlicePredicateBuilder fields={fields} initial={pred} lockField submitLabel="Apply" onAdd={p => { replaceFilter(i, p); close(); }} />,
    }));
    const row = (
        <SliceFilterChips chips={chips} density={density} foldChips={foldChips} seedOpen={seedOpen}
            onRemove={i => slice.removeFilter(BigInt(i))} onClear={() => slice.clearFilters()}
            add={(close) => <SlicePredicateBuilder fields={fields} onAdd={pred => { slice.addFilter(pred); close(); }} />}
            save={{ name: cohortName, onName: setCohortName, onSave: saveCohort }} />
    );
    if (density !== "focused") return row;

    return (
        <Box css={frame.root}>
            <Box css={frame.body}>{row}</Box>
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
