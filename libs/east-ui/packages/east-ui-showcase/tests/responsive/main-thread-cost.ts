/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * What a stretch of a page's work costs its main thread, for the benchmarks
 * asked for with `E3_UI_PERF=1` (#1398, CL9; #1393) — never in CI: a timing on
 * a shared runner is no deterministic signal. The frames the page drew while
 * the work ran — how many, the longest, the median and the 90th percentile, how
 * many took longer than one and two 60 Hz frames and than 50 ms — and the long
 * animation frames the browser reported meanwhile, its `long-animation-frame`
 * entries: how many, their total and blocking time, the longest, the time in
 * script, in forced style and layout, in the rendering phase and in style and
 * layout, the script time by what invoked it, and the longest scripts, each
 * with what invoked it and where its code is.
 *
 * And what the work spent the main thread on ({@link traceOf}), from a trace of
 * it and a sample of its scripts: the self time in each phase of a frame —
 * script, style, layout, paint, garbage collection and the rest — the trace's
 * events with the most of it, and the functions with the most.
 */

import type { Page } from "playwright/test";

/** A script a long animation frame ran: how long, what invoked it, and where its code is. */
export interface LongScript {
    readonly ms: number;
    readonly invoker: string;
    readonly source: string;
}

/** What a stretch of the page's work cost the main thread. */
export interface Cost {
    readonly ms: number;
    readonly frames: number;
    readonly fps: number;
    readonly longestFrame: number;
    /** The median frame, ms. */
    readonly medianFrame: number;
    /** The 90th percentile frame, ms. */
    readonly p90Frame: number;
    readonly over16: number;
    readonly over33: number;
    readonly over50: number;
    readonly loaf: {
        readonly count: number;
        readonly total: number;
        readonly blocking: number;
        readonly longest: number;
        readonly script: number;
        readonly forcedStyleAndLayout: number;
        readonly rendering: number;
        readonly styleAndLayout: number;
        readonly byInvoker: readonly string[];
        readonly longestScripts: readonly LongScript[];
    };
}

/** The measurement's state on the page's window. */
const PROBE = "__mainThreadProbe";

/**
 * The page's main-thread cost while `work` runs: the frames it drew and the
 * long animation frames the browser reported, the last delivered after `work`
 * is done.
 *
 * @param page - The page
 * @param work - The stretch of work, done when it resolves
 * @returns What it cost
 */
export async function costOf(page: Page, work: () => Promise<unknown>): Promise<Cost> {
    await page.evaluate((name) => {
        const probe = { loafs: [] as PerformanceEntry[], frames: [] as number[], drawing: true, start: performance.now(), observer: undefined as PerformanceObserver | undefined };
        probe.observer = new PerformanceObserver((list) => { probe.loafs.push(...list.getEntries()); });
        probe.observer.observe({ type: "long-animation-frame", buffered: false });
        const frame = (now: number) => { probe.frames.push(now); if (probe.drawing) requestAnimationFrame(frame); };
        requestAnimationFrame(frame);
        (window as unknown as Record<string, unknown>)[name] = probe;
    }, PROBE);
    await work();
    return page.evaluate(async (name): Promise<Cost> => {
        type Script = {
            duration: number; invoker: string; invokerType: string; forcedStyleAndLayoutDuration: number;
            sourceURL: string; sourceFunctionName: string; sourceCharPosition: number;
        };
        type Loaf = PerformanceEntry & { blockingDuration: number; renderStart: number; styleAndLayoutStart: number; scripts: Script[] };
        const probe = (window as unknown as Record<string, { loafs: Loaf[]; frames: number[]; drawing: boolean; start: number; observer: PerformanceObserver }>)[name]!;
        const end = performance.now();
        probe.drawing = false;
        // A long animation frame's entry is queued once its rendering is done, and delivered later: the frame in flight at
        // the end is done by the second frame after it, and what the observer has not delivered yet is taken from it.
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        probe.loafs.push(...(probe.observer.takeRecords() as Loaf[]));
        probe.observer.disconnect();
        const frames = probe.frames.filter((t) => t <= end);
        const gaps = frames.slice(1).map((t, i) => t - frames[i]!);
        const during = probe.loafs.filter((l) => l.startTime + l.duration >= probe.start && l.startTime <= end);
        const byInvoker = new Map<string, number>();
        const scripts: Script[] = [];
        let script = 0;
        let forced = 0;
        let rendering = 0;
        let styleAndLayout = 0;
        for (const l of during) {
            const frameEnd = l.startTime + l.duration;
            if (l.renderStart > 0) rendering += frameEnd - l.renderStart;
            if (l.styleAndLayoutStart > 0) styleAndLayout += frameEnd - l.styleAndLayoutStart;
            for (const s of l.scripts) {
                script += s.duration;
                forced += s.forcedStyleAndLayoutDuration;
                const key = `${s.invokerType} ${s.invoker}`;
                byInvoker.set(key, (byInvoker.get(key) ?? 0) + s.duration);
                scripts.push(s);
            }
        }
        const round = (n: number) => Math.round(n);
        const seconds = (end - probe.start) / 1000;
        const file = (url: string) => url.slice(url.lastIndexOf("/") + 1);
        const sorted = [...gaps].sort((a, b) => a - b);
        const percentile = (p: number) => (sorted.length === 0 ? 0 : Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! * 10) / 10);
        return {
            ms: round(end - probe.start),
            frames: frames.length,
            fps: Math.round((frames.length / seconds) * 10) / 10,
            longestFrame: round(Math.max(0, ...gaps)),
            medianFrame: percentile(0.5),
            p90Frame: percentile(0.9),
            over16: gaps.filter((g) => g > 1000 / 60 + 0.5).length,
            over33: gaps.filter((g) => g > 2000 / 60 + 0.5).length,
            over50: gaps.filter((g) => g > 50).length,
            loaf: {
                count: during.length,
                total: round(during.reduce((sum, l) => sum + l.duration, 0)),
                blocking: round(during.reduce((sum, l) => sum + l.blockingDuration, 0)),
                longest: round(Math.max(0, ...during.map((l) => l.duration))),
                script: round(script),
                forcedStyleAndLayout: round(forced),
                rendering: round(rendering),
                styleAndLayout: round(styleAndLayout),
                byInvoker: [...byInvoker.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}: ${round(v)} ms`),
                longestScripts: [...scripts].sort((a, b) => b.duration - a.duration).slice(0, 8).map((s) => ({
                    ms: round(s.duration),
                    invoker: `${s.invokerType} ${s.invoker}`,
                    source: `${s.sourceFunctionName || "(anonymous)"} ${file(s.sourceURL)}:${s.sourceCharPosition}`,
                })),
            },
        };
    }, PROBE);
}

/** What a stretch of a page's work spent its main thread on, from a trace of it and a sample of its scripts. */
export interface Spent {
    /** The stretch's length, ms. */
    readonly ms: number;
    /** Self time on the page's main thread, ms, by phase: script, style, layout, paint (pre-paint, paint, layerize and commit), garbage collection and the rest. */
    readonly phases: Readonly<Record<string, number>>;
    /** The trace's events with the most self time on the main thread, each `name: ms`. */
    readonly events: readonly string[];
    /** The functions with the most self time, as the profiler sampled them, each `ms name file:line:column`. */
    readonly functions: readonly string[];
}

/** A trace event, as Chrome reports one: a complete event's start and length, µs, on its process and thread. */
interface TraceEvent {
    readonly name: string;
    readonly ph: string;
    readonly pid: number;
    readonly tid: number;
    readonly ts: number;
    readonly dur?: number;
    readonly args?: { readonly name?: string };
}

/** The trace events in each phase of a frame; everything else is `other`, and a garbage collection is `gc`. */
const PHASES: Readonly<Record<string, readonly string[]>> = {
    script: ["FunctionCall", "EvaluateScript", "EventDispatch", "TimerFire", "FireAnimationFrame", "FireIdleCallback", "RunMicrotasks",
        "V8.Execute", "v8.run", "v8.callFunction", "v8.compile", "v8.compileModule", "v8.evaluateModule", "V8.CompileCode", "V8.ParseFunction"],
    style: ["UpdateLayoutTree", "RecalculateStyles", "ParseAuthorStyleSheet"],
    layout: ["Layout", "ComputeIntersections", "IntersectionObserverController::computeIntersections"],
    paint: ["PrePaint", "Paint", "PaintImage", "Layerize", "Commit", "UpdateLayer", "UpdateLayerTree", "CompositeLayers", "Decode Image"],
};

/** The phase a trace event's self time is spent in. */
function phaseOf(name: string): string {
    if (/GC|Garbage/.test(name)) return "gc";
    for (const [phase, names] of Object.entries(PHASES)) if (names.includes(name)) return phase;
    return "other";
}

/**
 * What the page's main thread spent its time on while `work` runs: a trace of
 * it, each complete event's self time — its length less its children's — by
 * the phase of a frame it is in and by its name, and a sample of its scripts,
 * each function's self time. Tracing costs the page time of its own: measure a
 * stretch's frames apart ({@link costOf}).
 *
 * @param page - The page
 * @param work - The stretch of work, done when it resolves
 * @returns What it spent
 */
export async function traceOf(page: Page, work: () => Promise<unknown>): Promise<Spent> {
    const cdp = await page.context().newCDPSession(page);
    const events: TraceEvent[] = [];
    cdp.on("Tracing.dataCollected", ({ value }) => { events.push(...(value as unknown as TraceEvent[])); });
    const done = new Promise<void>((resolve) => { cdp.once("Tracing.tracingComplete", () => resolve()); });
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 250 });
    await cdp.send("Tracing.start", { categories: "-*,toplevel,devtools.timeline,disabled-by-default-devtools.timeline,v8.execute", transferMode: "ReportEvents" });
    await cdp.send("Profiler.start");
    const start = Date.now();
    await work();
    const ms = Date.now() - start;
    const { profile } = await cdp.send("Profiler.stop");
    await cdp.send("Tracing.end");
    await done;
    await cdp.detach();

    // The page's main thread: of the renderers' main threads, the one the trace saw busiest.
    const thread = (e: TraceEvent) => `${e.pid}:${e.tid}`;
    const mains = new Set(events.filter((e) => e.ph === "M" && e.name === "thread_name" && e.args?.name === "CrRendererMain").map(thread));
    const busy = new Map<string, number>();
    for (const e of events) if (e.ph === "X" && mains.has(thread(e))) busy.set(thread(e), (busy.get(thread(e)) ?? 0) + (e.dur ?? 0));
    const main = [...busy.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const ran = events.filter((e) => e.ph === "X" && thread(e) === main && (e.dur ?? 0) > 0).sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0));
    // Each event's self time: its length, less what its children took of it.
    const self = new Map<string, number>();
    const open: { end: number; name: string }[] = [];
    for (const e of ran) {
        while (open.length > 0 && open[open.length - 1]!.end <= e.ts) open.pop();
        const parent = open[open.length - 1];
        self.set(e.name, (self.get(e.name) ?? 0) + e.dur!);
        if (parent !== undefined) self.set(parent.name, (self.get(parent.name) ?? 0) - Math.min(e.dur!, parent.end - e.ts));
        open.push({ end: e.ts + e.dur!, name: e.name });
    }
    const phases: Record<string, number> = {};
    for (const [name, us] of self) phases[phaseOf(name)] = (phases[phaseOf(name)] ?? 0) + us / 1000;

    // Each function's self time, as the profiler sampled the page's scripts.
    const frames = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
    const byFunction = new Map<string, number>();
    (profile.samples ?? []).forEach((id, i) => {
        const frame = frames.get(id)!;
        if (frame.functionName === "(idle)") return;
        const where = frame.url === "" ? "" : ` ${frame.url.slice(frame.url.lastIndexOf("/") + 1)}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`;
        const key = `${frame.functionName || "(anonymous)"}${where}`;
        byFunction.set(key, (byFunction.get(key) ?? 0) + (profile.timeDeltas?.[i] ?? 0) / 1000);
    });
    const round = (n: number) => Math.round(n);
    return {
        ms,
        phases: Object.fromEntries(Object.entries(phases).sort((a, b) => b[1] - a[1]).map(([phase, total]) => [phase, round(total)])),
        events: [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, us]) => `${name}: ${round(us / 1000)} ms`),
        functions: [...byFunction.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([key, total]) => `${round(total)} ms ${key}`),
    };
}
