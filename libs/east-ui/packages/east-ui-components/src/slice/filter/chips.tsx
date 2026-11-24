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
 * An editor's actions stand in its popover's foot, one row of them (the
 * design system's Slice edit): a filter's — Remove filter at its start, then
 * Cancel and Apply; a new filter's — Cancel and Add filter. A popover whose
 * foot holds Cancel draws no close × in its head (ruled 22 November 2026):
 * Cancel is what closes it, and no × stands over the ×s of its editor's rows.
 * One whose foot holds Done — a new filter's that adds by itself, `+N more`'s
 * list — keeps its ×. A host whose
 * editors' edits wait for that button — a Studio page's filters, whose
 * condition rows are a draft — says what the button does with the draft its
 * editor tells the row (`apply`, `addApply`): nothing changes until it is
 * pressed, and it stands off while there is nothing to commit. An editor that
 * submits by itself — Slice's predicate builder, its submit in its body —
 * gives none, and its foot holds Cancel, or Done, alone.
 *
 * While one of the row's editors is open — a filter's, a new filter's,
 * `+N more`'s — the row stands as it stood as the editor opened (#1673): its
 * chips' words, how many there are and how many show; and the rail it is drawn
 * in holds its form (`../rail/hold.ts`). The popover hanging from the row then
 * never moves as an edit applies; the editors themselves are drawn live, and
 * the row takes what they did once no editor is open and the press that shut
 * the last has clicked (`../../pointer/press-wait.ts`) — a press on another
 * chip opens that chip's editor where the row stood, and the row stays held.
 * A filter taken out meanwhile leaves the row at once.
 *
 * A host whose filters fall into groups — a Studio page's, each on one of the
 * page's datasets — gives each chip its group: the row draws a group's chips
 * together and names the group once, before the first of them it draws, in
 * the caption type a group's fields are headed in (`railGroupLabel`); a group
 * folded whole into `+N more` goes unnamed in the row. The groups come in the
 * order the host names them (`groups`), so no filter added or taken out
 * reorders them (`./groups.ts`). A chip is still told by its place in the
 * host's order: what `onRemove` and its editor are told.
 *
 * `+N more` holds what it counts: the filters the row folds, in the order the
 * row draws them — none it shows — under their groups' names, a group split
 * between the row and `+N more` named in each; its head counts them
 * (`2 more filters`), and its Clear all takes every filter out, the row's too.
 * A filter it holds is edited there, as one the row shows is from its chip: a
 * press on its words shows its editor in the same popover — its head, its body
 * and its foot the filter's — and Cancel, Apply and Remove filter give the
 * list back, which says what was done. A filter no room is left to show is
 * never one that cannot be edited. The popover says which it shows (`view`),
 * so an editor too tall for the room its list opened in opens on the side of
 * the chip that holds it.
 *
 * The focus goes with what `+N more` shows: to the editor's first control
 * (`editorFocus`) as a line opens its filter's editor, and back to that line — or the
 * line that took its place — as the list comes back; never left on nothing,
 * nor on a button drawn where the one pressed stood (Clear all, where Cancel
 * was). A line its × takes out hands the focus on the same way. Left with no
 * filter to hold, `+N more` goes from the row, its popover with it: it is shut,
 * so the row lets go of what it held, and the focus goes to the row's last
 * chip, else `+ FILTER` — the row's own hand-off: a host that then draws the
 * row anew, as the shared toolbar does where the rail takes another of its
 * forms, draws one that holds no focus.
 *
 * @packageDocumentation
 */

import { Fragment, useCallback, useContext, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Box, chakra, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faChevronDown, faXmark } from "@fortawesome/free-solid-svg-icons";
import { coarseHitArea } from "../../style/hit-area.js";
import { useSlotStyles } from "../../theme/slot-styles.js";
import { SliceFieldChip } from "../choice.js";
import { useOverflowCount } from "../../hooks/useOverflowCount";
import { SliceEditPopover, editorFocus } from "../edit";
import { SliceRailHold } from "../rail/hold.js";
import type { SliceRailGroup } from "../rail/toolbar.js";
import { usePressWait } from "../../pointer/press-wait.js";
import { chipOrder, foldedOrder } from "./groups.js";

/**
 * One filter of the row, as its chip shows it.
 *
 * @typeParam D - What its editor tells the row of its draft, which its Apply is given; none for an editor that submits by itself
 */
export interface SliceFilterChip<D = never> {
    /** Its words. */
    readonly label: string;
    /** Its whole words, where its label says them short: what its hover says, its label cut with an ellipsis where it runs long (#1673). */
    readonly whole?: string | undefined;
    /** The group it is drawn in, named once before the group's first chip (#1673): a Studio page's dataset; its icon and count go unsaid. In none unless given. */
    readonly group?: SliceRailGroup | undefined;
    /** Its editor's head. */
    readonly editLabel: ReactNode;
    /** Its editor, drawn while it is open; `close` puts it away, and `tell` hands the row its draft, which its Apply is given. */
    readonly editor: (close: () => void, tell: (draft: D) => void) => ReactNode;
    /**
     * What Apply does with its editor's draft — `undefined` before the editor tells one — for an editor whose edits wait
     * for it: `undefined` while there is nothing to apply, which stands Apply off. Its foot then holds Cancel and Apply.
     * An editor that submits by itself gives none, and its foot holds Cancel alone.
     */
    readonly apply?: ((draft: D | undefined) => (() => void) | undefined) | undefined;
}

/** The row as it stood as an editor opened: each chip's words, and how many showed. */
interface Frozen {
    readonly labels: readonly string[];
    readonly wholes: readonly (string | undefined)[];
    readonly visible: number;
}

/**
 * The row as it stands, to hold while an editor is open.
 *
 * @param chips - Its chips
 * @param visible - How many of them show
 * @returns Each chip's words, and how many show
 */
function rowAsItStands(chips: readonly Pick<SliceFilterChip, "label" | "whole">[], visible: number): Frozen {
    return { labels: chips.map((held) => held.label), wholes: chips.map((held) => held.whole), visible };
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

/**
 * Props of {@link SliceFilterChips}.
 *
 * @typeParam D - What an editor tells the row of its draft
 */
export interface SliceFilterChipsProps<D = never> {
    /** The filters, in order. */
    readonly chips: readonly SliceFilterChip<D>[];
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
    /** A new filter's editor, drawn while it is open; `close` puts it away, and `tell` hands the row its draft, which its Add filter is given. */
    readonly add: (close: () => void, tell: (draft: D) => void) => ReactNode;
    /**
     * What Add filter does with a new filter's editor's draft, for an editor whose filter waits for it: `undefined` while
     * there is none to add, which stands Add filter off. Its foot then holds Cancel and Add filter; an editor that adds
     * by itself gives none, and its foot holds Done.
     */
    readonly addApply?: ((draft: D | undefined) => (() => void) | undefined) | undefined;
    /** What a new filter's editor is called — the dataset it filters, say (#1673): `Add filter` when omitted. */
    readonly addLabel?: string | undefined;
    /** Whether it opens with a new filter's editor showing. */
    readonly seedOpen?: boolean | undefined;
    /** Saving the filters as a set, offered inside `+N more` while there are two or more; none unless given. */
    readonly save?: SliceFilterSave | undefined;
    /** Its chips' groups' keys in the order it draws the groups; a group not among them comes after, in the order its first chip comes. */
    readonly groups?: readonly string[] | undefined;
    /**
     * Its editors are rows of conditions — a Studio page's filters: every popover of the row — a filter's, a new
     * filter's, `+N more`'s, which holds a folded filter's editor — is the size that holds them (`xl`), one width
     * whatever it shows. Otherwise a filter's is the small size, and a new filter's and `+N more`'s the large.
     */
    readonly rows?: boolean | undefined;
}

/**
 * A row of filter chips — see the module docs.
 *
 * @param props - The filters, the density, how many fold, what removing, clearing and adding do, a new filter's editor's name, the groups' order, and whether its editors are rows of conditions
 * @returns The row
 */
export function SliceFilterChips<D = never>({ chips, density, foldChips, onRemove, onClear, add, addApply, addLabel, seedOpen = false, save, groups, rows = false }: SliceFilterChipsProps<D>) {
    const chip = useRecipe({ key: "chip" });
    const btn = useRecipe({ key: "button" });
    const inp = useRecipe({ key: "input" });
    const edit = useSlotRecipe({ key: "sliceEdit" })();
    const frame = useSlotStyles("sliceFrame");
    const compact = density === "compact";
    // Its popovers' sizes: a filter's own, and a new filter's and `+N more`'s.
    const wide = rows ? "xl" as const : "lg" as const;

    // null = closed; "add" = a new filter's editor; "more" = overflow list;
    // "save" = save-as-a-set form; a number = editing the filter at that index — from its chip, or, one the row folds,
    // in `+N more`.
    const [open, setOpened] = useState<"add" | "more" | "save" | number | null>(seedOpen ? "add" : null);
    // The open editor's draft, as it tells it: what its Apply, or Add filter, is given. Another editor starts with none.
    const [draft, setDraft] = useState<D | undefined>(undefined);
    const setOpen = useCallback((next: "add" | "more" | "save" | number | null) => {
        setDraft(undefined);
        setOpened(next);
    }, []);
    const close = () => setOpen(null);
    const btnOutline = btn({ variant: "outline", size: "xs" });
    /** An editor's foot's actions: Cancel, and — for one whose edits wait for it — its submit, off while it has nothing to do. */
    const actions = (cancel: () => void, submit: { readonly words: string; readonly run: (() => void) | undefined } | undefined, alone: string) => (
        <>
            <chakra.button type="button" css={btnOutline} onClick={cancel}>{submit === undefined ? alone : "Cancel"}</chakra.button>
            {submit !== undefined && (
                <chakra.button type="button" css={btnOutline} disabled={submit.run === undefined} data-slice-submit=""
                    onClick={() => { const run = submit.run; cancel(); run?.(); }}>{submit.words}</chakra.button>
            )}
        </>
    );
    /** A filter's editor's foot: Remove filter, then Cancel and Apply; `done` is where its actions leave it — shut, or back at `+N more`'s list. */
    const filterFoot = (held: SliceFilterChip<D>, i: number, done: () => void) => ({
        footLeft: <chakra.button type="button" css={edit.footDanger} onClick={() => { done(); onRemove(i); }}>Remove filter</chakra.button>,
        footActions: actions(done, held.apply === undefined ? undefined : { words: "Apply", run: held.apply(draft) }, "Cancel"),
    });

    // The row as it stood as an editor opened, while one is open (#1673): its chips' words, and how many show.
    const [frozen, setFrozen] = useState<Frozen | null>(null);
    const rowChips = frozen === null ? chips
        : chips.slice(0, frozen.labels.length).map((held, i) => ({ ...held, label: frozen.labels[i]!, whole: frozen.wholes[i] }));
    // The order the row draws its chips in, each group's together.
    const rowGroups = rowChips.map((held) => held.group?.key);
    const drawn = chipOrder(rowGroups, groups);

    // Compact eyebrow is one row that never wraps/clips — Priority+ overflow: as
    // many chips as fit, the rest collapse into `+N more`. The hook measures the
    // rendered chips once per resize / count change (see its doc) — unless the
    // shared toolbar decides the fold (`foldChips`, #952).
    const controlled = foldChips !== undefined;
    const ownFold = useOverflowCount(rowChips.length, !controlled);
    const rowRef = ownFold.rowRef;
    const visibleNow = controlled ? Math.max(0, chips.length - foldChips) : ownFold.visibleCount;
    const visibleCount = frozen?.visible ?? visibleNow;
    const measuring = !controlled && ownFold.measuring;
    // A compact row's chips that fit, the rest folded into `+N more`; while it is measured every chip is in flow, and
    // `+N more` is drawn beside any, its width kept for it.
    const fits = compact ? drawn.order.slice(0, visibleCount) : drawn.order;
    const shown = measuring ? drawn.order : fits;
    const overflow = rowChips.length - (measuring ? 0 : visibleCount);
    const showMore = compact && (measuring ? rowChips.length > 0 : overflow > 0);
    // What `+N more`'s popover shows: its list (`more`), a cohort's name (`save`), or the editor of a filter the row
    // folds, by the filter's place — nothing while it is shut, or not drawn.
    const moreView = !showMore ? null : open === "more" || open === "save" ? open : typeof open === "number" && !fits.includes(open) ? open : null;
    // `+N more` gone from the row while its popover is open — the last filter it held taken out — leaves no popover to
    // shut it: it is shut here, so the row lets go of what it held.
    const moreGone = (open === "more" || open === "save") && !showMore;
    useLayoutEffect(() => { if (moreGone) setOpen(null); }, [moreGone, setOpen]);
    // The focus, as what `+N more` shows changes — see the module docs. `moreLine` is the place, among its list's lines,
    // of the line last pressed: its filter's editor opened, or its filter taken out.
    const moreBody = useRef<HTMLDivElement | null>(null);
    const moreLine = useRef(0);
    const moreWas = useRef(moreView);
    useLayoutEffect(() => {
        // A row being measured draws every chip, and its list none: it is read once it has settled.
        if (measuring) return;
        const was = moreWas.current;
        moreWas.current = moreView;
        // Shut before: as it opens, the focus is the popover's own. A cohort's name takes it for itself.
        if (was === null || moreView === "save") return;
        const active = document.activeElement;
        const onNothing = active === null || active === document.body;
        if (moreView === null) {
            // Shut with `+N more` still in the row, the focus goes back to it, as any popover's does to its trigger.
            const row = rowRef.current;
            if (showMore || !onNothing || row === null) return;
            const clauses = row.querySelectorAll<HTMLElement>("[data-slice-clause]");
            (clauses[clauses.length - 1] ?? row.querySelector<HTMLElement>("[data-slice-add='filter']"))?.focus({ preventScroll: true });
            return;
        }
        const body = moreBody.current;
        if (body === null || (was === moreView && !onNothing)) return;
        const lines = body.querySelectorAll<HTMLElement>("[data-slice-more-edit]");
        const line = moreView === "more" ? lines[Math.min(moreLine.current, lines.length - 1)] : undefined;
        (line ?? editorFocus(body.closest("[role='dialog']")))?.focus({ preventScroll: true });
    });

    // An editor opening holds the row as it stands, and the rail it is drawn in. The row lets both go once no editor is
    // open and the press that shut the last has clicked — on another chip, where the row stood; an editor that click
    // opens keeps them held. A row that never held — one drawn to be measured — lets go of nothing.
    const holdRail = useContext(SliceRailHold);
    const holding = useRef(holdRail);
    const holds = useRef(false);
    const letGo = useRef<() => void>(() => undefined);
    const afterPress = usePressWait();
    useLayoutEffect(() => { holding.current = holdRail; });
    useLayoutEffect(() => {
        if (open !== null) {
            letGo.current();
            if (!holds.current) {
                holds.current = true;
                holding.current(true);
            }
            setFrozen((was) => was ?? rowAsItStands(chips, visibleNow));
            return;
        }
        if (!holds.current) return;
        letGo.current = afterPress(() => {
            holds.current = false;
            setFrozen(null);
            holding.current(false);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the row as it stood as the editor opened: its chips then, not as its edits change them
    }, [open]);
    // A filter taken out while the row is held: the row says what is left at once, folding where it stood.
    const seen = useRef(chips.length);
    useLayoutEffect(() => {
        const was = seen.current;
        seen.current = chips.length;
        if (chips.length < was) setFrozen((held) => (held === null ? null : rowAsItStands(chips, Math.min(held.visible, chips.length))));
    }, [chips]);
    useLayoutEffect(() => () => {
        letGo.current();
        if (holds.current) holding.current(false);
    }, []);

    // A filter removed by Delete hands the focus on once the chips have drawn
    // again, as a Sheet tab's close does (#860): to the filter that takes its
    // place in the row, else the one before it, else `+N more`, else `+ FILTER`.
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
    const onClauseKey = (i: number, at: number) => (e: KeyboardEvent<HTMLElement>) => {
        if (e.key !== "Delete") return;
        e.preventDefault();
        const row = e.currentTarget.closest("[data-slice-filter]");
        if (row !== null) focusAfter.current = { chips: row, index: at };
        onRemove(i);
    };

    // A filter's chip: one button opening its editor (Slice.Edit), whose foot
    // removes the filter; its xmark the pointer's (#1231). It is the host's
    // `i`th, drawn `at`th in the row.
    const clausePill = (held: SliceFilterChip<D>, i: number, at: number) => (
        <SliceEditPopover
            key={i}
            open={open === i}
            onOpenChange={o => setOpen(o ? i : null)}
            label={held.editLabel}
            {...(rows ? { size: wide } : {})}
            headClose={false}
            {...filterFoot(held, i, close)}
            trigger={
                <SliceFieldChip label={held.label} title={held.whole} active data-slice-clause={i} data-chip-cut={held.whole === undefined ? undefined : ""}
                    onKeyDown={onClauseKey(i, at)} onRemove={() => onRemove(i)} />
            }
        >
            {open === i ? held.editor(close, setDraft) : null}
        </SliceEditPopover>
    );
    // A chip's group's name, before the chip drawn `at`th where it is the first of its group the row draws.
    const groupName = (held: SliceFilterChip<D>, at: number) => (drawn.starts[at] === true && held.group !== undefined
        ? <Box as="span" css={frame.railGroupLabel} data-slice-chip-group={held.group.key}>{held.group.label}</Box>
        : null);
    // A chip drawn in a row that wraps: after its group's name where it starts its group, the two kept on one line.
    const wrapped = (i: number, at: number) => {
        const held = rowChips[i]!;
        const name = groupName(held, at);
        return name === null ? clausePill(held, i, at) : <Box key={i} css={frame.railAffordance}>{name}{clausePill(held, i, at)}</Box>;
    };

    const addPopover = (
        <SliceEditPopover
            open={open === "add"}
            onOpenChange={o => setOpen(o ? "add" : null)}
            label={addLabel ?? "Add filter"}
            size={wide}
            headClose={addApply === undefined}
            footActions={actions(close, addApply === undefined ? undefined : { words: "Add filter", run: addApply(draft) }, "Done")}
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
            {open === "add" ? add(close, setDraft) : null}
        </SliceEditPopover>
    );

    if (density === "editor") {
        // The sectioned editor is the terminal surface: every filter shows
        // (wrapping vertically — the editor scrolls), nothing folds, and the
        // filter / add-filter editors expand inline via `SliceEditPopover`'s
        // editor-density disclosure.
        return (
            <Box display="flex" gap="{spacing.2}" alignItems="center" flexWrap="wrap" minWidth="0" data-slice-filter="">
                {drawn.order.map(wrapped)}
                {addPopover}
            </Box>
        );
    }

    if (compact) {
        // During the measure pass every chip is in flow; once measured we show
        // the leading `visibleCount` and collapse the rest into `+N more` — a
        // group's name in the item of its first chip, so it is measured and
        // folds with it.
        // What `+N more` holds: the filters the row folds, in the order it draws them — none it shows. Its chip's width
        // is reserved during measuring (worst-case count), so it never collapses one chip too many once it appears.
        const folded = foldedOrder(drawn, rowGroups, shown.length);
        const more = folded.order.length;
        const saving = save !== undefined && open === "save";
        // A folded filter being edited in `+N more`: the popover is that filter's editor, and its actions give the list back.
        const editedAt = typeof moreView === "number" ? moreView : undefined;
        const edited = editedAt === undefined ? undefined : chips[editedAt];
        const toList = () => setOpen("more");
        // The row clips sideways only: a chip's touch halo reaches above and below it (#1221).
        return (
            <Box ref={rowRef} position="relative" display="flex" gap="{spacing.2}" alignItems="center" flexWrap="nowrap" overflowX="clip" minWidth="0" data-slice-filter="">
                {shown.map((i, at) => (
                    <Box key={i} css={frame.railAffordance} data-overflow-item>
                        {groupName(rowChips[i]!, at)}
                        {clausePill(rowChips[i]!, i, at)}
                    </Box>
                ))}
                <Box data-overflow-rest display="inline-flex" alignItems="center" gap="{spacing.2}" flexShrink="0">
                    {showMore && (
                        <SliceEditPopover
                            open={open === "more" || open === "save" || edited !== undefined}
                            onOpenChange={o => setOpen(o ? "more" : null)}
                            label={edited !== undefined ? edited.editLabel : saving ? "Save as cohort" : `${more} more filter${more === 1 ? "" : "s"}`}
                            size={wide}
                            view={edited !== undefined ? "editor" : saving ? "save" : "list"}
                            headClose={edited === undefined && !saving}
                            {...(edited !== undefined && editedAt !== undefined ? filterFoot(edited, editedAt, toList) : {
                                footLeft: save !== undefined && !saving && chips.length >= 2 ? <chakra.button type="button" css={edit.footLink} onClick={() => setOpen("save")}>Save as cohort →</chakra.button> : undefined,
                                footActions: saving
                                    ? (
                                        <>
                                            <chakra.button type="button" css={btnOutline} onClick={() => setOpen("more")}>Cancel</chakra.button>
                                            <chakra.button type="button" css={btn({ variant: "solid", size: "xs" })} disabled={save.name.trim() === ""} onClick={() => { save.onSave(); setOpen(null); }}>Save</chakra.button>
                                        </>
                                    )
                                    : (
                                        <>
                                            <chakra.button type="button" css={btnOutline} onClick={() => { onClear(); setOpen(null); }}>Clear all</chakra.button>
                                            <chakra.button type="button" css={btnOutline} onClick={close}>Done</chakra.button>
                                        </>
                                    ),
                            })}
                            trigger={
                                // A 44px touch target on a coarse pointer, by its halo (#1231).
                                <chakra.button type="button" css={[chip({ tone: "more" }), coarseHitArea({ position: true })]} cursor="pointer"
                                    data-slice-more="">
                                    <Box as="span">{`+${measuring ? rowChips.length : overflow} more`}</Box>
                                    <FontAwesomeIcon icon={faChevronDown} style={{ fontSize: "8px" }} />
                                </chakra.button>
                            }
                        >
                            {/* What it shows, in the popover's body with no box of its own: where the focus is sent from. */}
                            <Box ref={moreBody} css={edit.moreBody}>
                                {edited !== undefined && edited.editor(toList, setDraft)}
                                {saving && (
                                    <Box css={edit.field}>
                                        <chakra.input css={inp({ size: "sm" })} value={save.name} onChange={e => save.onName(e.target.value)} placeholder="Cohort name" aria-label="Cohort name" required aria-required="true" aria-invalid={save.name.trim() === ""} autoFocus />
                                        {save.name.trim() === "" && <Box as="span" fontFamily="mono" fontSize="10px" color="fg.muted">Give the cohort a name to save it.</Box>}
                                    </Box>
                                )}
                                {(open === "more" || open === "save") && folded.order.map((i, at) => {
                                    const held = chips[i]!;
                                    const words = held.whole ?? held.label;
                                    return (
                                        <Fragment key={i}>
                                            {/* Each group's filters under its name, in the caption a group's fields are headed by. */}
                                            {folded.starts[at] === true && held.group !== undefined && (
                                                <Box css={frame.railGroupHead} data-slice-more-group={held.group.key}>
                                                    <Box as="span" css={frame.railGroupLabel}>{held.group.label}</Box>
                                                </Box>
                                            )}
                                            <Box css={edit.moreRow} data-slice-more-row={i}>
                                                {/* Its words and its Edit are one button: pressed, the popover is the filter's editor. */}
                                                {open === "more" ? (
                                                    <chakra.button type="button" css={edit.moreRowOpen} aria-label={`Edit filter: ${words}`} data-slice-more-edit=""
                                                        onClick={() => { moreLine.current = at; setOpen(i); }}>
                                                        <Box as="span" data-slice-more-words="">{words}</Box>
                                                        <Box as="span" css={edit.moreRowEdit}>Edit</Box>
                                                    </chakra.button>
                                                ) : <Box as="span" data-slice-more-words="">{words}</Box>}
                                                {open === "more" && (
                                                    <chakra.button type="button" css={edit.moreRowRemove} onClick={() => { moreLine.current = at; onRemove(i); }} aria-label="Remove filter">
                                                        <FontAwesomeIcon icon={faXmark} />
                                                    </chakra.button>
                                                )}
                                            </Box>
                                        </Fragment>
                                    );
                                })}
                            </Box>
                        </SliceEditPopover>
                    )}
                    <Box data-overflow-keep display="inline-flex">{addPopover}</Box>
                </Box>
            </Box>
        );
    }

    return (
        <Box display="flex" gap="{spacing.2}" flexWrap="wrap" alignItems="center" data-slice-filter="">
            {drawn.order.map(wrapped)}
            {addPopover}
        </Box>
    );
}
