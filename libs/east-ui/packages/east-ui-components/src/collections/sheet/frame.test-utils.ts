/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a Sheet's DOM tests say the browser would measure, for a jsdom that
 * lays nothing out (#856). A sheet that mounts a screenful measures its rows,
 * so a test that renders one — bounded, or unbounded at scale — needs rows as
 * tall as they draw; a test of an unbounded sheet in a page needs the page to
 * scroll.
 *
 * Test use only: the package build leaves `*.test-utils.ts` out.
 *
 * @packageDocumentation
 */

/**
 * A mounted virtual row measures the height its row declares inline (its
 * `height`, else its `min-height`), as if nothing wrapped — jsdom's 0 would
 * collapse every measured row onto the first.
 *
 * @returns The restore
 */
export function measureRowsAsDrawn(): () => void {
    const saved = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
        if (this instanceof HTMLElement && this.dataset["slot"] === "virtualRow") {
            const row = this.querySelector<HTMLElement>('[style*="height"]');
            const px = row === null ? 0 : parseFloat(row.style.height || row.style.minHeight) || 0;
            return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: px, width: 0, height: px, toJSON: () => ({}) } as DOMRect;
        }
        return saved.call(this);
    };
    return () => { Element.prototype.getBoundingClientRect = saved; };
}

/**
 * The page an unbounded sheet scrolls in: the sheet sits at the top of a tall
 * document, `window.scrollTo` moves `scrollY` and fires `scroll`, and the
 * rows' top moves with it (the Plan's `plan-paged-seek` stand-in).
 *
 * @returns The restore
 */
export function emulateWindowScroll(): () => void {
    let y = 0;
    const html = document.documentElement;
    const saved = {
        scrollY: Object.getOwnPropertyDescriptor(window, "scrollY"),
        scrollTo: Object.getOwnPropertyDescriptor(window, "scrollTo"),
        rect: Element.prototype.getBoundingClientRect,
    };
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => y });
    Object.defineProperty(window, "scrollTo", {
        configurable: true,
        writable: true,
        value: (arg: ScrollToOptions | number) => {
            y = Math.max(0, typeof arg === "number" ? arg : (arg.top ?? y));
            window.dispatchEvent(new Event("scroll"));
        },
    });
    // A document tall enough to scroll through the sheet (jsdom reports 0).
    Object.defineProperty(html, "scrollHeight", { configurable: true, get: () => 100_000_000 });
    Element.prototype.getBoundingClientRect = function (this: Element) {
        if (this.hasAttribute("data-virtual-extent")) {
            return { x: 0, y: -y, top: -y, left: 0, right: 1024, bottom: -y, width: 1024, height: 0, toJSON: () => ({}) } as DOMRect;
        }
        return saved.rect.call(this);
    };
    return () => {
        if (saved.scrollY !== undefined) Object.defineProperty(window, "scrollY", saved.scrollY);
        if (saved.scrollTo !== undefined) Object.defineProperty(window, "scrollTo", saved.scrollTo);
        delete (html as { scrollHeight?: number }).scrollHeight;
        Element.prototype.getBoundingClientRect = saved.rect;
    };
}

/**
 * Where a body item starts among the rows: its virtual row's offset when the
 * sheet mounts a screenful, else the heights the sheet gave each item before
 * it in flow.
 *
 * @param item - A body item's element: a row, a band
 * @returns Its top, in the rows' own coordinates
 * @throws {Error} When the element is not among the rows
 */
export function offsetOf(item: Element): number {
    const wrapper = item.closest<HTMLElement>('[data-slot="virtualRow"]');
    if (wrapper !== null) return Number(/translateY\((-?[\d.]+)px\)/.exec(wrapper.style.transform)![1]);
    let y = 0;
    for (const el of item.parentElement!.children) {
        if (el === item) return y;
        const style = (el as HTMLElement).style;
        y += parseFloat(style.height || style.minHeight || "0");
    }
    throw new Error("Not among the rows");
}
