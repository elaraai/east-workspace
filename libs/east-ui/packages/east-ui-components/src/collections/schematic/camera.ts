/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure camera maths for the Schematic renderer — the single source of truth for
 * the pan/zoom transform, the interaction-mode machine, viewport culling
 * geometry, and the `requestAnimationFrame` coalescer. Kept free of React,
 * Chakra, and Canvas2D so every piece is unit-testable in a `node` environment
 * and so the **same** world→screen projection is shared by the Canvas2D painter
 * ({@link ../paint}) and the DOM card layer — the two surfaces can never use a
 * different transform and drift apart (issue #57, P1).
 *
 * @packageDocumentation
 */

/** The pan/zoom state: `screen = world × fit × zoom + t`. */
export interface Viewport {
    zoom: number;
    tx: number;
    ty: number;
}

/** The identity camera — fully zoomed out, no pan. */
export const IDENTITY: Viewport = { zoom: 1, tx: 0, ty: 0 };

/**
 * The transform in CSS pixels with `ppu` (pixels-per-world-unit) already
 * folded in: `screen = world × ppu + t`. Mirrors {@link ../paint!PaintCamera}.
 */
export interface ScreenCamera {
    ppu: number;
    tx: number;
    ty: number;
}

/** An axis-aligned bounding box (world or screen space). */
export interface Bbox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/**
 * Project a world point to screen space (`x × ppu + tx`, `y × ppu + ty`). The
 * one projector shared by the painter and the card layer; the DOM cards apply
 * the identical arithmetic in CSS via {@link cardTranslateCss}.
 *
 * @param x - world x
 * @param y - world y
 * @param cam - the screen camera (ppu + translation)
 * @returns the screen-space point
 */
export function project(x: number, y: number, cam: ScreenCamera): { sx: number; sy: number } {
    return { sx: x * cam.ppu + cam.tx, sy: y * cam.ppu + cam.ty };
}

/**
 * The CSS `translate(...)` a DOM card uses to sit on its world anchor, reading
 * the live camera from the `--cam-ppu` / `--cam-tx` / `--cam-ty` custom
 * properties set on the card layer. The arithmetic is identical to
 * {@link project} (`ppu × coord + t`), so card and canvas-drawn footprint
 * resolve to the same screen point. The string is **camera-independent** (it
 * only embeds the item's world `x`/`y`), so a camera change is a single set of
 * custom-property writes on the parent — no per-card React re-layout.
 *
 * @param x - world x of the item anchor
 * @param y - world y of the item anchor
 * @returns a CSS `translate()` expression referencing the `--cam-*` vars
 */
export function cardTranslateCss(x: number, y: number): string {
    return `translate(calc(var(--cam-ppu) * ${x} * 1px + var(--cam-tx)), calc(var(--cam-ppu) * ${y} * 1px + var(--cam-ty)))`;
}

/**
 * The CSS length a DOM card uses for an explicit world-space `width`, reading
 * the live `--cam-ppu`. Expressing the width through the var (not a
 * render-time `width × ppu`) keeps an explicit-width card's box sized from the
 * **same** live ppu the canvas footprint is drawn from, so box and footprint
 * never diverge in size during a zoom (issue #57, Phase 2 invariant 6).
 *
 * @param width - the item's world-space width
 * @returns a CSS `calc()` length referencing `--cam-ppu`
 */
export function cardWidthCss(width: number): string {
    return `calc(var(--cam-ppu) * ${width} * 1px)`;
}

/**
 * The world-space rectangle currently visible — the inverse projection of the
 * canvas corners. Used to cull off-screen zones / links (issue #57, P6).
 *
 * @param cam - the screen camera
 * @param width - canvas width in CSS px
 * @param height - canvas height in CSS px
 * @returns the visible world bbox
 */
export function viewportWorldBbox(cam: ScreenCamera, width: number, height: number): Bbox {
    return {
        minX: -cam.tx / cam.ppu,
        minY: -cam.ty / cam.ppu,
        maxX: (width - cam.tx) / cam.ppu,
        maxY: (height - cam.ty) / cam.ppu,
    };
}

/**
 * Whether two axis-aligned bounding boxes overlap (inclusive edges). Off-screen
 * shapes whose bbox misses the viewport bbox are culled.
 *
 * @param a - first bbox
 * @param b - second bbox
 * @returns `true` when the boxes touch or overlap
 */
export function bboxOverlaps(a: Bbox, b: Bbox): boolean {
    return a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;
}

/**
 * The world-space AABB over a set of points. For a link this is taken over
 * **all** anchors (endpoints + waypoints), so a trunk whose two ends sit
 * off-screen but whose segment crosses the viewport is not wrongly culled
 * (issue #57, 1e).
 *
 * @param pts - the points to bound (world coords)
 * @returns the AABB, or `null` when the list is empty
 */
export function pointsBbox(pts: readonly { x: number; y: number }[]): Bbox | null {
    if (pts.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
}

/**
 * Apply a multiplicative zoom about a screen-space focal point, keeping that
 * point fixed on screen (cursor-anchored wheel zoom, centre-anchored button
 * zoom). Clamps to `[min, max]`; snapping to `min === 1` returns
 * {@link IDENTITY} so a full zoom-out also recentres.
 *
 * @param prev - the current camera
 * @param factor - multiply `zoom` by this
 * @param px - screen-x to keep fixed
 * @param py - screen-y to keep fixed
 * @param min - minimum zoom
 * @param max - maximum zoom
 * @returns the next camera
 */
export function zoomAbout(prev: Viewport, factor: number, px: number, py: number, min: number, max: number): Viewport {
    const zoom = Math.max(min, Math.min(max, prev.zoom * factor));
    if (zoom === 1) return IDENTITY;
    const k = zoom / prev.zoom;
    return { zoom, tx: px - k * (px - prev.tx), ty: py - k * (py - prev.ty) };
}

/** The interaction modes the camera can be in at any instant. */
export type CameraMode = "idle" | "panning" | "wheeling" | "flying";

/** The inputs that drive {@link nextMode} transitions. */
export type CameraEvent = "pointerDown" | "wheel" | "zoom" | "flyStart" | "pointerUp" | "flyEnd" | "cancel";

/**
 * The camera interaction-mode transition. Entering an input mode
 * (`pointerDown` / `wheel` / `zoom`) supersedes a running fly — see
 * {@link cancelsFly} for the companion side-effect predicate — so a user
 * gesture always wins over an animation rather than racing it (issue #57, P4 /
 * Phase 2 invariant 5).
 *
 * @param mode - the current mode
 * @param event - the input event
 * @returns the next mode
 */
export function nextMode(mode: CameraMode, event: CameraEvent): CameraMode {
    switch (event) {
        case "pointerDown": return "panning";
        case "wheel": return "wheeling";
        case "zoom": return "wheeling";
        case "flyStart": return "flying";
        case "pointerUp": return mode === "panning" ? "idle" : mode;
        case "flyEnd": return mode === "flying" ? "idle" : mode;
        case "cancel": return "idle";
    }
}

/**
 * Whether processing `event` in `mode` must cancel a running fly animation.
 * Pairs with {@link nextMode}: the reducer names the next mode, this names the
 * side-effect (cancel the in-flight `flyTo` rAF) the transition implies. Every
 * event that moves the machine OUT of `flying` (a user gesture, an explicit
 * `cancel`/`reset`) must cancel the rAF, so the mode and the live `animRef` can
 * never disagree — `flyEnd` is the sole exception (the rAF has already ended).
 *
 * @param mode - the current mode
 * @param event - the input event
 * @returns `true` when a fly animation is in progress and is being superseded
 */
export function cancelsFly(mode: CameraMode, event: CameraEvent): boolean {
    return mode === "flying"
        && (event === "pointerDown" || event === "wheel" || event === "zoom" || event === "cancel");
}

/** A frame-coalesced render scheduler — see {@link makeRafCoalescer}. */
export interface RafCoalescer {
    /** Schedule `run` for the next frame; repeat calls before it fires are no-ops. */
    request(run: () => void): void;
    /** Cancel a pending frame (teardown). */
    cancel(): void;
}

/**
 * Coalesce many `request` calls within a single frame down to **one** scheduled
 * callback. Pointer-move / wheel handlers mutate the live camera synchronously
 * and call `request` on every event; this guarantees at most one paint +
 * snapshot per frame, keeping the hot pan path off the per-event path (issue
 * #57, Phase 2 invariant 2). Injecting `schedule` / `cancel` (rather than
 * closing over `requestAnimationFrame`) keeps the coalescer unit-testable.
 *
 * @param schedule - schedules a callback for the next frame, returns a handle
 * @param cancel - cancels a scheduled callback by handle
 * @returns a {@link RafCoalescer}
 */
export function makeRafCoalescer(schedule: (cb: () => void) => number, cancel: (handle: number) => void): RafCoalescer {
    let handle: number | null = null;
    return {
        request(run: () => void): void {
            if (handle !== null) return;
            handle = schedule(() => {
                handle = null;
                run();
            });
        },
        cancel(): void {
            if (handle !== null) {
                cancel(handle);
                handle = null;
            }
        },
    };
}
