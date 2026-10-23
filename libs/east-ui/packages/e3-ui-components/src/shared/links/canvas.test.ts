/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The links' look on a Canvas2D surface (#1403, `canvas.ts`), over a context
 * that records each stroke, fill and text it draws — its style, its width, its
 * dash, its alpha and its path's ops — so what the painter draws is read
 * without pixels: every casing under every ink, each head at its route's far
 * end, the captions on their knockouts, the selected link and the lit one drawn
 * last with the rings round their ends, a tone recolouring a link's ink, and
 * each corner a circle's, clamped to half of each run beside it.
 */

import { describe, expect, test } from "vitest";
import { arrive, paintLinks, traceRoute, type CanvasLink, type CanvasLinkLook, type CanvasPoint } from "./canvas.js";

/** One path op as the context took it. */
type Op = readonly [string, ...number[]];

/** One stroke, fill or text as the context drew it: its style, its width, its dash, its alpha and its path's ops. */
interface Drawn {
    readonly op: "stroke" | "fill" | "text";
    readonly style: string;
    readonly width: number;
    readonly dash: readonly number[];
    readonly alpha: number;
    readonly path: readonly Op[];
    readonly text?: string;
    readonly at?: CanvasPoint;
}

/** A context that records what is drawn on it; each letter of its text is 6px wide. */
function recorder(): { ctx: CanvasRenderingContext2D; drawn: Drawn[] } {
    const drawn: Drawn[] = [];
    let state = { strokeStyle: "", fillStyle: "", lineWidth: 1, globalAlpha: 1, dash: [] as number[], font: "" };
    const saved: (typeof state)[] = [];
    let path: Op[] = [];
    const record = (op: "stroke" | "fill") => drawn.push({
        op, style: op === "stroke" ? state.strokeStyle : state.fillStyle, width: state.lineWidth, dash: [...state.dash], alpha: state.globalAlpha, path: [...path],
    });
    const ctx = {
        get strokeStyle() { return state.strokeStyle; }, set strokeStyle(v: string) { state.strokeStyle = v; },
        get fillStyle() { return state.fillStyle; }, set fillStyle(v: string) { state.fillStyle = v; },
        get lineWidth() { return state.lineWidth; }, set lineWidth(v: number) { state.lineWidth = v; },
        get globalAlpha() { return state.globalAlpha; }, set globalAlpha(v: number) { state.globalAlpha = v; },
        get font() { return state.font; }, set font(v: string) { state.font = v; },
        lineJoin: "miter", lineCap: "butt", textAlign: "start", textBaseline: "alphabetic",
        save() { saved.push({ ...state, dash: [...state.dash] }); },
        restore() { state = saved.pop() ?? state; },
        setLineDash(dash: number[]) { state.dash = [...dash]; },
        beginPath() { path = []; },
        moveTo(x: number, y: number) { path.push(["moveTo", x, y]); },
        lineTo(x: number, y: number) { path.push(["lineTo", x, y]); },
        arcTo(x1: number, y1: number, x2: number, y2: number, r: number) { path.push(["arcTo", x1, y1, x2, y2, r]); },
        arc(x: number, y: number, r: number) { path.push(["arc", x, y, r]); },
        rect(x: number, y: number, w: number, h: number) { path.push(["rect", x, y, w, h]); },
        roundRect(x: number, y: number, w: number, h: number, r: number) { path.push(["roundRect", x, y, w, h, r]); },
        closePath() { path.push(["closePath"]); },
        stroke() { record("stroke"); },
        fill() { record("fill"); },
        fillText(text: string, x: number, y: number) {
            drawn.push({ op: "text", style: state.fillStyle, width: 0, dash: [], alpha: state.globalAlpha, path: [], text, at: { x, y } });
        },
        measureText(text: string) { return { width: text.length * 6 }; },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn };
}

/** The look, each part a colour of its own. */
const LOOK: CanvasLinkLook = {
    casing: "paper", ink: "muted", strong: "strong", ring: "ring", ringWidth: 1, knockout: "knockout", outline: "outline", caption: "caption", captionFont: "500 10px mono",
};

/** A run from A's edge to B's: straight, 2 wide, arriving at (100, 20). */
const ROUTE: CanvasPoint[] = [{ x: 20, y: 20 }, { x: 100, y: 20 }];

/** A link over a route, arriving with its head; its parts as given. */
function link(id: string, route: readonly CanvasPoint[], over: Partial<CanvasLink> = {}): CanvasLink {
    const arrived = arrive(route, 2)!;
    return {
        id, strokes: [{ points: arrived.line, width: 2, corner: 8 }], heads: [arrived.head], dots: [], dash: [], ink: undefined, alpha: 1,
        lit: false, selected: false, ends: [], caption: undefined, ...over,
    };
}

/** The painted strokes of a style, as `[style, width]`. */
const strokes = (drawn: readonly Drawn[]) => drawn.filter((d) => d.op === "stroke").map((d) => [d.style, d.width] as const);

describe("arrive", () => {
    test("a route arrives with its head's tip at its last point, its base 8 back along it, the line ending at the base", () => {
        const arrived = arrive(ROUTE, 2)!;
        expect(arrived.head).toEqual({ tip: { x: 100, y: 20 }, base: { x: 92, y: 20 }, half: 4 });
        expect(arrived.line).toEqual([{ x: 20, y: 20 }, { x: 92, y: 20 }]);
        // A heavy link's head is twice its weight wide.
        expect(arrive(ROUTE, 6)!.head.half).toBe(6);
    });

    test("a head walks back past a corner a last run shorter than it, and a route shorter than a head is all head", () => {
        const arrived = arrive([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 5 }], 2)!;
        expect(arrived.head.base).toEqual({ x: 47, y: 0 });
        expect(arrived.line).toEqual([{ x: 0, y: 0 }, { x: 47, y: 0 }]);
        expect(arrive([{ x: 0, y: 0 }, { x: 5, y: 0 }], 2)).toEqual({ line: [], head: { tip: { x: 5, y: 0 }, base: { x: 0, y: 0 }, half: 4 } });
        expect(arrive([{ x: 3, y: 3 }], 2)).toBeUndefined();
    });
});

describe("traceRoute", () => {
    /** The ops a route traces, at a corner's radius. */
    const ops = (points: readonly CanvasPoint[], corner: number): Op[] => {
        const { ctx } = recorder();
        const path: Op[] = [];
        const rec = ctx as unknown as { moveTo: (x: number, y: number) => void; lineTo: (x: number, y: number) => void; arcTo: (...a: number[]) => void };
        rec.moveTo = (x, y) => path.push(["moveTo", x, y]);
        rec.lineTo = (x, y) => path.push(["lineTo", x, y]);
        rec.arcTo = (...a) => path.push(["arcTo", ...a]);
        traceRoute(ctx, points, corner);
        return path;
    };

    test("each corner turns on a circle of the corner's radius, clamped to half of each run beside it", () => {
        expect(ops([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }], 8)).toEqual([["moveTo", 0, 0], ["arcTo", 40, 0, 40, 40, 8], ["lineTo", 40, 40]]);
        // A run of 6 beside the corner: it turns at 3.
        const tight = ops([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 6 }], 8);
        expect(tight[1]![0]).toBe("arcTo");
        expect(tight[1]![5]).toBeCloseTo(3, 9);
    });

    test("a point that turns nothing is passed straight through, and a corner of 0 turns none", () => {
        expect(ops([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 40, y: 0 }], 8)).toEqual([["moveTo", 0, 0], ["lineTo", 20, 0], ["lineTo", 40, 0]]);
        expect(ops([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }], 0)).toEqual([["moveTo", 0, 0], ["lineTo", 40, 0], ["lineTo", 40, 40]]);
    });
});

describe("paintLinks", () => {
    test("every link's casing lies under every link's ink: the paper a px either side of each run, and round each head", () => {
        const { ctx, drawn } = recorder();
        paintLinks(ctx, [link("a", ROUTE), link("b", [{ x: 20, y: 60 }, { x: 100, y: 60 }])], LOOK);
        expect(strokes(drawn)).toEqual([
            // a's casing — its run, 2 + 2, and its head's — then b's; then a's ink, then b's.
            ["paper", 4], ["paper", 2], ["paper", 4], ["paper", 2], ["muted", 2], ["muted", 2],
        ]);
        expect(drawn.filter((d) => d.op === "fill").map((d) => d.style)).toEqual(["paper", "paper", "muted", "muted"]);
    });

    test("each head is drawn at its route's far end: its tip on the last point, its base 8 back, across the line", () => {
        const { ctx, drawn } = recorder();
        paintLinks(ctx, [link("a", ROUTE)], LOOK);
        const head = drawn.filter((d) => d.op === "fill" && d.style === "muted").at(-1)!;
        expect(head.path).toEqual([["moveTo", 92, 24], ["lineTo", 100, 20], ["lineTo", 92, 16], ["closePath"]]);
    });

    test("a caption sits on its paper knockout, 4 either side of its text and 12 tall, over every link; selected, it is outlined", () => {
        const { ctx, drawn } = recorder();
        const caption = { text: "uplink · 100G", x: 60, y: 23 };
        paintLinks(ctx, [link("a", ROUTE, { caption }), link("b", [{ x: 20, y: 60 }, { x: 100, y: 60 }])], LOOK);
        // After both links' inks: the knockout, then the text.
        const inks = drawn.findIndex((d) => d.style === "muted" && d.op === "stroke");
        const knockout = drawn.findIndex((d) => d.style === "knockout");
        expect(knockout).toBeGreaterThan(drawn.map((d) => d.style).lastIndexOf("muted"));
        expect(inks).toBeLessThan(knockout);
        expect(drawn[knockout]!.path).toEqual([["rect", 60 - 39 - 4, 23 - 9.5, 78 + 8, 12]]);
        expect(drawn.at(-1)).toMatchObject({ op: "text", style: "caption", text: "uplink · 100G", at: { x: 60, y: 23 } });
        expect(drawn.some((d) => d.style === "outline")).toBe(false);
        const selected = recorder();
        paintLinks(selected.ctx, [link("a", ROUTE, { caption, selected: true })], LOOK);
        expect(selected.drawn.filter((d) => d.style === "outline").map((d) => [d.op, d.width, d.path])).toEqual([["stroke", 1, [["rect", 17, 13.5, 86, 12]]]]);
    });

    test("the lit link is drawn last, over the selected one, in the strong ink, the ends it joins ringed 1px four outside them", () => {
        const { ctx, drawn } = recorder();
        const ends = [
            { kind: "box" as const, left: 0, top: 10, right: 20, bottom: 30 },
            { kind: "circle" as const, x: 105, y: 20, r: 5 },
        ];
        paintLinks(ctx, [
            link("lit", ROUTE, { lit: true, ends }),
            link("selected", [{ x: 20, y: 60 }, { x: 100, y: 60 }], { selected: true, ends: [] }),
            link("plain", [{ x: 20, y: 90 }, { x: 100, y: 90 }]),
        ], LOOK);
        // The plain link's casing and ink, then the selected one's, then the lit one's — and its rings, last.
        expect(strokes(drawn)).toEqual([
            ["paper", 4], ["paper", 2], ["muted", 2],
            ["paper", 4], ["paper", 2], ["strong", 2],
            ["paper", 4], ["paper", 2], ["strong", 2], ["ring", 1], ["ring", 1],
        ]);
        const rings = drawn.filter((d) => d.style === "ring").map((d) => d.path);
        expect(rings).toEqual([[["roundRect", -4.5, 5.5, 29, 29, 7.5]], [["arc", 105, 20, 9.5]]]);
    });

    test("a tone recolours a link's ink and its head, and a lit link draws in the strong ink whatever its tone", () => {
        const toned = recorder();
        paintLinks(toned.ctx, [link("a", ROUTE, { ink: "warning" })], LOOK);
        expect(toned.drawn.filter((d) => d.style === "warning").map((d) => d.op)).toEqual(["stroke", "fill"]);
        const lit = recorder();
        paintLinks(lit.ctx, [link("a", ROUTE, { ink: "warning", lit: true })], LOOK);
        expect(lit.drawn.some((d) => d.style === "warning")).toBe(false);
    });

    test("a run of its own fades, drains and strengthens apart from its link: a net's leg to context, and its selected leg", () => {
        const { ctx, drawn } = recorder();
        const net: CanvasLink = {
            ...link("feed", ROUTE),
            strokes: [
                { points: ROUTE, width: 2, corner: 8 },
                { points: [{ x: 20, y: 40 }, { x: 60, y: 40 }], width: 2, corner: 8, alpha: 0.35, ink: "muted-drained" },
                { points: [{ x: 20, y: 70 }, { x: 60, y: 70 }], width: 2, corner: 8, strong: true },
            ],
            heads: [], ink: "brand",
        };
        paintLinks(ctx, [net], LOOK);
        expect(drawn.filter((d) => d.op === "stroke" && d.style !== "paper").map((d) => [d.style, d.alpha])).toEqual([
            ["brand", 1], ["muted-drained", 0.35], ["strong", 1],
        ]);
    });

    test("a dashed link dashes its ink, never its casing; a faded link fades every part, its caption among them", () => {
        const { ctx, drawn } = recorder();
        paintLinks(ctx, [link("a", ROUTE, { dash: [6, 5], alpha: 0.35, caption: { text: "x", x: 60, y: 23 } })], LOOK);
        expect(drawn.filter((d) => d.op === "stroke").map((d) => [d.style, d.dash])).toEqual([["paper", []], ["paper", []], ["muted", [6, 5]]]);
        expect(new Set(drawn.map((d) => d.alpha))).toEqual(new Set([0.35]));
    });
});
