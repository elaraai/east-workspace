/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Story renderer — scroll-driven narrative (design/story.html §2.7 Narrate).
 *
 * One persistent visual (the sticky **stage**) evolves through keyframes
 * while prose **steps** scroll past in a rail beside it; the reader's
 * scrollbar is the timeline.
 *
 * Stance (non-negotiables from the spec):
 * - Text never floats over the visual — prose lives in a dedicated rail.
 * - Native scroll only: the driver *observes* scroll position; it never
 *   hijacks the wheel, never snaps. The single sanctioned programmatic
 *   scroll is navigation (a step/dot click or an external `active` write
 *   smooth-scrolls that step to the trigger line).
 * - The stage owns no chrome; keyframes bring their own framing.
 * - Keyframe transitions are a crossfade in this renderer (the spec's
 *   chart-aware series tweening is a planned enhancement); reduced motion
 *   shortens the fade.
 *
 * State follows the mandatory interactive pattern (CLAUDE.md): local
 * useState drives the UI, `useEffect([value])` re-syncs on IR changes,
 * callbacks fire via `queueMicrotask` outside updaters. The optional
 * `active` binding is a plain closure struct (read/write/has) with no
 * visible key, so external writes are observed via a global store
 * subscription (`useSyncExternalStore` on `getStore()`).
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Box as ChakraBox } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Story, UIComponentType } from "@elaraai/east-ui/internal";
import { EastChakraComponent } from "../../component";
import { getSomeorUndefined } from "../../utils";
import { getStore } from "../../platform/state-runtime";
import { usePrefersReducedMotion } from "../../contracts/reduced-motion";

type StoryValue = ValueTypeOf<typeof Story.Types.Story>;
type StoryStepValue = ValueTypeOf<typeof Story.Types.Step>;
type StoryProgressValue = ValueTypeOf<typeof Story.Types.Progress>;
type UIComponentValue = ValueTypeOf<typeof UIComponentType>;
type ActiveBinding = ValueTypeOf<typeof Story.Types.ActiveBinding>;
type ProgressBinding = ValueTypeOf<typeof Story.Types.ProgressBinding>;

// Pre-define equality functions at module level
const storyEqual = equalFor(Story.Types.Story);
const storyStepEqual = equalFor(Story.Types.Step);
const storyProgressEqual = equalFor(Story.Types.Progress);

/** Whether the static override disables the scrollport (one keyframe, no driver). */
function isStaticForScrollport(value: StoryValue): boolean {
    return getSomeorUndefined(value.activeStep) !== undefined;
}

// Spec dimensions (design/story.html §Story.Root)
const TRIGGER_LINE = 0.38;       // step activates crossing 38% from the viewport top
const NAV_OFFSET = 0.30;         // navigation scrolls the step to 30% from the top
const STACK_BREAKPOINT = 720;    // forced `stacked` below this container width
const STEP_RUNWAY_VH: Record<string, number> = { compact: 36, default: 52, long: 72 };
const DEFAULT_STAGE_HEIGHT = "420px";
const STACKED_STAGE_CAP = "280px";

// ============================================================================
// Helpers
// ============================================================================

interface ExtractedStep {
    id: string;
    eyebrow: string | undefined;
    title: string | undefined;
    stage: UIComponentValue | undefined;
    body: UIComponentValue[];
}

let warnedNonStepChild = false;

/**
 * Pull the StoryStep children out of the steps array. The contract
 * "children must be Story.Steps" is soft — non-step children are skipped
 * with a one-time dev warning (the ChipRail precedent).
 */
function extractSteps(children: UIComponentValue[]): ExtractedStep[] {
    const steps: ExtractedStep[] = [];
    for (const child of children) {
        const tagged = child as unknown as { type: string; value: unknown };
        if (tagged.type === "StoryStep") {
            const step = tagged.value as StoryStepValue;
            steps.push({
                id: step.id,
                eyebrow: getSomeorUndefined(step.eyebrow),
                title: getSomeorUndefined(step.title),
                stage: getSomeorUndefined(step.stage) as UIComponentValue | undefined,
                body: step.body as UIComponentValue[],
            });
        } else if (!warnedNonStepChild) {
            warnedNonStepChild = true;
            console.warn(`Story: skipping non-StoryStep child (got '${tagged.type}'). Story children should be Story.Step components.`);
        }
    }
    return steps;
}

/**
 * Resolve which step owns the visible keyframe for a given active index:
 * the nearest step at-or-before it that carries a stage (a step without
 * one holds the previous keyframe).
 */
function keyframeOwner(steps: ExtractedStep[], active: number): number {
    for (let i = Math.min(active, steps.length - 1); i >= 0; i--) {
        if (steps[i]?.stage !== undefined) return i;
    }
    return -1;
}

/** Find the nearest scrollable ancestor (else the window). */
function getScrollParent(el: HTMLElement | null): HTMLElement | null {
    let p = el?.parentElement ?? null;
    while (p) {
        const oy = getComputedStyle(p).overflowY;
        if (oy === "auto" || oy === "scroll") return p;
        p = p.parentElement;
    }
    return null; // window
}

/**
 * Subscribe to an opaque binding's value. The closure struct exposes no
 * state key, so external writes are observed via the global store
 * subscription; the numeric snapshot keeps useSyncExternalStore stable.
 */
function useActiveBindingValue(binding: ActiveBinding | undefined): number | undefined {
    const subscribe = useCallback((cb: () => void) => {
        if (!binding) return () => { /* no binding — nothing to observe */ };
        return getStore().subscribe(cb);
    }, [binding]);
    const getSnapshot = useCallback(() => (binding ? Number(binding.read()) : -1), [binding]);
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return binding ? snapshot : undefined;
}

// ============================================================================
// Story.Progress chrome row (shared by Story.Root and the standalone arm)
// ============================================================================

interface ChromeRowProps {
    title: string | undefined;
    count: number;
    active: number;
    sticky: boolean;
    onNavigate: ((index: number) => void) | undefined;
}

const StoryChromeRow = memo(function StoryChromeRow({ title, count, active, sticky, onNavigate }: ChromeRowProps) {
    // Past ~12 steps the dots compress to a segmented meter; the counter stays.
    const meterMode = count > 12;
    return (
        <ChakraBox
            display="flex"
            alignItems="center"
            gap="3"
            paddingX="4"
            paddingY="2"
            borderBottomWidth="1px"
            borderColor="border.subtle"
            background="bg.surface"
            position={sticky ? "sticky" : "relative"}
            top={sticky ? "0" : undefined}
            zIndex={sticky ? 3 : undefined}
            data-scope="story-progress"
        >
            {title !== undefined && (
                <ChakraBox
                    fontFamily="mono"
                    fontSize="9.5px"
                    fontWeight="600"
                    letterSpacing="0.18em"
                    textTransform="uppercase"
                    color="fg.muted"
                >
                    {title}
                </ChakraBox>
            )}
            {meterMode ? (
                <ChakraBox width="64px" height="4px" borderRadius="full" background="border.strong" position="relative" overflow="hidden">
                    <ChakraBox
                        position="absolute"
                        insetY="0"
                        left="0"
                        width={`${count > 0 ? ((active + 1) / count) * 100 : 0}%`}
                        background="colorPalette.solid"
                        colorPalette="brand"
                        transition="width 200ms ease-out"
                    />
                </ChakraBox>
            ) : (
                <ChakraBox display="flex" gap="1.5" alignItems="center">
                    {Array.from({ length: count }, (_, i) => (
                        <ChakraBox
                            key={i}
                            as="button"
                            aria-label={`Go to step ${i + 1}`}
                            width="6px"
                            height="6px"
                            borderRadius="full"
                            cursor={onNavigate ? "pointer" : "default"}
                            background={i === active ? "colorPalette.solid" : "border.strong"}
                            opacity={i < active ? 0.5 : 1}
                            colorPalette="brand"
                            transition="background 200ms ease-out"
                            onClick={onNavigate ? () => onNavigate(i) : undefined}
                        />
                    ))}
                </ChakraBox>
            )}
            <ChakraBox marginLeft="auto" fontFamily="mono" fontSize="11px" color="fg.subtle" fontVariantNumeric="tabular-nums">
                <ChakraBox as="span" color="fg" fontWeight="600">{active + 1}</ChakraBox>
                {` / ${count}`}
            </ChakraBox>
            <ChakraBox
                as="button"
                aria-label="Previous step"
                display="inline-flex"
                alignItems="center"
                justifyContent="center"
                width="22px"
                height="22px"
                borderWidth="1px"
                borderColor="border.strong"
                borderRadius="sm"
                background="bg.surface"
                color="fg.muted"
                fontSize="11px"
                cursor="pointer"
                _hover={{ borderColor: "fg.muted", color: "fg" }}
                onClick={onNavigate ? () => onNavigate(active - 1) : undefined}
            >
                ↑
            </ChakraBox>
            <ChakraBox
                as="button"
                aria-label="Next step"
                display="inline-flex"
                alignItems="center"
                justifyContent="center"
                width="22px"
                height="22px"
                borderWidth="1px"
                borderColor="border.strong"
                borderRadius="sm"
                background="bg.surface"
                color="fg.muted"
                fontSize="11px"
                cursor="pointer"
                _hover={{ borderColor: "fg.muted", color: "fg" }}
                onClick={onNavigate ? () => onNavigate(active + 1) : undefined}
            >
                ↓
            </ChakraBox>
        </ChakraBox>
    );
});

// ============================================================================
// Step block (rail)
// ============================================================================

interface StepBlockProps {
    step: ExtractedStep;
    index: number;
    total: number;
    state: "upcoming" | "active" | "visited";
    minHeight: string | undefined;
    storageKey: string;
    onActivate: ((index: number) => void) | undefined;
}

const StoryStepBlock = memo(function StoryStepBlock({ step, index, total, state, minHeight, storageKey, onActivate }: StepBlockProps) {
    const pad = (n: number) => String(n).padStart(2, "0");
    const eyebrowText = step.eyebrow !== undefined
        ? `${pad(index + 1)} / ${pad(total)} · ${step.eyebrow}`
        : `${pad(index + 1)} / ${pad(total)}`;

    return (
        <ChakraBox
            position="relative"
            paddingY="4"
            paddingLeft="26px"
            display="flex"
            flexDirection="column"
            minHeight={minHeight}
            boxSizing="border-box"
            opacity={state === "active" ? 1 : 0.45}
            transition="opacity 200ms ease-out"
            cursor={onActivate && state !== "active" ? "pointer" : undefined}
            onClick={onActivate && state !== "active" ? () => onActivate(index) : undefined}
            data-story-step={step.id}
            data-state={state}
        >
            {/* progress spine */}
            <ChakraBox
                position="absolute"
                left="4px"
                top={index === 0 ? "22px" : "0"}
                bottom={index === total - 1 ? undefined : "0"}
                height={index === total - 1 ? "22px" : undefined}
                width="2px"
                background="border.subtle"
            />
            {/* node */}
            <ChakraBox
                position="absolute"
                left="0"
                top="18px"
                width="10px"
                height="10px"
                borderRadius="full"
                boxSizing="border-box"
                borderWidth="2px"
                colorPalette="brand"
                borderColor={state === "upcoming" ? "border.strong" : "colorPalette.solid"}
                background={state === "active" ? "colorPalette.solid" : "bg.surface"}
                transition="all 200ms ease-out"
            />
            <ChakraBox
                fontFamily="mono"
                fontSize="9.5px"
                fontWeight="600"
                letterSpacing="0.18em"
                textTransform="uppercase"
                colorPalette="brand"
                color={state === "active" ? "colorPalette.fg" : "fg.subtle"}
                marginBottom="1.5"
            >
                {eyebrowText}
            </ChakraBox>
            {step.title !== undefined && (
                <ChakraBox
                    fontSize="17px"
                    fontWeight="600"
                    letterSpacing="-0.01em"
                    lineHeight="1.3"
                    color="fg"
                    marginBottom="2"
                >
                    {step.title}
                </ChakraBox>
            )}
            {/* body fills the step's full runway — the author's subtree owns the rectangle */}
            <ChakraBox fontSize="13px" lineHeight="1.55" color="fg.muted" maxWidth="46ch" flex="1 1 auto" minHeight="0">
                {step.body.map((child, i) => (
                    <EastChakraComponent key={i} value={child} storageKey={`${storageKey}.body.${i}`} />
                ))}
            </ChakraBox>
        </ChakraBox>
    );
}, (prev, next) =>
    prev.index === next.index &&
    prev.total === next.total &&
    prev.state === next.state &&
    prev.minHeight === next.minHeight &&
    prev.storageKey === next.storageKey &&
    prev.step === next.step);

// ============================================================================
// EastChakraStory
// ============================================================================

export interface EastChakraStoryProps {
    value: StoryValue;
    storageKey: string;
}

/**
 * Renders an East UI Story: optional sticky chrome, the prose rail with the
 * progress spine, and the sticky stage holding the active keyframe.
 */
export const EastChakraStory = memo(function EastChakraStory({ value, storageKey }: EastChakraStoryProps) {
    const steps = useMemo(() => extractSteps(value.steps as UIComponentValue[]), [value.steps]);
    const total = steps.length;

    const style = getSomeorUndefined(value.style);
    const layoutPref = (style ? getSomeorUndefined(style.layout)?.type : undefined) ?? "rail-left";
    const stageHeight = (style ? getSomeorUndefined(style.stageHeight) : undefined) ?? DEFAULT_STAGE_HEIGHT;
    const stepLength = (style ? getSomeorUndefined(style.stepLength)?.type : undefined) ?? "default";
    const runwayVh = STEP_RUNWAY_VH[stepLength] ?? STEP_RUNWAY_VH["default"]!;
    const scrollportHeight = style ? getSomeorUndefined(style.height) : undefined;
    const ownScrollport = scrollportHeight !== undefined && !isStaticForScrollport(value);

    const title = getSomeorUndefined(value.title);
    const staticActiveId = getSomeorUndefined(value.activeStep);
    const isStatic = staticActiveId !== undefined;

    const activeBinding = useMemo(() => getSomeorUndefined(value.active), [value.active]) as ActiveBinding | undefined;
    const progressBinding = useMemo(() => getSomeorUndefined(value.progress), [value.progress]) as ProgressBinding | undefined;
    const onStepEnterFn = useMemo(() => getSomeorUndefined(value.onStepEnter), [value.onStepEnter]);
    const onStepExitFn = useMemo(() => getSomeorUndefined(value.onStepExit), [value.onStepExit]);

    const prefersReducedMotion = usePrefersReducedMotion();
    const fadeMs = prefersReducedMotion ? 120 : 200;

    const rootRef = useRef<HTMLDivElement | null>(null);
    const railRef = useRef<HTMLDivElement | null>(null);
    // The effective layout, readable from scroll-time callbacks (it derives
    // from measured width, declared below; assigned every render).
    const layoutRef = useRef<"rail-left" | "rail-right" | "stacked">("rail-left");

    /** Bottom edge (viewport coords) of the sticky chrome — plus, in stacked
     *  layout, the sticky stage. Prose is only readable below this line, so
     *  all activation / navigation geometry is relative to it. */
    const occlusionBottom = useCallback((viewTop: number): number => {
        const root = rootRef.current;
        let bottom = viewTop;
        if (!root) return bottom;
        const chrome = root.querySelector('[data-scope="story-progress"]');
        if (chrome) bottom = Math.max(bottom, chrome.getBoundingClientRect().bottom);
        if (layoutRef.current === "stacked") {
            const stage = root.querySelector('[data-scope="story-stage"]');
            if (stage) bottom = Math.max(bottom, stage.getBoundingClientRect().bottom);
        }
        return bottom;
    }, []);

    // ---- active state (mandatory interactive pattern) -----------------------
    const clamp = useCallback((i: number) => Math.max(0, Math.min(total - 1, i)), [total]);
    const initialActive = isStatic
        ? Math.max(0, steps.findIndex(s => s.id === staticActiveId))
        : clamp(activeBinding ? Number(activeBinding.read()) : 0);
    const [active, setActive] = useState(initialActive);
    const activeRef = useRef(active);
    activeRef.current = active;

    // Re-sync local state when the IR value changes (rule 2)
    useEffect(() => {
        if (isStatic) {
            setActive(Math.max(0, steps.findIndex(s => s.id === staticActiveId)));
        } else {
            setActive(prev => Math.max(0, Math.min(total - 1, prev)));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, total]);

    /** Apply a scroll-driven (or click-driven) activation: local state first,
     *  then binding write + enter/exit handlers via queueMicrotask. */
    const applyActive = useCallback((next: number) => {
        const clamped = Math.max(0, Math.min(total - 1, next));
        const prev = activeRef.current;
        if (clamped === prev) return;
        setActive(clamped);
        const prevId = steps[prev]?.id;
        const nextId = steps[clamped]?.id;
        queueMicrotask(() => {
            if (activeBinding) activeBinding.write(BigInt(clamped));
            if (onStepExitFn && prevId !== undefined) onStepExitFn(prevId);
            if (onStepEnterFn && nextId !== undefined) onStepEnterFn(nextId);
        });
    }, [total, steps, activeBinding, onStepEnterFn, onStepExitFn]);

    /** The scroll container driving this story: its own scrollport when the
     *  `height` style is set, else the nearest scrollable ancestor / window. */
    const resolveScroller = useCallback((): HTMLElement | null => {
        if (ownScrollport) return rootRef.current;
        return getScrollParent(rootRef.current);
    }, [ownScrollport]);

    /** The one sanctioned programmatic scroll: bring a step to the trigger
     *  line (clicks, chrome dots, keyboard, external binding writes). */
    const navigateTo = useCallback((index: number) => {
        const clamped = Math.max(0, Math.min(total - 1, index));
        applyActive(clamped);
        const stepEl = railRef.current?.querySelector<HTMLElement>(`[data-story-step="${CSS.escape(steps[clamped]?.id ?? "")}"]`);
        if (!stepEl) return;
        const behavior: ScrollBehavior = prefersReducedMotion ? "auto" : "smooth";
        const scroller = resolveScroller();
        const rect = stepEl.getBoundingClientRect();
        const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
        const viewBottom = viewTop + (scroller ? scroller.clientHeight : window.innerHeight);
        const occ = Math.min(occlusionBottom(viewTop), viewBottom);
        const navLine = layoutRef.current === "stacked"
            ? occ + (viewBottom - occ) * NAV_OFFSET
            : Math.max(occ, viewTop + (viewBottom - viewTop) * NAV_OFFSET);
        if (scroller) {
            scroller.scrollBy({ top: rect.top - navLine, behavior });
        } else {
            window.scrollBy({ top: rect.top - navLine, behavior });
        }
    }, [total, steps, applyActive, prefersReducedMotion, resolveScroller, occlusionBottom]);

    // ---- external binding writes are navigation ------------------------------
    const bindingValue = useActiveBindingValue(isStatic ? undefined : activeBinding);
    useEffect(() => {
        if (bindingValue === undefined) return;
        if (bindingValue !== activeRef.current) {
            navigateTo(bindingValue);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bindingValue]);

    // ---- scroll driver (observe, never hijack) -------------------------------
    useEffect(() => {
        if (isStatic || total === 0) return;
        const rail = railRef.current;
        if (!rail) return;

        let raf = 0;
        const measure = () => {
            raf = 0;
            const scroller = resolveScroller();
            const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
            const viewHeight = scroller ? scroller.clientHeight : window.innerHeight;
            // In stacked layout the trigger line lives in the readable strip
            // below the sticky stage; in rail layouts it floors at the chrome.
            const viewBottom = viewTop + viewHeight;
            const occ = Math.min(occlusionBottom(viewTop), viewBottom);
            const line = layoutRef.current === "stacked"
                ? occ + (viewBottom - occ) * TRIGGER_LINE
                : Math.max(occ, viewTop + viewHeight * TRIGGER_LINE);

            const blocks = rail.querySelectorAll<HTMLElement>("[data-story-step]");
            let current = 0;
            let progress = 0;
            blocks.forEach((el, i) => {
                const rect = el.getBoundingClientRect();
                if (rect.top <= line) {
                    current = i;
                    progress = rect.height > 0 ? (line - rect.top) / rect.height : 0;
                }
            });
            applyActive(current);
            if (progressBinding) {
                const p = Math.max(0, Math.min(1, progress));
                queueMicrotask(() => progressBinding.write(p));
            }
        };
        const onScroll = () => {
            if (raf === 0) raf = requestAnimationFrame(measure);
        };

        const scroller = resolveScroller();
        const target: EventTarget = scroller ?? window;
        target.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll, { passive: true });
        measure();
        return () => {
            target.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onScroll);
            if (raf !== 0) cancelAnimationFrame(raf);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isStatic, total, applyActive, progressBinding, resolveScroller]);

    // ---- forced stacked under 720px + measured scrollport height -------------
    // (height accepts any CSS length, so the runway math measures the real
    // box instead of parsing the style string)
    const [narrow, setNarrow] = useState(false);
    const [portHeight, setPortHeight] = useState(0);
    useEffect(() => {
        const el = rootRef.current;
        if (!el) return;
        const ro = new ResizeObserver(([entry]) => {
            if (entry) {
                setNarrow(entry.contentRect.width < STACK_BREAKPOINT);
                setPortHeight(entry.contentRect.height);
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const layout = narrow ? "stacked" : layoutPref;
    layoutRef.current = layout;
    const effectiveStageHeight = layout === "stacked" ? `min(${stageHeight}, ${STACKED_STAGE_CAP})` : stageHeight;

    // Measured heights of the sticky chrome row and stage block in stacked
    // layout: the runway math sizes steps against the readable strip beneath
    // them, and the stage pins to the chrome's real bottom (a hard-coded top
    // would leave a px gap where prose ghosts through).
    const [chromePx, setChromePx] = useState(0);
    const [stickyPx, setStickyPx] = useState(0);
    useEffect(() => {
        const root = rootRef.current;
        if (!root || layout !== "stacked") { setChromePx(0); setStickyPx(0); return; }
        const stage = root.querySelector('[data-scope="story-stage"]');
        const chrome = root.querySelector('[data-scope="story-progress"]');
        const update = () => {
            const ch = chrome ? chrome.getBoundingClientRect().height : 0;
            const st = stage ? stage.getBoundingClientRect().height : 0;
            // Tuck the stage 1px under the chrome (z-below it) so fractional
            // row heights can't open a gap that prose ghosts through.
            setChromePx(Math.max(0, Math.floor(ch) - 1));
            setStickyPx(Math.round(ch + st));
        };
        const ro = new ResizeObserver(update);
        if (stage) ro.observe(stage);
        if (chrome) ro.observe(chrome);
        update();
        return () => ro.disconnect();
    }, [layout, total]);

    // ---- keyboard (no focus trap; Tab exits normally) -------------------------
    const onKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (isStatic) return;
        switch (e.key) {
            case "ArrowDown": case "j": navigateTo(activeRef.current + 1); e.preventDefault(); break;
            case "ArrowUp": case "k": navigateTo(activeRef.current - 1); e.preventDefault(); break;
            case "Home": navigateTo(0); e.preventDefault(); break;
            case "End": navigateTo(total - 1); e.preventDefault(); break;
        }
    }, [isStatic, navigateTo, total]);

    // ---- render ---------------------------------------------------------------
    const kfOwner = keyframeOwner(steps, active);
    const chromeHeight = title !== undefined ? 41 : 0;
    const stageTop = 16 + chromeHeight;

    const stage = (
        // In stacked mode the prose scrolls UNDERNEATH the sticky stage, so
        // the slot must be opaque (with a hairline rule); in rail layouts it
        // stays unchromed per the spec — keyframes bring their own framing.
        <ChakraBox
            position="sticky"
            top={layout === "stacked" ? `${title !== undefined ? chromePx : 0}px` : `${stageTop}px`}
            paddingBottom="4"
            data-scope="story-stage"
            background={layout === "stacked" ? "bg.surface" : undefined}
            borderBottomWidth={layout === "stacked" ? "1px" : undefined}
            borderColor={layout === "stacked" ? "border.subtle" : undefined}
            zIndex={layout === "stacked" ? 2 : undefined}
        >
            <ChakraBox position="relative" height={effectiveStageHeight}>
                {steps.map((step, i) => step.stage !== undefined && (
                    <ChakraBox
                        key={step.id}
                        position="absolute"
                        inset="0"
                        opacity={i === kfOwner ? 1 : 0}
                        pointerEvents={i === kfOwner ? "auto" : "none"}
                        transition={`opacity ${fadeMs}ms ease-out`}
                        data-story-keyframe={step.id}
                        data-active={i === kfOwner ? "true" : "false"}
                    >
                        <EastChakraComponent value={step.stage} storageKey={`${storageKey}.stage.${step.id}`} />
                    </ChakraBox>
                ))}
            </ChakraBox>
        </ChakraBox>
    );

    const rail = (
        <ChakraBox ref={railRef} paddingTop="4" data-scope="story-rail">
            {steps.map((step, i) => (
                <StoryStepBlock
                    key={step.id}
                    step={step}
                    index={i}
                    total={total}
                    state={i === active ? "active" : i < active ? "visited" : "upcoming"}
                    minHeight={isStatic ? undefined : ownScrollport
                        // The last step's runway is the distance from the
                        // trigger line to the port bottom (plus a small
                        // margin): enough to activate at max scroll, without
                        // over-travelling its prose up under the chrome/stage.
                        ? (i === total - 1
                            ? `${Math.max(120, Math.round(
                                (1 - TRIGGER_LINE) * (layout === "stacked" ? Math.max(0, portHeight - stickyPx) : portHeight) + 16))}px`
                            : `${Math.max(120, Math.round(
                                (layout === "stacked"
                                    ? Math.max(0, portHeight - stickyPx)
                                    : portHeight - chromeHeight)
                                * (runwayVh / 52)))}px`)
                        : `${runwayVh + (i === total - 1 ? 20 : 0)}vh`}
                    storageKey={`${storageKey}.step.${step.id}`}
                    onActivate={isStatic ? undefined : navigateTo}
                />
            ))}
        </ChakraBox>
    );

    return (
        <ChakraBox
            ref={rootRef}
            position="relative"
            tabIndex={0}
            outline="none"
            onKeyDown={onKeyDown}
            data-scope="story"
            data-active-step={steps[active]?.id}
            height={ownScrollport ? scrollportHeight : undefined}
            overflowY={ownScrollport ? "auto" : undefined}
            overflowX={ownScrollport ? "hidden" : undefined}
            background={ownScrollport ? "bg.surface" : undefined}
        >
            {title !== undefined && (
                <StoryChromeRow
                    title={title}
                    count={total}
                    active={active}
                    sticky={!isStatic}
                    onNavigate={isStatic ? undefined : navigateTo}
                />
            )}
            {layout === "stacked" ? (
                <ChakraBox>
                    {stage}
                    {rail}
                </ChakraBox>
            ) : (
                <ChakraBox
                    display="grid"
                    gridTemplateColumns={layout === "rail-right"
                        ? "minmax(0, 1fr) clamp(280px, 34%, 380px)"
                        : "clamp(280px, 34%, 380px) minmax(0, 1fr)"}
                    gap="28px"
                >
                    {layout === "rail-right" ? (
                        <>
                            <ChakraBox minWidth="0">{stage}</ChakraBox>
                            {rail}
                        </>
                    ) : (
                        <>
                            {rail}
                            <ChakraBox minWidth="0">{stage}</ChakraBox>
                        </>
                    )}
                </ChakraBox>
            )}
        </ChakraBox>
    );
}, (prev, next) => storyEqual(prev.value, next.value) && prev.storageKey === next.storageKey);

// ============================================================================
// EastChakraStoryStep — standalone degraded render
// ============================================================================

export interface EastChakraStoryStepProps {
    value: StoryStepValue;
    storageKey: string;
}

/**
 * A StoryStep rendered outside a Story degrades to a plain rail block at
 * full ink (no spine context, no scroll driving).
 */
export const EastChakraStoryStep = memo(function EastChakraStoryStep({ value, storageKey }: EastChakraStoryStepProps) {
    const step = useMemo<ExtractedStep>(() => ({
        id: value.id,
        eyebrow: getSomeorUndefined(value.eyebrow),
        title: getSomeorUndefined(value.title),
        stage: getSomeorUndefined(value.stage) as UIComponentValue | undefined,
        body: value.body as UIComponentValue[],
    }), [value]);
    return (
        <StoryStepBlock
            step={step}
            index={0}
            total={1}
            state="active"
            minHeight={undefined}
            storageKey={storageKey}
            onActivate={undefined}
        />
    );
}, (prev, next) => storyStepEqual(prev.value, next.value) && prev.storageKey === next.storageKey);

// ============================================================================
// EastChakraStoryProgress — standalone chrome
// ============================================================================

export interface EastChakraStoryProgressProps {
    value: StoryProgressValue;
    storageKey: string;
}

/**
 * Standalone Story.Progress: shares nothing with the Story but the
 * `active` binding — dots and prev/next write it, and the Story's rail
 * treats the write as navigation.
 */
export const EastChakraStoryProgress = memo(function EastChakraStoryProgress({ value }: EastChakraStoryProgressProps) {
    const count = Number(value.count);
    const binding = useMemo(() => getSomeorUndefined(value.active), [value.active]) as ActiveBinding | undefined;
    const bound = useActiveBindingValue(binding);

    // Internal fallback state when unbound (the chrome is still browsable)
    const [internal, setInternal] = useState(0);
    const active = Math.max(0, Math.min(count - 1, bound ?? internal));

    const onNavigate = useCallback((index: number) => {
        const clamped = Math.max(0, Math.min(count - 1, index));
        setInternal(clamped);
        if (binding) {
            queueMicrotask(() => binding.write(BigInt(clamped)));
        }
    }, [count, binding]);

    return (
        <StoryChromeRow
            title={getSomeorUndefined(value.title)}
            count={count}
            active={active}
            sticky={false}
            onNavigate={onNavigate}
        />
    );
}, (prev, next) => storyProgressEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
