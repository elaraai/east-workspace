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
