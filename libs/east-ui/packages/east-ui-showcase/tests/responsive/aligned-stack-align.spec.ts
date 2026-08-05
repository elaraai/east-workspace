/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * AlignedStack column-alignment goldens (#147 follow-up).
 *
 * The whole point of an `<AlignedStack>` is that every stacked lane —
 * Chart, Trace, Matrix, Planner, Calendar, Table — pins its N day columns
 * to the SAME `[left, W − right]` band the chart plots into, so a reader can
 * trace a vertical line down one day across all lanes. A grid `column-gap`
 * silently breaks this: the gap redistributes into the flexible tracks and
 * pulls the outer columns inward by a fraction that ACCUMULATES to ~±1.3px
 * by the 6th column — invisible per-cell, obvious across the width.
 *
 * jsdom can't lay out (getBoundingClientRect is 0), so this is a real-browser
 * test. It records the EXACT rendered horizontal centre of every column label
 * (a Range over the digit's text node — the glyph centre, not the padding box)
 * and asserts, per column index, that every lane agrees with the chart's
 * x-axis tick to within a sub-pixel tolerance. It fails loudly if any lane
 * reintroduces a column gap (or otherwise drifts off the shared axis).
 */

import { test, expect } from "playwright/test";

const KEY = "layout/aligned-stack/alignedStackAll";
// The fixes land every lane within ~±0.05px; the accumulating column-gap
// regression this guards against reaches ~1.3px at the ends. 0.75px sits
// comfortably between — tight enough to catch the drift, loose enough to
// absorb sub-pixel AA between browsers.
const TOL = 0.75;

interface Measured {
    chart: number[];
    laneRows: { label: string; centers: number[] }[];
}

test.describe("AlignedStack shares one column axis (#147)", () => {
    test("every lane's column labels sit on the chart's x-axis ticks", async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== "desktop", "column geometry is measured at the desktop width");

        await page.goto(`/#${encodeURIComponent(KEY)}`);
        await page.waitForSelector("header", { timeout: 20_000 });
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await page.waitForTimeout(1500);
        await page.evaluate((key) => {
            const a = document.querySelector(`a[href="#${key}"]`);
            a?.closest("[data-index]")?.scrollIntoView({ block: "start" });
        }, KEY);
        await page.waitForTimeout(600);

        const data: Measured = await page.evaluate((key) => {
            const a = document.querySelector(`a[href="#${key}"]`);
            const card = a?.closest("[data-index]") ?? document.body;

            // The page now hosts THIRTEEN captioned groups (the folded-in
            // pairs / density / axis catalogues) — each its own AlignedStack
            // with its own axis. The shared-axis assertion applies WITHIN one
            // stack, so scope every measurement to the flagship group: the
            // band between the first two Separator rules.
            const seps = [...card.querySelectorAll("[class*='elara-separator']")]
                .map((el) => el.getBoundingClientRect().top)
                .sort((x, y) => x - y);
            const bandTop = seps[0] ?? -Infinity;
            const bandBottom = seps[1] ?? Infinity;
            const inBand = (cy: number) => cy > bandTop && cy < bandBottom;

            // Glyph centre of an element's own digit text — a Range over the TEXT
            // NODE only, so sibling sort-icons / pseudo-elements don't skew it.
            const textCX = (el: Element): number | null => {
                const tn = [...el.childNodes].find(
                    (n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "",
                );
                if (!tn) return null;
                const range = document.createRange();
                range.selectNode(tn);
                const r = range.getBoundingClientRect();
                if (r.width === 0 && r.height === 0) return null;
                return (r.left + r.right) / 2;
            };
            const round = (n: number) => Math.round(n * 100) / 100;

            // Chart x-axis ticks: SVG <text> reading a single digit 0..6, taking
            // the cy-band that holds the most of them (the axis row).
            const raw: { d: number; cx: number; cy: number }[] = [];
            for (const t of card.querySelectorAll("svg text")) {
                const s = (t.textContent ?? "").trim();
                if (/^[0-6]$/.test(s)) {
                    const b = t.getBoundingClientRect();
                    const cy = (b.top + b.bottom) / 2;
                    if (!inBand(cy)) continue;
                    raw.push({ d: +s, cx: (b.left + b.right) / 2, cy });
                }
            }
            const bands: { cy: number; items: typeof raw }[] = [];
            for (const t of raw) {
                let band = bands.find((B) => Math.abs(B.cy - t.cy) < 10);
                if (!band) { band = { cy: t.cy, items: [] }; bands.push(band); }
                band.items.push(t);
            }
            const axis = bands.sort((A, B) => B.items.length - A.items.length)[0] ?? { items: [] };
            const chartByD: Record<number, number> = {};
            for (const t of axis.items) if (!(t.d in chartByD)) chartByD[t.d] = t.cx;
            const chart = [0, 1, 2, 3, 4, 5, 6].filter((d) => d in chartByD).map((d) => round(chartByD[d]));

            // Every non-SVG element whose own text is exactly a digit 0..6 → a
            // column label somewhere in a lane. Cluster by cy into lane rows;
            // keep only rows that carry a full 0..6 header (Trace / Matrix /
            // Planner axis + header rows).
            const digits: { d: number; cx: number; cy: number }[] = [];
            const walk = document.createTreeWalker(card, NodeFilter.SHOW_ELEMENT);
            for (let el = walk.nextNode() as Element | null; el; el = walk.nextNode() as Element | null) {
                if (el.closest("svg")) continue;
                const own = (el.textContent ?? "").trim();
                if (!/^[0-6]$/.test(own)) continue;
                const direct = [...el.childNodes].some(
                    (n) => n.nodeType === 3 && (n.textContent ?? "").trim() === own,
                );
                if (!direct) continue;
                const cx = textCX(el);
                if (cx == null) continue;
                const b = el.getBoundingClientRect();
                const cy = (b.top + b.bottom) / 2;
                if (!inBand(cy)) continue;
                digits.push({ d: +own, cx, cy });
            }
            digits.sort((x, y) => x.cy - y.cy || x.cx - y.cx);
            const rows: { cy: number; items: typeof digits }[] = [];
            for (const dg of digits) {
                let row = rows.find((R) => Math.abs(R.cy - dg.cy) < 14);
                if (!row) { row = { cy: dg.cy, items: [] }; rows.push(row); }
                row.items.push(dg);
                row.cy = row.items.reduce((s, i) => s + i.cy, 0) / row.items.length;
            }
            const laneRows = rows
                .filter((R) => {
                    const ds = new Set(R.items.map((i) => i.d));
                    return [0, 1, 2, 3, 4, 5, 6].every((d) => ds.has(d));
                })
                .map((R, idx) => {
                    const byD: Record<number, number> = {};
                    for (const it of R.items) if (!(it.d in byD)) byD[it.d] = it.cx;
                    return {
                        label: `digit-lane@${Math.round(R.cy)}#${idx}`,
                        centers: [0, 1, 2, 3, 4, 5, 6].map((d) => round(byD[d])),
                    };
                });

            // Calendar lane: its columns are MON..SUN, not digits — measure the
            // day-header glyph centres and treat MON→0 … SUN→6.
            const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
            const dayCX: (number | null)[] = DAYS.map(() => null);
            const seenDay = new Set<number>();
            const walk2 = document.createTreeWalker(card, NodeFilter.SHOW_ELEMENT);
            for (let el = walk2.nextNode() as Element | null; el; el = walk2.nextNode() as Element | null) {
                const own = (el.textContent ?? "").trim().toUpperCase();
                const di = DAYS.indexOf(own);
                if (di < 0 || seenDay.has(di)) continue;
                const direct = [...el.childNodes].some(
                    (n) => n.nodeType === 3 && (n.textContent ?? "").trim().toUpperCase() === own,
                );
                if (!direct) continue;
                const cx = textCX(el);
                if (cx == null) continue;
                const br = el.getBoundingClientRect();
                if (!inBand((br.top + br.bottom) / 2)) continue;
                dayCX[di] = round(cx);
                seenDay.add(di);
            }
            if (dayCX.every((v) => v != null)) {
                laneRows.push({ label: "calendar-days", centers: dayCX as number[] });
            }

            return { chart, laneRows };
        }, KEY);

        // The reference exists and is a full 7-tick axis.
        expect(data.chart, "chart x-axis ticks 0..6").toHaveLength(7);
        // At least the Trace, Matrix, Planner + Calendar lanes were found.
        expect(data.laneRows.length, "aligned lanes discovered").toBeGreaterThanOrEqual(4);

        // Per column, every lane agrees with the chart tick within tolerance.
        const failures: string[] = [];
        for (const lane of data.laneRows) {
            for (let i = 0; i < 7; i++) {
                const dev = lane.centers[i] - data.chart[i];
                if (Math.abs(dev) > TOL) {
                    failures.push(`${lane.label} col ${i}: ${lane.centers[i]} vs chart ${data.chart[i]} (Δ${dev.toFixed(2)}px)`);
                }
            }
        }
        expect(failures, `column labels off the chart axis by > ${TOL}px:\n${failures.join("\n")}`).toHaveLength(0);
    });
});
