/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Variant-renderer registry for the UI extension mechanism — the React side
 * of the symmetry with platform functions.
 *
 * @remarks
 * `EastUI.component(name, schema, ...)` in `@elaraai/east-ui` declares a
 * typed UI component slot; this module wires the React renderer for it via
 * {@link implementUIComponent}. The {@link EastChakraExtension} dispatcher
 * case (in `component.tsx`) resolves the `kind` against this registry and
 * decodes the payload using the schema captured at registration time.
 *
 * Mirrors the registration pattern of {@link registerReactiveTracker} and
 * {@link registerPlatformImplementation} in this package — single
 * module-load-time call per renderer.
 *
 * @packageDocumentation
 */

import type { ComponentType } from "react";
import { type EastType, type ValueTypeOf, decodeBeast2For } from "@elaraai/east";
import type { UIComponentDef } from "@elaraai/east-ui/internal";

/**
 * The shape of the component renderer the dispatcher expects. The renderer
 * receives the decoded value typed against the declared schema, plus a
 * `storageKey` for any persisted state inside the renderer.
 */
export interface ExtensionRendererProps<S extends EastType> {
    value: ValueTypeOf<S>;
    storageKey: string;
}

/** Internal entry — schema captured for decoding, renderer + decoded-value cache. */
interface RegistryEntry {
    schema: EastType;
    renderer: ComponentType<{ value: unknown; storageKey: string }>;
    decode: (bytes: Uint8Array) => unknown;
}

const registry = new Map<string, RegistryEntry>();

/**
 * Register a React renderer for a UI component declared via
 * `EastUI.component(name, schema, ...)`. The schema captured here is used by
 * the dispatcher to decode the payload bytes back into the typed value the
 * renderer receives.
 *
 * @typeParam S - The East type of the component's value schema (inferred
 *   from the `def`).
 *
 * @param def - The {@link UIComponentDef} returned from `EastUI.component`.
 * @param renderer - React component that consumes the typed value.
 *
 * @example
 * ```tsx
 * // In your *-components package:
 * import { implementUIComponent } from "@elaraai/east-ui-components";
 * import { Diff } from "@elaraai/e3-ui";
 * import { EastChakraDiff } from "./diff";
 *
 * implementUIComponent(Diff, EastChakraDiff);
 * ```
 */
export function implementUIComponent<S extends EastType>(
    def: UIComponentDef<S>,
    renderer: ComponentType<ExtensionRendererProps<S>>,
): void {
    registry.set(def.name, {
        schema: def.schema,
        renderer: renderer as ComponentType<{ value: unknown; storageKey: string }>,
        decode: decodeBeast2For(def.schema) as (bytes: Uint8Array) => unknown,
    });
}

/**
 * Look up a registry entry by component name. Returns undefined if no
 * renderer has been registered for `name`.
 *
 * @param name - Component identifier (the `name` arg to `EastUI.component`).
 */
export function getExtensionEntry(name: string): RegistryEntry | undefined {
    return registry.get(name);
}

/**
 * True if at least one renderer is registered for `name`.
 *
 * @param name - Component identifier.
 */
export function hasExtensionRenderer(name: string): boolean {
    return registry.has(name);
}

/** Test-only — clear all registered renderers. */
export function clearExtensionRegistry(): void {
    registry.clear();
}
