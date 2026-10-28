/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The eye button (#1409; `Optimise Spec.md` §8, D1, D4, R6, R19): named
 * `Optimise {period}` at rest and `Stop optimising` while a run is out, a
 * click starting or stopping the run; disabled while the period cannot take
 * a run yet, its tooltip `Read-only`; one blink, 560ms, each time a result
 * lands with nothing to change; the mark 16px at `md`, 14 at `sm` and at
 * `toolbar`, the builders' rows' 32 × 28; and its place in the toolbar —
 * immediately before the history item, kept in every fold of the ladder, and
 * never leaving the toolbar (ruled 27 Oct 2026, "Into the View menu"): alone
 * it takes no step at all, and where its builder's View takes its entry it
 * goes into the View only below the whole ladder, one step with the View's,
 * the history and Save kept in the row. jsdom lays nothing out, so the
 * toolbar's widths are stubbed from each item's form, and the eye sits in a
 * row of peers that fold before it at 1440, 1024, 768, 390 and 360.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { IntegerType, StringType, StructType, none, variant } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { system } from "../theme/index.js";
import { formatters } from "../format/index.js";
import { Toolbar, type ToolbarItem } from "../toolbar/index.js";
import { historyToolbarItem } from "../editing/history-item.js";
import { editingMessages, type EditingWords } from "../editing/messages.js";
import { EditSession } from "../editing/session.js";
import { ELARA_EYE_DOTS } from "./eye.js";
import { OPTIMISE_BLINK_MS, OptimiseButton, type OptimiseButtonProps } from "./button.js";
import { OptimiseEntry } from "./entry.js";
import { OPTIMISE_RANK, optimiseToolbarItem } from "./toolbar-item.js";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const noop = () => {};

function mount(props: Partial<OptimiseButtonProps> = {}) {
    const onRun = vi.fn();
    const onStop = vi.fn();
    const view = render(
        <ChakraProvider value={system}>
            <OptimiseButton period="W11" running={false} onRun={onRun} onStop={onStop} {...props} />
        </ChakraProvider>,
    );
    const button = () => view.container.querySelector<HTMLButtonElement>("[data-optimise-button]")!;
    return { ...view, onRun, onStop, button };
}

describe("the eye button", () => {
    test("the mark is the lockup's: a ring of 100 dots and an iris of 52, two paths, and the iris's echo", () => {
        const { button } = mount();
        expect(ELARA_EYE_DOTS).toEqual({ ring: 100, iris: 52 });
        const eye = button().querySelector("[data-eye]")!;
        expect([eye.getAttribute("aria-hidden"), eye.getAttribute("data-eye-size"), eye.getAttribute("viewBox")]).toEqual(["true", "16", "0 0 82.9 82.9"]);
        expect(["[data-eye-ring]", "[data-eye-iris]", "[data-eye-echo]"].map((s) => eye.querySelector(s)?.tagName)).toEqual(["path", "path", "circle"]);
        // The ring's path draws 100 circles, the iris's 52: one `M` each.
        expect(eye.querySelector("[data-eye-ring]")!.getAttribute("d")!.split("M").length - 1).toBe(100);
        expect(eye.querySelector("[data-eye-iris]")!.getAttribute("d")!.split("M").length - 1).toBe(52);
    });

    test("at rest it is named for the period, and a click starts a run", () => {
        const { button, onRun, onStop } = mount();
        expect([button().getAttribute("aria-label"), button().hasAttribute("data-running"), button().disabled]).toEqual(["Optimise W11", false, false]);
        fireEvent.click(button());
        expect([onRun.mock.calls.length, onStop.mock.calls.length]).toEqual([1, 0]);
    });

    test("while a run is out it is Stop, and a click stops it; its stop glyph is decorative", () => {
        const { button, onRun, onStop } = mount({ running: true });
        expect([button().getAttribute("aria-label"), button().hasAttribute("data-running")]).toEqual(["Stop optimising", true]);
        expect(button().querySelector("[data-eye-stop]")!.getAttribute("aria-hidden")).toBe("true");
        fireEvent.click(button());
        expect([onRun.mock.calls.length, onStop.mock.calls.length]).toEqual([0, 1]);
    });

    test("disabled while the period cannot take a run yet (D1): no run on a click, and the tooltip says Read-only", async () => {
        vi.useFakeTimers();
        const { button, onRun } = mount({ disabled: true });
        expect([button().disabled, button().getAttribute("aria-label")]).toEqual([true, "Optimise W11"]);
        fireEvent.click(button());
        expect(onRun).not.toHaveBeenCalled();
        // The tooltip hangs from the span around the button, which a disabled button leaves the pointer to.
        const trigger = button().parentElement!;
        fireEvent.pointerMove(trigger, { pointerType: "mouse" });
        fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
        await act(async () => { await vi.advanceTimersByTimeAsync(400); });
        expect(screen.getByRole("tooltip").textContent).toBe("Read-only");
    });

    test("the tooltip names what a click does: Optimise at rest, Stop while running", async () => {
        vi.useFakeTimers();
        const { button, rerender } = mount();
        const trigger = button().parentElement!;
        fireEvent.pointerMove(trigger, { pointerType: "mouse" });
        fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
        await act(async () => { await vi.advanceTimersByTimeAsync(400); });
        expect(screen.getByRole("tooltip").textContent).toBe("Optimise W11");
        rerender(<ChakraProvider value={system}><OptimiseButton period="W11" running onRun={noop} onStop={noop} /></ChakraProvider>);
        expect(screen.getByRole("tooltip").textContent).toBe("Stop optimising");
    });

    test("a result with nothing to change blinks the eye once, for 560ms, each time", () => {
        vi.useFakeTimers();
        const { button, rerender } = mount({ blink: 0 });
        const at = (blink: number) => rerender(<ChakraProvider value={system}><OptimiseButton period="W11" running={false} blink={blink} onRun={noop} onStop={noop} /></ChakraProvider>);
        expect(button().hasAttribute("data-blink")).toBe(false);
        act(() => { at(1); });
        expect(button().hasAttribute("data-blink")).toBe(true);
        act(() => { vi.advanceTimersByTime(OPTIMISE_BLINK_MS - 1); });
        expect(button().hasAttribute("data-blink")).toBe(true);
        act(() => { vi.advanceTimersByTime(1); });
        expect(button().hasAttribute("data-blink")).toBe(false);
        act(() => { at(2); });
        expect(button().hasAttribute("data-blink")).toBe(true);
    });

    test("its sizes: a 16px mark at md, 14 at sm and at toolbar, the builders' rows'", () => {
        const sizes = (["md", "sm", "toolbar"] as const).map((size) => {
            const { button } = mount({ size });
            const mark = button().querySelector("[data-eye]")!.getAttribute("data-eye-size");
            const at = [button().getAttribute("data-size"), mark];
            cleanup();
            return at;
        });
        expect(sizes).toEqual([["md", "16"], ["sm", "14"], ["toolbar", "14"]]);
    });
});

// ─── Its place in the toolbar (D4) ──────────────────────────────────────────

// jsdom lacks ResizeObserver; the toolbar observes its row and items through it.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }

/** The stubbed layout: the toolbar row's width. */
const row = { px: 0 };

/**
 * Each item's width in the form it shows: the eye 32; a builder's View 30 in either form, its trigger alone in the row;
 * the history bar 200 whole, 120 as buttons; a peer 300, 80 folded.
 */
function widthOf(el: Element): number {
    if (el.hasAttribute("data-toolbar")) return row.px;
    switch (el.getAttribute("data-toolbar-item")) {
        case "optimise": return 32;
        case "view": return 30;
        case "history": return el.querySelector('[data-history-form="buttons"]') !== null ? 120 : 200;
        case "rail": return el.querySelector('[data-peer="short"]') !== null ? 80 : 300;
        case "segments": return el.querySelector('[data-peer="short"]') !== null ? 80 : 300;
        default: return 0;
    }
}

const originalRect = Element.prototype.getBoundingClientRect;
const originalRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
    Element.prototype.getBoundingClientRect = function (this: Element) {
        const width = widthOf(this);
        return { x: 0, y: 0, left: 0, top: 0, width, height: 30, right: width, bottom: 30, toJSON() { return {}; } } as DOMRect;
    };
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
        const style = computed(el, pseudo);
        if (!el.hasAttribute("data-toolbar")) return style;
        return new Proxy(style, { get: (target, prop) => (prop === "columnGap" ? "10px" : Reflect.get(target, prop)) });
    });
});
afterAll(() => {
    Element.prototype.getBoundingClientRect = originalRect;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalRO;
    vi.restoreAllMocks();
});

const Run = StructType({ id: StringType, end: IntegerType });
const WORDS: EditingWords = { ...formatters("en-US"), m: editingMessages };

function editSession(): EditSession<string> {
    const session = new EditSession<string>({
        sourceId: "runs", entryType: Run, draftType: Editing.Types.Draft(Run), idField: "id", auto: false,
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined,
    });
    session.observeBase(variant("snapshot", [{ id: "a", end: 1n }]));
    return session;
}

/** A builder's own items — the rail and the segments — which fold before the eye and the history item. */
const peer = (key: string, rank: number): ToolbarItem => ({ key, forms: [<span data-peer="long" />, <span data-peer="short" />], rank });

/** The bundle of the eye's step into the View and the View's step that lists its entry, as a builder names it. */
const INTO_VIEW = "test.optimise";

/**
 * A row of peers, the eye and the history item — and, `view`, a builder's View that takes the eye's entry, as the
 * Roster's and the Allocation's do: the View's second form lists the entry, and the eye's item takes a second form,
 * none, both steps at the eye's rank in one bundle.
 */
function mountToolbar(px: number, view = false) {
    row.px = px;
    const history = historyToolbarItem({ session: editSession(), words: WORDS, editing: false, onAction: noop, onIssue: noop });
    const props: OptimiseButtonProps = { period: "W11", running: false, onRun: noop, onStop: noop };
    const eye = optimiseToolbarItem(props);
    const items = view
        ? [peer("rail", 3), peer("segments", 5),
            { key: "view", forms: [<span data-view="" />, <span data-view=""><OptimiseEntry {...props} /></span>], rank: OPTIMISE_RANK, bundle: INTO_VIEW },
            { ...eye, forms: [...eye.forms, null], rank: OPTIMISE_RANK, bundle: INTO_VIEW }, history]
        : [peer("rail", 3), peer("segments", 5), eye, history];
    return render(<ChakraProvider value={system}><Toolbar items={items} /></ChakraProvider>);
}

describe("the eye in the toolbar (D4)", () => {
    test.each([1440, 1024, 768, 390, 360])("at %ipx the eye keeps its place immediately before the history item, whatever folds", (px) => {
        const { container } = mountToolbar(px);
        const keys = [...container.querySelectorAll("[data-toolbar-item]")].map((el) => el.getAttribute("data-toolbar-item"));
        expect(keys).toEqual(["rail", "segments", "optimise", "history"]);
        const eye = container.querySelector('[data-toolbar-item="optimise"]')!;
        // The eye leads the end cluster, and nothing folds it away: it has one form.
        expect([eye.hasAttribute("data-toolbar-end"), eye.getAttribute("data-toolbar-form"), eye.querySelector("[data-optimise-button]") !== null]).toEqual([true, "0", true]);
        expect(eye.nextElementSibling!.getAttribute("data-toolbar-item")).toBe("history");
    });

    const state = (container: HTMLElement) => container.querySelector("[data-toolbar]")!.getAttribute("data-toolbar-state");
    const keysOf = (container: HTMLElement) => [...container.querySelectorAll("[data-toolbar-item]")].map((el) => el.getAttribute("data-toolbar-item"));

    test("the rail and the segments fold first, then the history bar to its buttons; the eye stays whole", () => {
        // Whole: 300 + 300 + 32 + 200 and three gaps of 10.
        const whole = mountToolbar(862);
        expect(state(whole.container)).toBe("rail=0/2;segments=0/2;optimise=0/1;history=0/2");
        cleanup();
        // A pixel less: the rail folds first (rank 3: 80 + 300 + 32 + 200 + 30 = 642), then the segments (5: 422), then the
        // history bar (100: 342).
        expect(state(mountToolbar(861).container)).toBe("rail=1/2;segments=0/2;optimise=0/1;history=0/2");
        cleanup();
        expect(state(mountToolbar(641).container)).toBe("rail=1/2;segments=1/2;optimise=0/1;history=0/2");
        cleanup();
        expect(state(mountToolbar(421).container)).toBe("rail=1/2;segments=1/2;optimise=0/1;history=1/2");
    });

    test("alone the eye takes no step at all: below the whole ladder it stays in the row beside the history, never out of the toolbar (ruled 27 Oct 2026, \"Into the View menu\")", () => {
        // The ladder's end: 80 + 80 + 32 + 120 + 30 = 342. A pixel less, no rung lets the row fit, and the eye stays.
        const { container } = mountToolbar(341);
        expect(state(container)).toBe("rail=1/2;segments=1/2;optimise=0/1;history=1/2");
        expect(keysOf(container)).toEqual(["rail", "segments", "optimise", "history"]);
        expect(container.querySelector("[data-toolbar]")!.hasAttribute("data-toolbar-floor")).toBe(false);
    });

    test("where its builder's View takes its entry, the eye goes into the View only below the whole ladder — one step with the View's, a rung of the floor — the entry named for the period there, the history and Save in the row (ruled 27 Oct 2026, \"Into the View menu\")", () => {
        // The ladder's end: 80 + 80 + 30 + 32 + 120 + 40 = 382 — the eye in the row beside the history's buttons, the View its trigger alone.
        const ladder = mountToolbar(382, true);
        expect(state(ladder.container)).toBe("rail=1/2;segments=1/2;view=0/2;optimise=0/2;history=1/2");
        expect(ladder.container.querySelector("[data-optimise-entry]")).toBeNull();
        expect(ladder.container.querySelector("[data-toolbar]")!.getAttribute("data-toolbar-floor")).toBe("view>1 optimise>1");
        cleanup();
        // A pixel less: the eye goes into the View in the View's own step (80 + 80 + 30 + 120 + 30 = 340), the history's
        // buttons in the row, Save among them.
        const floor = mountToolbar(381, true);
        expect(state(floor.container)).toBe("rail=1/2;segments=1/2;view=1/2;optimise=1/2;history=1/2");
        expect(keysOf(floor.container)).toEqual(["rail", "segments", "view", "history"]);
        const entry = floor.container.querySelector<HTMLButtonElement>('[data-toolbar-item="view"] [data-optimise-entry]')!;
        expect([entry.getAttribute("aria-label"), entry.disabled]).toEqual(["Optimise W11", false]);
        expect(floor.container.querySelector("[data-optimise-button]")).toBeNull();
        expect(floor.container.querySelector('[data-toolbar-item="history"] button[aria-label="Save"]')).not.toBeNull();
    });
});
