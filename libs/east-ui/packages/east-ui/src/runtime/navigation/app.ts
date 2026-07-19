/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Navigation `<App>` tag — the application shell (#367). */

import { App as AppFactory, type AppInput } from "../../navigation/app/index.js";
import type { NavRoutes } from "../../navigation/pages/types.js";
import type { UIElement } from "../runtime.js";

/**
 * The application shell — a collapsible nav rail, a breadcrumb app bar, an
 * optional brand logo, app-bar slots and the routed page body, all driven by one
 * `Navigation.bind` handle. Author it **inside** the enclosing `<Reactive>` that
 * binds `nav`, and pass the same `Navigation.config` as `config` (the handle
 * carries no labels/icons — the config is the single source of truth for the
 * rail and breadcrumb).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, NullType, UIComponentType } from "@elaraai/east";
 * import { App, Navigation, Reactive, Image, Text } from "@elaraai/east-ui";
 *
 * const app = East.function([], UIComponentType, _$ => {
 *     const routes = Navigation.config({
 *         overview: { value: NullType, label: "Overview", section: "Analyse", icon: { prefix: "fas", name: "gauge-high" } },
 *         audit: { value: NullType, label: "Audit", section: "Manage", icon: { prefix: "fas", name: "list-check" } },
 *     });
 *     return (
 *         <Reactive>{$ => {
 *             const nav = $.let(Navigation.bind(routes, "app.route", [routes.Page.overview()]));
 *             return (
 *                 <App nav={nav} config={routes} title="Acme Ops" logo={Image.dataUri("data:image/svg+xml,<svg/>")}
 *                     pages={{ overview: () => <Text>Overview</Text>, audit: () => <Text>Audit</Text> }} />
 *             );
 *         }}</Reactive>
 *     );
 * });
 * ```
 *
 * @remarks
 * Desugars to `App.Root({ nav, config, pages, … })`. A generic function
 * declaration (merged with the `App` namespace) so it is a valid generic JSX
 * component.
 */
export function App<R extends NavRoutes>(props: AppInput<R>): UIElement {
    return AppFactory.Root(props) as UIElement;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace App {
    /** The underlying factory: `App.Root({ nav, config, pages, … })`. */
    export const Root = AppFactory.Root;
}
