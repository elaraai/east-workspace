/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The SnapGrid's editing canvas under test (#990) — ONE page of tiles, built by
 * the east-ui factory and COMPILED over a `State.bind` source the test holds,
 * written through the inline `onUpdate` adapter: the host renders again with
 * its latest value, as a `Reactive` would ({@link EditingSnapGrid.confirm}).
 * With `chrome`, the canvas is the builder's frame (#995): a bound view, the
 * design widths, the host's toolbar items and panes, and each tile's icon and
 * meta.
 *
 * The editing wire is PROBED, never replaced: every patch event is decoded and
 * kept, every apply request's bytes kept, and the real callback answers.
 */

import type { ReactNode } from "react";
import { act, fireEvent, render, waitFor, type RenderResult } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, BooleanType, East, IntegerType, OptionType, StringType, StructType,
    decodeBeast2For, encodeBeast2For, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { DragEventType, Editing, SnapGrid, State, Text, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { getStore } from "../../platform/state-runtime.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { DragLayerProvider, useDragSourceItem } from "../../dnd/drag-layer";
import { pointAt } from "../../dnd/dnd.test-utils.js";
import { EastChakraSnapGrid, type SnapGridValue } from "./index.js";

// ── The page's data ─────────────────────────────────────────────────────────

/** A tile of the page — where it sits, its name, and how far a height drag shrinks it. */
export const Tile = StructType({
    id: StringType,
    row: StringType,
    span: IntegerType,
    height: OptionType(IntegerType),
    minHeight: OptionType(IntegerType),
    name: StringType,
});
/** One tile, decoded. */
export type TileValue = ValueTypeOf<typeof Tile>;
/** The page's source. */
export const Tiles = ArrayType(Tile);

/** The page: the KPI rail, the trend beside the breakdown, and the board. */
export const SEED: readonly TileValue[] = [
    { id: "kpi", row: "kpis", span: 12n, height: none, minHeight: none, name: "KPI rail" },
    { id: "trend", row: "charts", span: 8n, height: none, minHeight: some(120n), name: "Revenue trend" },
    { id: "region", row: "charts", span: 4n, height: none, minHeight: none, name: "Breakdown bars" },
    { id: "board", row: "board", span: 12n, height: none, minHeight: none, name: "Assignment board" },
];

/** The library its cards come from. */
export const PALETTE = "palette";
/** The canvas's drop-target id. */
export const SURFACE = "page-canvas";
/** Where the tiles are bound. */
const TILES_KEY = "snap-grid-990.tiles";
/** Where the bound selection is held. */
export const UI_KEY = "snap-grid-990.selection";
/** Where the bound design width and zoom are held (#995). */
export const VIEW_KEY = "snap-grid-995.view";

/** A card that no destination takes — the veto's. */
export const BLOCKED = "blocked";

/** The veto: the blocked card lands nowhere. */
const NO_BLOCKED = East.function([DragEventType], BooleanType, ($, event) => {
    const allowed = $.let(true);
    $.match(event, { add: ($2, add) => { $2.assign(allowed, add.from.key.notEqual(BLOCKED)); } });
    return allowed;
});

/** The author's check: a tile is at least 3 columns wide. */
const READY = East.function([Tile], Editing.Types.Readiness, ($, tile) => {
    const result = $.let(variant("ready", null), Editing.Types.Readiness);
    $.if(tile.span.less(3n), ($2) => {
        $2.assign(result, variant("invalid", [{ field: "span", message: "A tile spans 3 columns at least" }]));
    });
    return result;
});

/** How a test's canvas is built. */
export interface CanvasOptions {
    /** The tiles (default {@link SEED}). */
    seed?: readonly TileValue[];
    /** Whether the selection is the host's bound state (default `true`). */
    bound?: boolean;
    /** The veto over the {@link BLOCKED} card. */
    veto?: boolean;
    /** The author's readiness check ({@link READY}). */
    ready?: boolean;
    /** Whether a dropped card makes a tile — `edit.create` (default `true`). */
    creates?: boolean;
    /**
     * The builder's frame (#995), default `false`: the view bound at
     * {@link VIEW_KEY}, a 1440px design width with Desktop and Tablet, the
     * host's toolbar items ("Draft" at the start, "Publish" at the end), its
     * panes ("Palette" and "Inspector"), and each tile's icon and meta.
     */
    chrome?: boolean;
}

type Resolved = Required<CanvasOptions>;

/** The canvas's program — the factory's, compiled. */
function compileCanvas(o: Resolved): () => ValueTypeOf<typeof UIComponentType> {
    const seed = o.seed.map((t) => ({ ...t }));
    const program = East.function([], UIComponentType, ($) => {
        const tiles = $.const(State.bind([Tiles], TILES_KEY, seed));
        const ui = $.const(State.bind([SnapGrid.Types.UiState], UI_KEY, SnapGrid.uiState()));
        const view = $.const(State.bind([SnapGrid.Types.ViewState], VIEW_KEY, SnapGrid.viewState()));
        return SnapGrid.Root(tiles, {
            cell: (t) => SnapGrid.cell({
                key: t.id, row: t.row, span: t.span, height: t.height, minHeight: t.minHeight, label: some(t.name),
                ...(o.chrome ? { icon: some("gauge-high"), meta: some(East.str`${t.id} · sales_daily`) } : {}),
                content: Text.Root(t.name),
            }),
            guides: true,
            id: SURFACE,
            sources: [PALETTE],
            ...(o.bound ? { ui } : {}),
            ...(o.chrome ? {
                view,
                width: "1440px",
                widths: [
                    { label: "Desktop", icon: "desktop", width: "1440px" },
                    { label: "Tablet", icon: "tablet-screen-button", width: "1024px" },
                ],
                toolbar: { start: [Text.Root("Draft")], end: [Text.Root("Publish")] },
                panes: { start: Text.Root("Palette"), end: Text.Root("Inspector") },
            } : {}),
            ...(o.veto ? { canDrop: NO_BLOCKED } : {}),
            edit: {
                key: "id", row: "row", span: "span", height: "height",
                ...(o.creates ? {
                    create: (_$, card, at) => ({ id: at.key, row: at.row, span: 6n, height: none, minHeight: none, name: card.key }),
                } : {}),
            },
            editing: { onUpdate: tiles.write, ...(o.ready ? { ready: READY } : {}) },
        });
    });
    return East.compile(program, getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
}

/** One gesture's patch event, decoded. */
const PatchEventType = SnapGrid.Types.PatchEvent(Tile);
export type SnapGridPatch = ValueTypeOf<typeof PatchEventType>;
const decodePatch = decodeBeast2For(PatchEventType);
const encodeTiles = encodeBeast2For(Tiles);
const decodeTiles = decodeBeast2For(Tiles);
const encodeUi = encodeBeast2For(SnapGrid.Types.UiState);
const decodeUi = decodeBeast2For(SnapGrid.Types.UiState);
const decodeView = decodeBeast2For(SnapGrid.Types.ViewState);

/** What a canvas's editing wire is probed with. */
interface Probe {
    patches: SnapGridPatch[];
    applies: Uint8Array[];
}

/** The value with its editing wire probed — every patch kept, every apply request kept, the real callback answering. */
function probed(value: SnapGridValue, probe: Probe): SnapGridValue {
    if (value.editing.type !== "some") return value;
    const wire = value.editing.value;
    const apply = wire.onApply.type === "some" ? wire.onApply.value : undefined;
    const observe = wire.onPatch.type === "some" ? wire.onPatch.value : undefined;
    return {
        ...value,
        editing: some({
            ...wire,
            onPatch: some((bytes: Uint8Array) => {
                probe.patches.push(decodePatch(bytes));
                observe?.(bytes);
                return null;
            }),
            onApply: apply === undefined ? none : some(variant("async", async (bytes: Uint8Array) => {
                probe.applies.push(bytes.slice());
                return apply.type === "sync" ? apply.value(bytes) : await apply.value(bytes);
            })),
        }),
    } as unknown as SnapGridValue;
}

/** A card in the palette — a drag source, by pointer or keyboard. */
function Card({ card }: { card: string }) {
    const drag = useDragSourceItem({ library: PALETTE, key: card, label: card }, <div />);
    return <div data-testid={`card-${card}`} {...drag} />;
}

/** A mounted canvas, and what the test reads and drives it through. */
export interface EditingSnapGrid extends RenderResult {
    /** Every gesture's patch event, in order. */
    patches: SnapGridPatch[];
    /** Every apply request's bytes, in order. */
    applies: Uint8Array[];
    /** What the source holds now. */
    stored: () => TileValue[];
    /** How many writes the source took. */
    writes: () => number;
    /** The host renders again with the source's latest value. */
    confirm: () => Promise<void>;
    /** The host selects a tile — a write to the bound selection — and renders. */
    hostSelects: (key: string | null) => Promise<void>;
    /** The tile the bound selection holds. */
    boundSelection: () => string | null;
    /** The design width and zoom the bound view holds (#995) — `null` each while it holds none. */
    boundView: () => { width: string | null; zoom: number | null };
}

/** Let everything in flight land — microtasks, and timers queued behind them. */
export async function settle(): Promise<void> {
    await act(async () => {
        for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
}

/**
 * Build, compile and mount a canvas, and wait for its tiles to draw.
 *
 * @param options - How the canvas is built ({@link CanvasOptions})
 * @returns The mounted canvas
 */
export async function mountSnapGrid(options: CanvasOptions = {}): Promise<EditingSnapGrid> {
    const o: Resolved = { seed: SEED, bound: true, veto: false, ready: false, creates: true, chrome: false, ...options };
    const probe: Probe = { patches: [], applies: [] };
    const program = compileCanvas(o);
    const view = (): SnapGridValue => {
        const ui = program();
        if (ui.type !== "SnapGrid") throw new Error(`Expected a SnapGrid, got ${ui.type}`);
        return probed(ui.value as SnapGridValue, probe);
    };
    const tree = (value: SnapGridValue): ReactNode => (
        <ChakraProvider value={system}>
            <DragLayerProvider>
                <Card card="orders" />
                <Card card={BLOCKED} />
                <EastChakraSnapGrid value={value} storageKey="snap-grid-990" />
            </DragLayerProvider>
        </ChakraProvider>
    );
    const utils = render(<>{tree(view())}</>);
    const rerenderLatest = () => act(() => { utils.rerender(<>{tree(view())}</>); });
    const baseline = getStore().getKeyVersion(TILES_KEY);
    await waitFor(() => {
        if (utils.container.querySelector(`[data-snap-grid-tile="${o.seed[0]!.id}"]`) === null) throw new Error("the tiles have not drawn yet");
    });
    await settle();
    return {
        ...utils,
        patches: probe.patches,
        applies: probe.applies,
        stored: () => {
            const bytes = getStore().read(TILES_KEY);
            return bytes === undefined ? o.seed.map((t) => ({ ...t })) : decodeTiles(bytes);
        },
        writes: () => getStore().getKeyVersion(TILES_KEY) - baseline,
        confirm: async () => {
            rerenderLatest();
            await settle();
        },
        hostSelects: async (key) => {
            act(() => { getStore().write(UI_KEY, encodeUi({ selected: key === null ? none : some(key) })); });
            await settle();
        },
        boundSelection: () => {
            const bytes = getStore().read(UI_KEY);
            if (bytes === undefined) return null;
            const state = decodeUi(bytes);
            return state.selected.type === "some" ? state.selected.value : null;
        },
        boundView: () => {
            const bytes = getStore().read(VIEW_KEY);
            if (bytes === undefined) return { width: null, zoom: null };
            const state = decodeView(bytes);
            return {
                width: state.width.type === "some" ? state.width.value : null,
                zoom: state.zoom.type === "some" ? state.zoom.value : null,
            };
        },
    };
}

/** Write the tiles the host holds, as another writer would. */
export function hostWrites(tiles: readonly TileValue[]): void {
    act(() => { getStore().write(TILES_KEY, encodeTiles([...tiles])); });
}

// ── Reading the canvas ──────────────────────────────────────────────────────

/** A tile's placement box. */
export const tileEl = (c: HTMLElement, key: string): HTMLElement =>
    c.querySelector<HTMLElement>(`[data-snap-grid-tile="${key}"]`)!;

/** The rows as drawn: each row's tiles, by key, in their order. */
export const rowsDrawn = (c: HTMLElement): string[][] =>
    [...c.querySelectorAll<HTMLElement>("[data-snap-grid-row]")].map((row) =>
        [...row.querySelectorAll<HTMLElement>("[data-snap-grid-tile]")].map((t) => t.getAttribute("data-snap-grid-tile")!));

/** A tile's span as drawn. */
export const spanOf = (c: HTMLElement, key: string): number =>
    Number(tileEl(c, key).style.getPropertyValue("--snap-grid-span"));

/** A tile's height as drawn — `null` its content's own. */
export function heightOf(c: HTMLElement, key: string): number | null {
    const frame = tileEl(c, key).firstElementChild as HTMLElement;
    return frame.style.height === "" ? null : Number.parseFloat(frame.style.height);
}

/** The selected tile's key, as the canvas draws it. */
export const selectedTile = (c: HTMLElement): string | null =>
    c.querySelector("[data-snap-grid-tile][data-selected]")?.getAttribute("data-snap-grid-tile") ?? null;

/** The draft mark a tile wears: `pending`, `incomplete`, `invalid`, or none. */
export function markOf(c: HTMLElement, key: string): "pending" | "incomplete" | "invalid" | undefined {
    const t = tileEl(c, key);
    return t.hasAttribute("data-invalid") ? "invalid" : t.hasAttribute("data-incomplete") ? "incomplete"
        : t.hasAttribute("data-pending") ? "pending" : undefined;
}

/** Every tile's mark that has one, by key. */
export function marks(c: HTMLElement): Record<string, string> {
    const out: Record<string, string> = {};
    for (const t of c.querySelectorAll<HTMLElement>("[data-snap-grid-tile]")) {
        const key = t.getAttribute("data-snap-grid-tile")!;
        const mark = markOf(c, key);
        if (mark !== undefined) out[key] = mark;
    }
    return out;
}

/** The end zone under the rows — the gap a drop makes a new last row in. */
export const endZone = (c: HTMLElement): HTMLElement => c.querySelector<HTMLElement>("[data-snap-grid-end]")!;

/** The gap above row `index` — `0` above the first. */
export const gapEl = (c: HTMLElement, index: number): HTMLElement =>
    c.querySelector<HTMLElement>(`[data-snap-grid-gap="${index}"]:not([data-snap-grid-end])`)!;

/** What the canvas's live region last said. */
export const announced = (c: HTMLElement): string =>
    c.querySelector("[data-snap-grid-announce]")?.textContent?.trim() ?? "";

// ── Driving the canvas ──────────────────────────────────────────────────────

/** Click a tile. */
export async function clickTile(c: HTMLElement, key: string): Promise<void> {
    await act(async () => { fireEvent.click(tileEl(c, key)); });
    await settle();
}

/** Press a key on a tile — or, with no tile, on the canvas. */
export async function key(c: HTMLElement, init: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }, on?: string): Promise<void> {
    const target = on !== undefined ? tileEl(c, on) : c.querySelector<HTMLElement>("[data-snap-grid-canvas]")!;
    await act(async () => { fireEvent.keyDown(target, init); });
    await settle();
}

/** A history item button, by its name. */
export const historyButton = (canvas: RenderResult, name: string): HTMLButtonElement =>
    canvas.getByRole("button", { name }) as HTMLButtonElement;

/** Press a history item button, as a pointer does. */
export async function history(canvas: RenderResult, name: string): Promise<void> {
    const button = historyButton(canvas, name);
    await act(async () => {
        fireEvent.mouseDown(button, { button: 0 });
        fireEvent.click(button);
    });
    await settle();
}

/**
 * Drag a handle of the selected tile by `dy` down (and `dx` across) and let go.
 * The handle is the canvas's own pointer handling: its moves and its release
 * reach the handle, which holds the pointer.
 *
 * @param c - The container
 * @param key - The selected tile
 * @param handle - `span`, `height` or `both`
 * @param to - Where the pointer lets go, in client px, from where it took the handle at (0, 0)
 */
export async function dragHandle(c: HTMLElement, key: string, handle: "span" | "height" | "both", to: { x?: number; y?: number }): Promise<void> {
    const el = tileEl(c, key).querySelector<HTMLElement>(`[data-handle="${handle}"]`)!;
    await act(async () => {
        fireEvent.pointerDown(el, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
        fireEvent.pointerMove(el, { clientX: to.x ?? 0, clientY: to.y ?? 0, pointerId: 1 });
        fireEvent.pointerUp(el, { clientX: to.x ?? 0, clientY: to.y ?? 0, pointerId: 1 });
    });
    await settle();
}

/**
 * Pick up a tile or a card and hold it over a drop cell — the drop not yet
 * made. The move travels past the drag layer's 4px threshold, so the drag
 * engages on it.
 *
 * @param source - The tile's placement box or the card
 * @param over - The drop cell it rests on
 * @param at - Where the pointer rests, in client px (default 10, 10)
 * @returns Let go
 */
export async function hold(source: HTMLElement, over: HTMLElement, at: { x: number; y: number } = { x: 10, y: 10 }): Promise<() => Promise<void>> {
    await act(async () => {
        fireEvent.pointerDown(source, { clientX: at.x - 10, clientY: at.y - 10 });
        pointAt(over);
        fireEvent.pointerMove(document, { clientX: at.x, clientY: at.y });
    });
    return async () => {
        await act(async () => { fireEvent.pointerUp(document, { clientX: at.x, clientY: at.y }); });
        await settle();
    };
}

/** Pick up a tile or a card, and drop it on a drop cell. */
export async function drop(source: HTMLElement, over: HTMLElement, at?: { x: number; y: number }): Promise<void> {
    const letGo = await hold(source, over, at);
    await letGo();
}

/**
 * Lay the rows out for the drops and resizes that measure them: each row 1200px
 * wide and 100px tall, one under another 12px apart, and each tile across its
 * row by its span — a column 100px wide, as a 1200px row with no gaps holds.
 *
 * @param c - The container
 */
export function layRows(c: HTMLElement): Map<Element, { left: number; top: number; width: number; height: number }> {
    const rects = new Map<Element, { left: number; top: number; width: number; height: number }>();
    [...c.querySelectorAll<HTMLElement>("[data-snap-grid-row]")].forEach((row, i) => {
        const top = i * 112;
        let left = 0;
        for (const t of row.querySelectorAll<HTMLElement>("[data-snap-grid-tile]")) {
            const width = Number(t.style.getPropertyValue("--snap-grid-span")) * 100;
            rects.set(t, { left, top, width, height: 100 });
            left += width;
        }
        rects.set(row, { left: 0, top, width: 1200, height: 100 });
    });
    return rects;
}
