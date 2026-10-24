/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The footer's loading line in the DOM (#1398, CL3, CL4, CL12): an empty
 * polite live region while nothing is in flight; its words once its read's
 * reveal says so, kept through the hold; a failure at once, with Retry; and
 * the rail's fit — the legend whole and in place, the line full, short or its
 * dot alone, the legend cut at a whole item only where even that leaves it no
 * room — measured from the rendered rail. jsdom lays nothing out: the rail's
 * width and its items' are laid out here, as the browser would.
 */

import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../../theme/index.js";
import { useLoadingReveal } from "../../collections/loading/reveal.js";
import { UnloadedRun } from "../../collections/loading/unloaded-run.js";
import { FooterMore, LoadingLine, footerCut, useFooterFit, type LoadingLineValue } from "./loading-line.js";

const LOADING: LoadingLineValue = { kind: "loading", text: ["Loading work orders ", { strong: "8,301–8,500" }], short: "Loading…" };

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

const line = () => document.querySelector<HTMLElement>("[data-footer-line]")!;

describe("the loading line", () => {
    test("with nothing in flight it is an empty polite live region, out of the flow", () => {
        render(<ChakraProvider value={system}><LoadingLine value={undefined} shown={false} form="full" /></ChakraProvider>);
        expect([line().getAttribute("role"), line().getAttribute("aria-live"), line().hasAttribute("data-idle"), line().textContent]).toEqual(["status", "polite", true, ""]);
    });

    test("a read in flight says nothing until its reveal shows it, then its words, the range strong", () => {
        const view = render(<ChakraProvider value={system}><LoadingLine value={LOADING} shown={false} form="full" /></ChakraProvider>);
        expect(line().hasAttribute("data-idle")).toBe(true);
        view.rerender(<ChakraProvider value={system}><LoadingLine value={LOADING} shown form="full" /></ChakraProvider>);
        const text = line().querySelector("[data-line-text]")!;
        expect([line().getAttribute("data-loading-line"), text.textContent, text.querySelector("b")!.textContent]).toEqual(["loading", "Loading work orders 8,301–8,500", "8,301–8,500"]);
        // The dot, the short form and the copies the fit measures are not read; the full text is, in every form.
        expect(["[data-line-dot]", "[data-line-short]", "[data-line-measure]"].map((s) => line().querySelector(s)!.getAttribute("aria-hidden"))).toEqual(["true", "true", "true"]);
        view.rerender(<ChakraProvider value={system}><LoadingLine value={LOADING} shown form="dot" /></ChakraProvider>);
        expect([line().getAttribute("data-form"), line().querySelector("[data-line-text]")!.getAttribute("aria-hidden")]).toEqual(["dot", null]);
    });

    test("its words stay through the hold once its read has landed, then it empties", () => {
        const view = render(<ChakraProvider value={system}><LoadingLine value={LOADING} shown form="full" /></ChakraProvider>);
        view.rerender(<ChakraProvider value={system}><LoadingLine value={undefined} shown form="full" /></ChakraProvider>);
        expect(line().querySelector("[data-line-text]")!.textContent).toBe("Loading work orders 8,301–8,500");
        view.rerender(<ChakraProvider value={system}><LoadingLine value={undefined} shown={false} form="full" /></ChakraProvider>);
        expect(line().hasAttribute("data-idle")).toBe(true);
    });

    test("a failure shows at once, its dot still, with Retry", () => {
        const onRetry = vi.fn();
        const failed: LoadingLineValue = { kind: "failed", text: ["Couldn't read ", { strong: "12–18 Mar" }], short: "Couldn't read", onRetry };
        render(<ChakraProvider value={system}><LoadingLine value={failed} shown={false} form="short" /></ChakraProvider>);
        expect([line().hasAttribute("data-failed"), line().getAttribute("data-form"), line().querySelector("[data-line-short]")!.textContent]).toEqual([true, "short", "Couldn't read"]);
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});

/** Each rail item's laid-out width, by what it is. */
const WIDTHS = { unit: 80, more: 12, full: 220, short: 70, dot: 8 } as const;

/** The rail's width, as the test lays it out. */
let railWidth = 714;

/** Lays a rail out as the browser would: its width and padding, its gap, and each item's own width. */
function layOut() {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const width = this.hasAttribute("data-footer-unit") ? WIDTHS.unit
            : this.hasAttribute("data-footer-more") ? WIDTHS.more
                : this.matches("[data-line-measure] > [data-form]") ? WIDTHS[this.getAttribute("data-form") as "full" | "short" | "dot"]
                    : 0;
        return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 20, width, height: 20, toJSON() {} };
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
        return this.hasAttribute("data-rail") ? railWidth : 0;
    });
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) => {
        if (el.hasAttribute("data-rail")) {
            return { paddingInlineStart: "12px", paddingInlineEnd: "12px", columnGap: "14px", display: "flex", position: "relative" } as unknown as CSSStyleDeclaration;
        }
        if (el.hasAttribute("data-footer-line")) return { maxWidth: "64%", display: "inline-flex", position: "relative" } as unknown as CSSStyleDeclaration;
        return real(el);
    });
}

/** A rail of five legend items and the loading line, fitted. */
function Rail({ value }: { value: LoadingLineValue | undefined }) {
    const ref = useRef<HTMLDivElement>(null);
    const fit = useFooterFit(ref);
    const items = ["Permanent", "Agency staff", "Requested", "Open", "Hours needed"];
    return (
        <div ref={ref} data-rail="">
            {items.map((item, i) => <span key={item} data-footer-unit="" data-footer-cut={footerCut(i, fit)}>{item}</span>)}
            <FooterMore shown={fit.kept < items.length} />
            <LoadingLine value={value} shown form={fit.form} />
        </div>
    );
}

/** The units the fit keeps, whether the legend ends in "…", and the line's form. */
const fitted = () => [
    document.querySelectorAll("[data-footer-unit]:not([data-footer-cut])").length,
    !document.querySelector("[data-footer-more]")!.hasAttribute("data-footer-cut"),
    line().getAttribute("data-form"),
];

describe("the rail's fit (CL3)", () => {
    beforeEach(() => { railWidth = 714; layOut(); });

    test("the legend whole and the line's full text, where both fit", () => {
        // 714 less 24 of padding: the legend's 456, a gap and the full line's 220.
        render(<ChakraProvider value={system}><Rail value={LOADING} /></ChakraProvider>);
        expect(fitted()).toEqual([5, false, "full"]);
    });

    test("narrower, its short form; then its dot alone; then the legend ends at a whole item, then …, the line short", () => {
        const view = render(<ChakraProvider value={system}><Rail value={LOADING} /></ChakraProvider>);
        for (const [width, want] of [[564, [5, false, "short"]], [502, [5, false, "dot"]], [496, [4, true, "short"]], [360, [2, true, "short"]]] as const) {
            railWidth = width;
            view.rerender(<ChakraProvider value={system}><Rail value={LOADING} /></ChakraProvider>);
            expect([width, fitted()]).toEqual([width, want]);
        }
    });

    test("with nothing in flight the legend keeps its place: the line takes no room", () => {
        railWidth = 480;
        render(<ChakraProvider value={system}><Rail value={undefined} /></ChakraProvider>);
        expect(fitted().slice(0, 2)).toEqual([5, false]);
    });
});

/** A builder's one clock (CL4): the line and a run's fill take the same reveal. */
function Loading({ waiting }: { waiting: boolean }) {
    const shown = useLoadingReveal(waiting);
    return (
        <>
            <UnloadedRun height={3600} pitch={36} view={{ top: 0, bottom: 72 }} columns="1fr" cells={[{ kind: "text" }]} filled={shown} first={0} />
            <LoadingLine value={waiting ? LOADING : undefined} shown={shown} form="full" />
        </>
    );
}

describe("the reveal across the line and the fill (CL4)", () => {
    const filled = () => document.querySelector("[data-unloaded-run]")!.hasAttribute("data-filled");
    const said = () => !line().hasAttribute("data-idle");
    const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

    test("a 100 ms load shows no fill and no loading line", () => {
        vi.useFakeTimers();
        const view = render(<ChakraProvider value={system}><Loading waiting /></ChakraProvider>);
        advance(100);
        expect([filled(), said()]).toEqual([false, false]);
        view.rerender(<ChakraProvider value={system}><Loading waiting={false} /></ChakraProvider>);
        advance(500);
        expect([filled(), said()]).toEqual([false, false]);
    });

    test("a 400 ms load shows both from 150 ms, for at least 300 ms", () => {
        vi.useFakeTimers();
        const view = render(<ChakraProvider value={system}><Loading waiting /></ChakraProvider>);
        advance(149);
        expect([filled(), said()]).toEqual([false, false]);
        advance(1);
        expect([filled(), said()]).toEqual([true, true]);
        advance(250);
        view.rerender(<ChakraProvider value={system}><Loading waiting={false} /></ChakraProvider>);
        // Landed at 400: both stay until the hold's end at 450, the line still saying what it read.
        advance(49);
        expect([filled(), said(), line().querySelector("[data-line-text]")!.textContent]).toEqual([true, true, "Loading work orders 8,301–8,500"]);
        advance(1);
        expect([filled(), said()]).toEqual([false, false]);
    });
});
