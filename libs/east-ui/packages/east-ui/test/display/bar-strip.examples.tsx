/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, East, NullType, StringType, example, variant } from "@elaraai/east";
import { State, Style, UIComponentType } from "@elaraai/east-ui";
import { BarStrip, Configurator, HStack, Reactive, SegmentGroup, Switch, Text } from "@elaraai/east-ui";

export const barStripBasic = example({
    keywords: ["BarStrip", "Root", "items"],
    description: "Basic BarStrip with three rows and tones",
    fn: East.function([], UIComponentType, ($) => {
        return (
            <BarStrip items={[
                { label: <Text>Alpha</Text>, value: 42.0, tone: "success" },
                { label: <Text>Beta</Text>, value: 28.0, tone: "warning" },
                { label: <Text>Gamma</Text>, value: 15.0, tone: "danger" },
            ]} />
        );
    }),
    inputs: [],
});

export const barStripVariants = example({
    keywords: ["BarStrip", "Root", "sort", "desc", "thickness", "density", "condensed", "compact", "comfortable", "maxItems", "clipping", "showValues", "Reactive", "State", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "BarStrip configurator — density and thickness axes plus sorted, row-limit and values switches on one live strip",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const densities = $.const([
                variant("condensed", null), variant("compact", null), variant("comfortable", null),
            ], ArrayType(Style.Types.Density));
            const thicknesses = $.const([
                variant("xs", null), variant("sm", null), variant("md", null),
            ], ArrayType(BarStrip.Types.Thickness));

            const densityBind = $.let(State.bind([StringType], "barstrip_density", "compact"));
            const thicknessBind = $.let(State.bind([StringType], "barstrip_thickness", "sm"));
            const sortBind = $.let(State.bind([BooleanType], "barstrip_sort", true));
            const limitBind = $.let(State.bind([BooleanType], "barstrip_limit", false));
            const valuesBind = $.let(State.bind([BooleanType], "barstrip_values", true));

            const dKey = $.let(densityBind.read());
            const tKey = $.let(thicknessBind.read());
            const sortOn = $.let(sortBind.read());
            const limitOn = $.let(limitBind.read());
            const valuesOn = $.let(valuesBind.read());

            const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
            const onThickness = $.const(East.function([StringType], NullType, ($, next) => { $(thicknessBind.write(next)); }));
            const onSort = $.const(East.function([BooleanType], NullType, ($, next) => { $(sortBind.write(next)); }));
            const onLimit = $.const(East.function([BooleanType], NullType, ($, next) => { $(limitBind.write(next)); }));
            const onValues = $.const(East.function([BooleanType], NullType, ($, next) => { $(valuesBind.write(next)); }));

            const density = $.let(densities.filter((_$, v) => v.getTag().equal(dKey)).get(0n));
            const thickness = $.let(thicknesses.filter((_$, v) => v.getTag().equal(tKey)).get(0n));

            // sort / maxItems are presence-typed, so the switches pick between
            // prebuilt strips; density / thickness / showValues stay live.
            const preview = $.const(sortOn.ifElse(
                _$ => limitOn.ifElse(
                    _$ => (
                        <BarStrip
                            items={[
                                { label: <Text>Backend</Text>, value: 120.0, tone: "info" },
                                { label: <Text>Frontend</Text>, value: 85.0, tone: "info" },
                                { label: <Text>DevOps</Text>, value: 42.0, tone: "info" },
                                { label: <Text>Design</Text>, value: 30.0, tone: "info" },
                                { label: <Text>QA</Text>, value: 18.0, tone: "info" },
                            ]}
                            sort="desc" maxItems={3n} density={density} thickness={thickness} showValues={valuesOn}
                        />
                    ),
                    _$ => (
                        <BarStrip
                            items={[
                                { label: <Text>Backend</Text>, value: 120.0, tone: "info" },
                                { label: <Text>Frontend</Text>, value: 85.0, tone: "info" },
                                { label: <Text>DevOps</Text>, value: 42.0, tone: "info" },
                            ]}
                            sort="desc" density={density} thickness={thickness} showValues={valuesOn}
                        />
                    ),
                ),
                _$ => (
                    <BarStrip
                        items={[
                            { label: <Text>Alpha</Text>, value: 42.0, tone: "success" },
                            { label: <Text>Beta</Text>, value: 28.0, tone: "warning" },
                            { label: <Text>Gamma</Text>, value: 15.0, tone: "danger" },
                        ]}
                        density={density} thickness={thickness} showValues={valuesOn}
                    />
                ),
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Density", dKey,
                            <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Thickness", tKey,
                            <SegmentGroup value={tKey} onChange={onThickness} size="sm"
                                items={thicknesses.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Slot("Rows",
                            <HStack gap="5" align="center">
                                <Switch checked={sortOn} label="Sorted" onChange={onSort} />
                                <Switch checked={limitOn} label="Max 3 (sorted)" onChange={onLimit} />
                                <Switch checked={valuesOn} label="Values" onChange={onValues} />
                            </HStack>),
                    ]}
                    preview={preview}
                    spec={[
                        Configurator.Spec("Rows", sortOn.ifElse(_$ => limitOn.ifElse(_$ => "5 · top 3", _$ => "3"), _$ => "3")),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
