/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useState } from "react";
import { Box, chakra, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faPen } from "@fortawesome/free-solid-svg-icons";
import { none, some, type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { useFormatters } from "../../format/index.js";
import { SLICE_SERIES_PALETTE } from "../palette";
import { formatPredicate } from "../predicate-format";
import { SlicePredicateBuilder } from "../predicate-builder";
import { SliceEditPopover } from "../edit";
import { useSliceReactivity } from "../use-slice-reactivity";
import { uniqueSlug } from "../slug";

/** East Slice.Cohort value type. */
export type SliceCohortValue = ValueTypeOf<typeof Slice.Cohort.Types.Cohort>;
type PredicateValue = ValueTypeOf<typeof Slice.Types.Predicate>;
type CohortValue = ValueTypeOf<typeof Slice.Types.Cohort>;

export interface EastChakraSliceCohortProps {
    value: SliceCohortValue;
}

/** A cohort being authored / edited in the popover. `editId === null` = new. */
interface CohortDraft {
    editId: string | null;
    name: string;
    /** The family, as typed — empty = a standalone cohort. */
    group: string;
    clauses: PredicateValue[];
}

/**
 * A cohort's family, or `undefined` for a standalone cohort. Guarded: a state
 * built before the `group` field existed (a hand-rolled test fake) has none.
 */
export function cohortGroupOf(cohort: { group?: CohortValue["group"] | undefined }): string | undefined {
    const g = cohort.group;
    return g !== undefined && g.type === "some" ? g.value : undefined;
}

/** One run of chips: the standalone cohorts (no label), or a family under its caption. */
interface CohortFamily {
    label: string | undefined;
    members: { cohort: CohortValue; index: number }[];
}

/**
 * The cohorts arranged for the bar: the standalone ones first as the plain
 * run, then each family in first-seen order. `only` keeps a single family;
 * `keep` drops a member (an empty one on the preset bar) while its palette
 * slot — its index in the whole registry — stays put. A family every member
 * of which is dropped does not appear.
 */
export function cohortFamilies(cohorts: ReadonlyArray<CohortValue>, only: string | undefined, keep: (cohort: CohortValue) => boolean = () => true): CohortFamily[] {
    const out: CohortFamily[] = [];
    cohorts.forEach((cohort, index) => {
        const label = cohortGroupOf(cohort);
        if (only !== undefined && label !== only) return;
        if (!keep(cohort)) return;
        let family = out.find(f => f.label === label);
        if (family === undefined) {
            family = { label, members: [] };
            if (label === undefined) out.unshift(family); else out.push(family);
        }
        family.members.push({ cohort, index });
    });
    return out;
}

/**
 * Renders an East UI `Slice.Cohort` — a rail of developer-defined, toggleable
 * segment pills (swatch · name · resolved count, active ones brand-tinted).
 * The pill's **primary click toggles the cohort on/off** via
 * `slice.toggleCohort(id)` (#163). Cohorts that share a `group` render as one
 * captioned run — a family whose active members OR with each other — after
 * the standalone cohorts; the `group` option keeps a single family. In
 * `manage` mode (the default) a secondary pencil opens the `Slice.Edit`
 * popover holding the predicate editor (clause chips + a builder driven by
 * `slice.fields()`) and the family field, and a `+ cohort` pill authors new
 * ones; `mode: "toggle"` renders a pure preset bar with no authoring. On that
 * preset bar a family member with no rows behind it is hidden unless it is
 * on — a family is a facet, and an option with nothing to offer is noise —
 * while a standalone cohort always shows and the authoring surface shows
 * every member so an empty one can still be edited or removed. The editor
 * never renders inline, so the surface never re-flows. Apply commits via
 * `slice.updateCohort` / `defineCohort` and activates the cohort; `Remove
 * cohort` drops it.
 */
export const EastChakraSliceCohort = memo(function EastChakraSliceCohort({ value }: EastChakraSliceCohortProps) {
    const chip = useRecipe({ key: "chip" });
    const btn = useRecipe({ key: "button" });
    const inp = useRecipe({ key: "input" });
    const edit = useSlotRecipe({ key: "sliceEdit" })({ size: "lg" });
    // Counts compact in the app's locale (#850) — `2400` is `2.4K`, `380` stays `380`.
    const words = useFormatters();
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
    // One family only, uncaptioned — a host mounting one surface per family.
    // (Optional-chained: a host payload may predate the field.)
    const only = value.group !== undefined ? getSomeorUndefined(value.group) : undefined;
    // The preset bar hides a family member with nothing behind it unless it is
    // on; standalone cohorts and the authoring surface show every one.
    const keep = (c: CohortValue): boolean => manage || cohortGroupOf(c) === undefined || activeCohorts.has(c.id) || (counts?.get(c.id) ?? 1n) > 0n;
    const families = cohortFamilies(cohorts, only, keep);

    const draftOf = (c: CohortValue): CohortDraft => ({ editId: c.id, name: c.name, group: cohortGroupOf(c) ?? "", clauses: [...c.filters] });
    const freshDraft = (): CohortDraft => ({ editId: null, name: "", group: only ?? "", clauses: [] });
    const [draft, setDraft] = useState<CohortDraft | null>(
        manage && (getSomeorUndefined(value.editOpen) ?? false)
            ? (cohorts[0] !== undefined ? draftOf(cohorts[0]) : freshDraft())
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
        const group = draft.group.trim() === "" ? none : some(draft.group.trim());
        if (draft.editId !== null) {
            slice.updateCohort(draft.editId, { id: draft.editId, name: draft.name.trim(), filters: draft.clauses, group });
            if (!activeCohorts.has(draft.editId)) slice.toggleCohort(draft.editId);
        } else {
            const id = uniqueSlug(draft.name, cohorts.map(c => c.id));
            slice.defineCohort({ id, name: draft.name.trim(), filters: draft.clauses, group });
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
            {/* The family: cohorts sharing one are alternatives (OR); blank = standalone (AND). */}
            <chakra.input
                css={inp({ size: "sm" })}
                value={draft.group}
                onChange={e => setDraft(d => d && { ...d, group: e.target.value })}
                placeholder="Family (optional)"
                aria-label="Cohort family"
            />
            {draft.clauses.map((pred, i) => (
                <Box key={i} css={edit.clauseRow}>
                    <Box as="span" css={edit.clauseConj}>{i === 0 ? "WHEN" : "AND"}</Box>
                    <Box css={edit.clauseBox}>
                        <Box as="span">{formatPredicate(pred, words)}</Box>
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

    // One cohort's chip: the primary on/off toggle (#163 — the previously-dead
    // deactivate path) and, in manage mode, the demoted edit pencil that opens
    // the authoring popover. The swatch keeps the cohort's palette slot across
    // the whole registry, whatever family it sits in.
    const chipOf = (c: CohortValue, i: number) => {
        const on = activeCohorts.has(c.id);
        const count = counts?.get(c.id);
        return (
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
                    {count !== undefined && <Box as="span" color="fg.muted">{`· ${words.compact(Number(count))}`}</Box>}
                </chakra.button>
                {manage && (
                    <SliceEditPopover
                        open={draft?.editId === c.id}
                        onOpenChange={open => setDraft(open ? draftOf(c) : null)}
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
    };

    return (
        <Box display="flex" gap="{spacing.3}" flexWrap="wrap" alignItems="center">
            {families.map(family => (
                // A family is one captioned run of alternatives; the standalone
                // cohorts are the plain run (no caption). A single requested
                // family drops its caption — the host names it.
                <Box
                    key={family.label ?? ""}
                    display="flex"
                    gap="{spacing.2}"
                    flexWrap="wrap"
                    alignItems="center"
                    role={family.label !== undefined ? "group" : undefined}
                    aria-label={family.label !== undefined ? `${family.label} cohorts` : undefined}
                    data-cohort-group={family.label}
                >
                    {family.label !== undefined && only === undefined && (
                        <Box as="span" textStyle="caption.eyebrow" color="fg.subtle" whiteSpace="nowrap">{family.label}</Box>
                    )}
                    {family.members.map(({ cohort, index }) => chipOf(cohort, index))}
                </Box>
            ))}
            {manage && allowCreate && (
                <SliceEditPopover
                    open={draft !== null && draft.editId === null}
                    onOpenChange={open => setDraft(open ? freshDraft() : null)}
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
