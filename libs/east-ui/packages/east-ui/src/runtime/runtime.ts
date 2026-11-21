/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * JSX runtime for east-ui — author `UIComponentType` trees with JSX syntax
 * (`<Box>…</Box>`) that desugar to the east-ui component factories.
 *
 * A JSX element here is **not** a React element: it evaluates to a built
 * east-ui value (`ExprType<UIComponentType>`), exactly what `Box.Root(…)`
 * returns. The IR/renderer split is preserved — JSX is pure authoring sugar
 * that produces serializable East IR.
 *
 * @remarks
 * This module is the compiler-facing runtime; you never import it by hand.
 * Point the compiler at it per file with a pragma:
 *
 * ```tsx
 * /** @jsxImportSource @elaraai/east-ui *\/
 * ```
 *
 * or project-wide in `tsconfig.json`:
 *
 * ```json
 * { "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "@elaraai/east-ui" } }
 * ```
 *
 * The capitalized component tags (`Box`, `VStack`, `Text`, …) live in
 * `@elaraai/east-ui`. JSX only works in `.tsx` files — the `.ts` parser
 * reads `<Box>` as a type assertion, so there is no pragma that enables it in
 * `.ts`.
 *
 * @packageDocumentation
 */

import type { ExprType } from "@elaraai/east";
import type { UIComponentType } from "../component.js";
import { coalesceChildren, type ContainerChildrenType } from "./children.js";

/** A built east-ui element — what every JSX element expression evaluates to. */
export type UIElement = ExprType<UIComponentType>;

/** A JSX component: a function from a single props object to a built element. */
export type Component<P> = (props: P) => UIElement;

/**
 * Fragment marker. `<>…</>` collects its children with no wrapper element;
 * the enclosing container coalesces them into its own child list.
 */
export const Fragment = Symbol("@elaraai/east-ui.jsx.Fragment");
export type Fragment = typeof Fragment;

/**
 * Automatic-runtime entry point. The compiler emits calls to this (and to
 * {@link jsxs}) when `jsxImportSource` is `@elaraai/east-ui`.
 *
 * `props.children` carries the nested elements; each component function does
 * its own child normalization (see `@elaraai/east-ui`). A fragment is
 * routed through the shared child coalescer so it yields a well-typed children
 * value independent of the enclosing tag.
 *
 * A tag's `key` is no React key here — nothing reconciles these elements — so
 * it is one more prop: the compiler hands it apart from the others, and it
 * reaches the component among them, typed by the component's own props
 * (`<Record key={(row) => row.code}>`). One written after a spread the
 * compiler hands to {@link createElement} instead.
 */
export function jsx(
    type: Component<unknown> | Fragment,
    props: { children?: unknown } | null,
    key?: unknown,
): UIElement {
    if (type === Fragment) {
        // A fragment yields its coalesced children (a JS array or an East array
        // expression); the enclosing container re-coalesces it into place.
        return coalesceChildren(props?.children as ContainerChildrenType) as unknown as UIElement;
    }
    return (type as Component<unknown>)((key === undefined ? props ?? {} : { ...props, key }) as unknown);
}

/** Static-children variant — identical behaviour for this runtime. */
export const jsxs: typeof jsx = jsx;

/** Development entry point — same behaviour, the compiler's source arguments ignored. */
export function jsxDEV(
    type: Component<unknown> | Fragment,
    props: { children?: unknown } | null,
    key?: unknown,
): UIElement {
    return jsx(type, props, key);
}

/**
 * Classic-runtime factory (`@jsxFactory h`). Folds positional children into
 * `props.children` and delegates to {@link jsx}, so both runtimes share one
 * code path.
 */
export function h(
    type: Component<unknown> | Fragment,
    props: Record<string, unknown> | null,
    ...children: unknown[]
): UIElement {
    const merged: Record<string, unknown> = { ...(props ?? {}) };
    if (children.length === 1) merged.children = children[0];
    else if (children.length > 1) merged.children = children;
    return jsx(type, merged);
}

/**
 * The compiler's entry point for a tag whose `key` is written after a spread
 * (`<Record {...shared} key={(row) => row.code} />`). There it calls
 * `createElement` of the import source's own root, in place of {@link jsx},
 * with the key among the props and the children after them — the classic
 * factory's own call — so the key reaches the component as it does from
 * {@link jsx}. `@elaraai/east-ui` and `@elaraai/e3-ui` each export it.
 */
export const createElement: typeof h = h;

/**
 * JSX type contract consumed by the compiler under
 * `jsxImportSource: "@elaraai/east-ui"`.
 *
 * A `namespace` is the only shape the compiler accepts for the `JSX` type
 * contract, so the module-syntax lint rule is disabled here intentionally.
 */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace JSX {
    /** Every JSX element expression evaluates to a built `UIComponentType`. */
    export type Element = UIElement;
    /** Names the prop (`children`) that carries nested elements. */
    export interface ElementChildrenAttribute {
        children: object;
    }
    /**
     * No intrinsic (lowercase) tags: `<div>` is not an east-ui component.
     * Only the capitalized component tags are valid.
     */
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    export interface IntrinsicElements {}
}
