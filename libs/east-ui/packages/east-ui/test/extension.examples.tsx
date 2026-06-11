/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */

/**
 * Example declarations of UI components via `EastUI.component`. These mirror
 * the `East.platform(...)`-style symmetry: each `EastUI.component` declares a
 * typed schema and a `Root` factory; downstream `*-components` packages
 * register the renderer separately via `implementUIComponent`.
 *
 * The JSX layer extends to these custom components for free: wrap the
 * declaration's `Root` with the public `optionsTag` combinator (the same one
 * the built-in tags use) and the component authors as `<Counter … />`, its
 * schema fields surfaced as flat props.
 */

import { East, StructType, StringType, IntegerType, BooleanType, OptionType, example, some, none } from "@elaraai/east";
import { EastUI, UIComponentType } from "@elaraai/east-ui";
import { optionsTag, Text, VStack } from "@elaraai/east-ui";

export const counterBasic = example({
    keywords: ["EastUI", "component", "extension", "Counter", "optionsTag", "platform-symmetry"],
    description: "Declare a custom Counter component via the extension API and author it as a JSX tag",
    fn: East.function([], UIComponentType, (_$) => {
        const CounterComponent = EastUI.component("Counter", StructType({
            label: StringType,
            value: IntegerType,
            accent: OptionType(StringType),
        }), { optional: true });
        const Counter = optionsTag(CounterComponent.Root);
        return <Counter label="Visits" value={42n} accent={none} />;
    }),
    inputs: [],
});

export const counterInsideStack = example({
    keywords: ["EastUI", "component", "extension", "Counter", "Stack", "compose"],
    description: "Custom extension components compose freely inside built-in primitives",
    fn: East.function([], UIComponentType, (_$) => {
        const CounterComponent = EastUI.component("Counter", StructType({
            label: StringType,
            value: IntegerType,
            accent: OptionType(StringType),
        }), { optional: true });
        const Counter = optionsTag(CounterComponent.Root);
        return (
            <VStack gap="3">
                <Text>Today’s stats</Text>
                <Counter label="Visits" value={42n} accent={some("#488e97")} />
                <Counter label="Conversions" value={7n} accent={none} />
            </VStack>
        );
    }),
    inputs: [],
});

export const bannerExample = example({
    keywords: ["EastUI", "component", "extension", "Banner", "optionsTag", "required"],
    description: "Declare a required (non-optional) extension component and author it as a JSX tag",
    fn: East.function([], UIComponentType, (_$) => {
        const BannerComponent = EastUI.component("Banner", StructType({
            title: StringType,
            subtitle: StringType,
            dismissible: BooleanType,
        }));
        const Banner = optionsTag(BannerComponent.Root);
        return <Banner title="System maintenance" subtitle="Scheduled for 02:00 UTC tonight." dismissible={true} />;
    }),
    inputs: [],
});
