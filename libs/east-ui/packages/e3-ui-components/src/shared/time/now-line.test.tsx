/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The now line's parts (#1148): where they sit, what they forward, the dot
 * and the chip, read from Plan's recipe, which merges the theme's shared
 * `now` part; and the clock `useNow` reads when the host pins no now.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { ChakraProvider, useSlotRecipe } from "@chakra-ui/react";
import { DateTimeType, parseFor } from "@elaraai/east";
import { system } from "@elaraai/east-ui-components";
import type { ReactNode } from "react";
import { NowChip, NowLine, useNow } from "./now-line.js";

type Styles = Record<string, Record<string, unknown>>;

const readDateTime = parseFor(DateTimeType);

/** An instant written as East prints a DateTime (UTC), read with East's own parser. */
function at(text: string): Date {
    const read = readDateTime(text);
    if (!read.success) throw new Error(read.error);
    return read.value;
}

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

/** Plan's recipe, resolved: the host a now line's slots come from. */
function PlanStyles({ children }: { children: (styles: Styles) => ReactNode }) {
    const recipe = useSlotRecipe({ key: "plan" });
    return <>{children(recipe() as unknown as Styles)}</>;
}

function mount(children: (styles: Styles) => ReactNode) {
    return render(<ChakraProvider value={system}><PlanStyles>{children}</PlanStyles></ChakraProvider>);
}

describe("NowLine", () => {
    test("Plan's recipe has the shared part's slots", () => {
        let slots: string[] = [];
        mount((styles) => { slots = Object.keys(styles); return null; });
        expect(slots).toEqual(expect.arrayContaining(["nowLine", "nowDot", "nowChip"]));
    });

    test("along x it sits at its fraction across the box, forwarding the host's data attributes", () => {
        const { container } = mount((styles) => <NowLine styles={styles} at={0.25} data-plan-now data-kept="yes" />);
        const line = container.querySelector<HTMLElement>("[data-plan-now]")!;
        expect(line.getAttribute("data-along")).toBe("x");
        expect(line.getAttribute("data-kept")).toBe("yes");
        expect(line.style.left).toBe("25%");
        expect(line.style.top).toBe("");
        expect(line.childElementCount).toBe(0);
    });

    test("along y it sits at its fraction down the box, with a dot at its start when asked", () => {
        const { container } = mount((styles) => <NowLine styles={styles} at={0.4} along="y" dot data-line="" />);
        const line = container.querySelector<HTMLElement>("[data-line]")!;
        expect(line.getAttribute("data-along")).toBe("y");
        expect(line.style.top).toBe("40%");
        expect(line.style.left).toBe("");
        expect(line.childElementCount).toBe(1);
    });
});

describe("NowChip", () => {
    test("along x it says what now is called, anchored across the instant as the host asks", () => {
        const { container } = mount((styles) => (
            <>
                <NowChip styles={styles} at={0.95} anchor="-100%" data-anchored="">NOW</NowChip>
                <NowChip styles={styles} at={0.5} data-centred="">NOW</NowChip>
            </>
        ));
        const anchored = container.querySelector<HTMLElement>("[data-anchored]")!;
        expect(anchored.textContent).toBe("NOW");
        expect(anchored.getAttribute("data-along")).toBe("x");
        expect(anchored.style.left).toBe("95%");
        expect(anchored.style.transform).toBe("translate(-100%, -50%)");
        // No anchor: the recipe centres it.
        const centred = container.querySelector<HTMLElement>("[data-centred]")!;
        expect(centred.style.left).toBe("50%");
        expect(centred.style.transform).toBe("");
    });

    test("along y it sits at its fraction down the box", () => {
        const { container } = mount((styles) => <NowChip styles={styles} at={0.75} along="y" data-chip="">10:30</NowChip>);
        const chip = container.querySelector<HTMLElement>("[data-chip]")!;
        expect(chip.getAttribute("data-along")).toBe("y");
        expect(chip.style.top).toBe("75%");
        expect(chip.textContent).toBe("10:30");
    });
});

describe("useNow", () => {
    function Clock({ given }: { given?: Date | undefined }) {
        const now = useNow(given);
        return <span data-now={now.getTime()} />;
    }
    const shown = (container: HTMLElement) => Number(container.querySelector("[data-now]")!.getAttribute("data-now"));

    test("is the host's now when it gives one, and never ticks", () => {
        vi.useFakeTimers();
        vi.setSystemTime(at("2026-10-01T10:29:30"));
        const pinned = at("2026-10-01T06:00:00");
        const { container } = render(<Clock given={pinned} />);
        expect(shown(container)).toBe(pinned.getTime());
        act(() => { vi.advanceTimersByTime(120_000); });
        expect(shown(container)).toBe(pinned.getTime());
    });

    test("reads the clock otherwise, again at each whole minute", () => {
        vi.useFakeTimers();
        vi.setSystemTime(at("2026-10-01T10:29:30"));
        const { container } = render(<Clock />);
        expect(shown(container)).toBe(at("2026-10-01T10:29:30").getTime());
        act(() => { vi.advanceTimersByTime(30_000); });
        expect(shown(container)).toBe(at("2026-10-01T10:30:00").getTime());
        act(() => { vi.advanceTimersByTime(60_000); });
        expect(shown(container)).toBe(at("2026-10-01T10:31:00").getTime());
    });
});
