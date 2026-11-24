/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `StudioWells` — a visual's wells in its Configure tab (#1672, EDT-2 to
 * EDT-7, MOD-5, MOD-6), drawn from its kind's declaration: one well a field of
 * the kind's struct, in order, a single well holding one pill, a list well
 * several and a slot to add another. A pill is what the visual reads there,
 * as the spec's editor draws it: its field's kind, its name, what it is set
 * to beyond its aggregate in a note (`goal 450k`, `top 2 + Other`), a value's
 * aggregate or a date's bucket on a chip, and its remove. Its name and what
 * it is set to are one button, which opens its menu: a value's (EDT-6) or a
 * group's popover (EDT-7).
 *
 * A field reaches a well three ways, each the same edit (EDT-3): dragged from
 * the source's Fields list onto it — a single well's pill replaced, a list
 * well's appended, or put where it is dropped among them (EDT-5) — its empty
 * place saying so while the drag rests over it; chosen from its slot's
 * chooser; or chosen in place of a pill's field — by a single well's pill's
 * kind mark, or a list of fields' pill's name. A field placed takes its
 * defaults (MOD-6, East's `placedPill`). A
 * well takes only the kinds of field it accepts (EDT-4): a drag over one that
 * does not is refused, saying why, and its chooser offers such a field
 * refused. A list well's pill moves by its kind's mark, its grip, or ⌥↑ and
 * ⌥↓ on it. A pill whose field the source does not have is marked, and its
 * well says which (MOD-5).
 *
 * Every edit is the visual's view written whole — one gesture of the canvas —
 * through the wells' model in e3-ui (`placedInWell`, `movedInWell`,
 * `removedFromWell`, `replacedInWell`).
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { Box, chakra, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import { faArrowDown, faChevronDown, faCircleExclamation, faPlus, faXmark } from "@fortawesome/free-solid-svg-icons";
import { StringType, equalFor, variant, type ValueTypeOf } from "@elaraai/east";
import {
    StudioVisualType, fieldFits, movedInWell, pillFields, placedInWell, removedFromWell, replacedInWell, wellMost, wellPills,
    type StudioKindEditor, type StudioPill, type StudioWell,
} from "@elaraai/e3-ui/internal";
import {
    Pill, SliceEditPopover, useDragEventChip, useDragTarget, useDropCell, useFormatters,
    type CellCoord, type DragEventValue, type DragPayload,
} from "@elaraai/east-ui-components";
import { Chooser, type ChooserOption, type ChooserSection } from "@elaraai/east-ui-components/internal";

import { useStudioMessages, type StudioMessages } from "./messages.js";
import { GroupMenu, ValueMenu, aggregateWords, groupWords, type PillGroup, type PillValue } from "./pill-menus.js";
import { Tip } from "./seg.js";
import { studioEast } from "./studio-east.js";
import { kindIcon } from "./fields-list.js";
import { fieldLabel, valueName, type VisualSource } from "./visual/values.js";

type Styles = Record<string, SystemStyleObject>;

/** What a visual draws. */
type View = ValueTypeOf<typeof StudioVisualType>["view"];
/** A source's field. */
type Field = VisualSource["fields"][number];

const stringEqual = equalFor(StringType);
const NO_FIELDS: readonly Field[] = [];
/** A drop cell's slot past a well's pills: a list well's end, a single well's one place. */
const END = "end";

/** The ids the wells' drags go by: the wells' own surface, and the Fields list's library it takes fields from. */
export interface WellsDnd {
    /** The wells' surface. */
    readonly wells: string;
    /** The Fields list's library. */
    readonly fields: string;
}

/** Props of {@link StudioWells}. */
export interface StudioWellsProps {
    /** What the visual draws. */
    view: View;
    /** Its kind's editor. */
    editor: StudioKindEditor;
    /** Its source, as the surface lists it; `undefined` for one it does not list. */
    source: VisualSource | undefined;
    /** Its source's key: what an unlisted source is called. */
    sourceKey: string;
    /** The parts an edit changed from what is saved (`changedParts`): a well among them is tinted (EDT-10). */
    changed: ReadonlySet<string>;
    /** The ids its drags go by. */
    dnd: WellsDnd;
    /** Told the view as an edit leaves it. */
    onView: (view: View) => void;
}

/** A pill's index from a drop cell's slot: none past its pills. */
function slotIndex(slot: string): number | undefined {
    return stringEqual(slot, END) ? undefined : Number(slot);
}

/**
 * The visual's wells — see the module docs.
 *
 * @param props - The view, its kind's editor, its source, what changed, its drags' ids, and where an edit goes
 * @returns The wells
 */
export function StudioWells({ view, editor, source, sourceKey, changed, dnd, onView }: StudioWellsProps) {
    const styles = useSlotRecipe({ key: "studioInspector" })() as Styles;
    const m = useStudioMessages();
    const east = studioEast();
    const fields = source?.fields ?? NO_FIELDS;
    // A field placed in a well: its pill, made with its defaults (MOD-6), where it lands.
    const place = useCallback((held: StudioWell, id: string, at?: number) => {
        const field = fields.find((f) => stringEqual(f.id, id));
        if (field === undefined || !fieldFits(held, field)) return false;
        const next = placedInWell(view, held, east.placedPill(held, field), at);
        if (next === undefined) return false;
        onView(next);
        return true;
    }, [fields, view, east, onView]);
    // A pill's field changed: its pill made again, in its place.
    const replace = useCallback((held: StudioWell, at: number, id: string) => {
        const field = fields.find((f) => stringEqual(f.id, id));
        if (field === undefined || !fieldFits(held, field)) return;
        onView(replacedInWell(view, held, at, east.placedPill(held, field)));
    }, [fields, view, east, onView]);
    // What the wells take: a field from the Fields list, and a list well's pill along its own list.
    const onDrag = useCallback((event: DragEventValue) => {
        if (event.type === "add") {
            const into = event.value.into;
            const held = editor.wells.find((w) => stringEqual(w.field, into.row));
            return held !== undefined && place(held, event.value.from.key, slotIndex(into.slot));
        }
        if (event.type === "move") {
            const { from, to } = event.value;
            const held = editor.wells.find((w) => stringEqual(w.field, from.row));
            if (held === undefined || !stringEqual(from.row, to.row)) return false;
            const last = wellPills(view, held).length - 1;
            const next = movedInWell(view, held, Number(from.slot), slotIndex(to.slot) ?? last);
            onView(next);
            return true;
        }
        return false;
    }, [editor, place, view, onView]);
    const target = useMemo(() => ({ id: dnd.wells, sources: [dnd.fields], kinds: { add: true, move: true }, onDrag }), [dnd, onDrag]);
    useDragTarget(target);
    return (
        <Box css={styles.wells} data-configure="wells" role="group" aria-label={m.wells()}>
            {editor.wells.map((held) => (
                <Well key={held.field} held={held} editor={editor} view={view} fields={fields} source={source} sourceKey={sourceKey}
                    changed={changed.has(held.field)} dnd={dnd} onView={onView} place={place} replace={replace} />
            ))}
        </Box>
    );
}

/** Props of {@link Well}. */
interface WellProps {
    held: StudioWell;
    editor: StudioKindEditor;
    view: View;
    fields: readonly Field[];
    source: VisualSource | undefined;
    sourceKey: string;
    changed: boolean;
    dnd: WellsDnd;
    onView: (view: View) => void;
    place: (held: StudioWell, id: string, at?: number) => boolean;
    replace: (held: StudioWell, at: number, id: string) => void;
}

/** The words a field is called by: its source's label, else its id. */
function labelOf(source: VisualSource | undefined, id: string): string {
    return source === undefined ? id : fieldLabel(source, id);
}

/** Whether a drop on a well would take what it brings — a field it accepts, while there is room for it; or its own pill, moved along it. */
function takes(held: StudioWell, view: View, fields: readonly Field[], candidate: DragEventValue): boolean {
    if (candidate.type === "move") return stringEqual(candidate.value.from.row, held.field);
    if (candidate.type !== "add") return false;
    const field = fields.find((f) => stringEqual(f.id, candidate.value.from.key));
    if (field === undefined || !fieldFits(held, field)) return false;
    const most = wellMost(view, held);
    return !held.list || most === undefined || wellPills(view, held).length < most;
}

/** What a drag says over a well: where a field goes, or why the well does not take it. */
function captionOf(held: StudioWell, view: View, fields: readonly Field[], source: VisualSource | undefined, payload: DragPayload, allowed: boolean, m: StudioMessages): string | undefined {
    if (payload.kind !== "item") return undefined;
    const field = labelOf(source, payload.from.key);
    if (allowed) return m.dropInto({ field, well: held.label });
    const fits = fields.some((f) => stringEqual(f.id, payload.from.key) && fieldFits(held, f));
    return fits ? m.wellFull({ well: held.label }) : m.dropRefused({ field, well: held.label });
}

/** One well: its label, its pills and its slot, and what it says under them. */
function Well({ held, editor, view, fields, source, sourceKey, changed, dnd, onView, place, replace }: WellProps) {
    const styles = useSlotRecipe({ key: "studioInspector" })() as Styles;
    const m = useStudioMessages();
    const labelId = useId();
    const pills = wellPills(view, held);
    const most = wellMost(view, held);
    const room = held.list ? most === undefined || pills.length < most : pills.length === 0;
    const coord = useMemo((): CellCoord => ({ surface: dnd.wells, row: held.field, slot: END }), [dnd.wells, held.field]);
    // The field a drag rests over the well with, which it takes: its empty place says so.
    const [over, setOver] = useState<string | undefined>(undefined);
    const cell = useDropCell(coord, false, (candidate) => takes(held, view, fields, candidate), undefined, {
        name: () => held.label,
        caption: (_at, payload, allowed) => captionOf(held, view, fields, source, payload, allowed, m),
        onHover: (_x, _y, payload) => setOver(payload.kind === "item" ? labelOf(source, payload.from.key) : undefined),
        onLeave: () => setOver(undefined),
    });
    // Each pill is drawn in its place, so an edit in its menu keeps the menu open; a pill moved by the keyboard takes it
    // with it — its grip, in the place it moved to, has it once the well draws again.
    const grips = useRef(new Map<number, HTMLElement>());
    const focusAt = useRef<number | undefined>(undefined);
    useEffect(() => {
        const at = focusAt.current;
        if (at === undefined) return;
        focusAt.current = undefined;
        grips.current.get(at)?.focus();
    });
    const moved = useCallback((to: number) => { focusAt.current = to; }, []);
    const gripAt = useCallback((at: number, el: HTMLElement | null) => {
        if (el === null) grips.current.delete(at);
        else grips.current.set(at, el);
    }, []);
    // What it says under its pills: a field its source does not have (MOD-5), else a list held to one by it (CHT-2).
    const ids = useMemo(() => new Set(fields.map((f) => f.id)), [fields]);
    const missing = pills.flatMap((pill) => pillFields(pill)).find((id) => !ids.has(id));
    const holder = editor.wells.find((other) => other.list && other.one.type === "some" && stringEqual(other.one.value, held.field));
    const first = holder !== undefined && pills.length > 0 && wellPills(view, holder).length > 1;
    return (
        <Box css={styles.well} data-well={held.field} data-changed={changed ? held.field : undefined}>
            <Box as="span" css={styles.lbl} id={labelId}>{held.label}</Box>
            <Box ref={cell} css={styles.wellSlots} role="list" aria-labelledby={labelId}>
                {pills.map((pill, at) => (
                    <WellPill key={at} held={held} pill={pill} at={at} count={pills.length} view={view} fields={fields} source={source}
                        dnd={dnd} onView={onView} replace={replace} onMoved={moved} gripAt={gripAt} />
                ))}
                {room && (
                    <Box role="listitem">
                        <FieldChooser held={held} fields={fields} label={held.label} onPick={(id) => place(held, id)} trigger={(
                            <chakra.button type="button" css={styles.wellSlot} data-well-add={held.field} data-drop={over === undefined ? undefined : ""}>
                                <FontAwesomeIcon icon={over === undefined ? faPlus : faArrowDown} />
                                {over === undefined ? m.addToWell({ value: held.holds.type === "value" || held.holds.type === "axis" }) : m.dropOn({ field: over, well: held.label })}
                            </chakra.button>
                        )} />
                    </Box>
                )}
            </Box>
            {missing !== undefined ? (
                <Box as="span" css={styles.wellError} role="alert" data-well-missing={missing}>
                    {m.wellMissing({ source: source?.name ?? sourceKey, field: missing })}
                </Box>
            ) : first ? (
                <Box as="span" css={styles.wellHelp}>{m.wellTakesFirst({ well: held.label })}</Box>
            ) : null}
        </Box>
    );
}

/** Props of {@link WellPill}. */
interface WellPillProps {
    held: StudioWell;
    pill: StudioPill;
    at: number;
    count: number;
    view: View;
    fields: readonly Field[];
    source: VisualSource | undefined;
    dnd: WellsDnd;
    onView: (view: View) => void;
    replace: (held: StudioWell, at: number, id: string) => void;
    /** Told where a pill the keyboard moved goes, before the move is made. */
    onMoved: (to: number) => void;
    /** Told a pill's grip, by its place. */
    gripAt: (at: number, el: HTMLElement | null) => void;
}

/** One pill of a well: its field's kind — a list well's grip, a single well's chooser of another field — its name and what it is set to, which open its menu, and its remove. */
function WellPill({ held, pill, at, count, view, fields, source, dnd, onView, replace, onMoved, gripAt }: WellPillProps) {
    const styles = useSlotRecipe({ key: "studioInspector" })() as Styles;
    const m = useStudioMessages();
    const words = useFormatters();
    const name = pillName(pill, source, m);
    const ids = useMemo(() => new Set(fields.map((f) => f.id)), [fields]);
    const missing = pillFields(pill).some((id) => !ids.has(id));
    const coord = useMemo((): CellCoord => ({ surface: dnd.wells, row: held.field, slot: String(at) }), [dnd.wells, held.field, at]);
    const cell = useDropCell(coord, false, (candidate) => takes(held, view, fields, candidate), undefined, {
        name: () => held.label,
        caption: (_at, payload, allowed) => captionOf(held, view, fields, source, payload, allowed, m),
    });
    const from = useMemo((): Required<CellCoord> | null => (held.list ? { ...coord, event: `${held.field}.${at}` } : null), [held.list, held.field, coord, at]);
    const ghost = useMemo(() => <Pill size="sm">{name}</Pill>, [name]);
    const grip = useDragEventChip(from, ghost, false, name);
    // ⌥↑ and ⌥↓ move a list well's pill along it (EDT-5).
    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (!held.list || !event.altKey) return false;
        const to = event.key === "ArrowUp" ? at - 1 : event.key === "ArrowDown" ? at + 1 : undefined;
        if (to === undefined || to < 0 || to >= count) return false;
        event.preventDefault();
        onMoved(to);
        onView(movedInWell(view, held, at, to));
        return true;
    };
    // The grip's element: the drag's, and the well's, which gives it the keyboard back after a move.
    const gripRef = useCallback((el: HTMLElement | null) => {
        grip?.ref(el);
        gripAt(at, el);
    }, [grip, gripAt, at]);
    const edit = (next: StudioPill) => onView(replacedInWell(view, held, at, next));
    const field = pillFields(pill)[0];
    const listed = field === undefined ? undefined : fields.find((f) => stringEqual(f.id, field));
    // Its kind's mark: the danger's for a field its source lacks; a list well's pill moves by it.
    const mark = <FontAwesomeIcon icon={missing || listed === undefined ? faCircleExclamation : ["fas", kindIcon(listed) as IconName]} />;
    const note = pillNote(pill, words, m);
    const chip = pillChip(pill, listed, source, m);
    // What the button holds: its name, then its note and its chip.
    const face = (
        <>
            <Box as="span" css={styles.pillName} data-pill-name="">{name}</Box>
            {note !== undefined && <Box as="span" css={styles.pillNote} data-pill-meta="">{note}</Box>}
            {chip !== undefined && <Box as="span" css={styles.pillAgg} data-pill-chip="">{chip}<FontAwesomeIcon icon={faChevronDown} /></Box>}
        </>
    );
    return (
        <Box ref={cell} css={styles.pill} role="listitem" data-well-pill={at} data-missing={missing ? "" : undefined}>
            {held.list ? (
                <Tip tip={m.movePill({ label: name })}>
                    <chakra.button type="button" css={styles.pillKind} aria-label={m.movePill({ label: name })} data-pill-grip=""
                        {...grip} ref={gripRef} onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => { if (!onKeyDown(event)) grip?.onKeyDown?.(event); }}>
                        {mark}
                    </chakra.button>
                </Tip>
            ) : (
                <FieldChooser held={held} fields={fields} current={field} label={held.label} onPick={(id) => replace(held, at, id)} trigger={(
                    <chakra.button type="button" css={styles.pillKind} aria-label={m.changeField({ label: name })} data-pill-field="" onKeyDown={onKeyDown}>
                        {mark}
                    </chakra.button>
                )} />
            )}
            {pill.type === "value" && source !== undefined ? (
                <PillMenu label={held.label} name={name} onKeyDown={onKeyDown} face={face}>
                    <ValueMenu value={pill.value} source={source} onChange={(value: PillValue) => edit(variant("value", value))} />
                </PillMenu>
            ) : pill.type === "axis" && source !== undefined ? (
                <PillMenu label={held.label} name={name} onKeyDown={onKeyDown} face={face}>
                    <ValueMenu value={pill.value.value} source={source}
                        axis={{ right: pill.value.right, onRight: (right) => edit(variant("axis", { ...pill.value, right })) }}
                        onChange={(value: PillValue) => edit(variant("axis", { ...pill.value, value }))} />
                </PillMenu>
            ) : pill.type === "group" ? (
                <PillMenu label={held.label} name={name} onKeyDown={onKeyDown} face={face}>
                    <GroupMenu group={pill.value} field={listed} onChange={(group: PillGroup) => edit(variant("group", group))} />
                </PillMenu>
            ) : held.list ? (
                <FieldChooser held={held} fields={fields} current={field} label={held.label} onPick={(id) => replace(held, at, id)} trigger={(
                    <chakra.button type="button" css={styles.pillOpen} aria-label={m.changeField({ label: name })} data-pill-open="" onKeyDown={onKeyDown}>
                        {face}
                    </chakra.button>
                )} />
            ) : <Box css={styles.pillOpen} data-pill-face="">{face}</Box>}
            <Tip tip={m.removeFromWell({ label: name, well: held.label })}>
                <chakra.button type="button" css={styles.pillRemove} aria-label={m.removeFromWell({ label: name, well: held.label })} data-pill-remove=""
                    onClick={() => onView(removedFromWell(view, held, at))}>
                    <FontAwesomeIcon icon={faXmark} />
                </chakra.button>
            </Tip>
        </Box>
    );
}

/** What a pill is called: a value by its name, a group or a field by its field's label. */
function pillName(pill: StudioPill, source: VisualSource | undefined, m: StudioMessages): string {
    switch (pill.type) {
        case "value": return source === undefined ? pillFields(pill).join(" / ") : valueName(pill.value, source, m);
        case "axis": return source === undefined ? pillFields(pill).join(" / ") : valueName(pill.value.value, source, m);
        case "group": return labelOf(source, pill.value.field);
        case "field": return labelOf(source, pill.value);
    }
}

/**
 * What a pill is set to beyond its chip, after its name: a value's goal and a
 * period other than the page's — `goal 450k · year ago`; a group's first N —
 * `top 2 + Other`, and its order where its chip says a date's bucket.
 */
function pillNote(pill: StudioPill, words: ReturnType<typeof useFormatters>, m: StudioMessages): string | undefined {
    const value = pill.type === "value" ? pill.value : pill.type === "axis" ? pill.value.value : undefined;
    const said = value !== undefined ? [
        ...(value.goal.type === "some" ? [m.pillGoal({ goal: words.compact(value.goal.value) })] : []),
        ...(value.period.type === "current" ? [] : [m.pillPeriod({ period: value.period.type })]),
    ] : pill.type === "group" ? [
        ...(pill.value.top.type === "some" ? [m.pillTop({ top: words.number(Number(pill.value.top.value)) })] : []),
    ] : [];
    return said.length === 0 ? undefined : said.join(" · ");
}

/** What a pill's chip says: a value's aggregate — `Sum` — or a date group's bucket — `Month`; none for another group, or a field. */
function pillChip(pill: StudioPill, listed: Field | undefined, source: VisualSource | undefined, m: StudioMessages): string | undefined {
    switch (pill.type) {
        case "value": return aggregateWords(pill.value, source, m);
        case "axis": return aggregateWords(pill.value.value, source, m);
        case "group": return pill.value.bucket.type === "some" ? groupWords(pill.value, listed, m) : undefined;
        case "field": return undefined;
    }
}

/** A pill's name and what it is set to, as one button, which opens its menu. */
function PillMenu({ label, name, face, onKeyDown, children }: { label: string; name: string; face: ReactElement; onKeyDown: (event: KeyboardEvent<HTMLElement>) => boolean; children: ReactElement }) {
    const styles = useSlotRecipe({ key: "studioInspector" })() as Styles;
    const m = useStudioMessages();
    const [open, setOpen] = useState(false);
    return (
        <SliceEditPopover open={open} onOpenChange={setOpen} label={label} flush trigger={(
            <chakra.button type="button" css={styles.pillOpen} aria-label={m.editPill({ label: name })} data-pill-open="" onKeyDown={onKeyDown}>
                {face}
            </chakra.button>
        )}>
            {children}
        </SliceEditPopover>
    );
}

/** Props of {@link FieldChooser}. */
interface FieldChooserProps {
    held: StudioWell;
    fields: readonly Field[];
    /** The field the pill holds now, if it is one's. */
    current?: string | undefined;
    label: string;
    trigger: ReactElement;
    onPick: (id: string) => void;
}

/**
 * A well's field chooser — every drag's keyboard path (EDT-3): the source's
 * fields, what a visual groups by then numbers, a field the well does not
 * take refused, saying why.
 */
function FieldChooser({ held, fields, current, label, trigger, onPick }: FieldChooserProps) {
    const m = useStudioMessages();
    const [open, setOpen] = useState(false);
    const sections = useMemo((): ChooserSection[] => [false, true].map((numbers) => ({
        label: m.fieldGroup({ numbers }),
        options: fields.filter((f) => (f.kind.type === "number") === numbers).map((f): ChooserOption => {
            const fits = fieldFits(held, f);
            return {
                key: f.id, label: f.label,
                state: current !== undefined && stringEqual(current, f.id) ? "current" : fits ? "enabled" : "refused",
                ...(fits ? {} : { line: m.dropRefused({ field: f.label, well: held.label }) }),
            };
        }),
    })).filter((section) => section.options.length > 0), [fields, held, current, m]);
    return (
        <SliceEditPopover open={open} onOpenChange={setOpen} label={label} flush trigger={trigger}>
            <Chooser sections={sections} placeholder={m.findField()} onChoose={(id) => {
                setOpen(false);
                if (current === undefined || !stringEqual(current, id)) onPick(id);
            }} />
        </SliceEditPopover>
    );
}
