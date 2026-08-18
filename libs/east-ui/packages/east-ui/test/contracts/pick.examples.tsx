/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, StringType, StructType, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Pick, Reactive, Text } from "@elaraai/east-ui";

/** One pickable thing — the smallest shape with an id and a name. */
const ITEM = StructType({ key: StringType, name: StringType });

/** The library, hoisted to module scope (no host helpers inside East bodies). */
const LIBRARY = [
    { key: "machines", name: "Machine jobs" },
    { key: "load", name: "Line load" },
    { key: "crew", name: "Crew shifts" },
];

export const pickState = example({
    keywords: ["Pick", "state", "hidden", "seed", "PickStateType", "#590"],
    description: "Seed a pick with ids switched off — the state is what is HIDDEN, so an empty seed shows everything",
    fn: East.function([], ArrayType(StringType), (_$) => Pick.state(["crew"])),
    inputs: [],
    returns: ["crew"],
});

export const pickVisibleAll = example({
    keywords: ["Pick", "visible", "hidden", "empty", "default", "declaration order", "#590"],
    description: "An empty hidden list shows every item, in declaration order",
    fn: East.function([], ArrayType(StringType), ($) => {
        const all = $.const(LIBRARY, ArrayType(ITEM));
        const idOf = $.const(East.function([ITEM], StringType, (_$, item) => item.key));
        const shown = $.let(Pick.visible(all, idOf, []), ArrayType(ITEM));
        return shown.map((_$, item) => item.key);
    }),
    inputs: [],
    returns: ["machines", "load", "crew"],
});

export const pickVisibleHidden = example({
    keywords: ["Pick", "visible", "hidden", "toggle", "off", "filter", "#590"],
    description: "A hidden id drops its item and leaves the rest in declaration order",
    fn: East.function([], ArrayType(StringType), ($) => {
        const all = $.const(LIBRARY, ArrayType(ITEM));
        const idOf = $.const(East.function([ITEM], StringType, (_$, item) => item.key));
        const shown = $.let(Pick.visible(all, idOf, ["load"]), ArrayType(ITEM));
        return shown.map((_$, item) => item.key);
    }),
    inputs: [],
    returns: ["machines", "crew"],
});

export const pickVisibleStale = example({
    keywords: ["Pick", "visible", "stale", "unknown", "rename", "persisted", "new item", "#590"],
    description: "Persisted state survives the library changing — an id naming nothing is ignored, and an item the state never mentioned still shows",
    fn: East.function([], ArrayType(StringType), ($) => {
        const all = $.const(LIBRARY, ArrayType(ITEM));
        const idOf = $.const(East.function([ITEM], StringType, (_$, item) => item.key));
        // "defects" was renamed away; "crew" shipped after this state was written.
        const shown = $.let(Pick.visible(all, idOf, ["defects", "machines"]), ArrayType(ITEM));
        return shown.map((_$, item) => item.key);
    }),
    inputs: [],
    returns: ["load", "crew"],
});

export const pickBindHandle = example({
    keywords: ["Pick", "bind", "active", "handle", "Reactive", "State", "library", "panel", "persisted", "#590"],
    description: "Bind a library to a persisted pick inside Reactive.Root and feed the survivors to a component",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const all = $.const(LIBRARY, ArrayType(ITEM));
            // Bind ONCE, in the evaluation that mounts both the panel and the
            // component — a Reactive body is a free function and cannot capture
            // a handle from an enclosing scope.
            const shown = $.let(Pick.bind("demo.library", all, {
                id: (item) => item.key,
                title: (item) => item.name,
                hidden: ["crew"],
            }));
            const kept = $.let(Pick.active(shown), ArrayType(ITEM));
            return <Text>{East.str`${kept.length()} of ${all.length()} showing`}</Text>;
        }}</Reactive>
    )),
    inputs: [],
});
