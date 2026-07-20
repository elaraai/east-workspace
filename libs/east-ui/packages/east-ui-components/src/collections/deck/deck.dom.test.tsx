/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * Deck interaction surface (#359): the STATUS REGISTRY paints each card
 * (solid tag + face wash vars + fill bar colour, token or custom CSS
 * colour), metrics render raw values through the shared format
 * interpreter, and the VIEW state — clicking a card with `onClick`
 * content opens an anchored POPOVER CARD whose head is inherited from
 * the card face, fires `onOpen`; Esc / outside click / × close it
 * (`onClose`) — and the hover peek mounts only on hover-capable
 * pointers. Cards without popover content stay plain tap targets.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { EastChakraDeck, type DeckValue, type DeckItemValue } from "./index.js";

// Zag's popper autoUpdate reaches for ResizeObserver once an overlay opens;
// jsdom lacks it (same stub as hover-parity.dom.test.tsx).
class ResizeObserverStub { observe() { /* noop */ } unobserve() { /* noop */ } disconnect() { /* noop */ } }
(globalThis as never as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub;

afterEach(cleanup);

type UIValue = NonNullable<ReturnType<typeof getDetail>>;
function getDetail(item: DeckItemValue) {
    return item.detail.type === "some" ? item.detail.value : undefined;
}

/** A minimal Text component payload (the simplest UIComponentType case). */
const text = (value: string): UIValue =>
    variant("Text", { value, style: none }) as unknown as UIValue;

type StatusColor = { token: string } | { custom: string };
function statusEntry(label: string, color: StatusColor, opts: { pulse?: boolean; hint?: string } = {}) {
    return {
        label,
        color: "token" in color
            ? variant("token", variant(color.token, null))
            : variant("custom", color.custom),
        pulse: opts.pulse ?? false,
        hint: opts.hint !== undefined ? some(opts.hint) : none,
    };
}

interface ItemOver {
    status?: string;
    metrics?: unknown[];
    fill?: unknown;
    detail?: unknown;
    hover?: unknown;
}

function item(key: string, over: ItemOver = {}): DeckItemValue {
    return {
        key,
        title: `Card ${key}`,
        sublabel: none,
        icon: none,
        status: over.status !== undefined ? some(over.status) : none,
        metrics: over.metrics ?? [],
        fill: over.fill !== undefined ? some(over.fill) : none,
        facts: [],
        filtered: false,
        groups: new Map(),
        face: none,
        detail: over.detail !== undefined ? some(over.detail) : none,
        hover: over.hover !== undefined ? some(over.hover) : none,
    } as unknown as DeckItemValue;
}

interface Cbs {
    onCardClick?: (key: string) => void;
    onOpen?: (key: string) => void;
    onClose?: () => void;
}

interface RootOver {
    statuses?: Map<string, unknown>;
    footer?: { label: string; value: string }[];
    legend?: boolean;
}

function deckValue(items: DeckItemValue[], cbs: Cbs = {}, over: RootOver = {}): DeckValue {
    return {
        items,
        statuses: over.statuses ?? new Map(),
        groupOptions: [],
        groupSummaries: new Map(),
        footer: over.footer ?? [],
        legend: over.legend ?? false,
        layout: none,
        onCardClick: cbs.onCardClick !== undefined ? some(cbs.onCardClick) : none,
        onOpen: cbs.onOpen !== undefined ? some(cbs.onOpen) : none,
        onClose: cbs.onClose !== undefined ? some(cbs.onClose) : none,
        slice: none,
        style: none,
    } as unknown as DeckValue;
}

const REGISTRY = new Map<string, unknown>([
    ["fault", statusEntry("Fault", { token: "danger" }, { pulse: true, hint: "needs attention" })],
    ["standby", statusEntry("Standby", { custom: "#3568c9" }, { hint: "idle, ready" })],
]);

let keyCounter = 0;
function renderDeck(value: DeckValue) {
    keyCounter += 1;
    return render(
        <ChakraProvider value={system}>
            <EastChakraDeck value={value} storageKey={`deck-test-${keyCounter}`} />
        </ChakraProvider>,
    );
}

describe("EastChakraDeck interaction surface", () => {
    test("the status registry paints the card: tag label, status vars, token and custom colours", () => {
        renderDeck(deckValue([
            item("a", { status: "fault" }),
            item("b", { status: "standby" }),
            item("c"),
        ], {}, { statuses: REGISTRY }));
        const a = screen.getByText("Card a").closest("[data-status]") as HTMLElement;
        expect(a).toBeTruthy();
        expect(a.style.getPropertyValue("--dc")).toBe("var(--chakra-colors-status-neg)");
        expect(a.style.getPropertyValue("--dt")).toContain("color-mix");
        // The solid tag shows the registry label; pulse marks the dot.
        const tag = screen.getByText("Fault");
        expect(tag.hasAttribute("data-pulse")).toBe(true);
        // Custom CSS colours flow through verbatim.
        const b = screen.getByText("Card b").closest("[data-status]") as HTMLElement;
        expect(b.style.getPropertyValue("--dc")).toBe("#3568c9");
        expect(screen.getByText("Standby").hasAttribute("data-pulse")).toBe(false);
        // No status → no wash, no tag.
        expect(screen.getByText("Card c").closest("[data-status]")).toBeNull();
    });

    test("metrics render raw values (pre-rendered text, warn flag, missing → em dash)", () => {
        renderDeck(deckValue([
            item("a", {
                metrics: [
                    { label: "Temp", value: some(44.1), format: none, text: some("44.1°"), warn: true },
                    { label: "Rate", value: none, format: none, text: none, warn: false },
                ],
            }),
        ]));
        const temp = screen.getByText("44.1°");
        expect(temp.hasAttribute("data-warn")).toBe(true);
        const dash = screen.getByText("—");
        expect(dash.hasAttribute("data-muted")).toBe(true);
        expect(screen.getByText("Temp")).toBeTruthy();
        expect(screen.getByText("Rate")).toBeTruthy();
    });

    test("the fill bar renders a percentage reading by default", () => {
        renderDeck(deckValue([
            item("a", { fill: { value: 62, max: 100, format: none, text: none } }),
        ]));
        expect(screen.getByText("62%")).toBeTruthy();
    });

    test("footer stats and the registry legend render", () => {
        renderDeck(deckValue([item("a")], {}, {
            statuses: REGISTRY,
            footer: [{ label: "Lines", value: "6" }, { label: "Faulted", value: "1" }],
            legend: true,
        }));
        expect(screen.getByText("Lines")).toBeTruthy();
        expect(screen.getByText("6")).toBeTruthy();
        // Legend items carry the registry label + hint.
        expect(screen.getByText("Fault")).toBeTruthy();
        expect(screen.getByText("needs attention")).toBeTruthy();
        expect(screen.getByText("idle, ready")).toBeTruthy();
    });

    test("clicking a card with onClick content opens the popover with the inherited head", async () => {
        const onOpen = vi.fn();
        renderDeck(deckValue([
            item("a", { status: "fault", detail: text("DETAIL A") }),
        ], { onOpen }, { statuses: REGISTRY }));
        fireEvent.click(screen.getByText("Card a").closest("[role=button]")!);
        expect(await screen.findByText("DETAIL A")).toBeTruthy();
        const pop = screen.getByRole("dialog");
        expect(pop.getAttribute("aria-label")).toBe("Card a");
        // The popover head INHERITS the card face — the title and status
        // tag appear in both the card and the popover head.
        expect(screen.getAllByText("Card a").length).toBe(2);
        expect(screen.getAllByText("Fault").length).toBe(2);
        await waitFor(() => expect(onOpen).toHaveBeenCalledWith("a"));
    });

    test("Escape, the close button and outside clicks close the popover", async () => {
        const onClose = vi.fn();
        renderDeck(deckValue([
            item("a", { detail: text("DETAIL A") }),
        ], { onClose }));
        fireEvent.click(screen.getByText("Card a").closest("[role=button]")!);
        const pop = await screen.findByRole("dialog");
        fireEvent.keyDown(pop, { key: "Escape" });
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        // Reopen and close via the × button.
        fireEvent.click(screen.getByText("Card a").closest("[role=button]")!);
        fireEvent.click(await screen.findByLabelText("Close"));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(onClose).toHaveBeenCalledTimes(2);
        // Reopen and close by clicking outside the popover (the machine's
        // interact-outside tracks pointerdown).
        fireEvent.click(screen.getByText("Card a").closest("[role=button]")!);
        await screen.findByRole("dialog");
        fireEvent.pointerDown(document.body);
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(3));
    });

    test("cards without popover content don't open one but still report clicks", async () => {
        const onCardClick = vi.fn();
        renderDeck(deckValue([item("plain")], { onCardClick }));
        fireEvent.click(screen.getByText("Card plain").closest("[role=button]")!);
        await waitFor(() => expect(onCardClick).toHaveBeenCalledWith("plain"));
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    test("cards are not interactive without detail or onCardClick", () => {
        renderDeck(deckValue([item("plain")]));
        expect(screen.getByText("Card plain").closest("[role=button]")).toBeNull();
    });

    test("hover peeks stay unmounted on non-hover-capable pointers", () => {
        // jsdom matchMedia mock reports no hover capability by default —
        // the peek must never mount even after a mouseenter.
        renderDeck(deckValue([
            item("a", { hover: text("PEEK A") }),
        ]));
        fireEvent.mouseEnter(screen.getByText("Card a").closest("[data-part], div")!);
        expect(screen.queryByText("PEEK A")).toBeNull();
    });
});
