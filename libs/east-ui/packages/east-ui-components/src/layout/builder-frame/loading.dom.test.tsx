/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../../theme/index.js";
import { BuilderFrame } from "./index.js";

const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
afterEach(() => {
    cleanup();
    if (originalFonts === undefined) Reflect.deleteProperty(document, "fonts");
    else Object.defineProperty(document, "fonts", originalFonts);
});
function holdFonts() {
    let release!: () => void;
    let fail!: () => void;
    const ready = new Promise<void>((resolve, reject) => { release = resolve; fail = () => reject(new Error("font unavailable")); });
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready } });
    return { release, fail };
}
const view = (loading: boolean | undefined) => <ChakraProvider value={system}>
    <BuilderFrame storageKey="loading-test" label="Schedule" loading={loading}
        toolbar={[{ key: "action", forms: [<button>Save</button>] }]}
        start={{ label: "Library", body: <button>Choose a person</button> }} footer="Legend">
        <input aria-label="Draft title" defaultValue="Original" />
    </BuilderFrame>
</ChakraProvider>;
const frame = () => document.querySelector('[data-builder-frame]')!;

describe("BuilderFrame loading", () => {
    test("waits for data and initial fonts, covers every region, and preserves mounted drafts across later loading", async () => {
        const fonts = holdFonts();
        const mounted = render(view(true));
        const input = document.querySelector('input')!;
        input.value = "Unsaved draft";
        expect(screen.getByRole("status", { name: "Loading Schedule" })).toBeTruthy();
        expect(document.querySelectorAll('[data-builder-loading] .elara-skeleton').length).toBeGreaterThan(0);
        expect([...frame().querySelectorAll(':scope > [data-frame-slot]')].every(el => el.hasAttribute("inert"))).toBe(true);
        mounted.rerender(view(false));
        expect(frame().getAttribute("aria-busy")).toBe("true");
        await act(async () => { fonts.release(); });
        expect(frame().getAttribute("aria-busy")).toBe("false");
        expect(screen.queryByRole("status")).toBeNull();
        expect(screen.getByRole("textbox", { name: "Draft title" })).toBe(input);
        expect(input.value).toBe("Unsaved draft");
        // Later loads use their actual data state, without waiting for fonts again.
        holdFonts();
        mounted.rerender(view(true));
        expect(frame().getAttribute("aria-busy")).toBe("true");
        mounted.rerender(view(false));
        expect(frame().getAttribute("aria-busy")).toBe("false");
        expect(document.querySelector('input')).toBe(input);
        expect(input.value).toBe("Unsaved draft");
    });
    test("a failed font releases the skeleton; a frame without loading retains its immediate rendering", async () => {
        const fonts = holdFonts();
        const mounted = render(view(undefined));
        expect(frame().hasAttribute("aria-busy")).toBe(false);
        expect(screen.getByRole("textbox", { name: "Draft title" })).toBeTruthy();
        mounted.rerender(view(false));
        expect(frame().getAttribute("aria-busy")).toBe("true");
        await act(async () => { fonts.fail(); });
        expect(frame().getAttribute("aria-busy")).toBe("false");
    });
});

/** A frame over the skeleton's options, and `busy`. */
const optioned = (props: { loading?: boolean; busy?: boolean; pitch?: number; liveFooter?: boolean }) => <ChakraProvider value={system}>
    <BuilderFrame storageKey="loading-test" label="Schedule" loading={props.loading} busy={props.busy} loadingPitch={props.pitch} liveFooter={props.liveFooter}
        toolbar={[{ key: "action", forms: [<button>Save</button>] }]} footer={<span data-legend="">Legend</span>}>
        <input aria-label="Draft title" defaultValue="Original" />
    </BuilderFrame>
</ChakraProvider>;
const slot = (name: string) => frame().querySelector<HTMLElement>(`:scope > [data-frame-slot="${name}"], [data-frame-slot="body"] > [data-frame-slot="${name}"]`)!;
const loadingSurface = () => document.querySelector<HTMLElement>("[data-builder-loading]");

describe("BuilderFrame loading at the component's pitch, and busy after cold load (#1398)", () => {
    test("the cold-load skeleton's rows take the component's own pitch; 40px unless given", () => {
        holdFonts();
        const mounted = render(optioned({ loading: true, pitch: 36 }));
        expect(loadingSurface()!.style.getPropertyValue("--builder-loading-pitch")).toBe("36px");
        expect(loadingSurface()!.querySelectorAll("[data-builder-loading-row]").length).toBeGreaterThan(12);
        mounted.rerender(optioned({ loading: true }));
        expect(loadingSurface()!.style.getPropertyValue("--builder-loading-pitch")).toBe("40px");
    });

    test("a live footer stays out from under the skeleton: real, reachable, and the skeleton ends at its top", () => {
        holdFonts();
        render(optioned({ loading: true, liveFooter: true }));
        const footer = slot("footer");
        expect([footer.hasAttribute("inert"), footer.getAttribute("aria-hidden"), footer.hasAttribute("data-frame-live")]).toEqual([false, null, true]);
        // Every other region is covered, as before.
        for (const name of ["toolbar", "body"]) expect([name, slot(name).hasAttribute("inert"), slot(name).getAttribute("aria-hidden")]).toEqual([name, true, "true"]);
        // jsdom lays the footer out 0px tall: the surface ends there, and draws no footer of its own.
        expect(loadingSurface()!.style.bottom).toBe("0px");
        expect(loadingSurface()!.children).toHaveLength(2);
    });

    test("without liveFooter the footer is covered with the rest, as it always was", () => {
        holdFonts();
        render(optioned({ loading: true }));
        expect([slot("footer").hasAttribute("inert"), slot("footer").hasAttribute("data-frame-live"), loadingSurface()!.style.bottom]).toEqual([true, false, ""]);
    });

    test("busy covers nothing: main, the region being read, is aria-busy, and the toolbar and main stay live", () => {
        const mounted = render(optioned({ busy: true }));
        expect(loadingSurface()).toBeNull();
        expect([slot("main").getAttribute("aria-busy"), frame().hasAttribute("aria-busy"), slot("toolbar").hasAttribute("inert"), slot("body").hasAttribute("inert")])
            .toEqual(["true", false, false, false]);
        expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
        mounted.rerender(optioned({ busy: false }));
        expect(slot("main").getAttribute("aria-busy")).toBe("false");
        // A frame that says nothing of busy says nothing of it.
        mounted.rerender(optioned({}));
        expect(slot("main").hasAttribute("aria-busy")).toBe(false);
    });

    test("busy under the cold-load skeleton is the frame's: main is not busy while the whole frame is", () => {
        holdFonts();
        render(optioned({ loading: true, busy: true }));
        expect([frame().getAttribute("aria-busy"), slot("main").getAttribute("aria-busy")]).toEqual(["true", "false"]);
    });
});
