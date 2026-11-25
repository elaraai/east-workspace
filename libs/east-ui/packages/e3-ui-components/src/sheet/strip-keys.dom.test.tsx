/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The strip's keys give way first (east-workspace#1743), over a layout the
 * test gives — jsdom lays nothing out: a strip as a flex row lays it, its
 * label, its meta and its keys their own widths and its chips' row the rest.
 * Where the label, the meta and the keys leave the chips no room, the keys go
 * and the chips show; and at a width where the chips and the keys just miss
 * fitting, measured to the fraction of a pixel, the choice holds still. Where
 * the keys don't show — no room, or a coarse pointer — the armed candidate's
 * place among them, which the keys lead with, stands where they would.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "@elaraai/east-ui-components";
import { touchFrame } from "./frame.test-utils.js";
import { SheetStrip, type StripChip, type StripModel } from "./Strip.js";

/** The layout the test gives: the strip's inside width, and each part's own. */
interface Laid {
    readonly strip: number;
    readonly label: number;
    readonly meta: number;
    readonly keys: number;
    readonly chips: readonly number[];
}

const saved = {
    rect: Element.prototype.getBoundingClientRect,
    client: Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth")!,
    offset: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")!,
};
afterEach(() => {
    cleanup();
    Element.prototype.getBoundingClientRect = saved.rect;
    Object.defineProperty(Element.prototype, "clientWidth", saved.client);
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", saved.offset);
});

/** The armed candidate's place, where it stands in the keys' stead: its width. */
const COUNT_PX = 40;

/** Lays the strip out as a flex row does: each part its own width, the chips' row what the label, the meta and the keys — or the count in their stead — leave. */
function lay(laid: Laid): void {
    const widthOf = (el: Element): number => {
        const slot = el.getAttribute("data-slot");
        if (slot === "stripLabel") return laid.label;
        if (slot === "stripMeta") return laid.meta;
        if (slot === "stripKeys") return laid.keys;
        if (slot === "stripCount") return COUNT_PX;
        const within = el.parentElement;
        if (el.hasAttribute("data-measure-chip")) return laid.chips[[...within!.querySelectorAll(":scope > [data-measure-chip]")].indexOf(el)] ?? 0;
        // The keys' unseen copy, beside the chips' copies.
        if (within?.getAttribute("data-slot") === "stripMeasure") return laid.keys;
        if (slot === "stripChips") {
            const keys = within!.querySelector(':scope > [data-slot="stripKeys"]') !== null;
            const count = within!.querySelector(':scope > [data-slot="stripCount"]') !== null;
            return Math.max(0, laid.strip - laid.label - laid.meta - (keys ? laid.keys : count ? COUNT_PX : 0));
        }
        return 0;
    };
    Element.prototype.getBoundingClientRect = function (this: Element) {
        const width = widthOf(this);
        return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) } as DOMRect;
    };
    // A box's width as the page rounds it, where its exact width is asked for by its box.
    const rounded = { configurable: true, get(this: Element) { return Math.round(widthOf(this)); } };
    Object.defineProperty(Element.prototype, "clientWidth", rounded);
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", rounded);
}

const chip = (key: string, on: boolean): StripChip => ({ key, label: key, on, flat: false, title: key });
const MODEL: StripModel = {
    on: true, label: "MACHINES", chips: [chip("S1-press", true), chip("S1-saw", false)], meta: "press · bay 2", keys: "1 of 2 · ⇥ take · , next", count: "1 of 2",
};

/** The strip drawn over the layout: whether its keys show, the armed candidate's place where it stands alone, and the chips on its page. */
function drawn(laid: Laid) {
    lay(laid);
    const { container } = render(<ChakraProvider value={system}><SheetStrip styles={{}} model={MODEL} onAction={() => undefined} /></ChakraProvider>);
    return {
        keys: container.querySelector('[data-slot="strip"] > [data-slot="stripKeys"]') !== null,
        count: container.querySelector('[data-slot="strip"] > [data-slot="stripCount"]')?.textContent,
        chips: [...container.querySelectorAll('[data-slot="stripChips"] > [data-slot="stripChip"]')].map((el) => el.textContent),
    };
}

describe("the strip's keys give way first (east-workspace#1743)", () => {
    test("where the label, the meta and the keys leave the chips no room at all, the keys go and the chips show", () => {
        // 600 inside: the label 120, the meta 200 and the keys 280 fill it, so the chips' row is laid out 0 wide.
        expect(drawn({ strip: 600, label: 120, meta: 200, keys: 280, chips: [80, 70] })).toEqual({ keys: false, count: "1 of 2", chips: ["S1-press", "S1-saw"] });
    });

    test("where they have the room, the keys stand beside the chips", () => {
        expect(drawn({ strip: 900, label: 120, meta: 200, keys: 280, chips: [80, 70] })).toEqual({ keys: true, count: undefined, chips: ["S1-press", "S1-saw"] });
    });

    test("a coarse pointer's strip names no key, whatever its room, and still says where the armed candidate stands", () => {
        const restore = touchFrame(1024);
        try {
            expect(drawn({ strip: 900, label: 120, meta: 200, keys: 280, chips: [80, 70] })).toEqual({ keys: false, count: "1 of 2", chips: ["S1-press", "S1-saw"] });
        } finally {
            restore();
        }
    });

    test("at a width where the chips and the keys just miss fitting, by a fraction of a pixel, the choice holds still: the keys stay away", () => {
        // The chips' row is 220.4 beside keys 279.4 wide, 499.8 without them; the chips take 221 with their gap. Rounded,
        // the row and the keys came to 499 with the keys drawn and 500 without, and 221 + 279 fits the one and not the other.
        expect(() => drawn({ strip: 819.8, label: 120, meta: 200, keys: 279.4, chips: [110, 107] })).not.toThrow();
        cleanup();
        expect(drawn({ strip: 819.8, label: 120, meta: 200, keys: 279.4, chips: [110, 107] })).toEqual({ keys: false, count: "1 of 2", chips: ["S1-press", "S1-saw"] });
    });
});
