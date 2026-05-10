/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Example declarations of UI components via `EastUI.component`. These mirror
 * the `East.platform(...)`-style symmetry: each `EastUI.component` declares a
 * typed schema and a `Root` factory; downstream `*-components` packages
 * register the renderer separately via `implementUIComponent`.
 */

import {
    East,
    StructType,
    StringType,
    IntegerType,
    BooleanType,
    OptionType,
    variant,
    example,
} from "@elaraai/east";
import { EastUI, UIComponentType, Stack, Text } from "@elaraai/east-ui";

// ---- Tiny example: a "Counter" component declared via the extension API. ----

export const CounterPayloadType = StructType({
    label: StringType,
    value: IntegerType,
    accent: OptionType(StringType),
});

export const Counter = EastUI.component("Counter", CounterPayloadType, { optional: true });

export const counterBasic = example({
    keywords: ["EastUI", "component", "extension", "Counter", "Root", "platform-symmetry"],
    description: "Declare and use a custom Counter component via the extension API",
    fn: East.function([], UIComponentType, (_$) => {
        return Counter.Root({
            label: "Visits",
            value: 42n,
            accent: variant("none", null),
        });
    }),
    inputs: [],
});

export const counterInsideStack = example({
    keywords: ["EastUI", "component", "extension", "Counter", "Stack", "compose"],
    description: "Custom extension components compose freely inside built-in primitives",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Text.Root("Today's stats"),
            Counter.Root({
                label: "Visits",
                value: 42n,
                accent: variant("some", "#488e97"),
            }),
            Counter.Root({
                label: "Conversions",
                value: 7n,
                accent: variant("none", null),
            }),
        ], { gap: "3" });
    }),
    inputs: [],
});

// ---- Banner: another extension declaration, slightly richer schema. ----

export const BannerPayloadType = StructType({
    title: StringType,
    subtitle: StringType,
    dismissible: BooleanType,
});

export const Banner = EastUI.component("Banner", BannerPayloadType);

export const bannerExample = example({
    keywords: ["EastUI", "component", "extension", "Banner", "Root", "required"],
    description: "Declare a required (non-optional) extension component",
    fn: East.function([], UIComponentType, (_$) => {
        return Banner.Root({
            title: "System maintenance",
            subtitle: "Scheduled for 02:00 UTC tonight.",
            dismissible: true,
        });
    }),
    inputs: [],
});
