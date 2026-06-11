/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, NullType, example, some } from "@elaraai/east";
import { Share, UIComponentType } from "@elaraai/east-ui";
import { Button, Reactive } from "@elaraai/east-ui";

export const shareLinkButton = example({
    keywords: ["Share", "link", "Button", "navigator.share"],
    description: "Button that opens the OS share sheet for a URL",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const onClick = $.const(East.function([], NullType, ($) => {
                $(Share.link(East.value({
                    url: "https://app.example.com/scenarios/s1",
                    title: some("Scenario S1"),
                    text: some("Pricing scenario from Q2 2026"),
                }, Share.Types.LinkInput)));
            }));
            return <Button onClick={onClick}>Share</Button>;
        }}</Reactive>
    )),
    inputs: [],
});
