/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Navigation `<Pages>` tag — the route-stack content switcher. */

import { Pages as PagesFactory, type PagesInput } from "../../navigation/pages/index.js";
import { NavBindHandleType, type NavRoutes } from "../../navigation/pages/types.js";
import type { UIElement } from "../runtime.js";

/**
 * Route-stack content switcher — renders only the active route's page
 * (leaf-only) and re-renders on navigation. Takes the nav handle as a required
 * prop (like `<DecisionQueue handle>`): bind it once in the enclosing
 * `<Reactive>` with `Navigation.bind`, then share that one handle between the
 * writer (`nav.go.*` / `nav.pop()`) and this switcher — which is what makes it
 * re-render inside an e3 `ui()` task (#114). `R` (the route map) is inferred
 * from `nav`, so each `pages` handler is fully typed (a wrong payload won't
 * compile).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, NullType, UIComponentType } from "@elaraai/east";
 * import { Navigation, Pages, Reactive } from "@elaraai/east-ui";
 *
 * const app = East.function([], UIComponentType, _$ => {
 *     const routes = Navigation.config({ overview: { value: NullType, label: "Overview" } });
 *     return (
 *         <Reactive>{$ => {
 *             const nav = $.let(Navigation.bind(routes, "app.nav", [routes.Page.overview()]));
 *             return <Pages nav={nav} pages={{ overview: () => overviewScreen() }} />;
 *         }}</Reactive>
 *     );
 * });
 * ```
 *
 * @remarks
 * Desugars to `Pages.Root({ nav, pages })`. A generic function declaration
 * (merged with the `Pages` namespace) so it is a valid generic JSX component.
 */
export function Pages<R extends NavRoutes>(props: PagesInput<R>): UIElement {
    return PagesFactory.Root(props) as UIElement;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Pages {
    /** The underlying factory: `Pages.Root({ nav, pages })`. */
    export const Root = PagesFactory.Root;
    /** Navigation East types (namespaced — never bare-exported). */
    export const Types = {
        /** `Handle(routes)` → the `Navigation.bind` handle `StructType` for a routes map. */
        Handle: NavBindHandleType,
    } as const;
}
