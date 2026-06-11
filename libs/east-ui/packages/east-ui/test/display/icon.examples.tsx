/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Icon, HStack, Reactive } from "@elaraai/east-ui";

export const iconBasic = example({
    keywords: ["Icon", "Root", "fas", "FontAwesome"],
    description: "Font Awesome icons",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="4">
                <Icon prefix="fas" name="house" />
                <Icon prefix="fas" name="user" />
                <Icon prefix="fas" name="gear" />
                <Icon prefix="fas" name="bell" />
                <Icon prefix="fas" name="heart" />
                <Icon prefix="fas" name="star" />
            </HStack>
        );
    }),
    inputs: [],
});

export const iconStyles = example({
    keywords: ["Icon", "Root", "fas", "far", "fab", "FontAwesome"],
    description: "Solid, regular, and brands",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="4">
                <Icon prefix="far" name="bookmark" />
                <Icon prefix="fas" name="bookmark" />
                <Icon prefix="fab" name="github" />
                <Icon prefix="fab" name="twitter" />
                <Icon prefix="fab" name="react" />
            </HStack>
        );
    }),
    inputs: [],
});

export const iconInteractive = example({
    keywords: ["Icon", "Reactive", "State", "interactive", "toggle"],
    description: "Toggle between a star and heart icon on each click",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const counter = $.let(State.bind([IntegerType], "icon_counter", 0n));
            const value = $.let(counter.read());
            const isStar = $.let(value.remainder(2n).equal(0n));
            const display = $.let(isStar.ifElse(
                () => <Icon prefix="fas" name="star" size="2xl" colorPalette="yellow" />,
                () => <Icon prefix="fas" name="heart" size="2xl" colorPalette="red" />,
            ));
            const inc = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return (
                <HStack gap="3" align="center">
                    {display}
                    <Button onClick={inc}>Toggle icon</Button>
                </HStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
