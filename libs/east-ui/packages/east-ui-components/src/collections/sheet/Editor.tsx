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
 * - the **register kinds** (lookup · reference · enum) keep the typed
 *   buffer — one mono input with the inline ghost drawn in a mirror behind
 *   the caret, a `→ replacement` preview and a `k/n` badge — because their
 *   candidates live in the docked strip, never in a popover (B§9);
 * - a **link** / **set** column draws BOTH halves on the cell's own grid:
 *   the active half carries a 1.5 px brand underline and the only input;
 *   the other half's chips are clickable to move the caret. Existing content
 *   is chips; the buffer resolves to chips on `,` / ⏎ / a hop; ⇧← / ⇧→ select
 *   whole chips. Focus moving between the two halves is not leaving the cell.
 *
 * The editor stops keyboard propagation: the sheet owns every other key.
 */

import { memo, useEffect, useRef, type KeyboardEvent, type ChangeEvent, type FocusEvent, type MouseEvent, type ReactNode } from "react";
import { Box, Input as ChakraInput, NumberInput as ChakraNumberInput, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRightLong, faMinus } from "@fortawesome/free-solid-svg-icons";
import type { DateValue } from "@internationalized/date";
import { CompoundDateField, CompoundDateInput, CompoundDateSegment } from "../../forms/input/date/index.js";
import { dateToCalendarDate, dateValueToDate } from "../../forms/input/index.js";
import { memberIsDashed, memberLabel, type SheetKind } from "./model.js";
import { formatDateEdit } from "./parse/date.js";
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
    onChange: (val: string) => void;
    onKey: (e: EditorKey) => boolean;
    onBlur: () => void;
    onHalfDown: (side: 0 | 1) => void;
}

/** The window after a hop in which a blur is the OLD input going away, not the planner leaving. */
const HOP_GRACE_MS = 300;

/** The register kinds — the typed buffer with the ghost mirror (B§3.1). */
function isRegisterKind(kind: SheetKind): boolean {
    return kind === "lookup" || kind === "reference" || kind === "enum";
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
export const SheetEditor = memo(function SheetEditor({ styles, kind, value, date, seed, ghost, resolve, badge, error, focus, ariaLabel, link, onChange, onKey, onBlur, onHalfDown }: SheetEditorProps) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const lastFocus = useRef("");
    const hopAt = useRef(0);
    const seeded = useRef(false);
    const isDate = link === undefined && kind === "date";
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
        if (focus.selectAll && link === undefined) el.select();
        else el.setSelectionRange(el.value.length, el.value.length);
    }, [focusKey, focus.selectAll, link, isDate, seed]);

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
        e.stopPropagation();
        if (e.key === "Enter" || e.key === "Escape") { if (forward(e, true)) e.preventDefault(); return; }
        if (e.key !== "Tab") return;
        const segments = segmentsOf(rootRef.current);
        const active = typeof document !== "undefined" ? document.activeElement : null;
        const edge = e.shiftKey ? segments[0] : segments[segments.length - 1];
        if (edge !== undefined && edge === active && forward(e, true)) e.preventDefault();
    };
    const handleChange = (e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value);
    const handleDateChange = (next: DateValue | null) => onChange(next === null ? "" : formatDateEdit(dateValueToDate(next)));
    const handleBlur = (e: FocusEvent<HTMLElement>) => {
        // Focus moving inside the editor (between the two halves, the date's
        // segments, the number field's steppers) is not leaving the cell; an
        // input unmounting under a hop is not the planner leaving either.
        const to = e.relatedTarget as HTMLElement | null;
        if (to !== null && rootRef.current !== null && rootRef.current.contains(to)) return;
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

    /** The common date field — the segmented control over the buffer's date. */
    const dateField = (
        <Box css={styles.editorDate} data-slot="editorDate" onKeyDownCapture={handleDateKey} onBlur={handleBlur}>
            <CompoundDateField {...(date !== undefined ? { value: dateToCalendarDate(date) } : {})} onChange={handleDateChange} aria-label={ariaLabel}>
                <CompoundDateInput>
                    {({ segment }) => <CompoundDateSegment segment={segment} />}
                </CompoundDateInput>
            </CompoundDateField>
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
    else if (kind === "quantity" || kind === "integer") field = number;
    else if (isRegisterKind(kind)) field = typed(undefined);
    else field = text;

    return (
        <>
            <Box ref={rootRef} css={styles.editor} data-slot="editor" data-kind={kind} data-error={error ? "" : undefined} data-link={link !== undefined ? "" : undefined} onMouseDown={stop}>
                {field}
                {link === undefined && isRegisterKind(kind) && (resolve !== "" || badge !== "") && (
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
