/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a Sheet's DOM tests say the browser would measure, for a jsdom that
 * lays nothing out (#856). The Sheet renders in its frame and scrolls its own
 * rows in main (#1216), so a test that renders one needs that frame as tall
 * as the browser would lay it, and rows as tall as they draw; a test of a
 * folded gutter (#1215), a touch screen's narrow frame.
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
 * How tall a frame's content is: the extent it draws its rows in, which the
 * frame states as data (`data-virtual-extent`) — the header and the footer
 * take no height where nothing is laid out.
 *
 * @param frame - A bounded rows frame
 * @returns The extent (px)
 */
function extentOf(frame: Element): number {
    return Number(frame.querySelector(":scope > [data-virtual-extent]")?.getAttribute("data-virtual-extent") ?? 0);
}

/**
 * The frame a sheet's rows scroll in, laid out (#1216): every bounded rows
 * frame `height` px tall, its content as tall as its rows — so a scroll stops
 * at their end, as a browser's does — and each mounted row as tall as it
 * draws ({@link measureRowsAsDrawn}). A test of a sheet sets the height its
 * rows need: a few rows and the blank tail fit in 2,000 px.
 *
 * @param height - The frame's height (px)
 * @returns The restore
 */
export function boundFrame(height: number): () => void {
    const framed = (el: Element): boolean => el.getAttribute("data-virtual-rows") === "bounded";
    const saved = {
        offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!,
        clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!,
        scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight")!,
    };
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true, get(this: HTMLElement) { return framed(this) ? height : saved.offsetHeight.get!.call(this); },
    });
    Object.defineProperty(Element.prototype, "clientHeight", {
        configurable: true, get(this: Element) { return framed(this) ? height : saved.clientHeight.get!.call(this); },
    });
    Object.defineProperty(Element.prototype, "scrollHeight", {
        configurable: true, get(this: Element) { return framed(this) ? Math.max(height, extentOf(this)) : saved.scrollHeight.get!.call(this); },
    });
    const restoreRows = measureRowsAsDrawn();
    return () => {
        restoreRows();
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", saved.offsetHeight);
        Object.defineProperty(Element.prototype, "clientHeight", saved.clientHeight);
        Object.defineProperty(Element.prototype, "scrollHeight", saved.scrollHeight);
    };
}

/**
 * The frame scrolls when it is asked to, as a browser's does: `scrollTo`,
 * which jsdom lacks, writes a bounded rows frame's `scrollTop` and sends its
 * scroll event — what a jump to a sought row, or a keyboard move past the
 * rows in view, asks of it. Any other element's `scrollTo` is what it was.
 *
 * @returns The restore
 */
export function frameScrolls(): () => void {
    const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
        configurable: true,
        writable: true,
        value: function scrollTo(this: HTMLElement, options?: ScrollToOptions) {
            if (this.getAttribute("data-virtual-rows") !== "bounded") {
                const before = (own?.value ?? (Element.prototype as { scrollTo?: (options?: ScrollToOptions) => void }).scrollTo) as ((options?: ScrollToOptions) => void) | undefined;
                before?.call(this, options);
                return;
            }
            const top = options?.top;
            if (top === undefined || top === this.scrollTop) return;
            this.scrollTop = top;
            this.dispatchEvent(new Event("scroll"));
        },
    });
    return () => {
        if (own === undefined) delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
        else Object.defineProperty(HTMLElement.prototype, "scrollTo", own);
    };
}

/**
 * A touch screen's sheet (#1215): the primary pointer coarse — `(pointer:
 * coarse)` matches, nothing else does — and the frame the rows scroll in
 * `width` px wide, its box and inside it alike, watched as a browser watches
 * it (a `ResizeObserver` where the page has none). The frame is the rows'
 * scroll element.
 *
 * @param width - The frame's width (px)
 * @returns The restore
 */
export function touchFrame(width: number): () => void {
    const saved = {
        resizeObserver: Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver"),
        matchMedia: Object.getOwnPropertyDescriptor(window, "matchMedia"),
        offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")!,
        clientWidth: Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth")!,
    };
    const isFrame = (el: Element) => el.getAttribute("data-virtual-rows") === "bounded";
    if (saved.resizeObserver === undefined) {
        Object.defineProperty(globalThis, "ResizeObserver", {
            configurable: true, writable: true, value: class { observe() {} unobserve() {} disconnect() {} },
        });
    }
    Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: (query: string) => ({
            matches: query === "(pointer: coarse)", media: query, onchange: null,
            addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; },
        }),
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
        configurable: true, get(this: HTMLElement) { return isFrame(this) ? width : saved.offsetWidth.get!.call(this); },
    });
    Object.defineProperty(Element.prototype, "clientWidth", {
        configurable: true, get(this: Element) { return isFrame(this) ? width : saved.clientWidth.get!.call(this); },
    });
    return () => {
        if (saved.resizeObserver === undefined) delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
        if (saved.matchMedia !== undefined) Object.defineProperty(window, "matchMedia", saved.matchMedia);
        else delete (window as { matchMedia?: unknown }).matchMedia;
        Object.defineProperty(HTMLElement.prototype, "offsetWidth", saved.offsetWidth);
        Object.defineProperty(Element.prototype, "clientWidth", saved.clientWidth);
    };
}

/**
 * Animation frames the test runs itself: from the call on, a frame asked for
 * waits until `run`, so the test decides what happens before the next one — a
 * window landing before TanStack reconciles a scroll, say (#885).
 *
 * @returns `run`, which runs the frames waiting and those they ask for until
 *   none is left, and the restore
 */
export function holdFrames(): { run: () => void; restore: () => void } {
    const waiting = new Map<number, FrameRequestCallback>();
    let next = 0;
    const saved = { request: window.requestAnimationFrame, cancel: window.cancelAnimationFrame };
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
        waiting.set(++next, callback);
        return next;
    };
    window.cancelAnimationFrame = (id: number) => { waiting.delete(id); };
    return {
        run: () => {
            // A reconcile asks for the next frame until it settles; a hundred is a hang.
            for (let frames = 0; waiting.size > 0; frames++) {
                if (frames === 100) throw new Error("Frames kept asking for more");
                const now = [...waiting.values()];
                waiting.clear();
                for (const callback of now) callback(performance.now());
            }
        },
        restore: () => {
            window.requestAnimationFrame = saved.request;
            window.cancelAnimationFrame = saved.cancel;
        },
    };
}

/**
 * Where a body item starts among the rows: its virtual row's offset.
 *
 * @param item - A body item's element: a row, a band
 * @returns Its top, in the rows' own coordinates
 * @throws {Error} When the element is not among the mounted rows
 */
export function offsetOf(item: Element): number {
    const wrapper = item.closest<HTMLElement>('[data-slot="virtualRow"]');
    if (wrapper === null) throw new Error("Not among the mounted rows");
    return Number(/translateY\((-?[\d.]+)px\)/.exec(wrapper.style.transform)![1]);
}
