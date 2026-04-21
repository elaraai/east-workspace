/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Button, Icon, Reactive, Stack, State, UIComponentType } from "@elaraai/east-ui";

export const iconBasic = example({
    keywords: ["Icon", "Root", "fas", "FontAwesome"],
    description: "Font Awesome icons",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Icon.Root("fas", "house"),
            Icon.Root("fas", "user"),
            Icon.Root("fas", "gear"),
            Icon.Root("fas", "bell"),
            Icon.Root("fas", "heart"),
            Icon.Root("fas", "star"),
        ], { gap: "4" });
    }),
    inputs: [],
});

export const iconStyles = example({
    keywords: ["Icon", "Root", "fas", "far", "fab", "FontAwesome"],
    description: "Solid, regular, and brands",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Icon.Root("far", "bookmark"),
            Icon.Root("fas", "bookmark"),
            Icon.Root("fab", "github"),
            Icon.Root("fab", "twitter"),
            Icon.Root("fab", "react"),
        ], { gap: "4" });
    }),
    inputs: [],
});

export const iconInteractive = example({
    keywords: ["Icon", "Reactive", "State", "interactive", "toggle"],
    description: "Toggle between a star and heart icon on each click",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const counter = $.let(State.bind([IntegerType], "icon_counter", 0n));
            const value = $.let(counter.read());
            const isStar = $.let(value.remainder(2n).equal(0n));
            const display = $.let(isStar.ifElse(
                () => Icon.Root("fas", "star", { size: "2xl", colorPalette: "yellow" }),
                () => Icon.Root("fas", "heart", { size: "2xl", colorPalette: "red" }),
            ));
            const inc = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return Stack.HStack([
                display,
                Button.Root("Toggle icon", { onClick: inc }),
            ], { gap: "3", align: "center" });
        }));
    }),
    inputs: [],
});
