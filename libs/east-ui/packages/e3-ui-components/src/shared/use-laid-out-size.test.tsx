/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 */

/**
 * An element's size as laid out (#1735): read before the browser paints, as
 * it mounts; read again in the render a resize is delivered in, every element
 * the resize reaches in that one render; and a reading that moves nothing
 * commits nothing (#815). jsdom lays nothing out: each element measures as the
 * stand-in layout below says, and the stand-in observer delivers what the test
 * resizes.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Profiler, useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { useLaidOutSize } from "./use-laid-out-size.js";

/** Each element's size, as the stand-in layout gives it, by its `data-name`. */
const sizes = new Map<string, { width: number; height: number }>();
/** The stand-in observers made, each with what it observes. */
const made: Array<{ callback: (entries: { target: Element }[]) => void; targets: Element[] }> = [];
const saved = { rect: Element.prototype.getBoundingClientRect, observer: (globalThis as { ResizeObserver?: unknown }).ResizeObserver };

beforeEach(() => {
    sizes.clear();
    made.length = 0;
    Element.prototype.getBoundingClientRect = function (this: Element) {
        const { width, height } = sizes.get(this.getAttribute("data-name") ?? "") ?? { width: 0, height: 0 };
        return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect;
    };
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
        private readonly made: { callback: (entries: { target: Element }[]) => void; targets: Element[] };
        constructor(callback: (entries: { target: Element }[]) => void) { this.made = { callback, targets: [] }; made.push(this.made); }
        observe(target: Element) { this.made.targets.push(target); }
        unobserve(target: Element) { this.made.targets.splice(this.made.targets.indexOf(target), 1); }
        disconnect() { this.made.targets.length = 0; }
    };
});
afterEach(() => {
    cleanup();
    Element.prototype.getBoundingClientRect = saved.rect;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = saved.observer;
});

/** An element that says its size as laid out. */
function Measured({ name }: { name: string }) {
    const ref = useRef<HTMLDivElement | null>(null);
    const size = useLaidOutSize(ref, true);
    return <div ref={ref} data-name={name} data-size={size === undefined ? "none" : `${size.width}x${size.height}`} />;
}

/** What each element says, by its name. */
const said = (container: HTMLElement) =>
    Object.fromEntries([...container.querySelectorAll("[data-name]")].map((el) => [el.getAttribute("data-name"), el.getAttribute("data-size")]));

/** Delivers a resize of the named elements, as a browser does before it paints: one delivery, an entry each. */
const resize = (container: HTMLElement, to: Record<string, { width: number; height: number }>) => act(() => {
    for (const [name, size] of Object.entries(to)) sizes.set(name, size);
    const targets = Object.keys(to).map((name) => container.querySelector(`[data-name="${name}"]`)!);
    for (const observer of made) {
        const reached = observer.targets.filter((target) => targets.includes(target));
        if (reached.length > 0) observer.callback(reached.map((target) => ({ target })));
    }
});

describe("an element's size as laid out (#1735)", () => {
    test("read as it mounts, before the browser paints: in the mount's own commits; nothing laid out says none", () => {
        sizes.set("a", { width: 660.5, height: 24 });
        const commits: string[] = [];
        const { container } = render(
            <Profiler id="m" onRender={(_id, phase) => { commits.push(phase); }}>
                <Measured name="a" />
                <Measured name="b" />
            </Profiler>,
        );
        expect(said(container)).toEqual({ a: "660.5x24", b: "none" });
        // The mount, and its reading set in the layout effect before the browser paints: nothing after it.
        expect(commits).toEqual(["mount", "nested-update"]);
    });

    test("one observer for every element; a resize reaching several sets them all in one render, as it is delivered", () => {
        sizes.set("a", { width: 600, height: 24 });
        sizes.set("b", { width: 600, height: 49 });
        const commits: string[] = [];
        const { container } = render(
            <Profiler id="m" onRender={(_id, phase) => { commits.push(phase); }}>
                <Measured name="a" />
                <Measured name="b" />
            </Profiler>,
        );
        expect(made.filter((o) => o.targets.length > 0)).toHaveLength(1);
        commits.length = 0;
        resize(container, { a: { width: 580, height: 24 }, b: { width: 580, height: 49 } });
        expect(said(container)).toEqual({ a: "580x24", b: "580x49" });
        expect(commits).toHaveLength(1);
    });

    test("a reading that moves nothing commits nothing", () => {
        sizes.set("a", { width: 600, height: 24 });
        const commits: string[] = [];
        const { container } = render(
            <Profiler id="m" onRender={(_id, phase) => { commits.push(phase); }}>
                <Measured name="a" />
            </Profiler>,
        );
        commits.length = 0;
        resize(container, { a: { width: 600, height: 24 } });
        expect(commits).toEqual([]);
        // Nothing laid out before, nothing laid out still: none either.
        const none = render(<Profiler id="n" onRender={(_id, phase) => { commits.push(phase); }}><Measured name="z" /></Profiler>);
        expect(commits).toEqual(["mount"]);
        expect(said(none.container)).toEqual({ z: "none" });
    });

    test("an element unmounted is observed no more", () => {
        sizes.set("a", { width: 600, height: 24 });
        const { unmount } = render(<Measured name="a" />);
        expect(made.flatMap((o) => o.targets)).toHaveLength(1);
        unmount();
        expect(made.flatMap((o) => o.targets)).toHaveLength(0);
    });
});
