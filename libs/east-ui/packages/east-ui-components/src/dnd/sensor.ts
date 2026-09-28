/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The drag layer's sensors (#608), on dnd-kit's sensor contract: one for the
 * pointer — mouse, pen and touch — and one for the keyboard.
 *
 * dnd-kit's own pointer sensors follow whichever pointer moves, so a second
 * finger's `pointerup` ends — and commits — the first finger's drag. The
 * pointer sensor here belongs to the pointer that pressed: moves, releases and
 * cancels from any other pointer are never this drag's. It also engages per
 * pointer type:
 *
 * - a mouse or a pen engages once it has travelled `distance` px, so a click
 *   stays a click;
 * - a touch on the body engages after a `delay` ms hold, and drifting more than
 *   `tolerance` px first is a scroll — the sensor stands down and the page pans;
 * - a touch on a drag grip (`[data-drag-grip]`) engages at once: a grip is
 *   unambiguous intent, and it takes no scroll gesture (`touch-action: none`).
 *
 * Once a touch drag engages, the page does not pan for the rest of it. Escape,
 * a window resize or a hidden page cancels the drag, and the click a drag ends
 * with never reaches the element it began on.
 *
 * The keyboard sensor picks a focused draggable up with a start key, drops it
 * with an end key and cancels it with a cancel key (the layer's: Space or
 * Enter, Space or Enter, Escape or Tab). The arrow keys are the drag's while
 * it lasts, and only they move it — to wherever the layer's coordinate getter
 * says; a modifier or a letter pressed mid-drag leaves it where it rests. The
 * layer scrolls what a step lands on into view, so the sensor scrolls nothing
 * itself.
 *
 * Both write the drag's modifiers and position into the layer's
 * {@link DragTrack}, and leave their `abort` there while they carry a drag:
 * dnd-kit never tears down the sensor of a drag whose context unmounted, so
 * the layer does — the sensor's page-wide listeners would otherwise outlive
 * it, and swallow the next key the page is pressed.
 *
 * @packageDocumentation
 */

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type {
    Activators, DraggableNode, KeyboardCodes, KeyboardCoordinateGetter, SensorInstance, SensorProps,
} from "@dnd-kit/core";

/** The drag in flight, as its sensor reports it — written by the sensors, read by the layer. */
export interface DragTrack {
    /** Whether Alt (Option) is held — an `add` drop is then a duplicate. */
    altKey: boolean;
    /** The pointer's last position, in client px — `undefined` for a keyboard drag. */
    point: { x: number; y: number } | undefined;
    /** Ends the drag without a drop — left by the sensor that carries it, for as long as it does. */
    abort: (() => void) | undefined;
}

/** {@link DragPointerSensor}'s options. */
export interface DragPointerOptions {
    /** Mouse and pen: the px a press travels before the drag engages. */
    distance: number;
    /** Touch: the ms a press holds before the drag engages. */
    delay: number;
    /** Touch: the px a press may drift during the hold — more is a scroll. */
    tolerance: number;
    /** Where the pointer and its modifiers are written, and the drag's abort left. */
    track: DragTrack;
}

/** {@link DragKeyboardSensor}'s options. */
export interface DragKeyboardOptions {
    /** The keys (`event.code`) that pick a drag up, drop it and cancel it. */
    keyboardCodes: KeyboardCodes;
    /** Where an arrow key takes the drag — the collision rect's new top-left, or `undefined` to stay. */
    coordinateGetter: KeyboardCoordinateGetter;
    /** Where the modifiers are written, and the drag's abort left. */
    track: DragTrack;
}

type Remove = () => void;

function listen<E extends Event>(
    target: EventTarget,
    type: string,
    handler: (event: E) => void,
    options?: AddEventListenerOptions,
): Remove {
    const h = handler as EventListener;
    target.addEventListener(type, h, options);
    return () => target.removeEventListener(type, h, options);
}

const preventDefault = (event: Event): void => { event.preventDefault(); };

/**
 * The drag layer's pointer sensor — see the module docs.
 */
export class DragPointerSensor implements SensorInstance {
    /** The layer scrolls what lies under the pointer itself, so dnd-kit's scroller stays off. */
    public autoScrollEnabled = false;

    private readonly props: SensorProps<DragPointerOptions>;
    private readonly pointerId: number;
    private readonly touch: boolean;
    private readonly initial: { x: number; y: number };
    private readonly doc: Document;
    private readonly origin: Element | null;
    private activated = false;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private listeners: Remove[] = [];

    /**
     * Take the press a draggable's `onPointerDown` began.
     *
     * @param props - dnd-kit's sensor props; `props.event` is the `pointerdown`
     */
    constructor(props: SensorProps<DragPointerOptions>) {
        this.props = props;
        const event = props.event as PointerEvent;
        this.pointerId = event.pointerId;
        this.touch = event.pointerType === "touch";
        this.initial = { x: event.clientX, y: event.clientY };
        this.origin = event.target instanceof Element ? event.target : null;
        this.doc = this.origin?.ownerDocument ?? document;
        const win = this.doc.defaultView ?? window;
        const { options } = props;
        options.track.altKey = event.altKey;
        options.track.point = this.initial;
        options.track.abort = this.cancel;

        this.listeners = [
            listen<PointerEvent>(this.doc, "pointermove", this.handleMove, { passive: false }),
            listen<PointerEvent>(this.doc, "pointerup", this.handleUp),
            listen<PointerEvent>(this.doc, "pointercancel", this.handlePointerCancel),
            listen<KeyboardEvent>(this.doc, "keydown", this.handleKey),
            listen<KeyboardEvent>(this.doc, "keyup", this.handleKey),
            listen(this.doc, "visibilitychange", this.cancel),
            listen(win, "resize", this.cancel),
            listen(win, "dragstart", preventDefault),
            listen(win, "contextmenu", preventDefault),
        ];

        const onGrip = this.origin?.closest("[data-drag-grip]") != null;
        if (this.touch && !onGrip) {
            this.timer = setTimeout(this.start, options.delay);
            props.onPending(props.active, { delay: options.delay, tolerance: options.tolerance }, this.initial);
        } else if (!this.touch && options.distance > 0) {
            props.onPending(props.active, { distance: options.distance }, this.initial);
        } else {
            this.start();
        }
    }

    /** The draggable's activator: the primary button's press, of any pointer type. */
    static activators: Activators<DragPointerOptions> = [{
        eventName: "onPointerDown",
        handler: ({ nativeEvent }: { nativeEvent: PointerEvent }) => nativeEvent.button === 0,
    }];

    /** Engage the drag. */
    private readonly start = (): void => {
        if (this.activated) return;
        this.activated = true;
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.clearSelection();
        this.listeners.push(listen(this.doc, "selectionchange", this.clearSelection));
        // An engaged touch drag owns the gesture: the page must not pan under it.
        if (this.touch) this.listeners.push(listen(this.doc, "touchmove", preventDefault, { passive: false }));
        this.props.onStart(this.initial);
    };

    private readonly handleMove = (event: PointerEvent): void => {
        // Another pointer's move is never this drag's.
        if (event.pointerId !== this.pointerId) return;
        const { options } = this.props;
        const point = { x: event.clientX, y: event.clientY };
        options.track.altKey = event.altKey;
        options.track.point = point;
        if (!this.activated) {
            const moved = Math.hypot(point.x - this.initial.x, point.y - this.initial.y);
            if (this.touch) {
                // A drift before the hold is a scroll: stand down, and let the page pan.
                if (moved > options.tolerance) this.cancel();
                return;
            }
            if (moved < options.distance) return;
            this.start();
        }
        if (event.cancelable) event.preventDefault();
        this.props.onMove(point);
    };

    private readonly handleUp = (event: PointerEvent): void => {
        // Another finger's release must not end — and commit — this drag.
        if (event.pointerId !== this.pointerId) return;
        const { options } = this.props;
        options.track.altKey = event.altKey;
        options.track.point = { x: event.clientX, y: event.clientY };
        const activated = this.activated;
        this.detach();
        if (!activated) this.props.onAbort(this.props.active);
        else this.suppressClick();
        this.props.onEnd();
    };

    private readonly handlePointerCancel = (event: PointerEvent): void => {
        if (event.pointerId !== this.pointerId) return;
        this.cancel();
    };

    private readonly handleKey = (event: KeyboardEvent): void => {
        this.props.options.track.altKey = event.altKey;
        if (event.type === "keydown" && (event.key === "Escape" || event.code === "Escape")) this.cancel();
    };

    /** Stand down, or cancel an engaged drag. */
    private readonly cancel = (): void => {
        const activated = this.activated;
        this.detach();
        if (!activated) this.props.onAbort(this.props.active);
        this.props.onCancel();
    };

    private readonly clearSelection = (): void => {
        this.doc.getSelection()?.removeAllRanges();
    };

    /**
     * The click a drag ends with would land on the element it began on (or an
     * ancestor both ends share) — a chip dropped back where it was would
     * select itself. That one click is swallowed; any other click passes, and
     * the next press, or the end of the task, retires the guard.
     */
    private suppressClick(): void {
        const origin = this.origin;
        if (origin === null) return;
        const removers: Remove[] = [];
        const retire = (): void => { for (const remove of removers.splice(0)) remove(); };
        removers.push(
            listen<MouseEvent>(this.doc, "click", (event) => {
                const target = event.target;
                if (target instanceof Node && (origin.contains(target) || target.contains(origin))) {
                    event.stopPropagation();
                    event.preventDefault();
                }
                retire();
            }, { capture: true }),
            listen(this.doc, "pointerdown", retire, { capture: true }),
            listen(this.doc, "mousedown", retire, { capture: true }),
        );
        setTimeout(retire, 0);
    }

    private detach(): void {
        for (const remove of this.listeners.splice(0)) remove();
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        const { track } = this.props.options;
        if (track.abort === this.cancel) track.abort = undefined;
    }
}

/** The keys that move a keyboard drag. */
const ARROWS: ReadonlySet<string> = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

/**
 * The drag layer's keyboard sensor — see the module docs.
 */
export class DragKeyboardSensor implements SensorInstance {
    /** The layer scrolls what a step lands on into view, so dnd-kit's scroller stays off. */
    public autoScrollEnabled = false;

    private readonly props: SensorProps<DragKeyboardOptions>;
    private readonly doc: Document;
    /** The collision rect's top-left at the first arrow — every move is an offset from it. */
    private reference: { x: number; y: number } | undefined;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private listeners: Remove[] = [];

    /**
     * Take the drag a draggable's `onKeyDown` picked up.
     *
     * @param props - dnd-kit's sensor props; `props.event` is the `keydown`
     */
    constructor(props: SensorProps<DragKeyboardOptions>) {
        this.props = props;
        const event = props.event as KeyboardEvent;
        this.doc = (event.target instanceof Node ? event.target.ownerDocument : null) ?? document;
        const win = this.doc.defaultView ?? window;
        const { options } = props;
        options.track.altKey = event.altKey;
        options.track.point = undefined;
        options.track.abort = this.cancel;
        this.listeners = [
            listen<KeyboardEvent>(this.doc, "keyup", this.handleKeyUp),
            listen(this.doc, "visibilitychange", this.cancel),
            listen(win, "resize", this.cancel),
        ];
        props.activeNode.node.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        props.onStart({ x: 0, y: 0 });
        // The key that picked the drag up is still on its way to the document:
        // listen from the next task, or it would drop what it just picked up.
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.listeners.push(listen<KeyboardEvent>(this.doc, "keydown", this.handleKeyDown));
        }, 0);
    }

    /** The draggable's activator: a start key pressed on the draggable itself — never in a control inside it. */
    static activators: Activators<DragKeyboardOptions> = [{
        eventName: "onKeyDown",
        handler: (event: ReactKeyboardEvent, { keyboardCodes }: DragKeyboardOptions, { active }: { active: DraggableNode }) => {
            if (!keyboardCodes.start.includes(event.nativeEvent.code)) return false;
            const activator = active.activatorNode.current;
            if (activator !== null && event.target !== activator) return false;
            event.preventDefault();
            return true;
        },
    }];

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        const { options } = this.props;
        options.track.altKey = event.altKey;
        if (options.keyboardCodes.end.includes(event.code)) {
            event.preventDefault();
            this.detach();
            this.props.onEnd();
            return;
        }
        if (options.keyboardCodes.cancel.includes(event.code)) {
            event.preventDefault();
            this.cancel();
            return;
        }
        if (!ARROWS.has(event.code)) return;
        // The arrows are the drag's: nowhere to go that way is a step not taken, never a page scroll.
        event.preventDefault();
        const context = this.props.context.current;
        const rect = context.collisionRect;
        const current = rect !== null ? { x: rect.left, y: rect.top } : { x: 0, y: 0 };
        this.reference ??= current;
        const next = options.coordinateGetter(event, { active: this.props.active, context, currentCoordinates: current });
        if (next === undefined) return;
        this.props.onMove({ x: next.x - this.reference.x, y: next.y - this.reference.y });
    };

    private readonly handleKeyUp = (event: KeyboardEvent): void => {
        this.props.options.track.altKey = event.altKey;
    };

    /** Cancel the drag. */
    private readonly cancel = (): void => {
        this.detach();
        this.props.onCancel();
    };

    private detach(): void {
        for (const remove of this.listeners.splice(0)) remove();
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        const { track } = this.props.options;
        if (track.abort === this.cancel) track.abort = undefined;
    }
}
