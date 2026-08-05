/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, East, NullType, StringType, example, some, none } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Breadcrumb, Configurator, Reactive, SegmentGroup, Text } from "@elaraai/east-ui";

export const breadcrumbBasic = example({
    keywords: ["Breadcrumb", "Root", "navigation", "separator"],
    description: "Basic breadcrumb — mono links, '/' separator, current page in ink",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Breadcrumb items={[
                { label: "Home", current: none, onClick: none },
                { label: "Components", current: none, onClick: none },
                { label: "Breadcrumb", current: some(true), onClick: none },
            ]} />
        );
    }),
    inputs: [],
});

export const breadcrumbVariants = example({
    keywords: ["Breadcrumb", "Root", "runAnchor", "run", "stamp", "leadingSeparator", "path", "Reactive", "State", "onClick", "interactive", "SegmentGroup", "Configurator", "configurator"],
    description: "Breadcrumb configurator — a chrome preset axis (plain / run-anchor / path) on one live clickable trail; the aside reads the current page",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const presets = $.const(["plain", "run", "path"], ArrayType(StringType));

            const presetBind = $.let(State.bind([StringType], "breadcrumb_preset", "plain"));
            const pageBind = $.let(State.bind([StringType], "breadcrumb_page", "Home"));

            const pKey = $.let(presetBind.read());
            const page = $.let(pageBind.read());

            const onPreset = $.const(East.function([StringType], NullType, ($, next) => { $(presetBind.write(next)); }));
            const goHome = $.const(East.function([], NullType, $ => { $(pageBind.write("Home")); }));
            const goProducts = $.const(East.function([], NullType, $ => { $(pageBind.write("Products")); }));
            const goWidgets = $.const(East.function([], NullType, $ => { $(pageBind.write("Widgets")); }));

            // runAnchor / leadingSeparator are presence-typed, so the axis
            // picks between prebuilt trails; the click bindings are shared.
            const preview = $.const(pKey.equal("run").ifElse(
                _$ => (
                    <Breadcrumb
                        items={[
                            { label: "SE region", current: none, onClick: some(goHome) },
                            { label: "wk of Sep 16", current: none, onClick: some(goProducts) },
                            { label: "Roster builder", current: some(true), onClick: none },
                        ]}
                        runAnchor="run #42"
                    />
                ),
                _$ => pKey.equal("path").ifElse(
                    _$ => (
                        <Breadcrumb
                            items={[
                                { label: "workspace", current: none, onClick: some(goHome) },
                                { label: "roster", current: none, onClick: some(goProducts) },
                                { label: "wk of Sep 16", current: some(true), onClick: none },
                            ]}
                            leadingSeparator={true}
                        />
                    ),
                    _$ => (
                        <Breadcrumb items={[
                            { label: "Home", current: none, onClick: some(goHome) },
                            { label: "Products", current: none, onClick: some(goProducts) },
                            { label: "Widgets", current: none, onClick: some(goWidgets) },
                            { label: "Details", current: some(true), onClick: none },
                        ]} />
                    ),
                ),
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Chrome", pKey,
                            <SegmentGroup value={pKey} onChange={onPreset} size="sm"
                                items={presets.map((_$, o) => SegmentGroup.Item(o, <Text>{o.upperCase()}</Text>))} />),
                    ]}
                    preview={preview}
                    aside={{
                        label: "onClick · Reactive",
                        body: <Text.MonoLabel>{East.str`PAGE · ${page}`}</Text.MonoLabel>,
                    }}
                    spec={[
                        Configurator.Spec("Chrome", pKey.equal("run").ifElse(_$ => "run anchor", _$ => pKey.equal("path").ifElse(_$ => "leading /", _$ => "plain"))),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
