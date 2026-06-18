/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<Map>` tag — see the export's JSDoc. */

import { type ExprType, type SubtypeExprOrValue, ArrayType, StructType } from "@elaraai/east";
import {
    Map as MapFactory,
    type MapConfig,
    type RowElement,
} from "../../collections/map/index.js";
import { UIComponentType } from "../../component.js";

/**
 * `<Map>` — an interactive geographic basemap (CARTO / OSM raster tiles) with
 * H3 hex and filled-area overlays, connector lines, pins, standalone labels,
 * and a generalised overlay slot hosting arbitrary East `UIComponent`
 * children positioned over the canvas. Read-only / selection-only; writes
 * ride in through ordinary `Button` children in the overlay slot.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, StringType, NullType } from "@elaraai/east";
 * import { Map, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const moveMap = East.function([], UIComponentType, $ => {
 *     const onArea = $.const(East.function([StringType], NullType, (_$, _key) => null));
 *     return (
 *         <Map
 *             tiles={Map.carto("positron")}
 *             center={Map.at(-34.881, 138.6)} zoom={12n}
 *             lodZoom={13n}
 *             areas={[{ id: "5000", name: "5000 · CBD", lat: -34.9258, lng: 138.5994 }]}
 *             area={a => ({
 *                 key: a.id, label: a.name,
 *                 shape: Map.hexDisk(Map.at(a.lat, a.lng), 1n, 8n),
 *             })}
 *             markers={[{ id: "okafor", lat: -34.842, lng: 138.598, name: "J. Okafor" }]}
 *             marker={m => ({ key: m.id, lat: m.lat, lng: m.lng, label: m.name, icon: "house", minZoom: 13n })}
 *             overlays={[Map.overlay(<Text fontFamily="mono">ELARA</Text>, { key: "hud" })]}
 *             onAreaClick={onArea}
 *             height="540px"
 *         />
 *     );
 * });
 * ```
 *
 * @remarks
 * Desugars to `Map.Root(markers, config)`.
 */
function MapTag<
    M extends SubtypeExprOrValue<ArrayType<StructType>>,
    A extends SubtypeExprOrValue<ArrayType<StructType>> = [],
    La extends SubtypeExprOrValue<ArrayType<StructType>> = [],
    L extends SubtypeExprOrValue<ArrayType<StructType>> = [],
>(
    props: { markers: M }
        & MapConfig<RowElement<M>, RowElement<A>, RowElement<La>, RowElement<L>>
        & { areas?: A; labels?: La; lines?: L },
): ExprType<UIComponentType> {
    const { markers, ...config } = props;
    return MapFactory.Root(markers, config as never);
}

export const Map: typeof MapTag & {
    at: typeof MapFactory.at;
    carto: typeof MapFactory.carto;
    osm: typeof MapFactory.osm;
    tile: typeof MapFactory.tile;
    hexDisk: typeof MapFactory.hexDisk;
    cells: typeof MapFactory.cells;
    polygon: typeof MapFactory.polygon;
    hex: typeof MapFactory.hex;
    marker: typeof MapFactory.marker;
    area: typeof MapFactory.area;
    line: typeof MapFactory.line;
    solid: typeof MapFactory.solid;
    dashed: typeof MapFactory.dashed;
    point: typeof MapFactory.point;
    bounds: typeof MapFactory.bounds;
    overlay: typeof MapFactory.overlay;
    Types: typeof MapFactory.Types;
} = Object.assign(MapTag, {
    at: MapFactory.at,
    carto: MapFactory.carto,
    osm: MapFactory.osm,
    tile: MapFactory.tile,
    hexDisk: MapFactory.hexDisk,
    cells: MapFactory.cells,
    polygon: MapFactory.polygon,
    hex: MapFactory.hex,
    marker: MapFactory.marker,
    area: MapFactory.area,
    line: MapFactory.line,
    solid: MapFactory.solid,
    dashed: MapFactory.dashed,
    point: MapFactory.point,
    bounds: MapFactory.bounds,
    overlay: MapFactory.overlay,
    Types: MapFactory.Types,
});
