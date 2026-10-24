/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * Where a popover opened inside a builder's frame keeps to (#1393): across the
 * page the frame's sides while it fits between them, else the page's; down the
 * page always the page's; read live, as the frame moves and narrows.
 */
import { afterEach, beforeEach, expect, test } from "vitest";
import { POPOVER_OVERFLOW, frameBounds } from "./frame-bounds.js";

/** The page's size, as its root's client box gives it. */
const PAGE = { width: 1600, height: 1000 };

/** A frame's box, which the test moves. */
let frameBox = { left: 80, width: 1024 };
/** The popover's width. */
let popoverWidth = 320;

beforeEach(() => {
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, get: () => PAGE.width });
    Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, get: () => PAGE.height });
    frameBox = { left: 80, width: 1024 };
    popoverWidth = 320;
});
afterEach(() => { document.body.replaceChildren(); });

/** A builder's frame holding a trigger, and a popover's content portalled to the page. */
function mount(): { trigger: HTMLElement; loose: HTMLElement; content: HTMLElement } {
    const frame = document.createElement("div");
    frame.setAttribute("data-builder-frame", "");
    frame.getBoundingClientRect = () => DOMRect.fromRect({ x: frameBox.left, y: 120, width: frameBox.width, height: 600 });
    const trigger = document.createElement("button");
    frame.append(trigger);
    const loose = document.createElement("button");
    const content = document.createElement("div");
    Object.defineProperty(content, "offsetWidth", { configurable: true, get: () => popoverWidth });
    document.body.append(frame, loose, content);
    return { trigger, loose, content };
}

/** The bounds' four sides, read as Floating UI reads them. */
const sides = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x, y: b.y, width: b.width, height: b.height });

test("inside a frame it fits in, across the page it keeps to the frame's sides; down the page to the page's", () => {
    const { trigger, content } = mount();
    expect(sides(frameBounds(() => trigger, () => content))).toEqual({ x: 80, width: 1024, y: 0, height: PAGE.height });
});

test("in a frame narrower than it with its overflow at each side — a phone's — it keeps to the page's", () => {
    const { trigger, content } = mount();
    const bounds = frameBounds(() => trigger, () => content);
    frameBox = { left: 48, width: popoverWidth + 2 * POPOVER_OVERFLOW };
    expect(sides(bounds)).toEqual({ x: 48, width: popoverWidth + 2 * POPOVER_OVERFLOW, y: 0, height: PAGE.height });
    frameBox = { left: 48, width: popoverWidth + 2 * POPOVER_OVERFLOW - 1 };
    expect(sides(bounds)).toEqual({ x: 0, width: PAGE.width, y: 0, height: PAGE.height });
});

test("outside a frame, or before its content stands, it keeps to the page's — the frame's only once the popover is there to fit", () => {
    const { trigger, loose, content } = mount();
    expect(sides(frameBounds(() => loose, () => content))).toEqual({ x: 0, width: PAGE.width, y: 0, height: PAGE.height });
    expect(sides(frameBounds(() => null, () => content))).toEqual({ x: 0, width: PAGE.width, y: 0, height: PAGE.height });
    expect(sides(frameBounds(() => trigger, () => null))).toEqual({ x: 0, width: PAGE.width, y: 0, height: PAGE.height });
});

test("a popover placed before it shows — its content mounted, still closed — is weighed by the width its styles give it, no wider than their most; with none, it keeps to the page's", () => {
    const { trigger, content } = mount();
    const bounds = frameBounds(() => trigger, () => content);
    popoverWidth = 0;
    content.style.width = "380px";
    content.style.maxWidth = "366px";
    frameBox = { left: 33, width: 294 };
    expect([bounds.x, bounds.width], "366px with its overflow at each side is wider than a 294px frame").toEqual([0, PAGE.width]);
    frameBox = { left: 33, width: 366 + 2 * POPOVER_OVERFLOW };
    expect([bounds.x, bounds.width], "and fits one 382px wide").toEqual([33, 366 + 2 * POPOVER_OVERFLOW]);
    content.style.width = "";
    content.style.maxWidth = "";
    expect([bounds.x, bounds.width], "a width no style gives fits nowhere but the page").toEqual([0, PAGE.width]);
});

test("its sides are read live: the frame's place as the page scrolls, and whether the popover still fits as the frame narrows", () => {
    const { trigger, content } = mount();
    const bounds = frameBounds(() => trigger, () => content);
    expect([bounds.x, bounds.width]).toEqual([80, 1024]);
    frameBox = { left: -200, width: 1024 };
    expect([bounds.x, bounds.width]).toEqual([-200, 1024]);
    frameBox = { left: 40, width: 294 };
    expect([bounds.x, bounds.width]).toEqual([0, PAGE.width]);
    popoverWidth = 240;
    expect([bounds.x, bounds.width]).toEqual([40, 294]);
});
