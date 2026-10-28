/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The banner a run lands with (#1409; `Optimise Spec.md` §8, R16, R21), the
 * legend's `Elara change` and the footer line's words: the three banners'
 * words verbatim, their roles and tones, the eye in two of them and the
 * exclamation mark in the third, dismiss; the collapse over `--dur-base` once
 * the outcome goes; the legend unit; and the busy line's seconds, padded.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme/index.js";
import { OPTIMISE_BANNER_COLLAPSE_MS, OptimiseBanner, type OptimiseOutcome } from "./banner.js";
import { OptimiseLegendItem } from "./legend.js";
import { optimiseRunningLine, optimiseSeconds, optimiseStoppedLine } from "./line.js";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const DONE: OptimiseOutcome = { kind: "done", period: "W11", added: 4, changed: 5, removed: 2 };

function mount(outcome: OptimiseOutcome | undefined, onDismiss?: () => void) {
    const view = render(<ChakraProvider value={system}><OptimiseBanner outcome={outcome} onDismiss={onDismiss} /></ChakraProvider>);
    const banner = () => view.container.querySelector<HTMLElement>("[data-optimise-banner]");
    const live = () => view.container.querySelector<HTMLElement>("[role=status], [role=alert]")!;
    const at = (next: OptimiseOutcome | undefined) => view.rerender(<ChakraProvider value={system}><OptimiseBanner outcome={next} onDismiss={onDismiss} /></ChakraProvider>);
    return { ...view, banner, live, at };
}

const words = (live: HTMLElement) => [live.querySelector("[data-banner-title]")!.textContent, live.querySelector("[data-banner-body]")!.textContent];

describe("the banner", () => {
    test("done: the title names the period, the line counts the run's operations, and it is a status with the eye", () => {
        const { banner, live } = mount(DONE);
        expect(banner()!.getAttribute("data-optimise-banner")).toBe("done");
        expect(live().getAttribute("role")).toBe("status");
        expect(words(live())).toEqual(["Elara optimised W11", "11 changes: 4 added, 5 changed, 2 removed. Undo or apply them like any edit."]);
        expect(live().querySelector("[data-banner-mark] [data-eye]")).not.toBeNull();
    });

    test("done leaves a zero part out, and one change is singular", () => {
        const { live } = mount({ kind: "done", period: "Oct 5 – 9", added: 0, changed: 1, removed: 0 });
        expect(words(live())).toEqual(["Elara optimised Oct 5 – 9", "1 change: 1 changed. Undo or apply them like any edit."]);
    });

    test("none: a status with the eye, naming the period", () => {
        const { banner, live } = mount({ kind: "none", period: "8 work orders" });
        expect([banner()!.getAttribute("data-optimise-banner"), live().getAttribute("role")]).toEqual(["none", "status"]);
        expect(words(live())).toEqual(["No changes", "Elara found nothing to improve in 8 work orders."]);
        expect(live().querySelector("[data-banner-mark] [data-eye]")).not.toBeNull();
    });

    test("fail: an alert in the error tone with the exclamation mark, and no eye", () => {
        const { banner, live } = mount({ kind: "fail", period: "Wed 12 May" });
        expect([banner()!.getAttribute("data-optimise-banner"), live().getAttribute("role")]).toEqual(["fail", "alert"]);
        expect(words(live())).toEqual(["Couldn't optimise Wed 12 May", "Nothing changed. Run it again from the eye."]);
        expect(live().querySelector("[data-banner-mark] [data-eye]")).toBeNull();
        expect(live().querySelector("[data-banner-mark] svg")).not.toBeNull();
    });

    test("a close shows only with something to dismiss, and dismisses", () => {
        const onDismiss = vi.fn();
        const { live } = mount(DONE, onDismiss);
        fireEvent.click(live().querySelector("button")!);
        expect(onDismiss).toHaveBeenCalledTimes(1);
        cleanup();
        const bare = mount(DONE);
        expect(bare.live().querySelector("button")).toBeNull();
    });

    test("once the outcome goes it collapses over --dur-base, its words kept, then leaves; a new outcome replaces it in place", () => {
        vi.useFakeTimers();
        const { banner, live, at } = mount(DONE);
        act(() => { at(undefined); });
        expect([banner()!.hasAttribute("data-leaving"), words(live())[0]]).toEqual([true, "Elara optimised W11"]);
        act(() => { vi.advanceTimersByTime(OPTIMISE_BANNER_COLLAPSE_MS - 1); });
        expect(banner()).not.toBeNull();
        act(() => { vi.advanceTimersByTime(1); });
        expect(banner()).toBeNull();
        act(() => { at({ kind: "fail", period: "W11" }); });
        expect([banner()!.getAttribute("data-optimise-banner"), banner()!.hasAttribute("data-leaving")]).toEqual(["fail", false]);
        act(() => { at(DONE); });
        expect(banner()!.getAttribute("data-optimise-banner")).toBe("done");
    });
});

describe("the legend's item and the footer line's words", () => {
    test("the legend unit carries the swatch and the words, and is cut as the rail's fit says", () => {
        const { container } = render(<ChakraProvider value={system}><OptimiseLegendItem cut="" /></ChakraProvider>);
        const unit = container.querySelector("[data-optimise-legend]")!;
        expect([unit.hasAttribute("data-footer-unit"), unit.hasAttribute("data-footer-cut"), unit.textContent]).toEqual([true, true, "Elara change"]);
        expect(unit.querySelector("[data-optimise-swatch]")!.getAttribute("aria-hidden")).toBe("true");
    });

    test("the seconds count from 1, padded with a figure space under 10 so the line never shifts", () => {
        expect([optimiseSeconds(0), optimiseSeconds(1), optimiseSeconds(7.9), optimiseSeconds(10), optimiseSeconds(125)]).toEqual([" 1", " 1", " 7", "10", "125"]);
        expect(optimiseRunningLine("W11", 7)).toEqual({ kind: "busy", text: ["Optimising ", { strong: "W11" }], short: "Optimising…", aside: " 7 s" });
        expect(optimiseStoppedLine()).toEqual({ kind: "note", text: "Stopped · nothing changed", short: "Stopped" });
    });
});
