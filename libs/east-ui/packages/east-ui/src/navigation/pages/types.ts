/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * First-class navigation types — the `Navigation` config/bind handle.
 *
 * A **route** is one case of a typed variant; the navigation **path** is a stack
 * of routes (`ArrayType(Route)`). The config declares each route's payload type +
 * label (the single source of truth); the bind handle exposes the path-stack ops
 * plus one typed `go.<route>(payload)` per route — derived from the config exactly
 * as `Record.bind` derives `mutate.<name>(args)` from its mutation list.
 *
 * @packageDocumentation
 */

import {
    East,
    ArrayType,
    BooleanType,
    FunctionType,
    IntegerType,
    NullType,
    StringType,
    StructType,
    VariantType,
    type EastType,
    type ExprType,
} from "@elaraai/east";

// ============================================================================
// Route config — the single source of truth for each route's payload TYPE
// ============================================================================

/**
 * One route declaration: the page's payload East type plus its display label,
 * and optional rail presentation (`<App>` reads these to build the nav rail —
 * the config is the single source of truth for the rail as well as the routes).
 *
 * @typeParam V - The route's payload East type (`NullType` for an argless page).
 * @property value - The East type of the value passed when navigating to this route.
 * @property label - Human-readable label (breadcrumb / rail).
 * @property icon - Optional leading Font Awesome icon for the `<App>` rail row (`{ prefix, name }`).
 * @property section - Optional `<App>` rail section heading to group this route under; omit ⇒ the route is reachable but hidden from the rail (a deep page).
 * @property badge - Optional trailing badge text for the `<App>` rail row (count / "New").
 */
export interface NavRouteConfig<V extends EastType = EastType> {
    value: V;
    label: string;
    /** Optional leading Font Awesome icon for the `<App>` rail row. */
    icon?: { prefix: string; name: string };
    /** Optional `<App>` rail section heading; omit ⇒ reachable but hidden from the rail. */
    section?: string;
    /** Optional trailing badge text for the `<App>` rail row. */
    badge?: string;
}

/** A routes map: route name → its {@link NavRouteConfig}. */
export type NavRoutes = Record<string, NavRouteConfig>;

/** The derived `Route` variant East type for a routes map (`{ [name]: payload }`). */
export type RouteVariantOf<R extends NavRoutes> = VariantType<{ [K in keyof R]: R[K]["value"] }>;

/** Build the `Route` variant East type from a routes config. */
export function routeVariantType<R extends NavRoutes>(routes: R): RouteVariantOf<R> {
    const cases: Record<string, EastType> = {};
    for (const [name, cfg] of Object.entries(routes)) cases[name] = cfg.value;
    return VariantType(cases) as RouteVariantOf<R>;
}

// ============================================================================
// Bind handle — return type of `Navigation.bind`
// ============================================================================

/**
 * Build the East `StructType` of the bind handle for a routes config: the
 * path-stack ops plus one `go.<route>` closure per route (typed from the config),
 * `navigateTo`, and `labelOf`. Mirrors {@link "../../../e3-ui" | RecordBindHandleType}'s
 * "one closure per item, the struct shape IS the signature" approach.
 *
 * @param routes - The routes config.
 * @returns The handle `StructType`.
 */
export function NavBindHandleType<R extends NavRoutes>(routes: R): NavHandleType<R> {
    const Route = routeVariantType(routes);
    const Path = ArrayType(Route);
    const goFields: Record<string, EastType> = {};
    for (const [name, cfg] of Object.entries(routes)) {
        goFields[name] = FunctionType([cfg.value], NullType);
    }
    return StructType({
        /** The store key this navigator is bound to — lets renderers self-subscribe. */
        key: StringType,
        /** The whole path stack (→ breadcrumb). Tracked for reactive re-render. */
        path: FunctionType([], Path),
        /** The leaf (top of stack) — the page `<Pages>` renders. */
        current: FunctionType([], Route),
        /** Stack depth. */
        depth: FunctionType([], IntegerType),
        /** Whether `pop()` would do anything (depth > 1). */
        canPop: FunctionType([], BooleanType),
        /** Pop one level (back). */
        pop: FunctionType([], NullType),
        /** One typed navigate closure per route — push `variant(route, payload)`. */
        go: StructType(goFields),
        /** Replace the whole path (deep link / restore / nested path). */
        navigateTo: FunctionType([Path], NullType),
    }) as unknown as NavHandleType<R>;
}

/** The `Route` variant TS type for a routes map. */
type RouteVariant<R extends NavRoutes> = VariantType<{ [K in keyof R]: R[K]["value"] }>;

/**
 * The precise East struct type of a nav handle — a mapped type (rather than the
 * widened runtime loop of {@link NavBindHandleType}) so each `go.<route>` keeps
 * its payload arg type.
 *
 * @typeParam R - The routes config.
 */
export type NavHandleType<R extends NavRoutes> = StructType<{
    key: typeof StringType;
    path: FunctionType<[], ArrayType<RouteVariant<R>>>;
    current: FunctionType<[], RouteVariant<R>>;
    depth: FunctionType<[], typeof IntegerType>;
    canPop: FunctionType<[], typeof BooleanType>;
    pop: FunctionType<[], typeof NullType>;
    go: StructType<{ [K in keyof R]: FunctionType<[R[K]["value"]], typeof NullType> }>;
    navigateTo: FunctionType<[ArrayType<RouteVariant<R>>], typeof NullType>;
}>;

/** The value type of a {@link Navigation.bind} handle for routes `R`. */
export type BoundNav<R extends NavRoutes> = ExprType<NavHandleType<R>>;

// ============================================================================
// nav_bind platform — generic over the instantiated handle + route types
// ============================================================================

/**
 * Underlying `Navigation.bind` platform definition. End-users call
 * {@link Navigation.bind} (the typed factory); runtimes register against this raw
 * definition. Generic over `H` (the fully-instantiated handle struct — its shape
 * IS the signature) and `R` (the route variant type, governing the initial path).
 * The single literal/value args are the store key and the initial path.
 */
export const navBindPlatformFn = East.genericPlatform(
    "nav_bind",
    ["H", "R"],
    [StringType, ArrayType("R")],
    "H",
    { optional: true },
);

// Low-level primitives backing a `Navigation.bind` handle's methods (issue #106).
//
// The handle's path-stack ops become thin `East.function`s over these primitives,
// capturing only the plain-data store key (+ the seed path for the decode-side
// fallback). `P` is the path type (`ArrayType(Route)`); `V` is one route's payload
// type. current/depth/canPop are derived in East from `nav_read`. So a nav handle
// is ordinary serializable East data and re-binds to the decoder's store.
const nav_read = East.genericPlatform("nav_read", ["P"], [StringType, "P"], "P", { optional: true });
const nav_write = East.genericPlatform("nav_write", ["P"], [StringType, "P"], NullType, { optional: true });
const nav_pop = East.genericPlatform("nav_pop", ["P"], [StringType, "P"], NullType, { optional: true });
const nav_go = East.genericPlatform("nav_go", ["P", "V"], [StringType, StringType, "V", "P"], NullType, { optional: true });

/**
 * Low-level platform primitives that back {@link Navigation.bind}'s handle methods.
 *
 * @internal Not for direct use — author against {@link Navigation.bind}. These
 * exist so the handle's methods can be IR-bearing `East.function`s (serializable)
 * rather than raw host closures.
 */
export const NavBindPrimitives = {
    /** `nav_read([P], key, initial) -> P` — the path stack (tracks the key). */
    read: nav_read,
    /** `nav_write([P], key, path) -> Null` — replace the whole stack. */
    write: nav_write,
    /** `nav_pop([P], key, initial) -> Null` — drop the leaf (if depth > 1). */
    pop: nav_pop,
    /** `nav_go([P, V], key, routeName, payload, initial) -> Null` — push a route. */
    go: nav_go,
} as const;
