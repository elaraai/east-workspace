/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// The control for `studio-lint.spec.ts`: the same surface, but the component is
// made by a TS helper declared inside the East function, which the East rules
// flag. It shows the rules see this program's East blocks, so the clean file's
// silence means something.

import { East, IntegerType } from "@elaraai/east";
import { Reactive, State, Text, UIComponentType } from "@elaraai/east-ui/internal";
import { Studio } from "@elaraai/e3-ui/internal";

export const surface = East.function([], UIComponentType, ($) => {
    const make = (key: string) => Studio.component(key, {
        name: "Counter", category: "Display", icon: "gauge-high",
    }, East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($2) => {
        const clicks = $2.let(State.bind([IntegerType], "studio-lint.clicks", 0n));
        return Text.Root(East.print(clicks.read()));
    }))));
    const components = $.let([make("counter")]);
    return Studio.dispatch(components, "counter");
});
