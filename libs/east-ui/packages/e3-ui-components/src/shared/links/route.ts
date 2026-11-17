/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A family of links laid out together, the logic every builder that draws
 * links shares (#1680's review): a host resolves each link's two ends from its
 * own model — where each element draws, in its own px — and its weight, and
 * this lays the family out:
 *
 * 1. **Ports.** Links that share an element's end, or its start, stack their
 *    ports about its centre line (`ports.ts`). An end out of view meets the
 *    view's edge, and takes no port.
 * 2. **Routes.** Each link is routed by the grammar (`geometry.ts`), from its
 *    ports, on the lane and with the caption its host planned for it, where
 *    it planned one (`lanes.ts`).
 * 3. **Captions.** Each caption kept inside the bounds and stepped clear of
 *    an earlier one (`captions.ts`).
 *
 * The render layer draws what this returns: the SVG layer (`layer.tsx`) the
 * Plan's and the Allocation's links draw on. Pure: no React, no DOM.
 *
 * @packageDocumentation
 */

import { placeCaptions } from "./captions.js";
import { routeRibbon, type RibbonBounds, type RibbonEnd, type RibbonPath, type RibbonRouteOptions } from "./geometry.js";
import { linkPorts, portSize, type LinkPort } from "./ports.js";

/** One link as its host hands it over: its ends as they draw, the elements they meet, its weight and its caption. */
export interface LinkToRoute {
    readonly from: RibbonEnd;
    readonly to: RibbonEnd;
    /** The element the link leaves, as a key: links leaving one element's end share it, and spread there. */
    readonly fromAt: string;
    /** The element the link enters, as a key: links entering one element's start share it. */
    readonly toAt: string;
    /** Its weight: its stroke's width, as the host weighs it. */
    readonly weight: number;
    /** Its caption; `undefined` for none. */
    readonly label: string | undefined;
    /** Its planned lane and caption, where its host lays bands out for them (`lanes.ts`). */
    readonly plan?: RibbonRouteOptions | undefined;
}

/** A routed link: its paths, its ends with their ports, and its caption where it is placed. */
export interface RoutedLink extends RibbonPath {
    readonly from: RibbonEnd;
    readonly to: RibbonEnd;
    readonly label: string | undefined;
}

/** The centre line of an end. */
const centreOf = (end: RibbonEnd): number => (end.top + end.bottom) / 2;

/**
 * Lays a family of links out: each one's ports, its route and its caption.
 *
 * @param links - The links, in drawing order
 * @param bounds - The edges nothing of a link crosses
 * @returns Each link routed, in the order given
 */
export function routeLinks(links: readonly LinkToRoute[], bounds: RibbonBounds): RoutedLink[] {
    // Each end in view is a port at its element's end or start; one out of view meets the view's edge, as it is.
    const ports: LinkPort[] = [];
    const portOf: { from: number | undefined; to: number | undefined }[] = links.map((link) => {
        const from = link.from.off === undefined ? ports.push({
            at: `${link.fromAt}\u0000exit`, centre: centreOf(link.from), size: portSize(link.weight, "exit"), other: centreOf(link.to),
        }) - 1 : undefined;
        const to = link.to.off === undefined ? ports.push({
            at: `${link.toAt}\u0000entry`, centre: centreOf(link.to), size: portSize(link.weight, "entry"), other: centreOf(link.from),
        }) - 1 : undefined;
        return { from, to };
    });
    const ys = linkPorts(ports);
    const out = links.map((link, i): RoutedLink => {
        const at = portOf[i]!;
        // A port on its element's centre line is no port: the end meets it as it always has.
        const ported = (end: RibbonEnd, p: number | undefined): RibbonEnd =>
            p === undefined || Math.abs(ys[p]! - centreOf(end)) < 1e-9 ? end : { ...end, port: ys[p]! };
        const from = ported(link.from, at.from);
        const to = ported(link.to, at.to);
        return { ...routeRibbon(from, to, link.weight, bounds, link.plan), from, to, label: link.label };
    });
    placeCaptions(out, bounds.left, bounds.right);
    return out;
}
