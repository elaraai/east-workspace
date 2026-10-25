/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The links layer's drawing (`Plan links.html`, #1258), shared by Plan's
 * links and the Allocation's (#1321): each host lays its links out from its
 * own model (`routeRibbon`, `ribbonWeight`, `placeCaptions`) and hands them
 * here, in the coordinates of the box the layer fills.
 *
 * Every link is stroked at its weight in the muted ink over a paper CASING
 * one px either side, so it reads over anything it crosses; every link's
 * casing lies under every link's ink, and the lit link — the one under the
 * pointer — is drawn last, over the others, its two ends haloed 1px four
 * outside them. A caption sits on a paper knockout 12 tall, 4 either side of
 * its text, fitted once the text is drawn and again once the fonts come in.
 * A link's hit area is its stroke and 5 either side; the host names what a hit
 * on it is (`hit`). The clip keeps a halo or a casing inside the bounds the
 * routes keep to. An end past a window edge lands in a dashed slot.
 *
 * What a host may add, unused unless it opts in: a SELECTED link, its caption
 * outlined, carrying a × in its own 16px target whose pointer-down is stopped
 * (never a drag) and whose click unlinks (A68); a link DRAG's preview — the
 * moved link faded to its `was` line, and the new line to the pointer (A69);
 * a GRIP on a link's line and its caption, the host's component drawn in their
 * place to spread its drag handle on them (`grip`, A69); thin GUIDES from the
 * pointer into rows (`guides`, A30); captions that take the pointer as the line
 * does, lighting it (`caption`); a link's tone (`data-tone`: a draft's, a
 * drag's verdict) on its group, its casing and its caption alike, so a host
 * may draw a tone outlined; links that light nothing while a drag is under way
 * (`lights={false}`); and the lit link reported (`onLit`), for a host that
 * rings the ends itself (`halo={false}`), as the Allocation rings its bin card
 * and its resource's load bar (A67). The preview and the guides follow the
 * pointer wherever it is, so the bounds' clip does not cut them: the host's box
 * does, and they draw over the captions.
 *
 * Its measures are the links' look's (`look.ts`), which the Schematic's
 * Canvas2D painter (`canvas.ts`, #1403) draws with too.
 *
 * The DOM's vocabulary is Plan's, where these parts began (`data-plan-link`,
 * `data-plan-ribbon-band`, `data-plan-casing`, …), so Plan's tests and its
 * responsive invariants read it unchanged; the theme's shared `linkRibbons`
 * part styles it in every host.
 *
 * @packageDocumentation
 */

import {
    useEffect, useId, useLayoutEffect, useRef, useState, type ComponentType, type KeyboardEvent, type PointerEvent, type ReactNode, type SVGProps,
} from "react";
import { chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { RIBBON_SLOT_W, type RibbonEdgeSlot, type RibbonEnd, type RibbonPath } from "./geometry.js";
import {
    LINK_CASING as CASING, LINK_HALO_OUT as HALO_OUT, LINK_HALO_R as HALO_R, LINK_HIT_REACH as HIT_REACH, LINK_KNOCKOUT_H as KNOCKOUT_H,
    LINK_KNOCKOUT_PAD as KNOCKOUT_PAD, LINK_KNOCKOUT_RISE as KNOCKOUT_RISE,
} from "./look.js";

/** A selected caption's ×: its square target, and the gap from the knockout (px). */
const UNLINK_SIZE = 16;
const UNLINK_GAP = 2;

/** One link the layer draws: its route, its ends and its caption. */
export interface LinkRibbon extends RibbonPath {
    /** Its identity in the layer. */
    id: number;
    /** Its source's rect, as the route met it. */
    from: RibbonEnd;
    /** Its destination's rect. */
    to: RibbonEnd;
    /** Its caption — also its hit area's label; `undefined` for none. */
    label: string | undefined;
    /** Its tone, which the host's recipe draws (`data-tone`): a draft's. */
    tone?: string | undefined;
}

/** A line the layer draws beside the links: its path, and its head. */
export interface LinkLine {
    stroke: string;
    head: string;
}

/** A link drag's preview (A69). */
export interface LinkPreview {
    /** The link being moved, drawn as its faded `was` line; `undefined` for a new link. */
    was: number | undefined;
    /** The new line, from its source to the pointer; `undefined` while it has nowhere to go. */
    line: LinkLine | undefined;
}

/** What a grip spreads on the part it holds: its ref, the handlers that pick a drag up, its role and its marks. */
export interface LinkGripHandle {
    ref?: ((el: SVGElement | null) => void) | undefined;
    onPointerDown?: ((event: PointerEvent<SVGElement>) => void) | undefined;
    onKeyDown?: ((event: KeyboardEvent<SVGElement>) => void) | undefined;
    role?: string | undefined;
    tabIndex?: number | undefined;
    "aria-roledescription"?: string | undefined;
    "aria-describedby"?: string | undefined;
    "aria-disabled"?: boolean | undefined;
    "aria-pressed"?: boolean | undefined;
    [mark: `data-${string}`]: string | undefined;
}

/** What a host's grip is handed (A69): the link, the part it holds, and the part to draw with the grip's handle on it. */
export interface LinkGripProps {
    ribbon: LinkRibbon;
    /** Its line's hit area, or its caption. */
    part: "line" | "caption";
    /** Draws the part, the handle spread on it. */
    render: (handle: LinkGripHandle) => ReactNode;
}

/** What the layer draws. */
export interface LinksLayerProps {
    /** The routed links, in drawing order. */
    ribbons: readonly LinkRibbon[];
    /** The slots ends past a window edge land in. */
    edgeSlots?: readonly RibbonEdgeSlot[] | undefined;
    /** The layer's width and height, in its box's px. */
    width: number | undefined;
    height: number;
    /** The bounds nothing of a link crosses: the clip. */
    clip: { left: number; width: number };
    /** What the hit area of a link carries beyond its geometry: its attributes and its click. */
    hit: (ribbon: LinkRibbon) => SVGProps<SVGPathElement>;
    /** The selected link (A68): its caption outlined, with a × that unlinks. */
    selected?: number | undefined;
    /** Unlinks a link: the selected caption's ×. */
    onUnlink?: ((id: number) => void) | undefined;
    /** The ×'s words for a link (`Unlink LD-2210 · Delete`). */
    unlinkLabel?: ((ribbon: LinkRibbon) => string) | undefined;
    /** A link drag's preview (A69). */
    preview?: LinkPreview | undefined;
    /** Thin lines from the pointer into rows, drawn as the preview is (A30). */
    guides?: readonly LinkLine[] | undefined;
    /** What a caption carries when it takes the pointer as its line does: its attributes, its handlers and its tooltip. Omitted, captions only label. */
    caption?: ((ribbon: LinkRibbon) => SVGProps<SVGGElement> & { title?: string | undefined }) | undefined;
    /**
     * A host's grip on each link's line and on each caption that takes the pointer (A69): a component the layer draws in their
     * place, which spreads its drag handle on them. It keeps one identity — the layer remounts nothing for it — so a drag it
     * starts outlives the render that started it.
     */
    grip?: ComponentType<LinkGripProps> | undefined;
    /** Whether a link under the pointer lights (true by default); a host passes false while a drag is under way, and the lit link goes out. */
    lights?: boolean | undefined;
    /** Hears which link is lit, as it changes; `null` for none. */
    onLit?: ((id: number | null) => void) | undefined;
    /** Whether the layer rings a lit link's ends itself (true by default); a host that rings them passes false. */
    halo?: boolean | undefined;
}

/** The halo round an end a lit link joins — 1px, four outside it as it draws; in view only. */
function EndHalo({ end, side }: { end: RibbonEnd; side: "from" | "to" }) {
    if (end.off !== undefined) return null;
    return (
        <rect data-plan-linkend={side} x={end.leftX - HALO_OUT} y={end.top - HALO_OUT}
            width={Math.max(2, end.rightX - end.leftX) + 2 * HALO_OUT} height={end.bottom - end.top + 2 * HALO_OUT}
            rx={HALO_R} />
    );
}

/** A link's casing — the paper either side of its band and round its heads; it carries the link's tone, for a host that outlines one. */
function Casing({ r }: { r: LinkRibbon }) {
    return (
        <g data-plan-ribbon-casing={r.id} data-tone={r.tone}>
            <path data-plan-casing="band" d={r.stroke} strokeWidth={r.width + 2 * CASING} />
            <path data-plan-casing="head" d={r.head} />
            {r.tail !== "" && <path data-plan-casing="head" d={r.tail} />}
        </g>
    );
}

/**
 * Size each caption's knockout to its text, 4 either side of it, and keep the
 * two inside the bounds: a caption the layout centred near an edge moves in
 * (`data-x` holds where the layout centred it). A selected caption's × sits
 * just past its knockout, outside the clip.
 */
function fitKnockouts(svg: SVGSVGElement | null, left: number, right: number): void {
    if (svg === null) return;
    for (const text of svg.querySelectorAll<SVGTextElement>("[data-plan-ribbon-caption]")) {
        const knockout = text.previousElementSibling;
        if (knockout === null || knockout.tagName.toLowerCase() !== "rect") continue;
        const width = typeof text.getComputedTextLength === "function" ? text.getComputedTextLength() : 0;
        const half = width / 2 + KNOCKOUT_PAD;
        const x = Math.max(left + half, Math.min(right - half, Number(text.getAttribute("data-x"))));
        text.setAttribute("x", String(x));
        knockout.setAttribute("x", String(x - half));
        knockout.setAttribute("width", String(2 * half));
        const id = text.parentElement?.getAttribute("data-plan-ribbon-label");
        const unlink = id === null || id === undefined ? null : svg.querySelector(`[data-plan-ribbon-unlink="${id}"]`);
        if (unlink !== null) unlink.setAttribute("x", String(x + half + UNLINK_GAP));
    }
}

/**
 * The links layer's SVG — inside the host's box, in its coordinates.
 *
 * @param props - The routed links and what the host adds
 * @returns The SVG, or nothing when there is nothing to draw
 */
export function LinksLayer({
    ribbons, edgeSlots = [], width, height, clip, hit, selected, onUnlink, unlinkLabel, preview, guides = [], caption, grip: Grip, lights = true, onLit, halo = true,
}: LinksLayerProps): ReactNode {
    // The link under the pointer — lit, drawn over the others, its ends haloed.
    const [lit, setLit] = useState<number | null>(null);
    // A lit link that is gone (the focus moved on) lights nothing, nor one while the layer lights nothing.
    useLayoutEffect(() => {
        if (lit !== null && (!lights || !ribbons.some((r) => r.id === lit))) setLit(null);
    }, [lit, ribbons, lights]);
    const light = (id: number) => { if (lights) setLit(id); };
    const unlight = (id: number) => setLit((now) => (now === id ? null : now));
    // The host hears the lit link as it changes.
    const heard = useRef<number | null>(null);
    useLayoutEffect(() => {
        if (heard.current === lit) return;
        heard.current = lit;
        onLit?.(lit);
    }, [lit, onLit]);
    // Each caption's knockout is as wide as its text, the two inside the
    // bounds: measured after every render, and again once the fonts have come in.
    const svgRef = useRef<SVGSVGElement | null>(null);
    const edges = useRef({ left: 0, right: 0 });
    useLayoutEffect(() => {
        edges.current = { left: clip.left, right: clip.left + clip.width };
        fitKnockouts(svgRef.current, clip.left, clip.left + clip.width);
    });
    useEffect(() => {
        const fonts = typeof document !== "undefined" ? document.fonts : undefined;
        if (fonts === undefined) return undefined;
        const refit = () => fitKnockouts(svgRef.current, edges.current.left, edges.current.right);
        fonts.addEventListener("loadingdone", refit);
        return () => fonts.removeEventListener("loadingdone", refit);
    }, []);
    // Nothing of the layer leaves the bounds: the routes keep inside them, and
    // the clip takes what a halo or a casing would carry over their edge.
    const clipId = `plan-links-${useId().replace(/[^\w-]/g, "")}`;
    if (ribbons.length === 0 && edgeSlots.length === 0 && preview?.line === undefined && guides.length === 0) return null;
    // The lit link last: its casing and ink over every other link's.
    const ordered = lit === null ? ribbons
        : [...ribbons.filter((r) => r.id !== lit), ...ribbons.filter((r) => r.id === lit)];
    /** A link's hit area — the stroke and 5 either side — a grip's handle on it. */
    const hitArea = (r: LinkRibbon, handle: LinkGripHandle) => (
        <path data-link={r.id} aria-label={r.label} {...hit(r)} {...handle}
            d={r.stroke} strokeWidth={r.width + 2 * HIT_REACH}
            onPointerEnter={() => light(r.id)} onPointerLeave={() => unlight(r.id)} />
    );
    /** A link's caption on its knockout; when it takes the pointer, a grip's handle on it. */
    const captionOf = (r: LinkRibbon, handle: LinkGripHandle) => {
        const { title, ...takes } = caption?.(r) ?? {};
        return (
            <g key={`label-${r.id}`} data-plan-ribbon-label={r.id} data-tone={r.tone} data-selected={selected === r.id ? "" : undefined}
                data-lit={caption !== undefined && lit === r.id ? "" : undefined}
                {...(caption === undefined ? {} : {
                    ...takes, ...handle,
                    onPointerEnter: () => light(r.id),
                    onPointerLeave: () => unlight(r.id),
                })}>
                {title !== undefined && <title>{title}</title>}
                <rect data-plan-ribbon-knockout x={r.lx} y={r.ly - KNOCKOUT_RISE} width={0} height={KNOCKOUT_H} />
                <text data-plan-ribbon-caption data-x={r.lx} x={r.lx} y={r.ly} textAnchor={r.anchor}>{r.label}</text>
            </g>
        );
    };
    return (
        <svg ref={svgRef} width={width} height={height}>
            <defs>
                <clipPath id={clipId}>
                    <rect x={clip.left} y={0} width={Math.max(0, clip.width)} height={height} />
                </clipPath>
            </defs>
            <g data-plan-clip clipPath={`url(#${clipId})`}>
                {/* An end past the window lands in a dashed slot as tall as its
                    element, open toward the edge. */}
                {edgeSlots.map((s, i) => {
                    const inner = s.side === "right" ? s.x - RIBBON_SLOT_W : s.x + RIBBON_SLOT_W;
                    return (
                        <path key={`slot-${i}`} data-plan-linkslot={s.side}
                            d={`M ${s.x} ${s.y} H ${inner} V ${s.y + s.h} H ${s.x}`} />
                    );
                })}
                {/* Every link's casing, under every link's ink — the lit link's
                    comes with it, over the rest. */}
                {ordered.map((r) => (r.id === lit ? null : <Casing key={`casing-${r.id}`} r={r} />))}
                {ordered.map((r) => {
                    const isLit = lit === r.id;
                    return (
                        <g key={r.id} data-plan-link={r.id} data-plan-route={r.route} data-lit={isLit ? "" : undefined} data-tone={r.tone}
                            data-selected={selected === r.id ? "" : undefined} data-was={preview?.was === r.id ? "" : undefined}>
                            {isLit && <Casing r={r} />}
                            <path data-plan-ribbon-band d={r.stroke} strokeWidth={r.width} />
                            <path data-plan-ribbon-head d={r.head} data-plan-stub={r.to.off} />
                            {r.tail !== "" && <path data-plan-ribbon-head d={r.tail} data-plan-stub={r.from.off} />}
                            {isLit && halo && (
                                <>
                                    <EndHalo end={r.from} side="from" />
                                    <EndHalo end={r.to} side="to" />
                                </>
                            )}
                            {/* The hit area — the stroke and 5 either side of it.
                                Its caption is its label; the host names its ref, and its grip holds it. */}
                            {Grip === undefined ? hitArea(r, {}) : <Grip ribbon={r} part="line" render={(handle) => hitArea(r, handle)} />}
                        </g>
                    );
                })}
                {/* The captions, over every link: each on its paper knockout,
                    sized to its text once drawn; the selected one carries its ×. */}
                {ribbons.map((r) => {
                    if (r.label === undefined) return null;
                    // A caption that takes the pointer is a grip too, when the host has one.
                    return Grip === undefined || caption === undefined ? captionOf(r, {})
                        : <Grip key={`label-${r.id}`} ribbon={r} part="caption" render={(handle) => captionOf(r, handle)} />;
                })}
            </g>
            {/* What follows the pointer — the guides into rows (A30) and a link drag's new line (A69) — over the captions, and
                cut by the host's box, not the bounds': a line to the pointer runs past them. */}
            {guides.map((g, i) => (
                <g key={`guide-${i}`} data-plan-link-guide="">
                    <path data-plan-ribbon-band d={g.stroke} />
                    <path data-plan-ribbon-head d={g.head} />
                </g>
            ))}
            {preview?.line !== undefined && (
                <g data-plan-link-preview="">
                    <path data-plan-ribbon-band d={preview.line.stroke} />
                    <path data-plan-ribbon-head d={preview.line.head} />
                </g>
            )}
            {/* The selected caption's × in its own target, just past its knockout: a control, not a link, so the
                bounds' clip does not cut it where its caption sits by an edge. */}
            {ribbons.map((r) => (selected === r.id && r.label !== undefined && onUnlink !== undefined ? (
                <foreignObject key={`unlink-${r.id}`} data-plan-ribbon-unlink={r.id} x={r.lx} y={r.ly - KNOCKOUT_RISE - (UNLINK_SIZE - KNOCKOUT_H) / 2}
                    width={UNLINK_SIZE} height={UNLINK_SIZE}>
                    <chakra.button type="button" aria-label={unlinkLabel?.(r) ?? "Unlink"} title={unlinkLabel?.(r) ?? "Unlink"}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => { event.stopPropagation(); onUnlink(r.id); }}>
                        <FontAwesomeIcon icon={faXmark} />
                    </chakra.button>
                </foreignObject>
            ) : null))}
        </svg>
    );
}
