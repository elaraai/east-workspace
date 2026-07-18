/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * Deck interaction surface (#359): tone accents on cards, the VIEW
 * state — clicking a card with `onClick` content opens an anchored
 * POPOVER CARD whose head is inherited from the card face (title,
 * status), fires `onOpen`; Esc / outside click / × close it
 * (`onClose`) — and the hover peek mounts only on hover-capable
 * pointers. Cards without popover content stay plain tap targets.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { EastChakraDeck, type DeckValue, type DeckItemValue } from "./index.js";

afterEach(cleanup);

type UIValue = NonNullable<ReturnType<typeof getDetail>>;
function getDetail(item: DeckItemValue) {
    return item.detail.type === "some" ? item.detail.value : undefined;
}

/** A minimal Text component payload (the simplest UIComponentType case). */
const text = (value: string): UIValue =>
    variant("Text", { value, style: none }) as unknown as UIValue;

function item(key: string, over: Partial<Record<"tone" | "detail" | "hover", unknown>> = {}): DeckItemValue {
    return {
        key,
        title: `Card ${key}`,
        sublabel: none,
        icon: none,
        status: none,
        tone: over.tone !== undefined ? some(over.tone) : none,
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

function deckValue(items: DeckItemValue[], cbs: Cbs = {}): DeckValue {
    return {
        items,
        groupOptions: [],
        groupSummaries: new Map(),
        layout: none,
        onCardClick: cbs.onCardClick !== undefined ? some(cbs.onCardClick) : none,
        onOpen: cbs.onOpen !== undefined ? some(cbs.onOpen) : none,
        onClose: cbs.onClose !== undefined ? some(cbs.onClose) : none,
        slice: none,
        style: none,
    } as unknown as DeckValue;
}

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
    test("tone paints the card accent attribute", () => {
        renderDeck(deckValue([
            item("a", { tone: variant("danger", null) }),
            item("b"),
        ]));
        const a = screen.getByText("Card a").closest("[data-tone]");
        expect(a).toBeTruthy();
        expect(a!.getAttribute("data-tone")).toBe("danger");
        expect(screen.getByText("Card b").closest("[data-tone]")).toBeNull();
    });

    test("clicking a card with onClick content opens the popover with the inherited head", async () => {
        const onOpen = vi.fn();
        renderDeck(deckValue([
            item("a", { detail: text("DETAIL A") }),
        ], { onOpen }));
        fireEvent.click(screen.getByText("Card a").closest("[role=button]")!);
        expect(await screen.findByText("DETAIL A")).toBeTruthy();
        const pop = screen.getByRole("dialog");
        expect(pop.getAttribute("aria-label")).toBe("Card a");
        // The popover head INHERITS the card face — the title appears in
        // both the card and the popover head.
        expect(screen.getAllByText("Card a").length).toBe(2);
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
        // Reopen and close by clicking outside the popover.
        fireEvent.click(screen.getByText("Card a").closest("[role=button]")!);
        await screen.findByRole("dialog");
        fireEvent.mouseDown(document.body);
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(onClose).toHaveBeenCalledTimes(3);
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
