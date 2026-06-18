/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure, React-free H3 geometry for the Map renderer. Imports `h3-js` (no DOM),
 * so it is safe under the lazy Leaflet engine boundary and unit-testable on its
 * own. H3's `cellToBoundary` returns `[lat, lng]` pairs — exactly Leaflet's
 * polygon order — so rings pass straight through with no coordinate swap.
 *
 * @packageDocumentation
 */

import { cellToBoundary, gridDisk, latLngToCell } from "h3-js";

/** A `[lat, lng]` pair in Leaflet order. */
export type LatLng = [number, number];

/**
 * Expands a `gridDisk(origin, k)` blob into one boundary ring per cell.
 *
 * @param center - The disk origin `[lat, lng]`
 * @param k - Ring count around the origin (`k = 1` ⇒ 7 cells)
 * @param resolution - H3 resolution
 * @returns One `[lat, lng]` ring per cell
 */
export function diskRings(center: LatLng, k: number, resolution: number): LatLng[][] {
    const origin = latLngToCell(center[0], center[1], resolution);
    return gridDisk(origin, k).map(cell => cellToBoundary(cell) as LatLng[]);
}

/**
 * Expands explicit H3 cell ids into boundary rings.
 *
 * @param ids - The H3 cell ids
 * @returns One `[lat, lng]` ring per id
 */
export function cellRings(ids: string[]): LatLng[][] {
    return ids.map(id => cellToBoundary(id) as LatLng[]);
}

/**
 * Computes a small triangular arrowhead at the destination of a polyline,
 * oriented along its last segment. Works in a local planar frame (longitude
 * scaled by `cos(lat)`) so the head stays visually square at any latitude.
 *
 * @param points - The polyline points, in order
 * @param sizeDeg - Arrowhead length in degrees (default ~180 m)
 * @returns The 3-point `[tip, base1, base2]` ring, or `undefined` for < 2 points
 */
export function arrowHead(points: LatLng[], sizeDeg = 0.0016): LatLng[] | undefined {
    if (points.length < 2) return undefined;
    const tip = points[points.length - 1]!;
    const prev = points[points.length - 2]!;
    const cosLat = Math.max(Math.cos((tip[0] * Math.PI) / 180), 1e-6);
    const toXY = (p: LatLng): [number, number] => [p[1] * cosLat, p[0]];
    const toLL = (xy: [number, number]): LatLng => [xy[1], xy[0] / cosLat];
    const t = toXY(tip);
    const q = toXY(prev);
    let dx = t[0] - q[0];
    let dy = t[1] - q[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const px = -dy;
    const py = dx;
    const back = sizeDeg;
    const half = sizeDeg * 0.6;
    const bx = t[0] - dx * back;
    const by = t[1] - dy * back;
    return [tip, toLL([bx + px * half, by + py * half]), toLL([bx - px * half, by - py * half])];
}

/**
 * Computes the south-west / north-east bounding box enclosing all rings.
 *
 * @param rings - The boundary rings
 * @returns `[sw, ne]` or `undefined` when there are no points
 */
export function bboxOfRings(rings: LatLng[][]): [LatLng, LatLng] | undefined {
    let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
    for (const ring of rings) {
        for (const [lat, lng] of ring) {
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
        }
    }
    if (!Number.isFinite(minLat)) return undefined;
    return [[minLat, minLng], [maxLat, maxLng]];
}
