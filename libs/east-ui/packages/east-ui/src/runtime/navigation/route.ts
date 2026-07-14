/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Navigation `<Route>` tag — the nav-typed hosting slot (#333). */

import { Route as RouteFactory, type RouteInput } from "../../navigation/pages/index.js";
import type { NavRoutes } from "../../navigation/pages/types.js";
import type { UIElement } from "../runtime.js";

/**
 * Nav-typed hosting slot — `<Pages>` generalized to any slot: renders only the
 * active route's body and **remounts it on navigation**, but is placeable
 * anywhere (a header widget, a sidebar, a drawer body). Bind the nav handle
 * once in the enclosing `<Reactive>` and share it between the body `<Pages>`,
 * the chrome, and any number of `<Route>` slots — they stay in lockstep and
 * each remounts *its own* slot on navigation. Route keys are typed +
 * exhaustive against the `Navigation.config`; each body receives the route's
 * payload + the nav handle. For a non-route key (a `State`-bound mode, a
 * tagged selection), use `<Match on cases>` instead.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, NullType, UIComponentType } from "@elaraai/east";
 * import { Navigation, Route, Reactive, Text } from "@elaraai/east-ui";
 *
 * const widget = East.function([], UIComponentType, _$ => {
 *     const routes = Navigation.config({ overview: { value: NullType, label: "Overview" } });
 *     return (
 *         <Reactive>{$ => {
 *             const nav = $.let(Navigation.bind(routes, "app.nav", [routes.Page.overview()]));
 *             return <Route nav={nav} routes={{ overview: () => <Text>Overview widget</Text> }} />;
 *         }}</Reactive>
 *     );
 * });
 * ```
 *
 * @remarks
 * Desugars to `Route.Root({ nav, routes })`. A generic function declaration
 * (merged with the `Route` namespace) so it is a valid generic JSX component.
 */
export function Route<R extends NavRoutes>(props: RouteInput<R>): UIElement {
    return RouteFactory.Root(props) as UIElement;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Route {
    /** The underlying factory: `Route.Root({ nav, routes })`. */
    export const Root = RouteFactory.Root;
}
