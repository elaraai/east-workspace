/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The canvas's one input over a table cell (#1436, #1438): the common number
 * field, as the Sheet's cells use it, at the cell's column and the row's
 * height, the brand ring its chrome, its text in the table's numerals.
 *
 * - Enter writes it; Esc leaves the cell as it was; a blur writes it.
 * - Tab and Shift+Tab write it and move along the row's cells that take a
 *   number; ↑ and ↓ write it and move to the rows above and below that take
 *   one — the field's own stepping never sees them.
 * - Text that reads as no number, or a fraction where the values are whole, is
 *   refused, in words under the field and the ring in the neg tone; a field
 *   over whole numbers takes digits and a leading minus alone, as the common
 *   integer input does.
 * - Below 480px of main it is drawn in a popover anchored to its cell, a
 *   field of its own at a row's height, its keys as above.
 *
 * @packageDocumentation
 */

import { useEffect, useRef, useState, type KeyboardEvent, type SyntheticEvent } from "react";
import { Box, NumberInput as ChakraNumberInput } from "@chakra-ui/react";
import { usePlanWords } from "../words.js";

type Styles = Record<string, Record<string, unknown>>;

/** Where the input goes once it writes: back to its cell (Enter), nowhere (a blur), or along or across the rows. */
export type PlanCellInputMove = "stay" | "leave" | "next" | "previous" | "up" | "down";

/**
 * The field's own format, in the viewer's language (#852): the bare edit
 * form, never grouped, to fifteen significant digits — as the Sheet's.
 */
const NUMBER_FORMAT: Intl.NumberFormatOptions = { useGrouping: false, maximumSignificantDigits: 15 };
/** A field over whole numbers: every digit, none after the point. */
const INTEGER_FORMAT: Intl.NumberFormatOptions = { useGrouping: false, maximumFractionDigits: 0 };

/** The keys that write the field, and where each moves it. */
function moveOf(e: KeyboardEvent<HTMLInputElement>): PlanCellInputMove | undefined {
    switch (e.key) {
        case "Enter": return "stay";
        case "Tab": return e.shiftKey ? "previous" : "next";
        case "ArrowUp": return "up";
        case "ArrowDown": return "down";
        default: return undefined;
    }
}

/** Props of {@link PlanCellInput}. */
export interface PlanCellInputProps {
    /** The Plan recipe's styles. */
    styles: Styles;
    /** Its column's left edge, as a window fraction — none inside a popover, which places it. */
    x0?: number | undefined;
    /** Its column's right edge, as a window fraction. */
    x1?: number | undefined;
    /** The text it opens on: the cell's value as its format reads it. */
    text: string;
    /** A key that opened it, typed in place of the text. */
    seed: string | undefined;
    /** The values are whole numbers: a fraction is refused. */
    whole: boolean;
    /** Its accessible name. */
    name: string;
    /** What a text reads as: a number, `undefined` for none (the cell cleared), `null` for no number. */
    read: (text: string) => number | null | undefined;
    /** It wrote a number, or cleared the cell, and moves on. */
    onWrite: (value: number | undefined, move: PlanCellInputMove, input: HTMLElement) => void;
    /** It closed with the cell as it was: Esc. */
    onCancel: (input: HTMLElement) => void;
    /** It is drawn in a popover anchored to its cell, which places it. */
    popover?: boolean | undefined;
}

/** Stop an event at the input: its cell's click selects the row and opens the root's popover, and the field takes none. */
const stop = (e: SyntheticEvent) => e.stopPropagation();

/** Renders the canvas's input over a table cell. */
export function PlanCellInput({ styles, x0, x1, text, seed, whole, name, read, onWrite, onCancel, popover }: PlanCellInputProps) {
    const words = usePlanWords();
    const [value, setValue] = useState(seed ?? text);
    const [refusal, setRefusal] = useState<string | undefined>(undefined);
    const inputRef = useRef<HTMLInputElement | null>(null);
    // Written or cancelled: the blur its unmounting sends is not the planner leaving.
    const done = useRef(false);
    // A passive effect, after the field's own: its machine has started. A digit that opened it stays, the caret after
    // it; else its text is selected, to type over.
    useEffect(() => {
        const el = inputRef.current;
        if (el === null) return;
        el.focus({ preventScroll: true });
        if (seed === undefined) el.select();
        else el.setSelectionRange(el.value.length, el.value.length);
    }, [seed]);
    const write = (move: PlanCellInputMove): boolean => {
        const n = read(value);
        if (n === null) { setRefusal(words.m.typedNotNumber()); return false; }
        if (n !== undefined && whole && !Number.isInteger(n)) { setRefusal(words.m.typedNotWhole()); return false; }
        done.current = true;
        onWrite(n, move, inputRef.current!);
        return true;
    };
    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        // The canvas takes no key typed here, and the field's own stepping none of these.
        e.stopPropagation();
        if (e.key === "Escape") {
            e.preventDefault();
            done.current = true;
            onCancel(e.currentTarget);
            return;
        }
        const move = moveOf(e);
        if (move !== undefined) {
            e.preventDefault();
            write(move);
            return;
        }
        // Over whole numbers, digits and a leading minus, as the common integer input takes them.
        if (whole) {
            const control = e.key.length > 1 || e.metaKey || e.ctrlKey || e.altKey;
            const minus = e.key === "-" && e.currentTarget.selectionStart === 0 && !e.currentTarget.value.includes("-");
            if (!control && !minus && !/^\d$/.test(e.key)) e.preventDefault();
        }
    };
    const onBlur = () => {
        if (done.current) return;
        // Leaving with text that reads as no number leaves the cell as it was.
        if (!write("leave") && inputRef.current !== null) {
            done.current = true;
            onCancel(inputRef.current);
        }
    };
    return (
        <Box css={styles.tableCellInput} data-plan-typing="" data-invalid={refusal !== undefined ? "" : undefined}
            data-popover={popover === true ? "" : undefined}
            left={x0 !== undefined ? `${x0 * 100}%` : undefined}
            width={x0 !== undefined && x1 !== undefined ? `${(x1 - x0) * 100}%` : undefined}
            onMouseDown={stop} onClick={stop} onDoubleClick={stop}>
            <ChakraNumberInput.Root css={styles.tableCellField} value={value} locale={words.locale}
                formatOptions={whole ? INTEGER_FORMAT : NUMBER_FORMAT}
                inputMode={whole ? "numeric" : "decimal"}
                onValueChange={(d) => { setValue(d.value); setRefusal(undefined); }}>
                <ChakraNumberInput.Input ref={inputRef} css={styles.tableCellFieldInput} aria-label={name}
                    aria-invalid={refusal !== undefined} onKeyDown={onKeyDown} onBlur={onBlur} />
            </ChakraNumberInput.Root>
            {refusal !== undefined && <Box css={styles.tableCellRefusal} role="alert">{refusal}</Box>}
        </Box>
    );
}
