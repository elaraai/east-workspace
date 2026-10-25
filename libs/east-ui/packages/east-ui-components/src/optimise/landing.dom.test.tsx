/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The landing and the highlight (#1409, #1416; `Optimise Spec.md` §8, §9.3,
 * O7): the cascade's step and total at n = 1, 19, 40 and 400, each entry's
 * delay in reading order — by column in 12px buckets, then top to bottom —
 * the totals' delay after the cascade's n steps, the landing settling 1500ms
 * after that, the 8s highlight and each early end, and a highlight lit with
 * no landing. jsdom lays nothing out: each entry says where it stands.
 */

import { useRef } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import {
    OPTIMISE_CASCADE_MS, OPTIMISE_HIGHLIGHT_MS, OPTIMISE_SETTLE_MS, OPTIMISE_TOTALS_DELAY_MS, cascadeDelays, cascadeOrder, cascadeStep, useLanding,
    type Landing,
} from "./landing.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

/** Where an entry stands, as the test lays it out. */
interface At { left: number; top: number }

/** A main of entries that landed, each where the test puts it, and one total; the landing handed out. */
function Main({ entries, onLanding }: { entries: readonly At[]; onLanding: (landing: Landing) => void }) {
    const ref = useRef<HTMLDivElement>(null);
    const landing = useLanding(ref);
    onLanding(landing);
    return (
        <div ref={ref} data-main="" {...landing.attributes}>
            {entries.map((at, i) => <span key={i} data-op="add" data-left={at.left} data-top={at.top} />)}
            <span data-opn="" />
        </div>
    );
}

function layOut() {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const left = Number(this.getAttribute("data-left") ?? 0), top = Number(this.getAttribute("data-top") ?? 0);
        return { x: left, y: top, left, top, right: left + 10, bottom: top + 10, width: 10, height: 10, toJSON() {} };
    });
}

function mount(entries: readonly At[]) {
    vi.useFakeTimers();
    layOut();
    let landing!: Landing;
    const view = render(<Main entries={entries} onLanding={(l) => { landing = l; }} />);
    const main = () => view.container.querySelector<HTMLElement>("[data-main]")!;
    const delays = () => [...main().querySelectorAll<HTMLElement>("[data-op]")].map((el) => el.style.getPropertyValue("--optimise-delay"));
    const total = () => main().querySelector<HTMLElement>("[data-opn]")!.style.getPropertyValue("--optimise-delay");
    const state = () => [main().hasAttribute("data-optimise-landing"), main().hasAttribute("data-optimise-lit")];
    const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
    return { ...view, landing: () => landing, main, delays, total, state, advance };
}

/** A column of `n` entries, one under another. */
const column = (n: number): At[] => Array.from({ length: n }, (_, i) => ({ left: 0, top: i * 20 }));

describe("the cascade (R14)", () => {
    test.each([[1, 40], [19, 40], [40, 19], [400, 1.9]])("n = %i: the step is min(40ms, 760ms ÷ n) = %sms, and the whole cascade fits in 760ms", (n, step) => {
        expect(cascadeStep(n)).toBeCloseTo(step, 5);
        const delays = cascadeDelays(column(n));
        expect(delays[0]).toBe(0);
        expect(Math.max(...delays)).toBeLessThanOrEqual(OPTIMISE_CASCADE_MS);
        expect(Math.max(...delays)).toBeCloseTo((n - 1) * step, 5);
    });

    test("reading order: by column in 12px buckets, then top to bottom, ties in the order given", () => {
        const boxes = [{ left: 0, top: 100 }, { left: 0, top: 0 }, { left: 5, top: 50 }, { left: 30, top: 0 }, { left: 5, top: 50 }];
        expect(cascadeOrder(boxes)).toEqual([1, 2, 4, 0, 3]);
        expect(cascadeDelays(boxes)).toEqual([3 * 40, 0, 40, 4 * 40, 2 * 40]);
    });
});

describe("the landing and the highlight (R13, R16)", () => {
    test("land: each entry takes its delay in reading order, the total flashes 120ms after the cascade's three steps, the landing settles 1500ms after that, the highlight ends after 8s", () => {
        const { landing, delays, total, state, advance } = mount([{ left: 0, top: 100 }, { left: 0, top: 0 }, { left: 30, top: 0 }]);
        expect(state()).toEqual([false, false]);
        act(() => { landing().land(1); });
        expect(delays()).toEqual(["40ms", "0ms", "80ms"]);
        const end = 3 * 40 + OPTIMISE_TOTALS_DELAY_MS;
        expect(total()).toBe(`${end}ms`);
        expect(state()).toEqual([true, true]);
        advance(end + OPTIMISE_SETTLE_MS - 1);
        expect(state()).toEqual([true, true]);
        advance(1);
        expect(state()).toEqual([false, true]);
        advance(OPTIMISE_HIGHLIGHT_MS - end - OPTIMISE_SETTLE_MS - 1);
        expect(state()).toEqual([false, true]);
        advance(1);
        expect(state()).toEqual([false, false]);
    });

    test("a large result lands within 760ms: 400 entries, the last delayed 758ms, the totals at 880ms", () => {
        const { landing, delays, total, advance, state } = mount(column(400));
        act(() => { landing().land(2); });
        const ms = delays().map((d) => Number.parseInt(d, 10));
        expect([ms[0], ms[399], Math.max(...ms) <= OPTIMISE_CASCADE_MS, total()]).toEqual([0, 758, true, `${760 + OPTIMISE_TOTALS_DELAY_MS}ms`]);
        advance(760 + OPTIMISE_TOTALS_DELAY_MS + OPTIMISE_SETTLE_MS);
        expect(state()).toEqual([false, true]);
    });

    test("end ends the highlight at once — dismiss, Undo, a new run, Apply or Cancel — and no timer fires after it", () => {
        const { landing, state, advance } = mount(column(3));
        act(() => { landing().land(1); });
        advance(500);
        act(() => { landing().end(); });
        expect(state()).toEqual([false, false]);
        advance(OPTIMISE_HIGHLIGHT_MS);
        expect(state()).toEqual([false, false]);
    });

    test("light: the highlight with no landing, for 8s — a result with nothing to change", () => {
        const { landing, state, delays, advance } = mount(column(2));
        act(() => { landing().light(); });
        expect([state(), delays()]).toEqual([[false, true], ["", ""]]);
        advance(OPTIMISE_HIGHLIGHT_MS - 1);
        expect(state()).toEqual([false, true]);
        advance(1);
        expect(state()).toEqual([false, false]);
    });

    test("a new landing during a highlight restarts it", () => {
        const { landing, state, advance } = mount(column(1));
        act(() => { landing().land(1); });
        advance(6000);
        act(() => { landing().land(2); });
        advance(OPTIMISE_HIGHLIGHT_MS - 1);
        expect(state()).toEqual([false, true]);
        advance(1);
        expect(state()).toEqual([false, false]);
    });
});
