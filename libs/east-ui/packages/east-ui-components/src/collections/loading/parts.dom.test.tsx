/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The shared loading parts in the DOM (#1398): the region wash, a failure
 * said once where no row can hold it, a region its read found empty said
 * once, the narrow layouts' placeholder card, and every placeholder shape
 * `aria-hidden` (CL12) — and, under a builder's reveal, unseen at its
 * footprint until the reveal says so (CL4).
 */

import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { faInbox } from "@fortawesome/free-solid-svg-icons";
import { system } from "../../theme/index.js";
import { LoadingEmptyLine, LoadingFailedBox, LoadingFailedLine, LoadingWash, PlaceholderCard, PlaceholderShape, type PlaceholderKind } from "./parts.js";
import { LoadingReveal } from "./reveal.js";

afterEach(() => { cleanup(); });

const wrap = (node: ReactNode) => render(<ChakraProvider value={system}>{node}</ChakraProvider>);

describe("the loading parts", () => {
    test("the region wash covers its region, or the part of it given, and shows only once revealed", () => {
        const view = wrap(<div style={{ position: "relative" }}><LoadingWash /></div>);
        const wash = document.querySelector<HTMLElement>("[data-loading-wash]")!;
        expect(wash.getAttribute("aria-hidden")).toBe("true");
        expect(wash.style.left).toBe("");
        view.rerender(<ChakraProvider value={system}><div><LoadingWash geometry={{ left: 360, top: 0, right: 0, bottom: 0 }} /></div></ChakraProvider>);
        expect(document.querySelector<HTMLElement>("[data-loading-wash]")!.style.left).toBe("360px");
        view.rerender(<ChakraProvider value={system}><div><LoadingWash shown={false} /></div></ChakraProvider>);
        expect(document.querySelector("[data-loading-wash]")).toBeNull();
    });

    test("every shape is aria-hidden and states no value", () => {
        const kinds: PlaceholderKind[] = ["text", "number", "date", "boolean", "chip", "link", "enum", "label", "label2", "aggregate", "count", "check", "rowNumber", "fill"];
        wrap(<div>{kinds.map((kind) => <PlaceholderShape key={kind} kind={kind} index={3} />)}</div>);
        const shapes = [...document.querySelectorAll("[data-shape]")];
        expect(shapes.map((shape) => shape.getAttribute("data-shape"))).toEqual(kinds);
        expect(shapes.every((shape) => shape.getAttribute("aria-hidden") === "true")).toBe(true);
        // The link's arrow is the only character any shape draws: no number, no word.
        expect(shapes.map((shape) => shape.textContent).join("")).toBe("→");
    });

    test("a region with no row to hold a line says its failure once, in the message box at its top-left in view", () => {
        const onRetry = vi.fn();
        wrap(<div style={{ position: "relative" }}><LoadingFailedBox message="Couldn't read November 2026" retry={{ onRetry }} at={{ top: 60, left: 16 }} /></div>);
        const box = document.querySelector<HTMLElement>("[data-loading-failed-box]")!;
        expect([box.style.top, box.style.left, box.textContent]).toEqual(["60px", "16px", "Couldn't read November 2026Retry"]);
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    test("a failed line names what it retries, and an empty line takes its slot and shape without one", () => {
        const view = wrap(<LoadingFailedLine message="Couldn't read Wed 12 May" retry={{ onRetry: () => {}, name: "Retry Wed 12 May" }} />);
        expect(screen.getByRole("button", { name: "Retry Wed 12 May" }).textContent).toBe("Retry");
        view.rerender(<ChakraProvider value={system}><LoadingFailedLine message="No bins on Wed 12 May" /></ChakraProvider>);
        expect([screen.queryByRole("button"), document.querySelector("[data-loading-failed-message]")!.textContent]).toEqual([null, "No bins on Wed 12 May"]);
    });

    test("an empty line says what its read found empty after the Empty state's glyph, and its hint after its words, heard whether or not it shows", () => {
        const view = wrap(<LoadingEmptyLine icon={faInbox} message="No bins on Wed 12 May" hint="Drag an arrival onto a lane hour" />);
        const line = document.querySelector<HTMLElement>("[data-loading-empty]")!;
        expect(line.querySelector("svg")!.closest("[aria-hidden=true]")).not.toBeNull();
        expect([line.querySelector("[data-loading-empty-message]")!.textContent, line.querySelector("[data-loading-empty-hint]")!.textContent])
            .toEqual(["No bins on Wed 12 May", "· Drag an arrival onto a lane hour"]);
        // Its words are what it says to assistive technology: the hint among them, never hidden from it.
        expect(line.textContent).toBe("No bins on Wed 12 May· Drag an arrival onto a lane hour");
        expect(line.querySelector("[data-loading-empty-hint]")!.closest("[aria-hidden]")).toBeNull();
        view.rerender(<ChakraProvider value={system}><LoadingEmptyLine icon={faInbox} message="No bins on Wed 12 May" /></ChakraProvider>);
        expect(document.querySelector("[data-loading-empty-hint]")).toBeNull();
    });

    test("the placeholder card: its height a real card's, a title bar or its real title, one meta bar, filled once revealed", () => {
        const view = wrap(<PlaceholderCard height={104} index={0} filled />);
        const card = document.querySelector<HTMLElement>("[data-placeholder-card]")!;
        expect([card.style.minHeight, card.getAttribute("aria-hidden")]).toEqual(["104px", "true"]);
        expect([...card.querySelectorAll("[data-shape]")].map((shape) => shape.getAttribute("data-shape"))).toEqual(["label", "aggregate"]);
        view.rerender(<ChakraProvider value={system}><PlaceholderCard height={104} index={0} filled title="Thu 9 · Inbound · Early" /></ChakraProvider>);
        const titled = document.querySelector<HTMLElement>("[data-placeholder-card]")!;
        expect([titled.getAttribute("aria-hidden"), titled.textContent]).toEqual([null, "Thu 9 · Inbound · Early"]);
        view.rerender(<ChakraProvider value={system}><PlaceholderCard height={104} index={0} filled={false} /></ChakraProvider>);
        expect(document.querySelectorAll("[data-placeholder-card] [data-shape]")).toHaveLength(0);
    });

    test("under a builder's reveal every shape and the wash keep their footprint unseen until it says so; a real row number shows at once (CL4)", () => {
        vi.useFakeTimers();
        try {
            const kinds: PlaceholderKind[] = ["text", "number", "date", "boolean", "chip", "link", "enum", "label", "label2", "aggregate", "count", "fill"];
            wrap(
                <LoadingReveal waiting>
                    {kinds.map((kind) => <PlaceholderShape key={kind} kind={kind} index={3} />)}
                    <PlaceholderShape kind="rowNumber" index={3} number="4" />
                    <LoadingWash />
                </LoadingReveal>,
            );
            const hidden = () => [...document.querySelectorAll("[data-shape], [data-loading-wash]")].map((el) => el.hasAttribute("data-unrevealed"));
            expect(hidden()).toEqual([...kinds.map(() => true), false, true]);
            act(() => { vi.advanceTimersByTime(150); });
            expect(hidden().every((unseen) => !unseen)).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});
