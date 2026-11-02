/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An action cell's one overlay (#1476, `Sheet Action Column - Behaviour
 * Spec.md` §5, §6): the Menu of a choice's reasons or of the rest of the
 * offer, and the anchored Popover of a form's fields. The Menu is the shared
 * Menu card, hung from the control that opened it; the form is the shared
 * anchored popover (`SliceEditPopover`) around `FieldForm`, the inspector's
 * own form, so an action asks for its value as every builder's Details does.
 * Neither ever opens a dialog (X13).
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Menu as ChakraMenu, Portal, chakra, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import { variant } from "@elaraai/east";
import { FieldForm, SliceEditPopover, type FieldOption } from "@elaraai/east-ui-components";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import type { FieldSpecValue } from "@elaraai/east-ui/internal";
import { useSheetWords } from "../words.js";
import type { SheetRegisterIndex } from "../model.js";
import { verbOf, type ActionCase } from "./model.js";
import { FIRST_CONTROL, emptyRequired, getAt, setAt } from "./form-check.js";

/** The overlay open on an action cell, as its sheet holds it. */
export type ActionOverlayState =
    | {
        kind: "menu";
        r: number;
        /** The rows it takes on: a range down the column (T8), else the cell's own. */
        rs: readonly number[];
        key: string;
        /** The control that opened it, held while it is open. */
        part: "next" | "more";
        anchor: HTMLElement;
        /** The cases it lists: a choice's reasons, or the rest of the offer (M5). */
        cases: readonly ActionCase[];
        /** How the menu names the row (M5). */
        head: string;
    }
    | {
        kind: "form";
        r: number;
        /** The rows it takes on: a range down the column asks once (T8), else the cell's own. */
        rs: readonly number[];
        key: string;
        part: "next" | "more";
        anchor: HTMLElement;
        /** The case it asks for. */
        case: ActionCase;
        /** The value it opens with (F10), decoded; `undefined` for none. */
        initial: unknown;
        /** How the row is named in its eyebrow (F4). */
        name: string | undefined;
        /** The row's words beside its name (F4). */
        meta: string | undefined;
    };

/**
 * While an overlay is open, a press outside it only closes it (P6): the press and its click go no further, so a
 * dismissing click never also runs what it lands on — an Undo, another cell.
 *
 * @param inside - Whether an element is the overlay's own
 * @param onClose - Close it
 */
function useOutsideDismiss(inside: (el: Element) => boolean, onClose: () => void): void {
    const latest = useRef({ inside, onClose });
    latest.current = { inside, onClose };
    useEffect(() => {
        const outside = (event: Event) => event.target instanceof Element && !latest.current.inside(event.target);
        // The click a dismissing press makes is swallowed even once the overlay has gone — its library may close it on
        // the press — and only that click: one that never comes (a drag) stops being waited for.
        const press = (event: Event) => {
            if (!outside(event) || event.type !== "pointerdown") return;
            const close = latest.current.onClose;
            const swallow = (click: Event) => {
                click.preventDefault();
                click.stopImmediatePropagation();
                clearTimeout(timer);
                close();
            };
            const timer = setTimeout(() => window.removeEventListener("click", swallow, true), 1_000);
            window.addEventListener("click", swallow, { capture: true, once: true });
        };
        const swallowPress = (event: Event) => {
            if (!outside(event)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        window.addEventListener("pointerdown", press, true);
        window.addEventListener("mousedown", swallowPress, true);
        return () => {
            window.removeEventListener("pointerdown", press, true);
            window.removeEventListener("mousedown", swallowPress, true);
        };
    }, []);
}

/** Whether an element is inside an open overlay of the action column's: its Menu or its form. */
const insideOverlay = (el: Element) => el.closest("[data-sheet-action-menu], [data-sheet-action-form], [data-scope=popover], [data-scope=select], [data-scope=combobox]") !== null;

/** A choice, as the Menu lists it: its case, its words, and its value. */
interface Choice {
    id: string;
    label: string;
    value: unknown;
}

/** A choice case's reasons, in their words: a menu's options, or a register's members. */
function choicesOf(c: ActionCase, registers: SheetRegisterIndex): Choice[] {
    if (c.take.type === "menu") return c.take.value.map((o) => ({ id: `${c.name}:${o.case}`, label: o.label, value: variant(o.case, null) }));
    if (c.take.type === "register") return (registers.byName.get(c.take.value) ?? []).map((m) => ({ id: `${c.name}:${m.key}`, label: m.label === "" ? m.key : m.label, value: m.key }));
    return [];
}

/** Props of {@link ActionMenu}. */
export interface ActionMenuProps {
    state: Extract<ActionOverlayState, { kind: "menu" }>;
    registers: SheetRegisterIndex;
    /** A case taken with its value (M8): a button's null, a choice's reason. */
    onTake: (c: ActionCase, value: unknown) => void;
    /** A form case run from the Menu (M8): its Popover opens in the Menu's place, hung from the same control. */
    onForm: (c: ActionCase) => void;
    onClose: () => void;
    /** The pointer rests on an item, or leaves it (P9): its case, previewed in the strip. */
    onPreview?: ((c: ActionCase | undefined) => void) | undefined;
}

/**
 * The Menu of an action cell (§5): the direct actions first, numbered, under
 * how the row is named; then one group per choice, its reasons in their
 * words. A digit runs the item with that number (K4).
 */
export const ActionMenu = memo(function ActionMenu({ state, registers, onTake, onForm, onClose, onPreview }: ActionMenuProps) {
    const styles = useSlotStyles("sheetAction");
    const { m } = useSheetWords();
    const direct = state.cases.filter((c) => c.kind !== "choice");
    const choices = state.cases.filter((c) => c.kind === "choice");
    // Each item's run: a form's opens its Popover in the Menu's place (M8) — the Menu never closes first, which would
    // hand the focus back to the grid under the form (F1 of the hand test); any other is taken, and the Menu closes.
    // A form picked: the Menu's own close as it selects is the form's opening, never a close of the overlay.
    const formed = useRef(false);
    const items = useMemo(() => {
        const out = new Map<string, () => void>();
        for (const c of direct) out.set(`direct:${c.name}`, () => { if (c.kind === "form") { formed.current = true; onForm(c); } else { onTake(c, null); onClose(); } });
        for (const c of choices) for (const choice of choicesOf(c, registers)) out.set(choice.id, () => { onTake(c, choice.value); onClose(); });
        return out;
    }, [direct, choices, registers, onForm, onTake, onClose]);
    useOutsideDismiss(insideOverlay, onClose);
    // An item the pointer rests on goes from under it as the Menu closes, picked or not, and never says it left: the
    // strip lets its preview go as the Menu does (P9; F2 of the hand retest).
    const previewRef = useRef(onPreview);
    previewRef.current = onPreview;
    useEffect(() => () => previewRef.current?.(undefined), []);
    const anchor = state.anchor;
    // Under the control, its right edge on the control's, flipping above where it would pass the sheet's bottom (M6).
    const positioning = useMemo(() => ({
        placement: "bottom-end" as const, gutter: 4, flip: true,
        getAnchorRect: () => anchor.getBoundingClientRect(),
        boundary: () => anchor.closest<HTMLElement>("[data-sheet-card]") ?? document.documentElement,
    }), [anchor]);
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const n = event.key.length === 1 ? Number(event.key) : NaN;
        const c = Number.isInteger(n) && n >= 1 ? direct[n - 1] : undefined;
        if (c === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        items.get(`direct:${c.name}`)?.();
    };
    return (
        <ChakraMenu.Root open onOpenChange={(d) => { if (!d.open && !formed.current) onClose(); }} positioning={positioning}
            onSelect={(d) => { items.get(d.value)?.(); }}>
            <Portal>
                <ChakraMenu.Positioner>
                    <ChakraMenu.Content css={styles.menu} data-sheet-action-menu="" onKeyDown={onKeyDown}>
                        {direct.length > 0 && (
                            <ChakraMenu.ItemGroup>
                                <ChakraMenu.ItemGroupLabel css={styles.menuHead}>{state.head}</ChakraMenu.ItemGroupLabel>
                                {direct.map((c, i) => (
                                    <ChakraMenu.Item key={c.name} value={`direct:${c.name}`} data-case={c.name}
                                        onPointerEnter={() => onPreview?.(c)} onPointerLeave={() => onPreview?.(undefined)}>
                                        {c.icon !== undefined && <FontAwesomeIcon icon={["fas", c.icon as IconName]} aria-hidden />}
                                        {verbOf(c)}
                                        <chakra.span css={styles.menuKbd} aria-hidden="true">{i + 1}</chakra.span>
                                    </ChakraMenu.Item>
                                ))}
                            </ChakraMenu.ItemGroup>
                        )}
                        {choices.map((c) => (
                            <ChakraMenu.ItemGroup key={c.name}>
                                {(direct.length > 0 || choices.length > 1 || state.part === "more") && <ChakraMenu.Separator />}
                                <ChakraMenu.ItemGroupLabel css={styles.menuHead}>{m.actionMenuChoice({ verb: c.label })}</ChakraMenu.ItemGroupLabel>
                                {choicesOf(c, registers).map((choice) => (
                                    <ChakraMenu.Item key={choice.id} value={choice.id} data-case={c.name}
                                        onPointerEnter={() => onPreview?.(c)} onPointerLeave={() => onPreview?.(undefined)}>{choice.label}</ChakraMenu.Item>
                                ))}
                            </ChakraMenu.ItemGroup>
                        ))}
                    </ChakraMenu.Content>
                </ChakraMenu.Positioner>
            </Portal>
        </ChakraMenu.Root>
    );
});

/** A form's value as `FieldForm` edits it: the struct, or a scalar case's value under its name. */
function formValueOf(c: ActionCase, value: unknown, scalar: boolean): unknown {
    return scalar ? { [c.name]: value } : value;
}

/** Props of {@link ActionForm}. */
export interface ActionFormProps {
    state: Extract<ActionOverlayState, { kind: "form" }>;
    registers: SheetRegisterIndex;
    /** What taking it with the values as they stand would write (F8): the consequence line. */
    consequence: (c: ActionCase, value: unknown) => string;
    /** The case taken with its value (F9). */
    onTake: (c: ActionCase, value: unknown) => void;
    onClose: () => void;
}

/**
 * A form case's Popover (§6): the eyebrow naming the action and the row, the
 * case's fields through `FieldForm`, the consequence, Cancel and the verb. A
 * required field left empty keeps it open, the focus on that field (F9).
 */
export const ActionForm = memo(function ActionForm({ state, registers, consequence, onTake, onClose }: ActionFormProps) {
    const styles = useSlotStyles("sheetAction");
    // Cancel and the verb are Default buttons, never a Primary (F8).
    const button = useRecipe({ key: "button" });
    const { m } = useSheetWords();
    const c = state.case;
    const form = c.take.type === "form" ? c.take.value : undefined;
    const specs = useMemo((): readonly FieldSpecValue[] => form?.specs ?? [], [form]);
    const scalar = form?.scalar ?? false;
    const [value, setValue] = useState<unknown>(() => formValueOf(c, state.initial, scalar));
    // What ⏎ takes: the values as the field's own ⏎ has just written them, before the form draws again.
    const valueRef = useRef(value);
    const [missing, setMissing] = useState<string | undefined>(undefined);
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const options = useMemo(() => {
        const out: Record<string, FieldOption[]> = {};
        for (const spec of specs) {
            if (spec.editor.type !== "reference") continue;
            const of = spec.editor.value.of;
            out[of] = (registers.byName.get(of) ?? []).map((mm) => ({ key: mm.key, label: mm.label === "" ? mm.key : mm.label }));
        }
        return out;
    }, [specs, registers]);
    const onChange = useCallback((path: readonly string[], to: unknown) => {
        valueRef.current = setAt(valueRef.current, path, to);
        setValue(valueRef.current);
        setMissing(undefined);
    }, []);
    const caseOf = (v: unknown): unknown => (scalar ? getAt(v, [c.name]) : v);
    const caseValue = caseOf(value);
    // A required field emptied as it is typed in: the foot says what it needs, never what a take it would refuse writes.
    const [emptied, setEmptied] = useState<FieldSpecValue | undefined>(undefined);
    const onInput = () => setEmptied(emptyRequired(specs, valueRef.current, bodyRef.current));
    const take = () => {
        const now = valueRef.current;
        // A required field left empty (F9): the popover stays, the focus on it.
        const empty = emptyRequired(specs, now, bodyRef.current);
        if (empty !== undefined) {
            const key = empty.path.join(".");
            setMissing(key);
            bodyRef.current?.querySelector<HTMLElement>(`[data-field="${key}"] :is(${FIRST_CONTROL}, button)`)?.focus();
            return;
        }
        onTake(c, caseOf(now));
        onClose();
    };
    useOutsideDismiss(insideOverlay, onClose);
    // On open, the focus in the first field, its value selected (K5) — once the control that opened it has let it go.
    useEffect(() => {
        let second = 0;
        const first = requestAnimationFrame(() => {
            second = requestAnimationFrame(() => {
                // A date's first segment is its control (F1 of the hand retest).
                const field = bodyRef.current?.querySelector<HTMLElement>(FIRST_CONTROL);
                field?.focus({ preventScroll: true });
                if (field instanceof HTMLInputElement) field.select();
            });
        });
        return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
    }, []);
    const anchor = state.anchor;
    // Its left 24 px left of the control's centre (F3): it hangs, centred, from a point 136 px right of it.
    const hangFrom = useCallback(() => {
        const box = anchor.getBoundingClientRect();
        return { x: box.x + box.width / 2 + 136, y: box.y, width: 0, height: box.height };
    }, [anchor]);
    const missingSpec = missing === undefined ? undefined : specs.find((spec) => spec.path.join(".") === missing);
    return (
        <SliceEditPopover open onOpenChange={(open) => { if (!open) onClose(); }} anchor={null} hangFrom={hangFrom} still
            label={(
                <chakra.span css={styles.formLabel} data-slot="actionFormLabel">
                    <chakra.span css={styles.formEyebrow} data-slot="actionFormEyebrow">{m.actionFormEyebrow({ verb: c.label, name: state.name })}</chakra.span>
                    {state.meta !== undefined && <chakra.span css={styles.formMeta} data-slot="actionFormMeta">{state.meta}</chakra.span>}
                </chakra.span>
            )}
            initialFocusEl={() => bodyRef.current?.querySelector<HTMLElement>(FIRST_CONTROL) ?? null}
            footLeft={<chakra.span css={styles.formConsequence} data-slot="actionConsequence" title={emptied !== undefined ? undefined : consequence(c, caseValue)}>
                {emptied !== undefined ? m.actionNeeds({ fields: [emptied.label] }) : consequence(c, caseValue)}
            </chakra.span>}
            footActions={(
                <>
                    <chakra.button type="button" css={[button({ variant: "outline", size: "xs" }), styles.formButton]} data-slot="actionCancel" onClick={onClose}>{m.actionFormCancel()}</chakra.button>
                    <chakra.button type="button" css={[button({ variant: "outline", size: "xs" }), styles.formButton]} data-slot="actionTake" onClick={take}>{c.label}</chakra.button>
                </>
            )}>
            <chakra.div ref={bodyRef} css={styles.formBody} data-sheet-action-form="" data-case={c.name} onInput={onInput}
                // ⏎ in a field takes the action (K5, F9) — heard before the field, which may keep its own Enter (a date's
                // segments do: F1 of the hand retest). A text area keeps its line breaks; an open list, its pick.
                onKeyDownCapture={(event: KeyboardEvent<HTMLDivElement>) => {
                    if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
                    const at = event.target as HTMLElement;
                    if (at.tagName === "TEXTAREA" || at.closest("[aria-expanded=true]") !== null) return;
                    if (at.tagName === "BUTTON" && at.getAttribute("role") !== "radio") return;
                    event.preventDefault();
                    event.stopPropagation();
                    queueMicrotask(take);
                }}>
                <FieldForm specs={specs} value={value} options={options} onChange={onChange} live />
                {missingSpec !== undefined && <chakra.span css={styles.formError} data-slot="actionFormError" role="alert">{m.issueRequired()} — {missingSpec.label}</chakra.span>}
            </chakra.div>
        </SliceEditPopover>
    );
});
