/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Box } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Note } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const noteEqual = equalFor(Note.Types.Note);

/** East Note value type */
export type NoteValue = ValueTypeOf<typeof Note.Types.Note>;

export interface EastChakraNoteProps {
    value: NoteValue;
    storageKey?: string;
}

type NoteVariantTag = "narrative" | "callout" | "quote";

interface VariantDefaults {
    borderLeftStyle: "dashed" | "solid" | "none";
    accentColor: string;
    bodyColor?: string;
    background?: string;
    fontStyle?: "italic";
    paddingStart: string;
}

const VARIANT_DEFAULTS: Record<NoteVariantTag, VariantDefaults> = {
    narrative: {
        borderLeftStyle: "dashed",
        accentColor: "border.muted",
        bodyColor: "fg.muted",
        paddingStart: "3",
    },
    callout: {
        borderLeftStyle: "solid",
        accentColor: "colorPalette.solid",
        bodyColor: "fg",
        background: "colorPalette.subtle",
        paddingStart: "3",
    },
    quote: {
        borderLeftStyle: "solid",
        accentColor: "border.subtle",
        bodyColor: "fg.subtle",
        fontStyle: "italic",
        paddingStart: "4",
    },
};

/**
 * Renders an East UI Note value as a styled prose block. The `body` is a
 * UIComponentType child and is dispatched through `EastChakraComponent`.
 *
 * Variants:
 *   - narrative → dashed left accent, muted body
 *   - callout → solid left accent in colorPalette, subtle background
 *   - quote → indented italic with subtle left accent
 *
 * Style overrides (color / background / borderColor / accentColor /
 * emphasis) win over the variant defaults.
 */
export const EastChakraNote = memo(function EastChakraNote({ value, storageKey }: EastChakraNoteProps) {
    const computed = useMemo(() => {
        const variantTag = value.variant.type as NoteVariantTag;
        const defaults = VARIANT_DEFAULTS[variantTag];
        const style = getSomeorUndefined(value.style);

        const color = style ? getSomeorUndefined(style.color) : undefined;
        const background = style ? getSomeorUndefined(style.background) : undefined;
        const accentColor = style ? getSomeorUndefined(style.accentColor) : undefined;
        const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;
        const emphasis = style ? getSomeorUndefined(style.emphasis)?.type : undefined;
        const width = style ? getSomeorUndefined(style.width) : undefined;
        const maxWidth = style ? getSomeorUndefined(style.maxWidth) : undefined;
        const opacity = style ? getSomeorUndefined(style.opacity) : undefined;
        const padding = style ? getSomeorUndefined(style.padding) : undefined;
        const margin = style ? getSomeorUndefined(style.margin) : undefined;

        return {
            defaults,
            variantTag,
            color,
            background,
            accentColor,
            borderColor,
            emphasis,
            width,
            maxWidth,
            opacity,
            padding,
            margin,
        };
    }, [value]);

    const d = computed.defaults;
    const borderWidth = computed.emphasis === "strong" ? "4px" : "2px";
    const fontWeight = computed.emphasis === "strong" && computed.variantTag === "callout" ? "semibold" : undefined;

    return (
        <Box
            as="blockquote"
            role={computed.variantTag === "callout" ? "note" : undefined}
            borderLeftWidth={borderWidth}
            borderLeftStyle={d.borderLeftStyle}
            borderLeftColor={computed.accentColor ?? d.accentColor}
            borderColor={computed.borderColor}
            borderWidth={computed.borderColor ? "1px" : undefined}
            bg={computed.background ?? d.background}
            color={computed.color ?? d.bodyColor}
            fontStyle={d.fontStyle}
            fontWeight={fontWeight}
            ps={d.paddingStart}
            py="2"
            pe="3"
            pt={computed.padding ? getSomeorUndefined(computed.padding.top) : undefined}
            pr={computed.padding ? getSomeorUndefined(computed.padding.right) : undefined}
            pb={computed.padding ? getSomeorUndefined(computed.padding.bottom) : undefined}
            pl={computed.padding ? getSomeorUndefined(computed.padding.left) : undefined}
            mt={computed.margin ? getSomeorUndefined(computed.margin.top) : undefined}
            mr={computed.margin ? getSomeorUndefined(computed.margin.right) : undefined}
            mb={computed.margin ? getSomeorUndefined(computed.margin.bottom) : undefined}
            ml={computed.margin ? getSomeorUndefined(computed.margin.left) : undefined}
            width={computed.width}
            maxWidth={computed.maxWidth}
            opacity={computed.opacity}
        >
            <EastChakraComponent
                value={value.body}
                storageKey={`${storageKey ?? ""}.body`}
            />
        </Box>
    );
}, (prev, next) => noteEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
