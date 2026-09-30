/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// A surface as a solution writes one: `Studio.component(…)` inside an East
// function, and a page that places it. `studio-lint.spec.ts` runs
// every East rule over this file and expects none to fire.

import { East, IntegerType } from "@elaraai/east";
import { Reactive, State, Text, UIComponentType } from "@elaraai/east-ui/internal";
import { Studio } from "@elaraai/e3-ui/internal";

export const surface = East.function([], UIComponentType, ($) => {
    const counter = $.let(Studio.component("counter", {
        name: "Counter", category: "Display", icon: "gauge-high", span: 4n, description: "Clicks so far",
    }, East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($2) => {
        const clicks = $2.let(State.bind([IntegerType], "studio-lint.clicks", 0n));
        return Text.Root(East.str`${East.print(clicks.read())} clicks`);
    })))));
    const components = $.let([counter]);
    const pages = $.let(new Map(), Studio.Types.Pages);
    return Studio.Page({ pages, components, page: { project: "demo", page: "counters" } });
});
