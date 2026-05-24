/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * UI component extension mechanism — the analog of platform functions for the
 * UI layer.
 *
 * @remarks
 * `East.platform(name, inputs, output, opts)` lets downstream packages declare
 * a typed signature in core East, then provide the implementation elsewhere
 * via `.implement(impl)` and the appropriate runtime registration. This file
 * brings the same pattern to UI components: downstream packages declare a
 * typed component schema, then wire a React renderer in their `*-components`
 * package via `implementUIComponent` (exported from
 * `@elaraai/east-ui-components`).
 *
 * Symmetry table:
 *
 * | Concept            | Platform fn               | UI component                       |
 * |--------------------|---------------------------|------------------------------------|
 * | Declaration        | `East.platform(name,…)`   | `EastUI.component(name, schema,…)` |
 * | TS-typed factory   | callable                  | `def.Root(value)`                  |
 * | Implementation     | `.implement(impl)`        | `implementUIComponent(def, comp)`  |
 * | `optional: true`   | runtime if missing        | placeholder if missing             |
 * | Carrier in IR      | `Platform` AST node       | `Extension` UIComponentType variant|
 *
 * The `Extension` variant in UIComponentType carries a `kind` (the component
 * name) and a `payload` (beast2-encoded value of the declared schema). The
 * dispatcher in `@elaraai/east-ui-components` resolves the renderer for
 * `kind` and decodes the payload using the registered schema.
 *
 * @example
 * ```ts
 * import {
 *     EastUI,
 *     UIComponentType,
 * } from "@elaraai/east-ui";
 * import {
 *     StructType,
 *     IntegerType,
 *     StringType,
 *     OptionType,
 * } from "@elaraai/east";
 *
 * // Declare a typed component (in your library package).
 * const Counter = EastUI.component("Counter", StructType({
 *     label: StringType,
 *     value: IntegerType,
 *     hint: OptionType(StringType),
 * }), { optional: true });
 *
 * // Use it (anywhere) — fully typed against the schema:
 * const tree = Counter.Root({ label: "Visits", value: 42n, hint: { type: "none", value: null } });
 * // tree: ExprType<UIComponentType>  ← drops in anywhere a UIComponent does.
 *
 * // Wire the renderer (in your *-components package):
 * //   import { implementUIComponent } from "@elaraai/east-ui-components";
 * //   implementUIComponent(Counter, ({ value }) => <CounterChakra value={value} />);
 * ```
 *
 * @packageDocumentation
 */

import {
    East,
    variant,
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
} from "@elaraai/east";

import { UIComponentType } from "./component.js";

/**
 * Options for {@link EastUI.component}.
 *
 * @property optional - When true, missing renderers degrade gracefully to an
 *   empty placeholder instead of an error fallback. Mirrors the semantics of
 *   `East.platform`'s `optional` flag. Default: `false`.
 */
export interface UIComponentOptions {
    optional?: boolean;
}

/**
 * Handle returned by {@link EastUI.component}.
 *
 * @typeParam S - The East type of the component's value schema.
 *
 * @property name - Component identifier — used to resolve the renderer in the
 *   variant-renderer registry.
 * @property schema - The declared East type of the component's value.
 * @property optional - Whether the component is optional (no renderer
 *   required at runtime). Set via {@link UIComponentOptions}.
 * @property Root - Typed factory: takes a value of the schema's TS type and
 *   produces a UIComponentType expression that the dispatcher will route to
 *   the registered renderer.
 */
export interface UIComponentDef<S extends EastType> {
    readonly name: string;
    readonly schema: S;
    readonly optional: boolean;
    /**
     * Typed factory. Accepts either plain JS values or East expressions per
     * field via `SubtypeExprOrValue<S>` — same ergonomics as built-in east-ui
     * factories (e.g. `Stack.Root`, `Card.Root`). Callbacks like onClick can
     * be `East.function(...)` expressions; primitives can be raw JS literals.
     */
    Root(value: SubtypeExprOrValue<S>): ExprType<UIComponentType>;
}

/**
 * Declare a typed UI component slot.
 *
 * @remarks
 * The returned {@link UIComponentDef} has a `Root` factory that produces an
 * `Extension`-tagged {@link UIComponentType} value. The renderer is wired
 * separately (in the consuming `*-components` package) via
 * `implementUIComponent(def, renderer)` from `@elaraai/east-ui-components`.
 *
 * The pattern mirrors `East.platform(name, inputs, output)` for the UI
 * layer. See the module-level docs for the symmetry table.
 *
 * @typeParam S - The East type of the component's value schema. Inferred
 *   from the `schema` argument.
 *
 * @param name - Identifier used to resolve the renderer at runtime. Must be
 *   unique across all declared components.
 * @param schema - The East type of the component's value. The `Root` factory
 *   accepts values of `ValueTypeOf<S>`; the renderer receives the same.
 * @param options - Optional flags ({@link UIComponentOptions}).
 *
 * @returns A {@link UIComponentDef} wrapping the schema + factory.
 */
export function component<S extends EastType>(
    name: string,
    schema: S,
    options: UIComponentOptions = {},
): UIComponentDef<S> {
    const optional = options.optional ?? false;

    function Root(value: SubtypeExprOrValue<S>): ExprType<UIComponentType> {
        // Wrap the value as an Expr<S> first so `East.Blob.encodeBeast` (which
        // takes an Expr and reads `Expr.type` / `Expr.ast`) can build a typed
        // BlobEncodeBeast2 builtin AST node. Encoding then happens lazily at
        // compile/runtime — by which point any inner `East.function` callbacks
        // have been compiled and have an IR attached. Doing the encode at
        // IR-construction time directly via `encodeBeast2For` would fail on
        // function fields, since CallableFunctionExpr nodes don't carry the
        // EAST_IR_SYMBOL until after the compile pass.
        const expr = East.value(value, schema);
        return East.value(
            variant("Extension", {
                kind: name,
                payload: East.Blob.encodeBeast(expr, 'v2'),
            }),
            UIComponentType,
        );
    }

    return {
        name,
        schema,
        optional,
        Root,
    };
}

/**
 * Namespace exposing the UI extension API. Mirrors the way `East` namespaces
 * `platform` / `function` / `value` etc.
 *
 * @example
 * ```ts
 * import { EastUI } from "@elaraai/east-ui";
 * import { StructType, StringType } from "@elaraai/east";
 *
 * const Banner = EastUI.component("Banner", StructType({
 *     title: StringType,
 *     subtitle: StringType,
 * }), { optional: true });
 *
 * Banner.Root({ title: "Hello", subtitle: "World" });
 * ```
 */
export const EastUI = {
    component,
} as const;
