/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The overlay editor (B§4.4 / B§6): the cell's field at inset −1 with the
 * 2 px brand ring, and the neg ring when the last commit was unrecognised.
 * The ring IS the field chrome — every field inside it is borderless.
 *
 * Which field depends on the column kind:
 *
 * - a **date** column mounts the common date field (the segmented
 *   `dd / mm / yyyy` control the `Input` renderer uses) — digits fill the
 *   segments, ↑ / ↓ step one, ← / → move between them, ⇥ leaves the last
 *   segment for the next cell; the buffer the machine holds is the date's
 *   edit form, so the commit parses exactly what the field shows;
 * - a **quantity** / **integer** column mounts the common number field
 *   (the stepper column on its right edge, ↑ / ↓ step, digits only);
 * - a **text** / **custom** column mounts the common text input;
 * - the **register kinds** (lookup · reference) keep the typed buffer — one
 *   mono input with the inline ghost drawn in a mirror behind the caret, a
 *   `→ replacement` preview and a `k/n` badge — because their candidates
 *   live in the docked strip, never in a popover (B§9);
 * - an **enum** column mounts the common combobox the way a
 *   date column mounts the common date field: the Chakra combobox parts
 *   over the machine's own buffer and candidates (`options`, best first),
 *   the list open while the editor is, the armed candidate highlighted, a
 *   click on an option committing it. The machine keeps every key — ⏎ ⇥
 *   esc ↑ ↓ are captured before the combobox sees them;
 * - a **link** / **set** column draws BOTH halves on the cell's own grid:
 *   the active half carries a 1.5 px brand underline and the only input;
 *   the other half's chips are clickable to move the caret. Existing content
 *   is chips; the buffer resolves to chips on `,` / ⏎ / a hop; ⇧← / ⇧→ select
 *   whole chips. Focus moving between the two halves is not leaving the cell.
 *
 * The editor stops keyboard propagation: the sheet owns every other key.
 */

import { memo, useEffect, useMemo, useRef, type KeyboardEvent, type ChangeEvent, type FocusEvent, type MouseEvent, type ReactNode } from "react";
import { Box, Combobox as ChakraCombobox, Input as ChakraInput, NumberInput as ChakraNumberInput, Portal, chakra, createListCollection, useCombobox } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRightLong, faMinus } from "@fortawesome/free-solid-svg-icons";
import type { DateValue } from "@internationalized/date";
import { CompoundDateField, CompoundDateInput, CompoundDateSegment } from "../../forms/input/date/index.js";
import { dateToCalendarDate, dateValueToDate } from "../../forms/input/index.js";
import { useDensity } from "../../contracts/density.js";
import { memberIsDashed, memberLabel, type SheetKind } from "./model.js";
import { formatDateEdit, splitTimeToken, type WhenLevel } from "./parse/date.js";
import type { LinkVocabulary } from "./link/grammar.js";
import type { LinkHalves } from "./link/sides.js";
import type { LinkGroups } from "./sheet-state.js";
import type { SheetMemberValue } from "./values.js";

type Styles = Record<string, Record<string, unknown>>;

/** A focus request — bumped by the machine's `focus.editor` effect. */
export interface EditorFocusRequest {
    seq: number;
    selectAll: boolean;
}

/** The link editor's view. */
export interface LinkEditorView {
    side: 0 | 1;
    halves: LinkHalves;
    groups: LinkGroups;
    /** The flat chip range under the selection. */
    chipSel: { lo: number; hi: number } | null;
    /** The predicted members per half (P4). */
    predicted: [readonly SheetMemberValue[], readonly SheetMemberValue[]];
    vocab: LinkVocabulary | undefined;
    /** Bumps on a hop — the new half's input takes focus. */
    hop: number;
    /** A `set` column — one half, no arrow. */
    single: boolean;
}

/** One option of an enum column's combobox: a register member, best first. */
export interface EditorOption {
    key: string;
    label: string;
    meta?: string | undefined;
    tone?: string | undefined;
}

/** The keys the machine sees from the editor. */
export interface EditorKey {
    key: string;
    shift: boolean;
    meta: boolean;
    alt: boolean;
    atEnd: boolean;
}

export interface SheetEditorProps {
    styles: Styles;
    /** The column kind — which field the ring holds. */
    kind: SheetKind;
    value: string;
    /** A date column's buffer as a date (`undefined` while the buffer is empty or incomplete). */
    date: Date | undefined;
    /** The printable key that opened the editor, if one did — the date field types it into its first segment. */
    seed: string | undefined;
    /** The inline ghost (the top prefix candidate's suffix). */
    ghost: string;
    /** A non-prefix match, previewed as a replacement. */
    resolve: string;
    /** `k/n` over the candidates. */
    badge: string;
    /** The neg ring. */
    error: boolean;
    focus: EditorFocusRequest;
    ariaLabel: string;
    /** The link editor, on a link / set column. */
    link: LinkEditorView | undefined;
    /** An enum column's options (the machine's candidates), best first. */
    options?: readonly EditorOption[] | undefined;
    /** The armed option's index (`-1` = none armed). */
    highlighted?: number | undefined;
    /** Browsing: the buffer is a whole option (or empty), so ↑ ↓ step the buffer through the options here instead of the machine's candidates. */
    browse?: boolean | undefined;
    /** A click on an option: the sheet writes it and moves on. */
    onPick?: ((label: string) => void) | undefined;
    /** A date column's level for this row (#844): at `time` the field grows a time box. */
    whenLevel?: WhenLevel | undefined;
    onChange: (val: string) => void;
    onKey: (e: EditorKey) => boolean;
    onBlur: () => void;
    onHalfDown: (side: 0 | 1) => void;
}

const NO_OPTIONS: readonly EditorOption[] = [];
/** The keys the machine owns on the combobox — captured before the combobox's own handlers. */
const COMBOBOX_MACHINE_KEYS = new Set(["Enter", "Escape", "Tab", "ArrowUp", "ArrowDown"]);

/** The window after a hop in which a blur is the OLD input going away, not the planner leaving. */
const HOP_GRACE_MS = 300;

/** The register kinds — the typed buffer with the ghost mirror (B§3.1); an enum column mounts the combobox instead. */
function isRegisterKind(kind: SheetKind): boolean {
    return kind === "lookup" || kind === "reference" || kind === "enum";
}
function isComboboxKind(kind: SheetKind): boolean {
    return kind === "enum";
}

/** The keys a field hands the machine — the rest are the field's own. */
function forwards(kind: SheetKind, key: string): boolean {
    if (kind === "quantity" || kind === "integer") return key !== "ArrowUp" && key !== "ArrowDown" && key !== "Home" && key !== "End";
    return true;
}

/** The date field's editable segments, in order. */
function segmentsOf(root: HTMLElement | null): HTMLElement[] {
    return root === null ? [] : [...root.querySelectorAll<HTMLElement>('[role="spinbutton"]')];
}

/** Renders the overlay editor. */
export const SheetEditor = memo(function SheetEditor({ styles, kind, value, date, seed, ghost, resolve, badge, error, focus, ariaLabel, link, options, highlighted, browse, onPick, whenLevel, onChange, onKey, onBlur, onHalfDown }: SheetEditorProps) {
    const density = useDensity();
    const controlSize = density === "comfortable" ? "md" : density === "condensed" ? "xs" : "sm";
    const rootRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const lastFocus = useRef("");
    const hopAt = useRef(0);
    const seeded = useRef(false);
    const isDate = link === undefined && kind === "date";
    const isCombobox = link === undefined && isComboboxKind(kind);
    // The combobox over the machine's candidates: the list is
    // open while the editor is, the input is the buffer, the highlight is the
    // armed candidate, and a selection (a click) is a pick.
    const items = options ?? NO_OPTIONS;
    const collection = useMemo(() => createListCollection<EditorOption>({ items: items as EditorOption[], itemToValue: (o) => o.key, itemToString: (o) => o.label }), [items]);
    const armed = highlighted !== undefined && highlighted >= 0 ? items[highlighted]?.key ?? null : null;
    const combobox = useCombobox<EditorOption>({
        collection,
        open: isCombobox,
        inputValue: value,
        value: [],
        highlightedValue: armed,
        inputBehavior: "none",
        selectionBehavior: "preserve",
        allowCustomValue: true,
        loopFocus: false,
        openOnClick: true,
        closeOnSelect: false,
        // No dismissable layer: the sheet owns esc and the outside press (the layer would take esc at the document before the machine hears it).
        disableLayer: true,
        positioning: { placement: "bottom-start", gutter: 4, sameWidth: false },
        onInputValueChange: (d) => { if (d.inputValue !== value) onChange(d.inputValue); },
        onValueChange: (d) => { const o = items.find((x) => x.key === d.value[0]); if (o !== undefined) onPick?.(o.label); },
    });
    const focusKey = `${focus.seq}:${link?.hop ?? 0}:${link?.side ?? -1}`;
    // A PASSIVE effect, after the fields' own: the number field's machine
    // starts, and the date field attaches its segment listeners, in their
    // effects — a focus fired from a layout effect would reach a machine that
    // has not started and a segment with no listener, and be dropped.
    useEffect(() => {
        if (lastFocus.current === focusKey) return;
        lastFocus.current = focusKey;
        hopAt.current = Date.now();
        if (isDate) {
            // The first segment takes focus; a printable key that opened the
            // editor is typed into it, the way the field takes any digit.
            const first = segmentsOf(rootRef.current)[0];
            if (first === undefined) return;
            first.focus({ preventScroll: true });
            if (seed !== undefined && !seeded.current && typeof InputEvent !== "undefined") {
                seeded.current = true;
                first.dispatchEvent(new InputEvent("beforeinput", { data: seed, inputType: "insertText", bubbles: true, cancelable: true }));
            }
            return;
        }
        const el = inputRef.current;
        if (el === null) return;
        el.focus({ preventScroll: true });
        if (focus.selectAll && link === undefined) {
            el.select();
            // The combobox settles its own caret after focus; select again once it has.
            if (isCombobox) requestAnimationFrame(() => { if (document.activeElement === el) el.select(); });
        } else el.setSelectionRange(el.value.length, el.value.length);
    }, [focusKey, focus.selectAll, link, isDate, isCombobox, seed]);

    const forward = (e: KeyboardEvent<HTMLElement>, atEnd: boolean): boolean =>
        onKey({ key: e.key, shift: e.shiftKey, meta: e.metaKey || e.ctrlKey, alt: e.altKey, atEnd });
    const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
        if (!forwards(kind, e.key)) return;
        const el = e.currentTarget;
        const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
        if (forward(e, atEnd)) e.preventDefault();
    };
    // The integer field takes digits and a leading minus, like the common integer input.
    const handleIntegerKey = (e: KeyboardEvent<HTMLInputElement>) => {
        const control = e.key.length > 1 || e.metaKey || e.ctrlKey || e.altKey;
        const minus = e.key === "-" && e.currentTarget.selectionStart === 0 && !e.currentTarget.value.includes("-");
        if (!control && !minus && !/^\d$/.test(e.key)) { e.preventDefault(); e.stopPropagation(); return; }
        handleKey(e);
    };
    // The date field owns its keys (digits, arrows, backspace); ⏎ and esc are
    // the sheet's, and ⇥ is the sheet's only at the edge segments.
    const handleDateKey = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" || e.key === "Escape") { e.stopPropagation(); if (forward(e, true)) e.preventDefault(); return; }
        if (e.key !== "Tab") return;
        const segments = segmentsOf(rootRef.current);
        const active = typeof document !== "undefined" ? document.activeElement : null;
        const edge = e.shiftKey ? segments[0] : segments[segments.length - 1];
        if (edge !== undefined && edge === active && forward(e, true)) { e.preventDefault(); e.stopPropagation(); }
    };
    const handleChange = (e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value);
    // The buffer's trailing time survives a change of day.
    const timeToken = (): string => { const t = value.trim(); const { rest } = splitTimeToken(t); return t.length > rest.length ? t.slice(rest.length).trim() : ""; };
    const handleDateChange = (next: DateValue | null) => {
        if (next === null) { onChange(""); return; }
        const tok = timeToken();
        onChange(`${formatDateEdit(dateValueToDate(next))}${tok !== "" ? ` ${tok}` : ""}`);
    };
    const setTimeToken = (tok: string) => { const { rest } = splitTimeToken(value); onChange(`${rest}${tok !== "" ? ` ${tok}` : ""}`.trim()); };
    const handleTimeKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" || e.key === "Escape" || e.key === "Tab") { e.stopPropagation(); if (forward(e, true)) e.preventDefault(); return; }
        e.stopPropagation();
    };
    // The combobox: the machine's keys are taken here, before the combobox's own handlers see them.
    const handleComboboxKeyCapture = (e: KeyboardEvent<HTMLElement>) => {
        if (!COMBOBOX_MACHINE_KEYS.has(e.key)) return;
        e.stopPropagation();
        // Browsing: ↑ ↓ step the buffer through the options; ⏎ then commits it.
        if (browse === true && (e.key === "ArrowDown" || e.key === "ArrowUp") && items.length > 0) {
            e.preventDefault();
            const i = highlighted ?? -1;
            const next = e.key === "ArrowDown" ? Math.min(i + 1, items.length - 1) : Math.max(i - 1, 0);
            const o = items[next];
            if (o !== undefined && o.label !== value) onChange(o.label);
            return;
        }
        const el = inputRef.current;
        const atEnd = el === null || (el.selectionStart === el.value.length && el.selectionEnd === el.value.length);
        // Typing: ↑ ↓ step the machine's candidates (its ⌥↑ / ⌥↓), never leave the cell — the list is what is being stepped.
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            onKey({ key: e.key, shift: e.shiftKey, meta: e.metaKey || e.ctrlKey, alt: true, atEnd });
            return;
        }
        if (forward(e, atEnd)) e.preventDefault();
    };
    const handleBlur = (e: FocusEvent<HTMLElement>) => {
        // Focus moving inside the editor (between the two halves, the date's
        // segments, the number field's steppers) is not leaving the cell; an
        // input unmounting under a hop is not the planner leaving either.
        const to = e.relatedTarget as HTMLElement | null;
        if (to !== null && rootRef.current !== null && rootRef.current.contains(to)) return;
        // The combobox's list lives in a portal: a press on it is not leaving either.
        if (to !== null && to.closest('[data-scope="combobox"][data-part="content"]') !== null) return;
        if (!e.currentTarget.isConnected) return;
        if (Date.now() - hopAt.current < HOP_GRACE_MS) return;
        onBlur();
    };
    const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

    /** The typed buffer with the ghost mirror — the register kinds and the link halves. */
    const typed = (side: 0 | 1 | undefined) => (
        <Box css={styles.editorField} style={link !== undefined ? { flex: "1", minWidth: "24px", height: "22px" } : undefined}>
            <Box css={styles.editorMirror} aria-hidden="true">
                <span style={{ visibility: "hidden" }}>{value}</span>
                <Box as="span" css={styles.editorGhost} data-slot="editorGhost">{ghost}</Box>
            </Box>
            <chakra.input
                ref={inputRef}
                css={styles.editorInput}
                value={value}
                aria-label={ariaLabel}
                aria-autocomplete="inline"
                data-slot="editorInput"
                data-side={side}
                onChange={handleChange}
                onKeyDown={handleKey}
                onBlur={handleBlur}
                onCopy={stop}
                onPaste={stop}
            />
        </Box>
    );

    /** The common text input, borderless inside the ring. */
    const text = (
        <Box css={styles.editorField}>
            <ChakraInput
                unstyled
                ref={inputRef}
                css={styles.editorInput}
                value={value}
                aria-label={ariaLabel}
                data-slot="editorInput"
                onChange={handleChange}
                onKeyDown={handleKey}
                onBlur={handleBlur}
                onCopy={stop}
                onPaste={stop}
            />
        </Box>
    );

    /** The common number field: the input and its stepper column, borderless inside the ring. */
    const number = (
        <ChakraNumberInput.Root
            size={controlSize}
            css={styles.editorNumber}
            data-slot="editorNumber"
            value={value}
            inputMode={kind === "integer" ? "numeric" : "decimal"}
            onValueChange={(d) => onChange(d.value)}
        >
            <ChakraNumberInput.Input
                ref={inputRef}
                css={styles.editorNumberInput}
                aria-label={ariaLabel}
                data-slot="editorInput"
                onKeyDown={kind === "integer" ? handleIntegerKey : handleKey}
                onBlur={handleBlur}
                onCopy={stop}
                onPaste={stop}
            />
            <ChakraNumberInput.Control css={styles.editorStepper} data-slot="editorStepper">
                <ChakraNumberInput.IncrementTrigger />
                <ChakraNumberInput.DecrementTrigger />
            </ChakraNumberInput.Control>
        </ChakraNumberInput.Root>
    );

    /** The common combobox: the buffer as its input, the machine's candidates as its list. */
    const comboboxField = (
        <ChakraCombobox.RootProvider value={combobox} size={controlSize} css={styles.editorCombobox} data-slot="editorCombobox" onKeyDownCapture={handleComboboxKeyCapture} onKeyDown={stop}>
            <ChakraCombobox.Control unstyled css={styles.editorField}>
                <ChakraCombobox.Input
                    unstyled
                    ref={inputRef}
                    css={styles.editorInput}
                    aria-label={ariaLabel}
                    data-slot="editorInput"
                    onBlur={handleBlur}
                    onCopy={stop}
                    onPaste={stop}
                />
            </ChakraCombobox.Control>
            <Portal>
                <ChakraCombobox.Positioner css={styles.editorMenu} data-slot="editorMenu">
                    <ChakraCombobox.Content onMouseDown={(e) => e.preventDefault()}>
                        {items.length === 0 && <ChakraCombobox.Empty css={styles.editorOptionMeta}>no options</ChakraCombobox.Empty>}
                        {items.map((o) => (
                            <ChakraCombobox.Item key={o.key} item={o} css={styles.editorOption} data-slot="editorOption">
                                {o.tone !== undefined && <Box as="span" css={styles.cellDot} data-tone={o.tone} aria-hidden="true" />}
                                <ChakraCombobox.ItemText>{o.label}</ChakraCombobox.ItemText>
                                {o.meta !== undefined && o.meta !== "" && <Box as="span" css={styles.editorOptionMeta} data-slot="editorOptionMeta">{o.meta}</Box>}
                            </ChakraCombobox.Item>
                        ))}
                    </ChakraCombobox.Content>
                </ChakraCombobox.Positioner>
            </Portal>
        </ChakraCombobox.RootProvider>
    );

    /** The common date field — the segmented control over the buffer's date; at the time level a time box follows it. */
    const timeNow = (() => { const s = splitTimeToken(value); return s.time !== undefined ? `${String(s.time.hh).padStart(2, "0")}:${String(s.time.mm).padStart(2, "0")}` : ""; })();
    const dateField = (
        <Box css={styles.editorDate} data-slot="editorDate" data-level={whenLevel} onKeyDownCapture={handleDateKey} onKeyDown={stop} onBlur={handleBlur}>
            <CompoundDateField size={controlSize} {...(date !== undefined ? { value: dateToCalendarDate(date) } : {})} onChange={handleDateChange} aria-label={ariaLabel}>
                <CompoundDateInput>
                    {({ segment }) => <CompoundDateSegment segment={segment} />}
                </CompoundDateInput>
            </CompoundDateField>
            {whenLevel === "time" && (
                <chakra.input css={styles.editorTime} data-slot="editorTime" aria-label="Time" placeholder="hh:mm" defaultValue={timeNow} key={timeNow}
                    onMouseDown={(e) => e.stopPropagation()}
                    onKeyDown={handleTimeKey}
                    onChange={(e) => { const v = e.currentTarget.value.trim(); if (/^\d{1,2}:\d{2}$/.test(v)) setTimeToken(v); }}
                    onBlur={(e) => { const v = e.currentTarget.value.trim(); if (/^\d{1,2}:\d{2}$/.test(v)) setTimeToken(v); handleBlur(e); }} />
            )}
        </Box>
    );

    const half = (side: 0 | 1) => {
        if (link === undefined) return null;
        const key: "from" | "to" = side === 0 ? "from" : "to";
        const state = link.halves[key];
        const members = link.groups[side];
        const active = link.side === side;
        const offset = side === 0 ? 0 : link.groups[0].length;
        const warn = !state.live && (members.length > 0 || active);
        const onDown = (e: MouseEvent) => {
            if ((e.target as HTMLElement).tagName === "INPUT") { e.stopPropagation(); return; }
            e.preventDefault();
            e.stopPropagation();
            onHalfDown(side);
        };
        return (
            <Box
                css={styles.half}
                data-half={key}
                data-active={active ? "" : undefined}
                data-locked={!state.live ? "" : undefined}
                style={{ position: "relative", minHeight: "34px", alignItems: "center", padding: side === 0 ? "7px 3px 7px 0" : "7px 0 7px 3px", justifyContent: "flex-start" }}
                onMouseDown={onDown}
            >
                {active && <Box aria-hidden="true" style={{ position: "absolute", left: side === 0 ? 0 : 3, right: side === 0 ? 3 : 0, bottom: 4, height: "1.5px", background: "var(--chakra-colors-brand-solid)", pointerEvents: "none" }} />}
                {!state.live && state.lock !== "" && (
                    <Box as="span" css={warn ? styles.lockWarn : styles.lockTag} data-slot={warn ? "lockWarn" : "lockTag"}
                        title={warn ? `This ${key === "from" ? "source" : "destination"} is locked — anything here is kept but flagged` : undefined}>
                        {state.lock}
                    </Box>
                )}
                {state.live && members.length === 0 && <Box as="span" css={styles.halfLabel} data-slot="halfLabel">{key}</Box>}
                {members.map((m, i) => {
                    const n = offset + i;
                    const picked = link.chipSel !== null && n >= link.chipSel.lo && n <= link.chipSel.hi;
                    return (
                        <Box key={i} as="span" css={picked ? styles.chipPicked : memberIsDashed(m) ? styles.chipDashed : styles.chip}
                            data-slot="chip" data-member={m.type} data-picked={picked ? "" : undefined}>
                            {memberLabel(m)}
                        </Box>
                    );
                })}
                {active && typed(side)}
                {link.predicted[side].map((m, i) => (
                    <Box key={`p${i}`} as="span" css={styles.chipDashed} data-slot="chip" data-predicted="" style={{ paddingLeft: 6, paddingRight: 6 }}>
                        {memberLabel(m)}
                    </Box>
                ))}
            </Box>
        );
    };

    let field: ReactNode;
    if (link !== undefined) {
        field = link.single ? (
            <Box css={styles.linkGrid} style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
                {half(1)}
            </Box>
        ) : (
            <Box css={styles.linkGrid}>
                {half(0)}
                <Box as="span" css={styles.arrow} aria-hidden="true" style={{ height: "34px" }}>
                    <FontAwesomeIcon icon={link.halves.isIn ? faMinus : faArrowRightLong} />
                </Box>
                {half(1)}
            </Box>
        );
    } else if (kind === "date") field = dateField;
    else if (isCombobox) field = comboboxField;
    else if (kind === "quantity" || kind === "integer") field = number;
    else if (isRegisterKind(kind)) field = typed(undefined);
    else field = text;

    return (
        <>
            <Box ref={rootRef} css={styles.editor} data-slot="editor" data-kind={kind} data-error={error ? "" : undefined} data-link={link !== undefined ? "" : undefined} onMouseDown={stop}>
                {field}
                {link === undefined && isRegisterKind(kind) && !isCombobox && (resolve !== "" || badge !== "") && (
                    <Box display="flex" alignItems="center" gap="8px" paddingLeft="8px" flex="none">
                        {resolve !== "" && (
                            <Box as="span" css={styles.editorResolve} data-slot="editorResolve">
                                <FontAwesomeIcon icon={faArrowRightLong} style={{ fontSize: "9px" }} />
                                {resolve}
                            </Box>
                        )}
                        {badge !== "" && <Box as="span" css={styles.editorBadge}>{badge}</Box>}
                    </Box>
                )}
            </Box>
            {error && <Box css={styles.editorError} data-slot="editorError" />}
        </>
    );
});
