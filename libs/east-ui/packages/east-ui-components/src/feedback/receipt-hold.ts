/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A receipt's hold (`Decision Queue Spec.md` §8, R25–R28): the line a verdict
 * leaves where its card stood stays {@link RECEIPT_HOLD_MS}, and is checked
 * again every {@link RECEIPT_RECHECK_MS} while the pointer is over it or the
 * focus is in it — its Undo never taken from under a hand reaching for it —
 * then leaves over {@link RECEIPT_LEAVE_MS}, drawn leaving the while (the
 * `decisionQueue` recipe's `receipt` slot, `data-leaving`: its height, its
 * opacity and the 8px above it going). Under `prefers-reduced-motion` it goes
 * as it starts to leave.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { prefersReducedMotion } from "../contracts/reduced-motion.js";

/** How long a receipt stays before it leaves, ms. */
export const RECEIPT_HOLD_MS = 5_000;

/** How often a receipt the pointer or the focus holds is checked again, ms. */
export const RECEIPT_RECHECK_MS = 1_000;

/** How long a receipt takes to leave, ms: the design system's `--dur-base` — none under `prefers-reduced-motion`. */
export const RECEIPT_LEAVE_MS = 200;

/** What {@link useReceiptHold} hands its receipt. */
export interface ReceiptHold {
    /** Whether it is leaving: drawn with `data-leaving` while its leave runs. */
    readonly leaving: boolean;
    /** The events that hold it, for the receipt's root. */
    readonly props: {
        readonly onPointerEnter: () => void;
        readonly onPointerLeave: () => void;
        readonly onFocus: () => void;
        readonly onBlur: () => void;
    };
}

/**
 * Holds a receipt its time — and on while it is pointed at or focused — then lets it go.
 *
 * @param onGone - Called once it has left: its host takes it out of the list
 * @returns Whether it is leaving, and the events that hold it
 */
export function useReceiptHold(onGone: () => void): ReceiptHold {
    const [leaving, setLeaving] = useState(false);
    const gone = useRef(onGone);
    useEffect(() => { gone.current = onGone; });
    // The pointer and the focus each hold it; either alone is enough.
    const pointed = useRef(false);
    const focused = useRef(false);
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        const check = (): void => {
            if (pointed.current || focused.current) {
                timer = setTimeout(check, RECEIPT_RECHECK_MS);
                return;
            }
            setLeaving(true);
            timer = setTimeout(() => gone.current(), prefersReducedMotion() ? 0 : RECEIPT_LEAVE_MS);
        };
        timer = setTimeout(check, RECEIPT_HOLD_MS);
        return () => clearTimeout(timer);
    }, []);
    const onPointerEnter = useCallback(() => { pointed.current = true; }, []);
    const onPointerLeave = useCallback(() => { pointed.current = false; }, []);
    // Both bubble from its controls: the focus moving on inside it — to its Undo — leaves it and comes back in one go.
    const onFocus = useCallback(() => { focused.current = true; }, []);
    const onBlur = useCallback(() => { focused.current = false; }, []);
    const props = useMemo(() => ({ onPointerEnter, onPointerLeave, onFocus, onBlur }), [onPointerEnter, onPointerLeave, onFocus, onBlur]);
    return { leaving, props };
}
