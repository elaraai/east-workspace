// charts-visx.js — pattern-spec chart bootstrap using Airbnb's visx.
//
// Loads React + visx primitives from esm.sh and renders visx React trees into
// every DOM element carrying a `data-spec-*` chart hook. One renderer per
// chart shape; design-system tokens live in the C palette below.
//
// Usage in the host HTML:
//   <script type="module" src="./charts-visx.js"></script>
//   <div data-spec-spark='[8,10,14,12,18,16,21]' style="height: 36px;"></div>
//   <div data-spec-multiline='{"series":[{"data":[...],"stroke":"#3a7780"}]}'></div>

import { createElement as h } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client?deps=react@18.3.1";
import { LinePath, AreaClosed, Bar, Line, Circle } from "https://esm.sh/@visx/shape@3?deps=react@18.3.1";
import { Group } from "https://esm.sh/@visx/group@3?deps=react@18.3.1";
import { scaleLinear, scaleBand } from "https://esm.sh/@visx/scale@3";
import { curveMonotoneX, curveLinear } from "https://esm.sh/@visx/curve@3";

// ---------------------------------------------------------------------------
// Design-system palette — mirrors colors_and_type.css.
// ---------------------------------------------------------------------------
const C = {
    brand:     "#3a7780",
    brandTint: "#e8f6f7",
    ink:       "#111b22",
    ink3:      "#4a5f5f",
    ink4:      "#6b8080",
    ink5:      "#9bb0b0",
    rule:      "#e2e8e8",
    ruleStrong:"#cbd5d5",
    pos:       "#2f7a5b",
    neg:       "#b85a4a",
    warn:      "#b8862d",
    paper:     "#ffffff",
    paper2:    "#f6f9f9",
};

const MONO_FONT = '"JetBrains Mono", "JetBrains Mono Variable", ui-monospace, monospace';

function size(el, fallbackH) {
    const rect = el.getBoundingClientRect();
    const w = rect.width  > 0 ? rect.width  : (el.clientWidth || 240);
    const h = rect.height > 0 ? rect.height : (el.clientHeight || fallbackH);
    return [Math.round(w), Math.round(h)];
}

// ---------------------------------------------------------------------------
// Sparkline — line, optional area fill underneath.
// data-spec-spark='[...]'   data-area="true"|"false"   data-stroke="#hex"
// ---------------------------------------------------------------------------
function renderSpark(el) {
    const data   = JSON.parse(el.getAttribute("data-spec-spark"));
    const area   = el.dataset.area !== "false";
    const stroke = el.dataset.stroke || C.brand;
    const [w, hPx] = size(el, 36);
    const xs = scaleLinear({ domain: [0, data.length - 1], range: [0, w] });
    const min = Math.min(...data), max = Math.max(...data);
    const pad = (max - min) * 0.08 || 1;
    const ys = scaleLinear({ domain: [min - pad, max + pad], range: [hPx - 1, 1] });

    createRoot(el).render(
        h("svg", { width: w, height: hPx, style: { display: "block" } },
            area && h(AreaClosed, {
                data, x: (_, i) => xs(i), y: d => ys(d),
                yScale: ys, fill: stroke, fillOpacity: 0.10,
                curve: curveMonotoneX, strokeWidth: 0,
            }),
            h(LinePath, {
                data, x: (_, i) => xs(i), y: d => ys(d),
                stroke, strokeWidth: 1.6, curve: curveMonotoneX,
            }),
        ),
    );
}

// ---------------------------------------------------------------------------
// Multi-line — N polylines on a shared y-axis. Used for Stat.Trend / Stat.Comparison.
// data-spec-multiline='{"series":[{"data":[...],"stroke":"#hex","dasharray":"3 2"}], "ticks":["Aug 14",...], "yTicks":["0","12k","25k"]}'
// ---------------------------------------------------------------------------
function renderMultiline(el) {
    const cfg = JSON.parse(el.getAttribute("data-spec-multiline"));
    const series = cfg.series || [];
    const xTicks = cfg.ticks || [];
    const yTicks = cfg.yTicks || [];
    const [w, hPx] = size(el, 140);
    const pad = { left: 36, right: 6, top: 8, bottom: 22 };
    const innerW = w - pad.left - pad.right;
    const innerH = hPx - pad.top - pad.bottom;

    const allVals = series.flatMap(s => s.data);
    const min = Math.min(...allVals), max = Math.max(...allVals);
    const maxLen = Math.max(...series.map(s => s.data.length));
    const xs = scaleLinear({ domain: [0, maxLen - 1], range: [0, innerW] });
    const ys = scaleLinear({ domain: [min, max], range: [innerH, 0] });

    createRoot(el).render(
        h("svg", { width: w, height: hPx, style: { display: "block" } },
            // Axes — hairline, no ticks, no gridlines
            h(Line, { from: { x: pad.left, y: pad.top + innerH }, to: { x: pad.left + innerW, y: pad.top + innerH }, stroke: C.rule, strokeWidth: 1 }),
            h(Line, { from: { x: pad.left, y: pad.top }, to: { x: pad.left, y: pad.top + innerH }, stroke: C.rule, strokeWidth: 1 }),
            // y tick labels
            yTicks.length === 3 && [
                h("text", { key: "y0", x: pad.left - 6, y: pad.top + 8,        textAnchor: "end", fontFamily: MONO_FONT, fontSize: 9.5, fill: C.ink4 }, yTicks[2]),
                h("text", { key: "y1", x: pad.left - 6, y: pad.top + innerH/2, textAnchor: "end", fontFamily: MONO_FONT, fontSize: 9.5, fill: C.ink4 }, yTicks[1]),
                h("text", { key: "y2", x: pad.left - 6, y: pad.top + innerH,   textAnchor: "end", fontFamily: MONO_FONT, fontSize: 9.5, fill: C.ink4 }, yTicks[0]),
            ],
            // Series — drawn back-to-front
            h(Group, { left: pad.left, top: pad.top },
                series.map((s, i) => h(LinePath, {
                    key: i,
                    data: s.data,
                    x: (_, ix) => xs(ix),
                    y: d => ys(d),
                    stroke: s.stroke || C.brand,
                    strokeWidth: s.strokeWidth || 1.6,
                    strokeDasharray: s.dasharray,
                    strokeOpacity: s.opacity != null ? s.opacity : 1,
                    curve: curveMonotoneX,
                })),
            ),
            // x tick labels
            xTicks.map((t, i) =>
                h("text", {
                    key: `x${i}`,
                    x: pad.left + (innerW * i) / (xTicks.length - 1),
                    y: hPx - 4,
                    textAnchor: i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle",
                    fontFamily: MONO_FONT, fontSize: 10, fill: C.ink4,
                }, t),
            ),
        ),
    );
}

// ---------------------------------------------------------------------------
// Histogram — explicit bin heights. Used for Stat.Distribution.
// data-spec-histogram='{"bins":[3,8,18,...], "xMin":0, "xMax":25, "xUnit":"s",
//                       "percentiles":{"p50":3.2,"p90":8.4,"p99":22.1}}'
// ---------------------------------------------------------------------------
function renderHistogram(el) {
    const cfg  = JSON.parse(el.getAttribute("data-spec-histogram"));
    const bins = cfg.bins || [];
    const [w, hPx] = size(el, 120);
    const pad = { left: 4, right: 4, top: 22, bottom: 24 };
    const innerW = w - pad.left - pad.right;
    const innerH = hPx - pad.top - pad.bottom;
    const maxBin = Math.max(...bins);
    const xs = scaleBand({ domain: bins.map((_, i) => i), range: [0, innerW], padding: 0.06 });
    const ys = scaleLinear({ domain: [0, maxBin], range: [innerH, 0] });

    const pct = cfg.percentiles || {};
    const pctX = name => pad.left + (innerW * (pct[name] - cfg.xMin)) / (cfg.xMax - cfg.xMin);

    const unit = cfg.xUnit || "";
    const xLabels = [0, 0.2, 0.4, 0.6, 0.8, 1.0].map(t => Math.round(cfg.xMin + (cfg.xMax - cfg.xMin) * t) + unit);

    createRoot(el).render(
        h("svg", { width: w, height: hPx, style: { display: "block" } },
            // Bars
            h(Group, { left: pad.left, top: pad.top },
                bins.map((v, i) => h(Bar, {
                    key: i,
                    x: xs(i), y: ys(v),
                    width: xs.bandwidth(),
                    height: innerH - ys(v),
                    fill: C.brand,
                    fillOpacity: 0.4 + 0.6 * (v / maxBin),
                    rx: 1,
                })),
            ),
            // Percentile guides
            ["p50", "p90", "p99"].filter(p => pct[p] != null).map(p => {
                const x = pctX(p);
                const isLast = p === "p99";
                return h("g", { key: p },
                    h(Line, {
                        from: { x, y: pad.top }, to: { x, y: pad.top + innerH },
                        stroke: isLast ? C.neg : C.ink3,
                        strokeWidth: 1, strokeDasharray: "2 2",
                    }),
                    h("text", {
                        x, y: pad.top - 6, textAnchor: "middle",
                        fontFamily: MONO_FONT, fontSize: 10,
                        fill: isLast ? C.neg : C.ink3,
                    }, p),
                );
            }),
            // x axis ticks
            xLabels.map((t, i) => h("text", {
                key: `x${i}`,
                x: pad.left + (innerW * i) / (xLabels.length - 1),
                y: hPx - 6,
                textAnchor: i === 0 ? "start" : i === xLabels.length - 1 ? "end" : "middle",
                fontFamily: MONO_FONT, fontSize: 10, fill: C.ink4,
            }, t)),
        ),
    );
}

// ---------------------------------------------------------------------------
// Annotated line — trend with vertical event markers.
// data-spec-annotated='{"series":[120,118,...], "yMax":260, "yMin":120,
//   "annotations":[{"at":0.23,"kind":"deploy"},{"at":0.27,"kind":"incident","callout":"260ms"}],
//   "xTicks":["Aug 14",...]}'
// ---------------------------------------------------------------------------
function renderAnnotated(el) {
    const cfg = JSON.parse(el.getAttribute("data-spec-annotated"));
    const data = cfg.series || [];
    const ann  = cfg.annotations || [];
    const [w, hPx] = size(el, 160);
    const pad = { left: 40, right: 8, top: 14, bottom: 24 };
    const innerW = w - pad.left - pad.right;
    const innerH = hPx - pad.top - pad.bottom;
    const xs = scaleLinear({ domain: [0, data.length - 1], range: [0, innerW] });
    const yMin = cfg.yMin != null ? cfg.yMin : Math.min(...data);
    const yMax = cfg.yMax != null ? cfg.yMax : Math.max(...data);
    const yUnit = cfg.yUnit != null ? cfg.yUnit : "ms";
    const ys = scaleLinear({ domain: [yMin, yMax], range: [innerH, 0] });

    const kindColor = { deploy: C.brand, incident: C.neg, release: C.brand, note: C.ink3 };
    const spikeIdx = data.indexOf(Math.max(...data));

    createRoot(el).render(
        h("svg", { width: w, height: hPx, style: { display: "block" } },
            // Annotation guide lines (drawn underneath)
            ann.map((a, i) => h(Line, {
                key: `ag${i}`,
                from: { x: pad.left + a.at * innerW, y: pad.top },
                to:   { x: pad.left + a.at * innerW, y: pad.top + innerH },
                stroke: kindColor[a.kind] || C.ink3,
                strokeWidth: 1,
                strokeOpacity: a.kind === "incident" ? 0.7 : 0.45,
            })),
            // y axis labels
            h("text", { x: pad.left - 6, y: pad.top + 8,           textAnchor: "end", fontFamily: MONO_FONT, fontSize: 9.5, fill: C.ink4 }, `${yMax}${yUnit}`),
            h("text", { x: pad.left - 6, y: pad.top + innerH/2,    textAnchor: "end", fontFamily: MONO_FONT, fontSize: 9.5, fill: C.ink4 }, `${Math.round((yMin + yMax)/2)}${yUnit}`),
            h("text", { x: pad.left - 6, y: pad.top + innerH,      textAnchor: "end", fontFamily: MONO_FONT, fontSize: 9.5, fill: C.ink4 }, `${yMin}${yUnit}`),
            // baseline + axes
            h(Line, { from: { x: pad.left, y: pad.top + innerH }, to: { x: pad.left + innerW, y: pad.top + innerH }, stroke: C.rule }),
            h(Line, { from: { x: pad.left, y: pad.top }, to: { x: pad.left, y: pad.top + innerH }, stroke: C.rule }),
            // Trend line
            h(Group, { left: pad.left, top: pad.top },
                h(LinePath, {
                    data, x: (_, i) => xs(i), y: d => ys(d),
                    stroke: C.brand, strokeWidth: 1.8, curve: curveMonotoneX,
                }),
                // Spike vertex highlight
                spikeIdx >= 0 && h(Circle, {
                    cx: xs(spikeIdx), cy: ys(data[spikeIdx]),
                    r: 3, fill: C.neg, stroke: C.paper, strokeWidth: 1,
                }),
            ),
            // Annotation pins on the top edge
            ann.map((a, i) => h("rect", {
                key: `ap${i}`,
                x: pad.left + a.at * innerW - 5, y: pad.top - 5,
                width: 10, height: 10,
                fill: kindColor[a.kind] || C.ink3,
                stroke: C.paper, strokeWidth: 2,
            })),
            // Callout label
            ann.filter(a => a.callout).map((a, i) => h("g", { key: `ac${i}` },
                h("rect", {
                    x: pad.left + a.at * innerW + 6, y: pad.top + 8,
                    width: 86, height: 16, rx: 2,
                    fill: kindColor[a.kind] || C.ink3,
                }),
                h("text", {
                    x: pad.left + a.at * innerW + 49, y: pad.top + 20,
                    textAnchor: "middle",
                    fontFamily: MONO_FONT, fontSize: 10, fontWeight: 600, fill: C.paper,
                }, a.callout),
            )),
            // x ticks
            (cfg.xTicks || []).map((t, i, arr) => h("text", {
                key: `xt${i}`,
                x: pad.left + (innerW * i) / (arr.length - 1),
                y: hPx - 6,
                textAnchor: i === 0 ? "start" : i === arr.length - 1 ? "end" : "middle",
                fontFamily: MONO_FONT, fontSize: 10, fill: C.ink4,
            }, t)),
        ),
    );
}

// ---------------------------------------------------------------------------
// Tornado — bidirectional bars sorted by max(|down|, |up|).
// data-spec-tornado='{"drivers":[{"label":"x","down":-28,"up":34}], "max":40}'
// ---------------------------------------------------------------------------
function renderTornado(el) {
    const cfg = JSON.parse(el.getAttribute("data-spec-tornado"));
    const drivers = cfg.drivers || [];
    const max = cfg.max || Math.max(...drivers.flatMap(d => [Math.abs(d.down), Math.abs(d.up)]));
    const [w, hPx] = size(el, 24 * drivers.length + 12);
    const pad = { left: 130, right: 12, top: 4, bottom: 4 };
    const innerW = w - pad.left - pad.right;
    const rowH = (hPx - pad.top - pad.bottom) / drivers.length;
    const center = pad.left + innerW / 2;
    const scale = (innerW / 2) / max;

    createRoot(el).render(
        h("svg", { width: w, height: hPx, style: { display: "block" } },
            drivers.map((d, i) => {
                const y = pad.top + i * rowH;
                const barH = Math.min(rowH - 8, 14);
                const barY = y + (rowH - barH) / 2;
                const downW = Math.abs(d.down) * scale;
                const upW   = d.up * scale;
                return h("g", { key: i },
                    h("text", {
                        x: pad.left - 10, y: barY + barH * 0.72,
                        textAnchor: "end",
                        fontFamily: MONO_FONT, fontSize: 11.5, fill: C.ink,
                    }, d.label),
                    // background track
                    h("rect", { x: pad.left, y: barY, width: innerW, height: barH, fill: C.paper2 }),
                    // down bar (left of center)
                    h("rect", { x: center - downW, y: barY, width: downW, height: barH, fill: C.neg, fillOpacity: 0.6 }),
                    // up bar (right of center)
                    h("rect", { x: center, y: barY, width: upW, height: barH, fill: C.pos }),
                    // center anchor line
                    h(Line, { from: { x: center, y: barY - 2 }, to: { x: center, y: barY + barH + 2 }, stroke: C.ink, strokeWidth: 1 }),
                );
            }),
        ),
    );
}

// ---------------------------------------------------------------------------
// Scatter — predicted-vs-actual style. Optional diagonal reference line.
// data-spec-scatter='{"points":[{"x":12,"y":11.4},...], "xMin":0,"xMax":50,
//                     "yMin":0,"yMax":50, "diagonal":true,
//                     "xLabel":"predicted","yLabel":"actual"}'
// ---------------------------------------------------------------------------
function renderScatter(el) {
    const cfg = JSON.parse(el.getAttribute("data-spec-scatter"));
    const pts = cfg.points || [];
    const [w, hPx] = size(el, 200);
    const pad = { left: 40, right: 12, top: 14, bottom: 26 };
    const innerW = w - pad.left - pad.right;
    const innerH = hPx - pad.top - pad.bottom;
    const xMin = cfg.xMin != null ? cfg.xMin : Math.min(...pts.map(p => p.x));
    const xMax = cfg.xMax != null ? cfg.xMax : Math.max(...pts.map(p => p.x));
    const yMin = cfg.yMin != null ? cfg.yMin : Math.min(...pts.map(p => p.y));
    const yMax = cfg.yMax != null ? cfg.yMax : Math.max(...pts.map(p => p.y));
    const xs = scaleLinear({ domain: [xMin, xMax], range: [0, innerW] });
    const ys = scaleLinear({ domain: [yMin, yMax], range: [innerH, 0] });

    createRoot(el).render(
        h("svg", { width: w, height: hPx, style: { display: "block" } },
            // Subtle gridlines at 25% / 50% / 75%
            [0.25, 0.5, 0.75].map((t, i) => h("g", { key: `g${i}` },
                h(Line, {
                    from: { x: pad.left, y: pad.top + innerH * (1 - t) },
                    to:   { x: pad.left + innerW, y: pad.top + innerH * (1 - t) },
                    stroke: C.rule, strokeWidth: 1, strokeDasharray: "2 3",
                }),
                h(Line, {
                    from: { x: pad.left + innerW * t, y: pad.top },
                    to:   { x: pad.left + innerW * t, y: pad.top + innerH },
                    stroke: C.rule, strokeWidth: 1, strokeDasharray: "2 3",
                }),
            )),
            // y-axis tick labels
            [yMin, (yMin + yMax) / 2, yMax].map((v, i, arr) => h("text", {
                key: `yt${i}`,
                x: pad.left - 6,
                y: pad.top + innerH * (1 - (v - yMin) / (yMax - yMin)) + 3,
                textAnchor: "end",
                fontFamily: MONO_FONT, fontSize: 9.5, fill: C.ink4,
            }, Math.round(v).toString())),
            // Diagonal reference (y = x)
            cfg.diagonal !== false && h(Line, {
                from: { x: pad.left + xs(Math.max(xMin, yMin)), y: pad.top + ys(Math.max(xMin, yMin)) },
                to:   { x: pad.left + xs(Math.min(xMax, yMax)), y: pad.top + ys(Math.min(xMax, yMax)) },
                stroke: C.brand, strokeWidth: 1, strokeDasharray: "4 3", strokeOpacity: 0.5,
            }),
            // Axes
            h(Line, { from: { x: pad.left, y: pad.top + innerH }, to: { x: pad.left + innerW, y: pad.top + innerH }, stroke: C.rule }),
            h(Line, { from: { x: pad.left, y: pad.top }, to: { x: pad.left, y: pad.top + innerH }, stroke: C.rule }),
            // Points
            h(Group, { left: pad.left, top: pad.top },
                pts.map((p, i) => {
                    const err = Math.abs(p.x - p.y) / (xMax - xMin);
                    const isMiss = err > 0.12;
                    return h(Circle, {
                        key: i,
                        cx: xs(p.x), cy: ys(p.y), r: isMiss ? 3.2 : 2.6,
                        fill: isMiss ? C.neg : C.brand,
                        fillOpacity: isMiss ? 0.85 : 0.6,
                        stroke: C.paper, strokeWidth: 0.6,
                    });
                }),
            ),
            // Axis labels
            cfg.xLabel && h("text", {
                x: pad.left + innerW / 2, y: hPx - 4,
                textAnchor: "middle",
                fontFamily: MONO_FONT, fontSize: 10, fontWeight: 600, fill: C.ink4,
            }, cfg.xLabel),
            cfg.yLabel && h("text", {
                x: -(pad.top + innerH / 2), y: 12,
                textAnchor: "middle",
                transform: "rotate(-90)",
                fontFamily: MONO_FONT, fontSize: 10, fontWeight: 600, fill: C.ink4,
            }, cfg.yLabel),
        ),
    );
}

// ---------------------------------------------------------------------------
// Bar — single-series vertical bars.
// data-spec-bar='[v1, v2, …]'
// ---------------------------------------------------------------------------
function renderBar(el) {
    const data = JSON.parse(el.getAttribute("data-spec-bar"));
    const [w, hPx] = size(el, 80);
    const pad = { left: 4, right: 4, top: 4, bottom: 4 };
    const innerW = w - pad.left - pad.right;
    const innerH = hPx - pad.top - pad.bottom;
    const xs = scaleBand({ domain: data.map((_, i) => i), range: [0, innerW], padding: 0.18 });
    const ys = scaleLinear({ domain: [0, Math.max(...data)], range: [innerH, 0] });
    createRoot(el).render(
        h("svg", { width: w, height: hPx, style: { display: "block" } },
            h(Group, { left: pad.left, top: pad.top },
                data.map((v, i) => h(Bar, {
                    key: i, x: xs(i), y: ys(v), width: xs.bandwidth(),
                    height: innerH - ys(v), fill: C.brand, rx: 1,
                })),
            ),
        ),
    );
}

// ---------------------------------------------------------------------------
// BarGroup — multi-series grouped bars.
// data-spec-bargroup='{"groups":[[v1a,v1b,v1c],[v2a,v2b,v2c],…],"strokes":["#…","#…","#…"]}'
// ---------------------------------------------------------------------------
function renderBarGroup(el) {
    const cfg = JSON.parse(el.getAttribute("data-spec-bargroup"));
    const groups = cfg.groups;
    const strokes = cfg.strokes || [C.brand, C.pos, C.ink4];
    const [w, hPx] = size(el, 80);
    const pad = { left: 4, right: 4, top: 4, bottom: 4 };
    const innerW = w - pad.left - pad.right;
    const innerH = hPx - pad.top - pad.bottom;
    const xs = scaleBand({ domain: groups.map((_, i) => i), range: [0, innerW], padding: 0.2 });
    const allMax = Math.max(...groups.flat());
    const ys = scaleLinear({ domain: [0, allMax], range: [innerH, 0] });
    const seriesN = groups[0].length;
    const subW = xs.bandwidth() / seriesN;
    createRoot(el).render(
        h("svg", { width: w, height: hPx, style: { display: "block" } },
            h(Group, { left: pad.left, top: pad.top },
                groups.flatMap((row, gi) => row.map((v, si) => h(Bar, {
                    key: `${gi}-${si}`,
                    x: xs(gi) + si * subW + 1,
                    y: ys(v),
                    width: subW - 2,
                    height: innerH - ys(v),
                    fill: strokes[si % strokes.length],
                    rx: 1,
                }))),
            ),
        ),
    );
}

// ---------------------------------------------------------------------------
// Area — filled-area line chart.
// data-spec-area='[v1, v2, …]'
// ---------------------------------------------------------------------------
function renderArea(el) {
    const data = JSON.parse(el.getAttribute("data-spec-area"));
    const stroke = el.dataset.stroke || C.brand;
    const [w, hPx] = size(el, 80);
    const pad = { left: 2, right: 2, top: 4, bottom: 16 };
    const innerW = w - pad.left - pad.right;
    const innerH = hPx - pad.top - pad.bottom;
    const xs = scaleLinear({ domain: [0, data.length - 1], range: [0, innerW] });
    const min = Math.min(...data), max = Math.max(...data);
    const ys = scaleLinear({ domain: [min, max], range: [innerH, 0] });
    createRoot(el).render(
        h("svg", { width: w, height: hPx, style: { display: "block" } },
            h(Group, { left: pad.left, top: pad.top },
                h(AreaClosed, {
                    data, x: (_, i) => xs(i), y: d => ys(d),
                    yScale: ys, fill: stroke, fillOpacity: 0.18, curve: curveMonotoneX, strokeWidth: 0,
                }),
                h(LinePath, {
                    data, x: (_, i) => xs(i), y: d => ys(d),
                    stroke, strokeWidth: 1.6, curve: curveMonotoneX,
                }),
                h(Line, { from: { x: 0, y: innerH }, to: { x: innerW, y: innerH }, stroke: C.rule, strokeWidth: 1 }),
            ),
        ),
    );
}

// ---------------------------------------------------------------------------
// AreaRange — band between two bounding lines (forecast confidence).
// data-spec-arearange='{"lo":[…],"hi":[…],"mid":[…]}'
// ---------------------------------------------------------------------------
// data-spec-arearange='{"lo":[…],"hi":[…],"mid":[…], "xTicks":["0h",…], "yTicks":["0","+3","+6"], "zero":0, "tone":"pos"}'
// xTicks / yTicks / zero / tone are all optional; without them it draws a bare band (back-compatible).
function renderAreaRange(el) {
    const cfg = JSON.parse(el.getAttribute("data-spec-arearange"));
    const { lo, hi, mid } = cfg;
    const xTicks = cfg.xTicks || [];
    const yTicks = cfg.yTicks || [];           // [min, mid, max] as strings
    const marks = cfg.marks || [];             // [{ at: dataIndex, label, tone }] vertical reference lines
    const tone = cfg.tone === "pos" ? C.pos : cfg.tone === "neg" ? C.neg : C.brand;
    const markCol = m => m.tone === "pos" ? C.pos : m.tone === "neg" ? C.neg : C.ink4;
    const [w, hPx] = size(el, 100);
    const pad = { left: yTicks.length ? 30 : 4, right: 8, top: marks.length ? 16 : 8, bottom: xTicks.length ? 22 : 12 };
    const innerW = w - pad.left - pad.right;
    const innerH = hPx - pad.top - pad.bottom;
    const xs = scaleLinear({ domain: [0, lo.length - 1], range: [0, innerW] });
    const allMin = Math.min(...lo, cfg.zero != null ? cfg.zero : Infinity);
    const allMax = Math.max(...hi);
    const ys = scaleLinear({ domain: [allMin, allMax], range: [innerH, 0] });
    const bandPath = [
        ...hi.map((v, i) => `${i === 0 ? "M" : "L"} ${xs(i)} ${ys(v)}`),
        ...lo.slice().reverse().map((v, i) => `L ${xs(lo.length - 1 - i)} ${ys(v)}`),
        "Z",
    ].join(" ");
    createRoot(el).render(
        h("svg", { width: w, height: hPx, style: { display: "block", fontFamily: MONO_FONT } },
            h(Group, { left: pad.left, top: pad.top },
                // y axis hairline + ticks
                h(Line, { from: { x: 0, y: 0 }, to: { x: 0, y: innerH }, stroke: C.rule, strokeWidth: 1 }),
                yTicks.length === 3 && [
                    h("text", { key: "yt2", x: -6, y: 8,            textAnchor: "end", fontSize: 9, fill: C.ink4 }, yTicks[2]),
                    h("text", { key: "yt1", x: -6, y: innerH / 2 + 3, textAnchor: "end", fontSize: 9, fill: C.ink4 }, yTicks[1]),
                    h("text", { key: "yt0", x: -6, y: innerH,       textAnchor: "end", fontSize: 9, fill: C.ink4 }, yTicks[0]),
                ],
                // zero reference (e.g. "no effect" on a sensitivity curve)
                cfg.zero != null && h(Line, { from: { x: 0, y: ys(cfg.zero) }, to: { x: innerW, y: ys(cfg.zero) }, stroke: C.ink4, strokeWidth: 1, strokeDasharray: "3 2" }),
                h("path", { d: bandPath, fill: tone, fillOpacity: 0.16 }),
                mid && h(LinePath, { data: mid, x: (_, i) => xs(i), y: d => ys(d), stroke: tone, strokeWidth: 1.7, curve: curveMonotoneX }),
                // vertical reference markers (e.g. "now", "sweet spot")
                marks.map((m, i) => h(Group, { key: `mk${i}`, left: xs(m.at) },
                    h(Line, { from: { x: 0, y: -2 }, to: { x: 0, y: innerH }, stroke: markCol(m), strokeWidth: 1, strokeDasharray: "2 3" }),
                    mid && h(Circle, { cx: 0, cy: ys(mid[m.at]), r: 3.5, fill: markCol(m), stroke: "#fff", strokeWidth: 1.5 }),
                    h("text", { x: 0, y: -6, textAnchor: m.at >= lo.length - 2 ? "end" : m.at <= 1 ? "start" : "middle", fontSize: 8.5, fontWeight: 600, fill: markCol(m) }, m.label),
                )),
                // x axis baseline + ticks
                h(Line, { from: { x: 0, y: innerH }, to: { x: innerW, y: innerH }, stroke: C.rule, strokeWidth: 1 }),
                xTicks.map((t, i) => h("text", {
                    key: `x${i}`, x: (innerW * i) / (xTicks.length - 1), y: innerH + 14,
                    textAnchor: i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle",
                    fontSize: 9, fill: C.ink4,
                }, t)),
            ),
        ),
    );
}

// ---------------------------------------------------------------------------
// Pie / Donut.
// data-spec-pie='{"slices":[{"value":40,"fill":"#…"},…],"donut":false}'
// ---------------------------------------------------------------------------
function renderPie(el) {
    const cfg = JSON.parse(el.getAttribute("data-spec-pie"));
    const slices = cfg.slices;
    const donut = !!cfg.donut;
    const [w, hPx] = size(el, 100);
    const r = Math.min(w, hPx) / 2 - 4;
    const cx = w / 2, cy = hPx / 2;
    const total = slices.reduce((a, s) => a + s.value, 0);
    let acc = -Math.PI / 2;
    const paths = slices.map((s, i) => {
        const a0 = acc;
        const a1 = acc + (s.value / total) * Math.PI * 2;
        acc = a1;
        const large = (a1 - a0) > Math.PI ? 1 : 0;
        const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
        const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
        const d = `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
        return { d, fill: s.fill || [C.brand, C.pos, C.ink4, C.warn][i % 4] };
    });
    createRoot(el).render(
        h("svg", { width: w, height: hPx, style: { display: "block" } },
            paths.map((p, i) => h("path", { key: i, d: p.d, fill: p.fill })),
            donut && h("circle", { cx, cy, r: r * 0.55, fill: C.paper }),
        ),
    );
}

// ---------------------------------------------------------------------------
// Radar — N-axis polygon.
// data-spec-radar='{"axes":["lat","cost","acc","rec","cov"],"values":[0.7,0.5,0.85,0.6,0.55]}'
// ---------------------------------------------------------------------------
function renderRadar(el) {
    const cfg = JSON.parse(el.getAttribute("data-spec-radar"));
    const axes = cfg.axes, values = cfg.values;
    const N = axes.length;
    const [w, hPx] = size(el, 140);
    const cx = w / 2, cy = hPx / 2 + 4;
    const r = Math.min(w, hPx) / 2 - 22;
    const angle = i => -Math.PI / 2 + (i / N) * Math.PI * 2;
    const point = (v, i) => [cx + v * r * Math.cos(angle(i)), cy + v * r * Math.sin(angle(i))];
    const polygon = vals => vals.map((v, i) => point(v, i).join(",")).join(" ");
    createRoot(el).render(
        h("svg", { width: w, height: hPx, style: { display: "block" } },
            [1, 0.66, 0.33].map((s, i) => h("polygon", {
                key: `g${i}`,
                points: polygon(Array(N).fill(s)),
                fill: "none", stroke: C.rule, strokeWidth: 1,
            })),
            axes.map((_, i) => {
                const [x, y] = point(1, i);
                return h(Line, { key: `ax${i}`, from: { x: cx, y: cy }, to: { x, y }, stroke: C.rule, strokeWidth: 1 });
            }),
            h("polygon", { points: polygon(values), fill: C.brand, fillOpacity: 0.18, stroke: C.brand, strokeWidth: 1.6 }),
            axes.map((label, i) => {
                const [x, y] = point(1.18, i);
                return h("text", {
                    key: `l${i}`, x, y, textAnchor: "middle",
                    fontFamily: MONO_FONT, fontSize: 9, fill: C.ink4,
                }, label);
            }),
        ),
    );
}

// ---------------------------------------------------------------------------
// Composed — bars + line on shared axes.
// data-spec-composed='{"bars":[…],"line":[…]}'
// ---------------------------------------------------------------------------
function renderComposed(el) {
    const cfg = JSON.parse(el.getAttribute("data-spec-composed"));
    const bars = cfg.bars, line = cfg.line;
    const [w, hPx] = size(el, 80);
    const pad = { left: 4, right: 4, top: 4, bottom: 4 };
    const innerW = w - pad.left - pad.right;
    const innerH = hPx - pad.top - pad.bottom;
    const xs = scaleBand({ domain: bars.map((_, i) => i), range: [0, innerW], padding: 0.18 });
    const allMax = Math.max(...bars, ...line);
    const ys = scaleLinear({ domain: [0, allMax], range: [innerH, 0] });
    const xLine = scaleLinear({ domain: [0, line.length - 1], range: [xs.bandwidth() / 2, innerW - xs.bandwidth() / 2] });
    createRoot(el).render(
        h("svg", { width: w, height: hPx, style: { display: "block" } },
            h(Group, { left: pad.left, top: pad.top },
                bars.map((v, i) => h(Bar, {
                    key: i, x: xs(i), y: ys(v), width: xs.bandwidth(),
                    height: innerH - ys(v), fill: C.brand, fillOpacity: 0.55, rx: 1,
                })),
                h(LinePath, {
                    data: line, x: (_, i) => xLine(i), y: d => ys(d),
                    stroke: C.pos, strokeWidth: 1.8, curve: curveMonotoneX,
                }),
            ),
        ),
    );
}

// ---------------------------------------------------------------------------
// Forest — horizontal effect estimates with confidence intervals + a zero
// ("no effect") reference line. Built for the Experiment surface: compare a
// naive estimate against an adjusted one and see whether each interval clears
// zero. Each row: { label, est, lo, hi, tone: brand|neg|pos|muted, note }.
// data-spec-forest='{"rows":[{"label":"Raw","est":-3.1,"lo":-6,"hi":-0.1,"tone":"neg","note":"looks worse"}],"min":-8,"max":9,"unit":"colour units"}'
// ---------------------------------------------------------------------------
function renderForest(el) {
    const cfg = JSON.parse(el.getAttribute("data-spec-forest"));
    const rows = cfg.rows, n = rows.length;
    const SANS = "system-ui, -apple-system, sans-serif";
    const [w, hPx] = size(el, 26 + n * 38);
    const padL = 146, padR = 58, padT = 16, padB = 30;   // padB holds the x-axis row
    const innerW = w - padL - padR;
    const innerH = hPx - padT - padB;
    const xs = scaleLinear({ domain: [cfg.min, cfg.max], range: [0, innerW] });
    const rowH = innerH / n;
    const zeroX = xs(0);
    const tone = t => t === "neg" ? C.neg : t === "pos" ? C.pos : t === "muted" ? C.ink4 : C.brand;
    const axisTicks = [cfg.min, 0, cfg.max];
    createRoot(el).render(
        h("svg", { width: w, height: hPx, style: { display: "block", fontFamily: MONO_FONT } },
            h(Group, { left: padL, top: padT },
                // zero ("no effect") reference, full plot height
                h(Line, { from: { x: zeroX, y: -4 }, to: { x: zeroX, y: innerH }, stroke: C.ink4, strokeWidth: 1, strokeDasharray: "3 2" }),
                h("text", { x: zeroX, y: -7, textAnchor: "middle", fontSize: 8, fill: C.ink4, letterSpacing: "0.06em" }, "no effect"),
                // estimate rows
                rows.map((r, i) => {
                    const cy = rowH * i + rowH / 2;
                    const col = tone(r.tone);
                    return h(Group, { key: i, top: cy },
                        h(Line, { from: { x: xs(r.lo), y: 0 }, to: { x: xs(r.hi), y: 0 }, stroke: col, strokeWidth: 3, strokeOpacity: 0.9, strokeLinecap: "round" }),
                        h(Line, { from: { x: xs(r.lo), y: -4 }, to: { x: xs(r.lo), y: 4 }, stroke: col, strokeWidth: 1.5 }),
                        h(Line, { from: { x: xs(r.hi), y: -4 }, to: { x: xs(r.hi), y: 4 }, stroke: col, strokeWidth: 1.5 }),
                        h(Circle, { cx: xs(r.est), cy: 0, r: 5.5, fill: col, stroke: "#fff", strokeWidth: 2 }),
                        h("text", { x: -padL + 2, y: -2, fontSize: 12, fontWeight: 600, fill: C.ink, fontFamily: SANS }, r.label),
                        h("text", { x: -padL + 2, y: 12, fontSize: 9.5, fill: C.ink4, fontFamily: SANS }, r.note || ""),
                        h("text", { x: innerW + padR - 2, y: 4, textAnchor: "end", fontSize: 15, fontWeight: 700, fill: col }, (r.est > 0 ? "+" : "") + r.est),
                    );
                }),
                // x axis baseline + min / 0 / max ticks
                h(Line, { from: { x: 0, y: innerH }, to: { x: innerW, y: innerH }, stroke: C.rule, strokeWidth: 1 }),
                axisTicks.map((t, i) => h(Group, { key: `t${i}`, left: xs(t) },
                    h(Line, { from: { x: 0, y: innerH }, to: { x: 0, y: innerH + 4 }, stroke: C.ruleStrong, strokeWidth: 1 }),
                    h("text", { x: 0, y: innerH + 15, textAnchor: i === 0 ? "start" : i === axisTicks.length - 1 ? "end" : "middle", fontSize: 9, fill: C.ink4 }, (t > 0 ? "+" : "") + t),
                )),
                cfg.unit && h("text", { x: innerW, y: innerH + 27, textAnchor: "end", fontSize: 8.5, fill: C.ink5, fontFamily: SANS, fontStyle: "italic" }, cfg.unit),
            ),
        ),
    );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
const renderers = {
    "data-spec-forest":     renderForest,
    "data-spec-spark":      renderSpark,
    "data-spec-multiline":  renderMultiline,
    "data-spec-histogram":  renderHistogram,
    "data-spec-annotated":  renderAnnotated,
    "data-spec-tornado":    renderTornado,
    "data-spec-scatter":    renderScatter,
    "data-spec-bar":        renderBar,
    "data-spec-bargroup":   renderBarGroup,
    "data-spec-area":       renderArea,
    "data-spec-arearange":  renderAreaRange,
    "data-spec-pie":        renderPie,
    "data-spec-radar":      renderRadar,
    "data-spec-composed":   renderComposed,
};

// Render every hook inside `root`, once per element. Skips elements already
// mounted so it is safe to call repeatedly (e.g. when a hidden tab is first
// revealed and its charts finally have a measurable width).
function mountIn(root) {
    for (const [attr, fn] of Object.entries(renderers)) {
        root.querySelectorAll(`[${attr}]`).forEach(el => {
            if (el.__specMounted) return;
            el.__specMounted = true;
            try { fn(el); } catch (e) { console.error(`charts-visx: ${attr} failed`, e, el); }
        });
    }
}

function mountAll() {
    for (const [attr, fn] of Object.entries(renderers)) {
        document.querySelectorAll(`[${attr}]`).forEach(el => {
            // Defer hidden elements (e.g. inactive tab panes) — they have zero
            // width now and would render blank. The host re-mounts them via
            // window.__specCharts.mountIn(pane) when they become visible.
            if (el.offsetParent === null) return;
            if (el.__specMounted) return;
            el.__specMounted = true;
            try { fn(el); } catch (e) { console.error(`charts-visx: ${attr} failed`, e, el); }
        });
    }
}

// Exposed so a host page can render charts inside a pane the moment it is shown.
window.__specCharts = { mountAll, mountIn };

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountAll);
} else {
    mountAll();
}
