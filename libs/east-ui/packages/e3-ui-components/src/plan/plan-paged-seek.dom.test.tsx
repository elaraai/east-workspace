/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * RANDOM ACCESS through the shipped affordance, over a REAL source.
 *
 * Two gaps met here that no other test covers.
 *
 * The first is composition. Every paged test elsewhere hands the renderer a
 * hand-written `{ id, page, total, seek }` literal of JS closures —
 * `plan-paged.dom.test.tsx` fakes the source, `controller/paging.test.ts` fakes
 * it again for the driver, and `paged-source.spec.ts` exercises the derived
 * source with no renderer in sight. Each half is covered and nothing proves
 * they compose. Here the value under test is built by the e3-ui factory over
 * a source built to the row-source contract IN EAST — its `page`, `total` and
 * `seek` East functions over a keyed fixture, as `Data.bindPaged`'s are
 * platform calls — and COMPILED, so the closures the driver calls are the ones
 * East emits.
 *
 * The second is direction. Every paged renderer test streams forward from
 * window 0; none starts, or lands, anywhere else. But the reason a canvas pages
 * at all is that it can show the middle of a source without walking to it —
 * the controller's `search.jump` → the driver's `jumpToElement` → a residency
 * REBASE (#577), reached through the toolbar key search (#574), which is the
 * only random-access affordance a user actually has. So the test types into
 * that search and asserts the canvas moved: the far window landed, the near one
 * was released, the ~60 windows in between were never requested, and the
 * skipped span is described by a band rather than by rows.
 *
 * The canvas has no height, and 600 rows land in its opening ring, so it
 * virtualizes against the WINDOW (#812): a jump scrolls the page to its row.
 * jsdom cannot scroll, so the jump test stands in for the window's scrolling.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, OptionType, StringType, StructType,
    none, some, variant,
} from "@elaraai/east";
import { Paged } from "@elaraai/east-ui";
import { Plan } from "@elaraai/e3-ui/internal";
import { system, UIStore, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { EastChakraPlan, type PlanRootValue } from "./index.js";
import { PLAN_PAGE_SIZE } from "./use-plan-paging.js";
import { rowSel, testKeyOf } from "./plan.test-utils.js";

/** A unit's row — the `units` series' entry at the unit's key (#822). */
const unitRow = (key: string) => rowSel(key, "data-plan-row", "units");

afterEach(cleanup);

// jsdom lacks ResizeObserver — the combobox positioner needs one.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const W27 = new Date("2026-06-29T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");
const NOW = new Date("2026-08-12T00:00:00Z");

/** Elements, deliberately far more than any residency retains. */
const ELEMENTS = 4_000;                        // 20 windows at PLAN_PAGE_SIZE
/** The element the search seeks to — deep enough that reaching it by walking
 *  would be unmistakable in the recorded offsets. */
const TARGET = 3_000;
const TARGET_KEY = `u${String(TARGET).padStart(4, "0")}`;
/** A span row's height (the default density's geometry). */
const ROW_PX = 32;

const UnitRow = StructType({ start: DateTimeType, end: DateTimeType, tonnes: FloatType });
const Units = DictType(StringType, UnitRow);

/** The fixture, generated at MODULE scope: East bodies never call host helpers
 *  (east 990020). Fixed-width keys, so canonical String order is index order —
 *  which is what makes "element N" and "key uN" the same place. */
const UNITS = new Map(Array.from({ length: ELEMENTS }, (_, i) => [
    `u${String(i).padStart(4, "0")}`,
    { start: W27, end: W39, tonnes: (i % 50) + 0.5 },
] as const));
/** Its keys, in key order. */
const UNIT_KEYS = [...UNITS.keys()];

// The source, built by hand to the row-source contract — paged data is bound
// (`Data.bindPaged`), so no package produces one.

/** A window of a units fixture: its entries from `offset`, at most `limit`, in key order. */
const UNITS_WINDOW = East.function([Units, IntegerType, IntegerType], OptionType(Units), ($, all, offset, limit) => {
    const keys = $.let(all.toArray((_$, _v, k) => k));
    const n = $.let(keys.size());
    const start = $.let(offset.less(n).ifElse(() => offset, () => n));
    const end = $.let(start.add(limit).less(n).ifElse(() => start.add(limit), () => n));
    return some(all.getKeys(keys.slice(start, end).toSet()));
});
const UNITS_PAGE = East.function([IntegerType, IntegerType], OptionType(Units), ($, offset, limit) => {
    const window = $.const(UNITS_WINDOW);
    return window($.const(UNITS, Units), offset, limit);
});
const UNITS_TOTAL = East.function([], OptionType(IntegerType), ($) => {
    const all = $.const(UNITS, Units);
    return some(all.size());
});
/**
 * Where a key query lands among the units' keys. Key order makes every query's
 * matches ONE contiguous run — `[lo, hi)` — so a hit is its first row and a
 * count, and a miss carries the row it would sit at. The keys are Strings:
 * leading struct fields name none of theirs, so `fields` matches only as its
 * prefix, and a range bounds on its first literal.
 */
const UNITS_SEEK = East.function([Paged.Types.SeekQuery], OptionType(Paged.Types.SeekRange), ($, query) => {
    const keys = $.const(UNIT_KEYS, ArrayType(StringType));
    const lo = $.let(0n);
    const hi = $.let(0n);
    $.match(query, {
        key: ($2, literal) => {
            const k = $2.let(literal.parse(StringType));
            $2.assign(lo, keys.filter((_$, x) => x.less(k)).size());
            $2.assign(hi, keys.filter((_$, x) => x.lessEqual(k)).size());
        },
        prefix: ($2, p) => {
            $2.assign(lo, keys.filter((_$, x) => x.less(p)).size());
            $2.assign(hi, lo.add(keys.filter((_$, x) => x.startsWith(p)).size()));
        },
        fields: ($2, f) => {
            $2.if(f.values.size().equal(0n), ($3) => {
                const p = $3.let(f.prefix.unwrap("some", () => ""));
                $3.assign(lo, keys.filter((_$, x) => x.less(p)).size());
                $3.assign(hi, lo.add(keys.filter((_$, x) => x.startsWith(p)).size()));
            });
        },
        range: ($2, r) => {
            $2.if(r.from.size().greater(0n), ($3) => {
                const from = $3.let(r.from.get(0n).parse(StringType));
                $3.assign(lo, keys.filter((_$, x) => x.less(from)).size());
            });
            $2.assign(hi, keys.size());
            $2.if(r.to.size().greater(0n), ($3) => {
                const to = $3.let(r.to.get(0n).parse(StringType));
                $3.assign(hi, keys.filter((_$, x) => x.less(to)).size());
            });
            $2.if(hi.less(lo), ($3) => { $3.assign(hi, lo); });
        },
    });
    return some({ found: hi.greater(lo), row: lo, count: hi.subtract(lo) });
});
const UNITS_SOURCE = { id: "units", page: UNITS_PAGE, total: UNITS_TOTAL, seek: some(UNITS_SEEK) };

/** Build the canvas the way an author does — the source handed to the factory,
 *  then compiled — as the payload the renderer takes. */
function buildPagedPlan(): PlanRootValue {
    const program = East.function([], Plan.Types.Root, ($) => {
        const source = $.const(UNITS_SOURCE, Paged.Types.Source(Units));
        const series = $.const([
            Plan.series.span(UnitRow, {
                key: "units", title: "Units",
                label: (_r, k) => k, id: true,
                runs: (r, k) => [Plan.run({
                    key: "run", start: r.start, end: r.end,
                    label: East.str`RUN · ${k}`,
                    quantity: Plan.quantity(r.tonnes, { unit: "t" }), state: "actual",
                })],
            }),
        ], ArrayType(Plan.Types.Series(UnitRow)));
        const axis = $.const(Plan.axis({
            window: { min: W27, max: W39 }, resolution: "week", now: NOW,
        }));
        return Plan.Payload({ axis, data: source, series });
    });
    return East.compile(program, getRegisteredPlatformImplementations())();
}

/** The compiled canvas's source — every canvas paged here is built over a
 *  source that names no snapshot, which the factory carries on the `paged` arm. */
function pagedOf(root: PlanRootValue) {
    if (root.rows.type !== "paged") throw new Error(`expected a paged canvas, got its ${root.rows.type} arm`);
    return root.rows.value;
}

/** Wrap the compiled source so every window request is recorded, delegating to
 *  the real closure — the behaviour stays East's, only the calls are observed. */
function withRecordedWindows(root: PlanRootValue): { root: PlanRootValue; asked: number[] } {
    const asked: number[] = [];
    const paged = pagedOf(root);
    const spied = {
        ...paged,
        page: (offset: bigint, limit: bigint) => {
            asked.push(Number(offset) / PLAN_PAGE_SIZE);
            return paged.page(offset, limit);
        },
    };
    return { root: { ...root, rows: variant("paged", spied) }, asked };
}

/**
 * What the unbounded canvas reads from the page it scrolls in (#812), for a
 * jsdom that lays nothing out: the canvas sits at the top of a tall document,
 * `window.scrollTo` moves `scrollY` and fires `scroll`, and the rows' top
 * moves with it. Returns the restore.
 */
function emulateWindowScroll(): () => void {
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
    // A document tall enough to scroll through the canvas (jsdom reports 0).
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

function renderPlan(value: PlanRootValue, key: string) {
    initializeStore(new UIStore());
    return render(
        <ChakraProvider value={system}>
            <EastChakraPlan value={value} storageKey={key} />
        </ChakraProvider>,
    );
}

describe("Plan paged random access (#567/#574/#577)", () => {
    test("a source built in East drives the canvas — the seam the fakes never cross", async () => {
        const { root, asked } = withRecordedWindows(buildPagedPlan());
        const { container } = renderPlan(root, "plan-seam");

        // The compiled `page` answered, and its rows reached the canvas.
        await waitFor(() => {
            expect(container.querySelector(unitRow("u0000"))).toBeTruthy();
        });
        // The compiled `total` taught the transport the exact element count.
        await waitFor(() => {
            const line = container.querySelector('[data-slot="footerTransport"]');
            expect(line?.textContent).toMatch(/of 4,000$/);
        });
        // It walked a bounded ring, not the whole source.
        expect(Math.max(...asked)).toBeLessThan(5);
        // The compiled source carries the handle's `seek` — an East function
        // over the fixture's keys — which is what the jump test then drives.
        expect(pagedOf(root).seek.type).toBe("some");
    }, 30_000);

    test("seeking element 3,000 REBASES — the windows in between are never fetched", async () => {
        const restore = emulateWindowScroll();
        try {
            const { root, asked } = withRecordedWindows(buildPagedPlan());
            const { container } = renderPlan(root, "plan-jump");
            await waitFor(() => {
                expect(container.querySelector(unitRow("u0000"))).toBeTruthy();
            });
            const beforeJump = new Set(asked);

            // Drive the SHIPPED affordance: type the key, wait out the 250 ms
            // debounce for the seek to land, then commit with Enter.
            // The search mounts because the SOURCE declares `seek` — this canvas
            // binds no slice at all (#587).
            const input = container.querySelector('[data-part="dataset-key-search"] input')! as HTMLElement;
            await userEvent.type(input, TARGET_KEY);
            await waitFor(() => {
                expect(container.querySelector('[data-part="dataset-key-search"]')!.textContent)
                    .toMatch(/match/);
            }, { timeout: 5_000 });
            fireEvent.keyDown(input, { key: "Enter" });

            // The canvas MOVED: the target window landed, and the page
            // scrolled to its row...
            await waitFor(() => {
                expect(container.querySelector(unitRow(TARGET_KEY))).toBeTruthy();
            }, { timeout: 10_000 });
            expect(window.scrollY).toBeGreaterThan(0);
            // ...and the head it left behind is described by a band, not by
            // rows: scrolled back to the top, the band is what is there.
            act(() => { window.scrollTo({ top: 0 }); });
            const head = container.querySelector('[data-plan-window-band="head"]');
            expect(head).toBeTruthy();
            expect(Number(head!.getAttribute("data-plan-elements"))).toBeGreaterThan(2_000);
            expect(container.querySelector(unitRow("u0000"))).toBeNull();

            // The point of paging: it jumped, it did not walk. Everything between
            // the opening ring and the target ring stayed unread.
            const target = Math.floor(TARGET / PLAN_PAGE_SIZE);
            const newly = asked.filter((w) => !beforeJump.has(w));
            expect(newly.length).toBeGreaterThan(0);
            for (const w of newly) expect(w).toBeGreaterThanOrEqual(target - 2);
            expect(asked).not.toContain(8);
            expect(asked).not.toContain(10);
        } finally {
            restore();
        }
    }, 30_000);

    test("a search the canvas has shown leaves the page to the reader — a window landing above its target never scrolls back to it", async () => {
        const restore = emulateWindowScroll();
        try {
            const { root, asked } = withRecordedWindows(buildPagedPlan());
            const { container } = renderPlan(root, "plan-search-leaves");
            await waitFor(() => {
                expect(container.querySelector(unitRow("u0000"))).toBeTruthy();
            });
            const input = container.querySelector('[data-part="dataset-key-search"] input')! as HTMLElement;
            await userEvent.type(input, TARGET_KEY);
            await waitFor(() => {
                expect(container.querySelector('[data-part="dataset-key-search"]')!.textContent).toMatch(/match/);
            }, { timeout: 5_000 });
            fireEvent.keyDown(input, { key: "Enter" });
            // The jump landed and the page went to its row, with the window
            // before it resident too (the demand ring).
            const target = Math.floor(TARGET / PLAN_PAGE_SIZE);
            await waitFor(() => {
                expect(container.querySelector(unitRow(TARGET_KEY))).toBeTruthy();
                expect(asked).toContain(target - 1);
            }, { timeout: 10_000 });
            const onTarget = window.scrollY;
            expect(onTarget).toBeGreaterThan(0);
            // The reader scrolls up 150 rows, the query still standing. Their
            // scroll settles, the demand follows, and the window before those
            // rows lands ABOVE the target, moving its index.
            act(() => { window.scrollTo({ top: onTarget - 150 * ROW_PX }); });
            const readerAt = window.scrollY;
            await waitFor(() => {
                expect(asked).toContain(target - 2);
            }, { timeout: 5_000 });
            await waitFor(() => {
                expect(container.querySelector(unitRow("u2850"))).toBeTruthy();
            }, { timeout: 5_000 });
            // The page stays where the reader put it: the search was shown
            // once, and a request is spent when it is served.
            await act(() => new Promise((r) => setTimeout(r, 300)));
            expect(window.scrollY).toBe(readerAt);
            expect(container.querySelector(unitRow("u2850"))).toBeTruthy();
        } finally {
            restore();
        }
    }, 30_000);

    test("the bar appears for the SOURCE's sake — and only when there is a reason", async () => {
        // #587's other half. Mounting the toolbar for a seek-capable source
        // must not mount it for everything: an inline canvas binds no slice and
        // declares no seek, so it still gets no bar rather than an empty band.
        const { root } = withRecordedWindows(buildPagedPlan());
        const { container: paged } = renderPlan(root, "plan-bar-paged");
        await waitFor(() => {
            expect(paged.querySelector('[data-slot="toolbar"]')).toBeTruthy();
        });
        expect(paged.querySelector('[data-part="dataset-key-search"]')).toBeTruthy();
        cleanup();

        const inline: PlanRootValue = { ...root, rows: variant("inline", []) as PlanRootValue["rows"] };
        const { container: plain } = renderPlan(inline, "plan-bar-inline");
        expect(plain.querySelector('[data-slot="toolbar"]')).toBeNull();
    }, 30_000);
});

/** `n` units of one shape — generated at module scope (East bodies never call host helpers). */
const uniformUnits = (n: number) => new Map(Array.from({ length: n }, (_, i) => [
    `u${String(i).padStart(4, "0")}`,
    { start: W27, end: W39, tonnes: i + 0.5 },
] as const));
/** One window's worth of units, and two windows' worth. */
const UNIFORM = { 30: uniformUnits(30), 300: uniformUnits(300) };
/** Each as a source built to the contract, a window of it at a time. */
const UNIFORM_SOURCES = {
    30: {
        id: "uniform",
        page: East.function([IntegerType, IntegerType], OptionType(Units), ($, offset, limit) => {
            const window = $.const(UNITS_WINDOW);
            return window($.const(UNIFORM[30], Units), offset, limit);
        }),
        total: East.function([], OptionType(IntegerType), ($) => {
            const all = $.const(UNIFORM[30], Units);
            return some(all.size());
        }),
        seek: none,
    },
    300: {
        id: "uniform",
        page: East.function([IntegerType, IntegerType], OptionType(Units), ($, offset, limit) => {
            const window = $.const(UNITS_WINDOW);
            return window($.const(UNIFORM[300], Units), offset, limit);
        }),
        total: East.function([], OptionType(IntegerType), ($) => {
            const all = $.const(UNIFORM[300], Units);
            return some(all.size());
        }),
        seek: none,
    },
};

describe("the same canvas inline and paged (#822)", () => {
    /** One canvas over `n` units, built by the factory and compiled — its
     *  `series` over the Dict itself, or over a source of it. */
    function buildOver(n: 30 | 300, twoSeries: boolean, paged: boolean): PlanRootValue {
        const program = East.function([], Plan.Types.Root, ($) => {
            const data = $.const(UNIFORM[n], Units);
            const jobs = Plan.series.span(UnitRow, {
                key: "jobs", title: "Jobs", label: (_r, k) => k,
                runs: (r, k) => [Plan.run({ key: "run", start: r.start, end: r.end, label: k, state: "actual" })],
            });
            const loads = Plan.series.span(UnitRow, {
                key: "loads", title: "Loads", label: (_r, k) => East.str`${k} · load`,
                runs: (r) => [Plan.run({ key: "run", start: r.start, end: r.end, label: "LOAD", quantity: Plan.quantity(r.tonnes, { unit: "t" }), state: "confirmed" })],
            });
            const axis = $.const(Plan.axis({ window: { min: W27, max: W39 }, resolution: "week", now: NOW }));
            const series = twoSeries ? [jobs, loads] : [jobs];
            return paged
                ? Plan.Payload({ axis, data: $.const(UNIFORM_SOURCES[n], Paged.Types.Source(Units)), series })
                : Plan.Payload({ axis, data, series });
        });
        return East.compile(program, getRegisteredPlatformImplementations())();
    }

    /** Every row the canvas drew, in order — as `series/key`. */
    const drawn = (c: HTMLElement) => [...c.querySelectorAll("[data-plan-row]")].map((el) => {
        const key = el.getAttribute("data-plan-row")!;
        const series = /series="([^"]*)"/.exec(key)?.[1] ?? "?";
        return `${series}/${testKeyOf(key)}`;
    });

    async function bothWays(n: 30 | 300, twoSeries: boolean): Promise<[string[], string[]]> {
        const inline = renderPlan(buildOver(n, twoSeries, false), `plan-822-inline-${n}`);
        const expected = drawn(inline.container);
        cleanup();
        const paged = renderPlan(buildOver(n, twoSeries, true), `plan-822-paged-${n}`);
        await waitFor(() => {
            expect(paged.container.querySelector('[data-slot="footerTransport"]')?.textContent)
                .toBe(`${n.toLocaleString("en-US")} loaded of ${n.toLocaleString("en-US")}`);
        }, { timeout: 10_000 });
        return [expected, drawn(paged.container)];
    }

    test("two series over one window: the same rows, block by block, in the same order", async () => {
        const [inline, paged] = await bothWays(30, true);
        expect(inline).toHaveLength(60);
        expect(inline.slice(0, 2)).toEqual(["jobs/u0000", "jobs/u0001"]);
        expect(inline[30]).toBe("loads/u0000");
        expect(paged).toEqual(inline);
    }, 30_000);

    test("one series over two windows: the windows concatenate into the inline order", async () => {
        const [inline, paged] = await bothWays(300, false);
        expect(inline).toHaveLength(300);
        expect(paged).toEqual(inline);
    }, 30_000);

    test("two series over two windows: two blocks, each paging on its own — the inline order, one read of a window for both (#823)", async () => {
        // 300 units: window 0 holds 200, window 1 the rest. Each series is a
        // block of its own, so every jobs row comes before every loads row —
        // not a window's jobs, then its loads, then the next window's.
        const restore = emulateWindowScroll();
        // A view tall enough to show the whole canvas: every row mounts.
        const own = Object.getOwnPropertyDescriptor(window, "innerHeight");
        Object.defineProperty(window, "innerHeight", { configurable: true, value: 30_000 });
        try {
            const inline = renderPlan(buildOver(300, true, false), "plan-823-inline");
            const expected = drawn(inline.container);
            expect(expected).toHaveLength(600);
            expect(expected.slice(299, 301)).toEqual(["jobs/u0299", "loads/u0000"]);
            cleanup();
            const { root, asked } = withRecordedWindows(buildOver(300, true, true));
            const paged = renderPlan(root, "plan-823-paged");
            await waitFor(() => expect(paged.container.querySelector('[data-slot="footerTransport"]')?.textContent)
                .toBe("300 loaded of 300"), { timeout: 10_000 });
            expect(drawn(paged.container)).toEqual(expected);
            // One read of each window served both blocks.
            expect([...asked].sort((a, b) => a - b)).toEqual([0, 1]);
        } finally {
            if (own !== undefined) Object.defineProperty(window, "innerHeight", own);
            else delete (window as { innerHeight?: number }).innerHeight;
            restore();
        }
    }, 30_000);
});

/** A machine: a run, its tonnes, and three weeks of load. */
const MachineRow = StructType({
    start: DateTimeType, end: DateTimeType, tonnes: FloatType, load: ArrayType(Plan.Types.HeatCell),
});
const WEEK_MS = 7 * 86_400_000;
/** Lines grouped in the data (#822): 1,001 lines of one machine, but for L0200,
 *  whose forty machines ride in its entry — in window 1 of six. Module scope:
 *  East bodies never call host helpers. */
const LINES = new Map(Array.from({ length: 1_001 }, (_, i) => {
    const line = `L${String(i).padStart(4, "0")}`;
    return [line, new Map(Array.from({ length: i === 200 ? 40 : 1 }, (_u, m) => [
        `${line}-M${String(m + 1).padStart(2, "0")}`,
        {
            start: new Date(W27.getTime() + (m % 4) * WEEK_MS),
            end: new Date(W27.getTime() + ((m % 4) + 2) * WEEK_MS),
            tonnes: m + 1,
            load: [0, 1, 2].map((k) => ({
                at: variant("time", new Date(W27.getTime() + k * WEEK_MS)),
                value: some(((m + k) % 5) * 20),
                label: none,
            })),
        },
    ] as const))] as const;
}));
const Machines = DictType(StringType, MachineRow);
const Lines = DictType(StringType, Machines);

/** The lines as a source built to the contract — a window of lines at a time, in key order. */
const LINES_PAGE = East.function([IntegerType, IntegerType], OptionType(Lines), ($, offset, limit) => {
    const all = $.const(LINES, Lines);
    const keys = $.let(all.toArray((_$, _v, k) => k));
    const n = $.let(keys.size());
    const start = $.let(offset.less(n).ifElse(() => offset, () => n));
    const end = $.let(start.add(limit).less(n).ifElse(() => start.add(limit), () => n));
    return some(all.getKeys(keys.slice(start, end).toSet()));
});
const LINES_TOTAL = East.function([], OptionType(IntegerType), ($) => {
    const all = $.const(LINES, Lines);
    return some(all.size());
});
const LINES_SOURCE = { id: "lines", page: LINES_PAGE, total: LINES_TOTAL, seek: none };

describe("a parent sits whole in its window (#823)", () => {
    /** The lines canvas — inline over the Dict, or paged over a source of it. */
    function buildLines(paged: boolean): PlanRootValue {
        const program = East.function([], Plan.Types.Root, ($) => {
            const lines = $.const(LINES, Lines);
            const series = [
                // One strip per line, its machines its members — collapsed, it
                // rests as their summed load.
                Plan.series.group(Machines, {
                    key: "lines", title: "Lines", label: (_g, line) => line,
                    match: (g) => g.size().greater(1n),
                    summaryAggregate: "sum", collapsed: true,
                    children: Plan.children((g) => g, [
                        Plan.series.heat(MachineRow, {
                            key: "load", title: "Load", label: (_m, k) => k,
                            cells: (m) => Plan.heatCells(m.load, { min: 0, max: 100 }),
                        }),
                    ]),
                }),
                // One row per line, rolling its machines' runs into bands —
                // each band sums their tonnes, the unit riding each quantity.
                Plan.series.span(Machines, {
                    key: "line-jobs", title: "Jobs", label: (_g, line) => line,
                    match: (g) => g.size().greater(1n),
                    runs: () => [], collapsed: true,
                    children: Plan.children((g) => g, [
                        Plan.series.span(MachineRow, {
                            key: "machine-jobs", title: "Machine jobs", label: (_m, k) => k,
                            runs: (m, k) => [Plan.run({ key: "run", start: m.start, end: m.end, label: k, quantity: Plan.quantity(m.tonnes, { unit: "t" }), state: "actual" })],
                        }),
                    ]),
                }),
            ];
            const axis = $.const(Plan.axis({ window: { min: W27, max: W39 }, resolution: "week", now: NOW }));
            return paged
                ? Plan.Payload({ axis, data: $.const(LINES_SOURCE, Paged.Types.Source(Lines)), series })
                : Plan.Payload({ axis, data: lines, series });
        });
        return East.compile(program, getRegisteredPlatformImplementations())();
    }

    /** What the line says: its strip's band — its count and its summed load — and its rollup bands. */
    const said = (c: HTMLElement) => ({
        strip: c.querySelector(rowSel("L0200", "data-plan-group", "lines"))!.textContent,
        bands: [...c.querySelector(rowSel("L0200", "data-plan-row", "line-jobs"))!
            .querySelectorAll("[data-state]:not([data-run])")].map((b) => b.textContent),
    });

    test("a line of forty machines reads on a partial paged canvas exactly as it does inline — its count, its strip, its bands", async () => {
        const inline = renderPlan(buildLines(false), "plan-823-line-inline");
        const expected = said(inline.container);
        expect(expected.strip).toContain("40 rows");
        expect(expected.bands.length).toBeGreaterThan(0);
        cleanup();
        // Windows past the third stay in flight, so the paged canvas is and
        // stays partial — its first three windows are all it holds.
        const built = buildLines(true);
        const src = pagedOf(built);
        const asked: number[] = [];
        const held = {
            ...src,
            page: (offset: bigint, limit: bigint) => {
                asked.push(Number(offset) / PLAN_PAGE_SIZE);
                return offset >= BigInt(3 * PLAN_PAGE_SIZE) ? none : src.page(offset, limit);
            },
        };
        const paged = renderPlan({ ...built, rows: variant("paged", held) }, "plan-823-line-paged");
        await waitFor(() => expect(paged.container.querySelector(rowSel("L0200", "data-plan-group", "lines"))).toBeTruthy(),
            { timeout: 10_000 });
        // The canvas is partial…
        expect(paged.container.querySelector("[data-plan-body][data-plan-partial]")).toBeTruthy();
        // …and the line is not — its window holds it whole.
        expect(paged.container.querySelector(`${rowSel("L0200", "data-plan-group", "lines")}[data-plan-partial]`)).toBeNull();
        expect(said(paged.container)).toEqual(expected);
        // One read of each landed window served both blocks.
        expect(asked.filter((w) => w < 3).sort((x, y) => x - y)).toEqual([0, 1, 2]);
    }, 30_000);
});
