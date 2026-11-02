/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A record's handles, as `Record.bind` makes them: one record bound twice, each
 * handle with mutations of its own, each runs its own.
 */

import { test, expect } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { East, NullType } from "@elaraai/east";
import { Button, Reactive, Stack, Stat, UIComponentType } from "@elaraai/east-ui/internal";
import { Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/bind/record/record";
import { act, e3Harness, settle } from "../e3-web-mount.test-utils.js";

const h = e3Harness({ "bind/record/record": ex });

/** The counter bound twice: Increment through a handle binding `increment`, Reset through one binding `reset`. */
const twoHandles = {
    fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const up = $.let(Record.bind(ex.counter, ["increment"]));
        const zero = $.let(Record.bind(ex.counter, ["reset"]));
        return Stack.Root([
            Stat.Root({ label: "Counter", value: East.print(up.read()) }),
            Button.Root("Increment", { onClick: East.function([], NullType, ($) => { $(up.mutate.increment(5n)); }) }),
            Button.Root("Reset", { onClick: East.function([], NullType, ($) => { $(zero.mutate.reset()); }) }),
        ]);
    }))),
};

test("a record bound twice, each handle binding mutations of its own, runs each handle's own", async () => {
    const { container } = await h.mount(twoHandles);
    const press = async (name: string) => {
        await act(async () => { fireEvent.click(within(container).getByRole("button", { name })); });
        await settle();
    };
    await press("Increment");
    expect(await h.read(ex.counter)).toBe(5n);
    await press("Reset");
    expect(await h.read(ex.counter)).toBe(0n);
});
