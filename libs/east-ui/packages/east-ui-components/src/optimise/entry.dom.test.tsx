/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The eye's entry in its builder's View (ruled 27 Oct 2026, "Into the View
 * menu"): what the eye folds into where the row's floor needs its room, doing
 * what the eye does — named `Optimise {period}` at rest and `Stop optimising`
 * while a run is out, a press starting or stopping the run; off while the
 * period cannot take a run yet, a press doing nothing, and saying why —
 * `Read-only` — in words beside its name, as a touch screen shows them, and as
 * its description; its mark the eye's, at 14px, in the eye's colours while a
 * run is out; and its words its host's table's.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme/index.js";
import { OptimiseEntry, type OptimiseEntryProps } from "./entry.js";
import { optimiseMessages } from "./messages.js";

afterEach(cleanup);

function mount(props: Partial<OptimiseEntryProps> = {}) {
    const onRun = vi.fn();
    const onStop = vi.fn();
    const view = render(
        <ChakraProvider value={system}>
            <OptimiseEntry period="W11" running={false} onRun={onRun} onStop={onStop} {...props} />
        </ChakraProvider>,
    );
    const entry = () => view.container.querySelector<HTMLButtonElement>("[data-optimise-entry]")!;
    return { ...view, onRun, onStop, entry };
}

describe("the eye's entry in its builder's View", () => {
    test("at rest it is named for the period, in its words and to assistive technology, its mark the eye's at 14px; a press starts a run", () => {
        const { entry, onRun, onStop } = mount();
        expect([entry().tagName, entry().getAttribute("aria-label"), entry().textContent, entry().disabled, entry().hasAttribute("data-running")])
            .toEqual(["BUTTON", "Optimise W11", "Optimise W11", false, false]);
        expect(entry().querySelector('[data-eye][data-eye-size="14"]')).not.toBeNull();
        expect([entry().querySelector("[data-entry-reason]"), entry().getAttribute("aria-describedby")]).toEqual([null, null]);
        fireEvent.click(entry());
        expect([onRun.mock.calls.length, onStop.mock.calls.length]).toEqual([1, 0]);
    });

    test("while a run is out it is Stop optimising, its mark in the eye's running colours, and a press stops the run", () => {
        const { entry, onRun, onStop } = mount({ running: true });
        expect([entry().getAttribute("aria-label"), entry().textContent, entry().hasAttribute("data-running")]).toEqual(["Stop optimising", "Stop optimising", true]);
        expect(entry().querySelector("[data-eye]")).not.toBeNull();
        fireEvent.click(entry());
        expect([onRun.mock.calls.length, onStop.mock.calls.length]).toEqual([0, 1]);
    });

    test("off while the period cannot take a run yet: a press does nothing, and it says why — Read-only — beside its name and as its description", () => {
        const { entry, onRun, onStop } = mount({ disabled: true });
        expect([entry().disabled, entry().getAttribute("aria-label")]).toEqual([true, "Optimise W11"]);
        const reason = entry().querySelector<HTMLElement>("[data-entry-reason]")!;
        expect(reason.textContent).toBe("Read-only");
        expect(entry().getAttribute("aria-describedby")).toBe(reason.id);
        expect(reason.id).not.toBe("");
        fireEvent.click(entry());
        expect([onRun.mock.calls.length, onStop.mock.calls.length]).toEqual([0, 0]);
    });

    test("its words are its host's table's: its names and why it is off", () => {
        const messages = { ...optimiseMessages, optimise: ({ period }: { period: string }) => `Optimiser ${period}`, stop: () => "Arrêter", readOnly: () => "Lecture seule" };
        const { entry, rerender } = mount({ disabled: true, messages });
        expect([entry().getAttribute("aria-label"), entry().querySelector("[data-entry-reason]")!.textContent]).toEqual(["Optimiser W11", "Lecture seule"]);
        rerender(<ChakraProvider value={system}><OptimiseEntry period="W11" running onRun={() => {}} onStop={() => {}} messages={messages} /></ChakraProvider>);
        expect([entry().getAttribute("aria-label"), entry().textContent]).toEqual(["Arrêter", "Arrêter"]);
    });
});
