/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, IntegerType, StringType, StructType, example, none, some } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { IconType, Pick, Reactive, Text, VStack } from "@elaraai/east-ui";

/** One pickable thing — the smallest shape with an id and a name. */
const ITEM = StructType({
    key: StringType, name: StringType, role: StringType,
    icon: StringType, rows: IntegerType, total: IntegerType,
});

/** The library, hoisted to module scope (no host helpers inside East bodies). */
const LIBRARY = [
    { key: "machines", name: "Machine jobs", role: "span · one row per machine", icon: "bars-staggered", rows: 18n, total: 24n },
    { key: "load",     name: "Line load",    role: "heat · per line",            icon: "table-cells-large", rows: 6n,  total: 6n },
    { key: "crew",     name: "Crew shifts",  role: "cards · per crew",           icon: "user-group",        rows: 0n,  total: 0n },
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
                id:       (item) => item.key,
                title:    (item) => item.name,
                subtitle: (item) => some(item.role),
                icon:     (item) => some(East.value(
                    { name: item.icon, prefix: "fas", label: none, style: none },
                    IconType,
                )),
                count:    (item) => some(item.rows),
                // A series whose own filter narrowed it reports the NARROWED
                // count, marked so a glance still says "this is filtered".
                narrowed: (item) => item.rows.less(item.total),
                hidden:   ["crew"],
            }));
            const kept = $.let(Pick.active(shown), ArrayType(ITEM));
            return (
                <VStack gap="4" align="stretch">
                    <Pick.Panel value={shown} title="Series" />
                    <Text>{East.str`${kept.length()} of ${all.length()} showing`}</Text>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
