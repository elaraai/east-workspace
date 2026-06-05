/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * React rendering surface for the UI extension mechanism. The
 * {@link EastChakraExtension} component is the dispatcher case for
 * `Extension`-tagged UIComponentType values — it decodes the payload and
 * delegates to the renderer registered via
 * {@link implementUIComponent}.
 *
 * @packageDocumentation
 */

import { memo, useMemo } from "react";
import { Box, Text } from "@chakra-ui/react";
import { type ValueTypeOf } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui/internal";

import { getExtensionEntry } from "./registry.js";

export {
    implementUIComponent,
    getExtensionEntry,
    hasExtensionRenderer,
    clearExtensionRegistry,
    type ExtensionRendererProps,
} from "./registry.js";

/**
 * The Extension variant's value shape. Pulled by structural lookup from
 * `UIComponentType` so the type stays in sync if east-ui ever changes the
 * carrier shape.
 */
type ExtensionValue = Extract<
    ValueTypeOf<UIComponentType>,
    { type: "Extension" }
>["value"];

export interface EastChakraExtensionProps {
    value: ExtensionValue;
    storageKey: string;
}

/**
 * Dispatcher case for `Extension`-tagged UI components. Decodes the
 * payload using the registered schema and renders the registered renderer.
 *
 * Fallbacks (visible to developers; never seen by end users in production):
 *   - **No renderer registered**: shows an inline diagnostic with the missing
 *     `kind`. Indicates the consuming `*-components` package didn't call
 *     `implementUIComponent` for this component, OR the component was
 *     declared with `optional: true` but no fallback was provided.
 */
export const EastChakraExtension = memo(function EastChakraExtension({
    value,
    storageKey,
}: EastChakraExtensionProps) {
    const entry = getExtensionEntry(value.kind);

    const decoded = useMemo<unknown>(() => {
        if (!entry) return null;
        return entry.decode(value.payload);
    }, [entry, value.payload]);

    if (!entry) {
        // Renderer missing. Render an inline diagnostic — better than
        // crashing or rendering blank in dev. Production callers that want
        // a different fallback can detect via `hasExtensionRenderer`.
        return (
            <Box layerStyle="banner.error" fontFamily="mono" fontSize="xs">
                <Text fontWeight="semibold">Extension renderer missing</Text>
                <Text>kind: {value.kind}</Text>
            </Box>
        );
    }

    const Renderer = entry.renderer;
    return <Renderer value={decoded} storageKey={storageKey} />;
});
