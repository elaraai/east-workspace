/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the canvas draws (#1386): each kind's rows, as its `rows` read them,
 * made the entities the camera, the painter, the hit-tests and the navigator
 * work over — an item placed at its centre, a zone, a link between two items,
 * a net joining many to many. Each is named on the canvas by its reference,
 * printed (`entityId`): its kind's slot and its key, so two kinds' rows of one
 * key are two entities. A link's ends and a net's sides name their items so.
 * An item's card draws its details' status, bar, figure and second line where
 * its kind gives none — and, while its details row is read, a placeholder in
 * each one's place (#1398): never a value it has not read. React-free data in,
 * data out, unit-tested in `drawn.test.ts`.
 *
 * @packageDocumentation
 */

import { ArrayType, FloatType, OptionType, StringType, StructType, none, parseFor, printFor, some, type ValueTypeOf, type option } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";

const T = Schematic.Types;

/**
 * An item as the canvas draws it: placed at its centre, named by its reference
 * printed.
 *
 * @property key - Its id on the canvas: its reference, printed
 * @property ref - Its kind's slot and its key
 * @property pending - Which of its card's roles its details give, while its details row is read: each a placeholder in
 *   its place (#1398); `none` once it is read, and for a kind with no details
 */
export const SchematicDrawnItemType = StructType({
    key: StringType,
    ref: T.Ref,
    x: FloatType,
    y: FloatType,
    label: StringType,
    sublabel: OptionType(StringType),
    icon: OptionType(StringType),
    status: OptionType(T.Status),
    meter: OptionType(T.Meter),
    metric: OptionType(StringType),
    width: OptionType(FloatType),
    height: OptionType(FloatType),
    footprint: OptionType(T.Geometry),
    tone: OptionType(T.Tone),
    color: OptionType(StringType),
    fillOpacity: OptionType(FloatType),
    weight: OptionType(FloatType),
    layer: OptionType(StringType),
    pending: OptionType(T.CardRoles),
});

/**
 * A zone as the canvas draws it.
 *
 * @property key - Its id on the canvas: its reference, printed
 * @property ref - Its kind's slot and its key
 */
export const SchematicDrawnZoneType = StructType({
    key: StringType,
    ref: T.Ref,
    label: StringType,
    x: FloatType,
    y: FloatType,
    width: FloatType,
    height: FloatType,
    pattern: T.ZonePattern,
    geometry: OptionType(T.Geometry),
    tone: OptionType(T.Tone),
    color: OptionType(StringType),
    fillOpacity: OptionType(FloatType),
    weight: OptionType(FloatType),
    layer: OptionType(StringType),
});

/**
 * A link as the canvas draws it: its ends the ids of the items it joins.
 *
 * @property key - Its id on the canvas: its reference, printed
 * @property ref - Its kind's slot and its key
 * @property from - The id of the item it runs from
 * @property to - The id of the item it runs to
 */
export const SchematicDrawnLinkType = StructType({
    key: StringType,
    ref: T.Ref,
    from: StringType,
    to: StringType,
    label: OptionType(StringType),
    metric: OptionType(StringType),
    style: T.LinkStyle,
    route: T.Route,
    via: ArrayType(T.Point),
    layer: OptionType(StringType),
});

/**
 * A net as the canvas draws it: its sides the ids of the items it joins.
 *
 * @property key - Its id on the canvas: its reference, printed
 * @property ref - Its kind's slot and its key
 * @property sources - The ids of the items on its feeding side
 * @property destinations - The ids of the items on its fed side
 */
export const SchematicDrawnNetType = StructType({
    key: StringType,
    ref: T.Ref,
    sources: ArrayType(StringType),
    destinations: ArrayType(StringType),
    label: OptionType(StringType),
    metric: OptionType(StringType),
    style: T.LinkStyle,
    route: T.Route,
    via: ArrayType(T.Point),
    layer: OptionType(StringType),
});

/**
 * Everything the canvas draws: its items, zones, links and nets, each kind's
 * in the order the Schematic lists its kinds, each kind's in key order.
 */
export const SchematicDrawnType = StructType({
    items: ArrayType(SchematicDrawnItemType),
    zones: ArrayType(SchematicDrawnZoneType),
    links: ArrayType(SchematicDrawnLinkType),
    nets: ArrayType(SchematicDrawnNetType),
});

/** An item as the canvas draws it. */
export type DrawnItem = ValueTypeOf<typeof SchematicDrawnItemType>;
/** A zone as the canvas draws it. */
export type DrawnZone = ValueTypeOf<typeof SchematicDrawnZoneType>;
/** A link as the canvas draws it. */
export type DrawnLink = ValueTypeOf<typeof SchematicDrawnLinkType>;
/** A net as the canvas draws it. */
export type DrawnNet = ValueTypeOf<typeof SchematicDrawnNetType>;
/** Everything the canvas draws. */
export type SchematicDrawn = ValueTypeOf<typeof SchematicDrawnType>;
/** An entity's reference: its kind's slot and its key. */
export type SchematicRef = ValueTypeOf<typeof T.Ref>;

/** An item's roles, as its kind's `rows` give them. */
export type ItemRoles = ValueTypeOf<typeof T.Item>;
/** A zone's roles. */
export type ZoneRoles = ValueTypeOf<typeof T.Zone>;
/** A link's roles. */
export type LinkRoles = ValueTypeOf<typeof T.Link>;
/** A net's roles. */
export type NetRoles = ValueTypeOf<typeof T.Net>;
/** A details row's roles. */
export type DetailsRoles = ValueTypeOf<typeof T.DetailsRoles>;
/** Which of a card's roles its kind's details give. */
export type CardRoles = ValueTypeOf<typeof T.CardRoles>;

/** Nothing drawn: a Schematic whose reads have not landed. */
export const EMPTY_DRAWN: SchematicDrawn = { items: [], zones: [], links: [], nets: [] };

/** An entity's id on the canvas: its reference, as East prints it — its kind's slot and its key. */
export const entityId: (ref: SchematicRef) => string = printFor(T.Ref);

const parseRef = parseFor(T.Ref);

/**
 * An entity's reference from its id on the canvas: what {@link entityId}
 * printed, read back — a link's end, a net's member, by the id it draws under.
 *
 * @param id - The entity's id
 * @returns Its reference; `undefined` for text no reference prints as
 */
export function refOfId(id: string): SchematicRef | undefined {
    const read = parseRef(id);
    return read.success ? read.value : undefined;
}

/** An Option the kind gives, else its details', else none. */
function either<V>(own: option<V>, details: option<V> | undefined): option<V> {
    return own.type === "some" || details === undefined ? own : details;
}

/**
 * An item as the canvas draws it, from its roles and its details' roles; none
 * for a row with no position, which is its kind's backlog and never draws.
 *
 * @param ref - Its kind's slot and its key
 * @param roles - Its roles
 * @param details - Its details row's roles, if its kind has details and the row has one
 * @param pending - The card roles its kind's details give, while its details row is read: its card draws a placeholder in each one's place (#1398)
 * @returns The item, or `undefined` for an unplaced row
 */
export function drawnItem(ref: SchematicRef, roles: ItemRoles, details: DetailsRoles | undefined, pending?: CardRoles): DrawnItem | undefined {
    if (roles.position.type !== "some") return undefined;
    return {
        key: entityId(ref),
        ref,
        x: roles.position.value.x,
        y: roles.position.value.y,
        label: roles.label,
        sublabel: either(roles.sublabel, details?.sublabel),
        icon: roles.icon,
        status: either(roles.status, details?.status),
        meter: either(roles.meter, details?.meter),
        metric: either(roles.metric, details?.metric),
        width: roles.width,
        height: roles.height,
        footprint: roles.footprint,
        tone: roles.tone,
        color: roles.color,
        fillOpacity: roles.fillOpacity,
        weight: roles.weight,
        layer: roles.layer,
        pending: pending === undefined ? none : some(pending),
    };
}

/**
 * Whether an item's colour is its status's, and its status unread (#1398): its
 * details give its status, their row is read, and the item has no colour of
 * its own — its marker and its card's dot draw a placeholder, never a status.
 *
 * @param item - The item
 * @returns Whether its status is unread
 */
export function statusUnread(item: DrawnItem): boolean {
    return item.pending.type === "some" && item.pending.value.status && item.color.type === "none" && item.tone.type === "none";
}

/**
 * A zone as the canvas draws it, from its roles.
 *
 * @param ref - Its kind's slot and its key
 * @param roles - Its roles
 * @returns The zone
 */
export function drawnZone(ref: SchematicRef, roles: ZoneRoles): DrawnZone {
    return {
        key: entityId(ref),
        ref,
        label: roles.label,
        x: roles.x,
        y: roles.y,
        width: roles.width,
        height: roles.height,
        pattern: roles.pattern,
        geometry: roles.geometry,
        tone: roles.tone,
        color: roles.color,
        fillOpacity: roles.fillOpacity,
        weight: roles.weight,
        layer: roles.layer,
    };
}

/**
 * A link as the canvas draws it, from its roles: its ends the ids of the items
 * it joins.
 *
 * @param ref - Its kind's slot and its key
 * @param roles - Its roles
 * @returns The link
 */
export function drawnLink(ref: SchematicRef, roles: LinkRoles): DrawnLink {
    return {
        key: entityId(ref),
        ref,
        from: entityId(roles.from),
        to: entityId(roles.to),
        label: roles.label,
        metric: roles.metric,
        style: roles.style,
        route: roles.route,
        via: roles.via,
        layer: roles.layer,
    };
}

/**
 * A net as the canvas draws it, from its roles: its sides the ids of the
 * items it joins.
 *
 * @param ref - Its kind's slot and its key
 * @param roles - Its roles
 * @returns The net
 */
export function drawnNet(ref: SchematicRef, roles: NetRoles): DrawnNet {
    return {
        key: entityId(ref),
        ref,
        sources: roles.sources.map((member) => entityId(member)),
        destinations: roles.destinations.map((member) => entityId(member)),
        label: roles.label,
        metric: roles.metric,
        style: roles.style,
        route: roles.route,
        via: roles.via,
        layer: roles.layer,
    };
}
