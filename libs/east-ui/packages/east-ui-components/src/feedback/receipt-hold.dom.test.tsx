/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A receipt's hold (`Decision Queue Spec.md` §8, R25–R28): it stays 5,000ms,
 * checked again every 1,000ms while the pointer is over it or the focus is in
 * it — the focus moving on to its Undo keeping it — then leaves over 200ms
 * and is gone; under reduced motion it goes as it starts to leave.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RECEIPT_HOLD_MS, RECEIPT_LEAVE_MS, RECEIPT_RECHECK_MS, useReceiptHold } from "./receipt-hold.js";

afterEach(() => { cleanup(); vi.useRealTimers(); });

/** A receipt as the queue draws one: its line, and its Undo. */
function Receipt({ onGone }: { onGone: () => void }) {
    const { leaving, props } = useReceiptHold(onGone);
    return (
        <div role="status" data-testid="receipt" data-leaving={leaving ? "" : undefined} {...props}>
            <span>Applied</span>
            <button type="button">Undo</button>
            <button type="button">More</button>
        </div>
    );
}

const leaving = () => screen.getByTestId("receipt").hasAttribute("data-leaving");
const pass = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe("useReceiptHold", () => {
    test("a receipt stays its 5,000ms, then leaves over 200ms and is gone", () => {
        vi.useFakeTimers();
        const gone = vi.fn();
        render(<Receipt onGone={gone} />);
        pass(RECEIPT_HOLD_MS - 1);
        expect(leaving()).toBe(false);
        pass(1);
        expect(leaving()).toBe(true);
        pass(RECEIPT_LEAVE_MS - 1);
        expect(gone).not.toHaveBeenCalled();
        pass(1);
        expect(gone).toHaveBeenCalledTimes(1);
    });

    test("pointed at, it is held — checked again each 1,000ms — and leaves at the first check after the pointer goes", () => {
        vi.useFakeTimers();
        render(<Receipt onGone={() => {}} />);
        const receipt = screen.getByTestId("receipt");
        pass(4_000);
        fireEvent.pointerEnter(receipt);
        pass(1_000 + 3 * RECEIPT_RECHECK_MS);
        expect(leaving()).toBe(false);
        fireEvent.pointerLeave(receipt);
        pass(RECEIPT_RECHECK_MS - 1);
        expect(leaving()).toBe(false);
        pass(1);
        expect(leaving()).toBe(true);
    });

    test("focused, it is held — the focus moving on to another of its controls keeping it — and leaves once the focus has left it", () => {
        vi.useFakeTimers();
        render(<Receipt onGone={() => {}} />);
        const undo = screen.getByRole("button", { name: "Undo" });
        act(() => { undo.focus(); });
        pass(RECEIPT_HOLD_MS);
        expect(leaving()).toBe(false);
        act(() => { screen.getByRole("button", { name: "More" }).focus(); });
        pass(RECEIPT_RECHECK_MS);
        expect(leaving()).toBe(false);
        act(() => { (document.activeElement as HTMLElement).blur(); });
        pass(RECEIPT_RECHECK_MS);
        expect(leaving()).toBe(true);
    });

    test("under reduced motion it goes as it starts to leave", () => {
        vi.useFakeTimers();
        const real = Object.getOwnPropertyDescriptor(window, "matchMedia");
        Object.defineProperty(window, "matchMedia", {
            configurable: true,
            writable: true,
            value: (query: string) => ({
                matches: query === "(prefers-reduced-motion: reduce)", media: query, onchange: null, addEventListener: () => {},
                removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
            }),
        });
        try {
            const gone = vi.fn();
            render(<Receipt onGone={gone} />);
            pass(RECEIPT_HOLD_MS);
            expect(leaving()).toBe(true);
            // Its leave takes no time: gone at the next tick — the fake clock's 1ms — never 200ms on.
            pass(1);
            expect(gone).toHaveBeenCalledTimes(1);
        } finally {
            if (real === undefined) delete (window as { matchMedia?: unknown }).matchMedia;
            else Object.defineProperty(window, "matchMedia", real);
        }
    });
});
