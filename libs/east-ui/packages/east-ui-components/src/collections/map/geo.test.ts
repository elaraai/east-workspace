/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure-geometry tests for the Map H3 helpers ({@link ./geo}): a `k = 1` disk
 * expands to 7 hex rings, cell rings round-trip, lat/lng order matches Leaflet
 * (no GeoJSON swap), and the bounding box encloses every vertex.
 */

import { describe, it, expect } from "vitest";
import { latLngToCell } from "h3-js";
import { arrowHead, bboxOfRings, cellRings, diskRings, type LatLng } from "./geo";

const CBD: [number, number] = [-34.9258, 138.5994];

describe("diskRings", () => {
    it("expands a k=1 disk to 7 cells", () => {
        const rings = diskRings(CBD, 1, 8);
        expect(rings).toHaveLength(7);
    });

    it("returns closed-ish hex rings of 6+ vertices", () => {
        const rings = diskRings(CBD, 1, 8);
        for (const ring of rings) {
            expect(ring.length).toBeGreaterThanOrEqual(6);
        }
    });

    it("keeps [lat, lng] order — latitude near the origin, no GeoJSON swap", () => {
        const [ring] = diskRings(CBD, 0, 8);
        expect(ring).toBeDefined();
        // Adelaide latitudes are ~ -34.9, longitudes ~ 138.6 — the first slot is lat.
        for (const [lat, lng] of ring!) {
            expect(lat).toBeGreaterThan(-36);
            expect(lat).toBeLessThan(-33);
            expect(lng).toBeGreaterThan(137);
            expect(lng).toBeLessThan(140);
        }
    });
});

describe("cellRings", () => {
    it("expands explicit cell ids to rings", () => {
        const id = latLngToCell(CBD[0], CBD[1], 8);
        const rings = cellRings([id]);
        expect(rings).toHaveLength(1);
        expect(rings[0]!.length).toBeGreaterThanOrEqual(6);
    });
});

describe("bboxOfRings", () => {
    it("encloses every vertex", () => {
        const rings = diskRings(CBD, 1, 8);
        const bbox = bboxOfRings(rings);
        expect(bbox).toBeDefined();
        const [[swLat, swLng], [neLat, neLng]] = bbox!;
        for (const ring of rings) {
            for (const [lat, lng] of ring) {
                expect(lat).toBeGreaterThanOrEqual(swLat);
                expect(lat).toBeLessThanOrEqual(neLat);
                expect(lng).toBeGreaterThanOrEqual(swLng);
                expect(lng).toBeLessThanOrEqual(neLng);
            }
        }
    });

    it("returns undefined for no rings", () => {
        expect(bboxOfRings([])).toBeUndefined();
    });
});

describe("arrowHead", () => {
    it("returns undefined for fewer than 2 points", () => {
        expect(arrowHead([[-34.9, 138.6]])).toBeUndefined();
    });

    it("produces a 3-point triangle with the tip at the destination", () => {
        const pts: LatLng[] = [[-34.905, 138.6], [-34.852, 138.6]];
        const head = arrowHead(pts);
        expect(head).toBeDefined();
        expect(head).toHaveLength(3);
        // tip is the last point
        expect(head![0]).toEqual(pts[1]);
        // the two base vertices sit behind the tip (lower latitude, heading north)
        expect(head![1]![0]).toBeLessThan(pts[1]![0]);
        expect(head![2]![0]).toBeLessThan(pts[1]![0]);
    });
});
