/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * What a stretch of a page's work costs its main thread, for the benchmarks
 * asked for with `E3_UI_PERF=1` (#1398, CL9; #1393) — never in CI: a timing on
 * a shared runner is no deterministic signal. The frames the page drew while
 * the work ran — how many, the longest, how many took longer than one and two
 * 60 Hz frames and than 50 ms — and the long animation frames the browser
 * reported meanwhile, its `long-animation-frame` entries: how many, their total
 * and blocking time, the longest, the time in script, in forced style and
 * layout, in the rendering phase and in style and layout, the script time by
 * what invoked it, and the longest scripts, each with what invoked it and where
 * its code is.
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
        // The last frames' entries are delivered after them.
        await new Promise((resolve) => setTimeout(resolve, 500));
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
        return {
            ms: round(end - probe.start),
            frames: frames.length,
            fps: Math.round((frames.length / seconds) * 10) / 10,
            longestFrame: round(Math.max(0, ...gaps)),
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
