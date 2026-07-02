/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useState } from "react";
import { Box, chakra, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faPen } from "@fortawesome/free-solid-svg-icons";
import { type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { SLICE_SERIES_PALETTE } from "../palette";
import { formatPredicate } from "../predicate-format";
import { SlicePredicateBuilder } from "../predicate-builder";
import { SliceEditPopover } from "../edit";
import { useSliceReactivity } from "../use-slice-reactivity";
import { uniqueSlug } from "../slug";

/** East Slice.Cohort value type. */
export type SliceCohortValue = ValueTypeOf<typeof Slice.Cohort.Types.Cohort>;
type PredicateValue = ValueTypeOf<typeof Slice.Types.Predicate>;

export interface EastChakraSliceCohortProps {
    value: SliceCohortValue;
}

/** A cohort being authored / edited in the popover. `editId === null` = new. */
interface CohortDraft {
    editId: string | null;
    name: string;
    clauses: PredicateValue[];
}

/** `2400n` → `"2.4k"`, `380n` → `"380"`. */
function fmtCount(n: bigint): string {
    const num = Number(n);
    return num >= 1000
        ? `${(num / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`
        : num.toLocaleString();
}

/**
 * Renders an East UI `Slice.Cohort` — a rail of developer-defined, toggleable
 * segment pills (swatch · name · resolved count, active ones brand-tinted).
 * The pill's **primary click toggles the cohort on/off** via
 * `slice.toggleCohort(id)` (#163). In `manage` mode (the default) a secondary
 * pencil opens the `Slice.Edit` popover holding the predicate editor (clause
 * chips + a builder driven by `slice.fields()`) and a `+ cohort` pill authors
 * new ones; `mode: "toggle"` renders a pure preset bar with no authoring. The
 * editor never renders inline, so the surface never re-flows. Apply commits
 * via `slice.updateCohort` / `defineCohort` and activates the cohort;
 * `Remove cohort` drops it.
 */
export const EastChakraSliceCohort = memo(function EastChakraSliceCohort({ value }: EastChakraSliceCohortProps) {
    const chip = useRecipe({ key: "chip" });
    const btn = useRecipe({ key: "button" });
    const inp = useRecipe({ key: "input" });
    const edit = useSlotRecipe({ key: "sliceEdit" })({ size: "lg" });
    const { slice } = value;
    useSliceReactivity(slice.key);

    const state = slice.read();
    const cohorts = state.cohorts;
    const activeCohorts = state.activeCohorts;
    const fields = slice.fields();
    const counts = slice.cohortCounts();
    const createdBy = getSomeorUndefined(value.createdBy);
    const lastEdited = getSomeorUndefined(value.lastEdited);
    const reevaluateEvery = getSomeorUndefined(value.reevaluateEvery);
    // `toggle` = curated preset bar: no pencil, no `+ cohort`, no editor.
    const manage = (getSomeorUndefined(value.mode)?.type ?? "manage") === "manage";
    const allowCreate = getSomeorUndefined(value.allowCreate) ?? manage;

    const [draft, setDraft] = useState<CohortDraft | null>(
        manage && (getSomeorUndefined(value.editOpen) ?? false)
            ? (cohorts[0] !== undefined
                ? { editId: cohorts[0].id, name: cohorts[0].name, clauses: [...cohorts[0].filters] }
                : { editId: null, name: "", clauses: [] })
            : null,
    );

    // Why the draft can't Apply yet — drives the disabled button + inline hint
    // (the silent-no-op Apply was #163's ergonomics gap).
    const draftInvalid = draft === null
        ? undefined
        : draft.editId === null && draft.name.trim() === "" ? "Give the cohort a name."
            : draft.clauses.length === 0 ? "Add at least one clause."
                : undefined;

    const commit = () => {
        if (draft === null || draft.name.trim() === "" || draft.clauses.length === 0) return;
        if (draft.editId !== null) {
            slice.updateCohort(draft.editId, { id: draft.editId, name: draft.name.trim(), filters: draft.clauses });
            if (!activeCohorts.has(draft.editId)) slice.toggleCohort(draft.editId);
        } else {
            const id = uniqueSlug(draft.name, cohorts.map(c => c.id));
            slice.defineCohort({ id, name: draft.name.trim(), filters: draft.clauses });
            slice.toggleCohort(id);
        }
        setDraft(null);
    };

    const editor = draft !== null && (
        <>
            {draft.editId === null && (
                <chakra.input
                    css={inp({ size: "sm" })}
                    value={draft.name}
                    onChange={e => setDraft(d => d && { ...d, name: e.target.value })}
                    placeholder="Cohort name"
                    aria-label="Cohort name"
                />
            )}
            {draft.clauses.map((pred, i) => (
                <Box key={i} css={edit.clauseRow}>
                    <Box as="span" css={edit.clauseConj}>{i === 0 ? "WHEN" : "AND"}</Box>
                    <Box css={edit.clauseBox}>
                        <Box as="span">{formatPredicate(pred)}</Box>
                        <chakra.button
                            type="button"
                            css={edit.moreRowRemove}
                            onClick={() => setDraft(d => d && { ...d, clauses: d.clauses.filter((_, j) => j !== i) })}
                            aria-label="Remove clause"
                        >
                            ×
                        </chakra.button>
                    </Box>
                </Box>
            ))}
            <SlicePredicateBuilder fields={fields} onAdd={pred => setDraft(d => d && { ...d, clauses: [...d.clauses, pred] })} />
            {draftInvalid !== undefined && <Box as="span" css={edit.hint}>{draftInvalid}</Box>}
            {(createdBy !== undefined || lastEdited !== undefined || reevaluateEvery !== undefined) && (
                <Box css={edit.resolveLine}>
                    {[
                        createdBy !== undefined ? `created by ${createdBy}` : undefined,
                        lastEdited !== undefined ? `last edited ${lastEdited}` : undefined,
                        reevaluateEvery !== undefined ? `re-evaluated ${reevaluateEvery}` : undefined,
                    ].filter(Boolean).join(" · ")}
                </Box>
            )}
        </>
    );

    const foot = {
        left: draft?.editId != null
            ? <chakra.button type="button" css={edit.footDanger} onClick={() => { slice.removeCohort(draft.editId!); setDraft(null); }}>Remove cohort</chakra.button>
            : undefined,
        actions: (
            <>
                <chakra.button type="button" css={btn({ variant: "outline", size: "xs" })} onClick={() => setDraft(null)}>Cancel</chakra.button>
                <chakra.button type="button" css={btn({ variant: "solid", size: "xs" })} disabled={draftInvalid !== undefined} onClick={commit}>Apply</chakra.button>
            </>
        ),
    };

    return (
        <Box display="flex" gap="{spacing.2}" flexWrap="wrap" alignItems="center">
            {cohorts.map((c, i) => {
                const on = activeCohorts.has(c.id);
                const count = counts?.get(c.id);
                return (
                    // The chip holds two sibling controls: the primary on/off
                    // toggle (#163 — the previously-dead deactivate path) and,
                    // in manage mode, the demoted edit pencil that opens the
                    // authoring popover.
                    <Box key={c.id} css={chip({ tone: on ? "brand" : "neutral", numeric: true })}>
                        <chakra.button
                            type="button"
                            css={edit.chipToggle}
                            onClick={() => slice.toggleCohort(c.id)}
                            aria-pressed={on}
                            aria-label={`Toggle cohort ${c.name}`}
                        >
                            <Box as="span" width="8px" height="8px" borderRadius="full" background={on ? SLICE_SERIES_PALETTE[i % SLICE_SERIES_PALETTE.length] : "border.strong"} />
                            <Box as="span">{c.name}</Box>
                            {count !== undefined && <Box as="span" color="fg.muted">{`· ${fmtCount(count)}`}</Box>}
                        </chakra.button>
                        {manage && (
                            <SliceEditPopover
                                open={draft?.editId === c.id}
                                onOpenChange={open => setDraft(open ? { editId: c.id, name: c.name, clauses: [...c.filters] } : null)}
                                label={<>{"Edit cohort · "}<Box as="span" css={edit.clauseField}>{c.name}</Box></>}
                                size="lg"
                                footLeft={foot.left}
                                footActions={foot.actions}
                                trigger={
                                    <chakra.button type="button" css={edit.chipEdit} aria-label={`Edit cohort ${c.name}`}>
                                        <FontAwesomeIcon icon={faPen} />
                                    </chakra.button>
                                }
                            >
                                {draft?.editId === c.id ? editor : null}
                            </SliceEditPopover>
                        )}
                    </Box>
                );
            })}
            {manage && allowCreate && (
                <SliceEditPopover
                    open={draft !== null && draft.editId === null}
                    onOpenChange={open => setDraft(open ? { editId: null, name: "", clauses: [] } : null)}
                    label="New cohort"
                    size="lg"
                    footActions={foot.actions}
                    trigger={
                        <Box css={chip({ tone: "dashed", numeric: true })} cursor="pointer">
                            <FontAwesomeIcon icon={faPlus} style={{ fontSize: "9px" }} />
                            <Box as="span">cohort</Box>
                        </Box>
                    }
                >
                    {draft !== null && draft.editId === null ? editor : null}
                </SliceEditPopover>
            )}
        </Box>
    );
}, () => false);
