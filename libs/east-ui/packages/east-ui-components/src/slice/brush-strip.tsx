/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The shared brush strip — the Plan spec's horizon-strip presentation over the
 * `brush-math` gesture machine, used by the standalone `Slice.Rail` brush and
 * the Plan canvas's horizon band.
 *
 * Pure presentation + gesture: the host owns the domain (fraction ↔ value
 * mapping), the histogram counts, and the actual range write. The strip
 * renders the full-horizon histogram (in-window bars brand-washed,
 * out-of-window muted), the excluded-region masks, the visible 5 px brand
 * handles inside their 10 px hit zones, and the optional now tick — and runs
 * the draw / slide / resize pointer machine, reporting the result as window
 * fractions.
 *
 * During a drag the draft window is drawn with the same mask + handle
 * vocabulary as the applied one (the applied window hides) — what you see
 * mid-gesture is exactly what releases.
 */

import { useRef, useState } from "react";
import { Box } from "@chakra-ui/react";
import { useSlotRecipe } from "@chakra-ui/react";
import { useDrag } from "@use-gesture/react";
import { brushHitTest, brushDragWindow, brushRelease, brushCursor, type BrushDrag } from "./brush-math.js";

export interface BrushStripProps {
    /** Per-bucket histogram counts (already narrowed / self-excluding); empty or all-zero ⇒ no bars. */
    counts: ReadonlyArray<number> | undefined;
    /** The applied window as track fractions `[0, 1]`; `undefined` ⇒ no window (all bars in-window, no masks). */
    window: { from: number; to: number } | undefined;
    /** Optional now-instant fraction — renders the 1.5 px brand tick. */
    nowFrac?: number | undefined;
    /** Track height in px (rail compact 28 / 18; Plan horizon 32). */
    height: number;
    /** Max bar height in px (bars scale to `count / max × barHeight`). */
    barHeight: number;
    /** A drag committed a window (fractions, `from < to`). */
    onCommit: (from: number, to: number) => void;
    /** A sub-threshold click on empty track cleared the window. */
    onClear: () => void;
    /**
     * Optional window snapping (fraction pair → fraction pair) — applied to
     * the in-flight draft AND the committed window, so what you see
     * mid-gesture is exactly what releases. The host owns the semantics
     * (e.g. the Plan snaps to resolution-period edges with a one-period
     * minimum width).
     */
    snapWindow?: ((from: number, to: number) => { from: number; to: number }) | undefined;
    /**
     * Optional live preview while adjusting an EXISTING window (move /
     * resize — never a fresh draw): fired with the snapped draft fractions
     * each time they CHANGE, so a snapping host applies the pan in discrete
     * per-period steps rather than per pixel. A cancelled or no-op-released
     * drag re-fires the origin window, so live-applied hosts always land
     * back where the drag started.
     */
    onPreview?: ((from: number, to: number) => void) | undefined;
}

/** The gesture-threaded state: the brush-math drag plus the preview channel's
 *  origin window and last-fired draft (all track fractions). */
type DragState = BrushDrag & {
    origin?: { from: number; to: number };
    preview?: { from: number; to: number };
};

/**
 * Renders the brush strip and runs the pointer gesture machine. See the
 * module doc for the visual contract; geometry decisions (draw vs slide vs
 * resize, click-through threshold) live in `brush-math.ts`.
 */
export function BrushStrip({ counts, window: win, nowFrac, height, barHeight, onCommit, onClear, snapWindow, onPreview }: BrushStripProps) {
    const styles = useSlotRecipe({ key: "brushStrip" })();
    const trackRef = useRef<HTMLDivElement | null>(null);
    const [drag, setDrag] = useState<DragState | null>(null);

    // The pointer gesture rides `@use-gesture` (the GanttTask precedent) —
    // it owns capture, cancellation and listener cleanup, so a missed
    // pointerup can never wedge the strip in a phantom drag. Geometry
    // decisions stay in `brush-math`; the in-flight state threads through
    // the gesture's `memo` (no stale-closure reads) with the `drag` state
    // mirroring it for the draft rendering.
    const bind = useDrag(({ xy: [clientX], first, last, canceled, memo }) => {
        const el = trackRef.current;
        if (el === null) return memo as DragState | undefined;
        const rect = el.getBoundingClientRect();
        const x = clientX - rect.left;
        if (first) {
            const w = win !== undefined ? { lo: win.from * rect.width, hi: win.to * rect.width } : undefined;
            const d: DragState = { mode: brushHitTest(x, w), start: x, current: x, width: rect.width, win: w };
            // Seed the preview channel at the origin window, so the first
            // fire only happens once the snapped draft actually LEAVES it.
            if (win !== undefined) { d.origin = win; d.preview = win; }
            setDrag(d);
            return d;
        }
        const d = memo as DragState | undefined;
        if (d === undefined) return memo as DragState | undefined;
        // A drag that live-applied preview steps must land the window
        // somewhere deliberate: the origin on cancel / no-op release.
        const restoreOrigin = (): void => {
            if (onPreview !== undefined && d.origin !== undefined && d.preview !== undefined
                && (d.preview.from !== d.origin.from || d.preview.to !== d.origin.to)) {
                onPreview(d.origin.from, d.origin.to);
            }
        };
        if (canceled) {
            setDrag(null);
            restoreOrigin();
            return d;
        }
        const next: DragState = { ...d, current: x };
        if (last) {
            setDrag(null);
            // `brushRelease` owns the click-vs-drag semantics (clear on
            // empty track, no-op on the window, commit past the threshold).
            const release = brushRelease(next);
            if (release.kind === "clear") onClear();
            else if (release.kind === "commit") {
                const raw = { from: release.lo / next.width, to: release.hi / next.width };
                const s = snapWindow !== undefined ? snapWindow(raw.from, raw.to) : raw;
                onCommit(s.from, s.to);
            } else restoreOrigin();
            return next;
        }
        // Live preview: adjusting an existing window (move / resize) fires
        // the snapped draft whenever it changes — under resolution snapping
        // that is one step per period-boundary crossing. Fresh draws stay
        // draft-only until release.
        if (onPreview !== undefined && next.mode !== "draw" && next.win !== undefined) {
            const w = brushDragWindow(next);
            const raw = { from: Math.max(0, w.lo / next.width), to: Math.min(1, w.hi / next.width) };
            const p = snapWindow !== undefined ? snapWindow(raw.from, raw.to) : raw;
            if (next.preview === undefined || next.preview.from !== p.from || next.preview.to !== p.to) {
                next.preview = p;
                onPreview(p.from, p.to);
            }
        }
        setDrag(next);
        return next;
    }, { preventDefault: true, pointer: { capture: false } });

    const maxCount = counts !== undefined && counts.length > 0 ? Math.max(...counts) : 0;
    const draft = drag !== null ? brushDragWindow(drag) : undefined;
    // The window being DISPLAYED: the in-flight draft while dragging (snapped
    // when the host snaps), else the applied one. Fractions clamped.
    const rawDraft = draft !== undefined && drag !== null
        ? { from: Math.max(0, draft.lo / drag.width), to: Math.min(1, draft.hi / drag.width) }
        : undefined;
    const shown = rawDraft !== undefined
        ? (snapWindow !== undefined ? snapWindow(rawDraft.from, rawDraft.to) : rawDraft)
        : win;
    const barIn = (i: number, n: number): boolean => {
        if (shown === undefined) return true;
        const centre = (i + 0.5) / n;
        return centre >= shown.from && centre <= shown.to;
    };

    return (
        <Box
            ref={trackRef}
            css={styles.track}
            height={`${height}px`}
            cursor={drag !== null ? brushCursor(drag.mode) : "crosshair"}
            data-brush-track
            data-empty={counts === undefined || maxCount === 0 ? "true" : "false"}
            {...bind()}
        >
            {/* full-horizon histogram — in-window brand wash, out-of-window
                muted. Zero-count buckets render as invisible spacers (height
                0) so bucket positions hold without faking density. */}
            {counts !== undefined && maxCount > 0 && counts.map((c, i) => (
                <Box
                    key={i}
                    css={styles.bar}
                    data-brush-bar
                    data-out={barIn(i, counts.length) ? "false" : "true"}
                    height={c > 0 ? `${Math.max(2, (c / maxCount) * barHeight)}px` : "0"}
                />
            ))}
            {/* excluded-region masks + the visible handles (applied or draft) */}
            {shown !== undefined && (
                <>
                    {shown.from > 0 && <Box css={styles.mask} data-brush-mask left="0" width={`${shown.from * 100}%`} />}
                    {shown.to < 1 && <Box css={styles.mask} data-brush-mask right="0" width={`${(1 - shown.to) * 100}%`} />}
                    <Box css={styles.handleZone} data-brush-handle="lo" left={`${shown.from * 100}%`}>
                        <Box css={styles.handleBar} />
                    </Box>
                    <Box css={styles.handleZone} data-brush-handle="hi" left={`${shown.to * 100}%`}>
                        <Box css={styles.handleBar} />
                    </Box>
                </>
            )}
            {nowFrac !== undefined && nowFrac >= 0 && nowFrac <= 1 && (
                <Box css={styles.now} data-brush-now left={`${nowFrac * 100}%`} />
            )}
        </Box>
    );
}
