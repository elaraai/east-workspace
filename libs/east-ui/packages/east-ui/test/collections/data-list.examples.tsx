/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Badge, Configurator, DataList, Highlight, HoverCard, SegmentGroup, Style, Text, VStack, Reactive } from "@elaraai/east-ui";

export const dataListBasic = example({
    keywords: ["DataList", "Root", "basic", "vertical"],
    description: "Default vertical data list",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <DataList items={[
                { label: "Status", value: <Text>Active</Text> },
                { label: "User", value: <Text>john.doe@example.com</Text> },
                { label: "Created", value: <Text>2024-01-15</Text> },
            ]} />
        );
    }),
    inputs: [],
});

// ============================================================================
// DataList — live configurator over every list axis
// ============================================================================

export const dataListVariants = example({
    keywords: ["DataList", "Root", "orientation", "horizontal", "variant", "bold", "size", "sm", "compact", "lg", "profile", "user", "colour", "override", "Badge", "HoverCard", "Highlight", "rich", "background", "labelColor", "valueColor", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "DataList configurator — orientation, variant, size, content-preset (specs / profile / rich) and colour axes driving one live list",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const orientations = $.const([
                    variant("vertical", null), variant("horizontal", null),
                ], ArrayType(Style.Types.Orientation));

                const variants = $.const([
                    variant("subtle", null), variant("bold", null),
                ], ArrayType(DataList.Types.Variant));

                const sizes = $.const([
                    variant("sm", null), variant("md", null), variant("lg", null),
                ], ArrayType(DataList.Types.Size));

                // Only the content needs a struct — a preset is its rows PLUS
                // the label the segment control names it by.
                const presets = $.const([
                    {
                        label: "specs",
                        items: [
                            { label: "CPU", value: <Text>Intel i9-14900K</Text> },
                            { label: "RAM", value: <Text>64GB DDR5</Text> },
                            { label: "Storage", value: <Text>2TB NVMe SSD</Text> },
                        ],
                    },
                    {
                        label: "profile",
                        items: [
                            { label: "Full Name", value: <Text>Jane Smith</Text> },
                            { label: "Email", value: <Text>jane.smith@company.com</Text> },
                            { label: "Department", value: <Text>Engineering</Text> },
                            { label: "Role", value: <Text>Senior Developer</Text> },
                            { label: "Location", value: <Text>San Francisco, CA</Text> },
                        ],
                    },
                    {
                        label: "rich",
                        items: [
                            { label: "Status", value: <Badge variant="solid" colorPalette="success">Active</Badge> },
                            {
                                label: "Assigned To",
                                value: (
                                    <HoverCard trigger={<Text color="link">@alice</Text>}>
                                        <VStack gap="1">
                                            <Text fontWeight="bold">Alice Johnson</Text>
                                            <Text textStyle="body-sm">Lead Designer — UX Team</Text>
                                        </VStack>
                                    </HoverCard>
                                ),
                            },
                            { label: "Filter", value: <Highlight query={["LIKE"]}>name LIKE '%smith%'</Highlight> },
                            { label: "Priority", value: <Badge variant="subtle" colorPalette="danger">Urgent</Badge> },
                        ],
                    },
                ], ArrayType(StructType({ label: StringType, items: ArrayType(DataList.Types.Item) })));

                // Colour slots come as a set — the recipe row mirrors the
                // renderer's defaults, branded shows the escape hatches.
                const colors = $.const([
                    { label: "recipe",  background: "transparent",     borderColor: "border.subtle", labelColor: "fg.subtle", valueColor: "fg.default" },
                    { label: "branded", background: "bg.brand.subtle", borderColor: "border.brand",  labelColor: "link",      valueColor: "link" },
                ], ArrayType(StructType({ label: StringType, background: StringType, borderColor: StringType, labelColor: StringType, valueColor: StringType })));

                const orientationBind = $.let(State.bind([StringType], "datalist_orientation", "vertical"));
                const variantBind     = $.let(State.bind([StringType], "datalist_variant", "subtle"));
                const sizeBind        = $.let(State.bind([StringType], "datalist_size", "md"));
                const contentBind     = $.let(State.bind([StringType], "datalist_content", "specs"));
                const colorBind       = $.let(State.bind([StringType], "datalist_color", "recipe"));

                const oKey = $.let(orientationBind.read());
                const vKey = $.let(variantBind.read());
                const sKey = $.let(sizeBind.read());
                const pKey = $.let(contentBind.read());
                const cKey = $.let(colorBind.read());

                const onOrientation = $.const(East.function([StringType], NullType, ($, next) => { $(orientationBind.write(next)); }));
                const onVariant     = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
                const onSize        = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
                const onContent     = $.const(East.function([StringType], NullType, ($, next) => { $(contentBind.write(next)); }));
                const onColor       = $.const(East.function([StringType], NullType, ($, next) => { $(colorBind.write(next)); }));

                // Each selection is a lookup into the same array the control renders.
                const orientation = $.let(orientations.filter((_$, v) => v.getTag().equal(oKey)).get(0n));
                const listVariant = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)).get(0n));
                const size = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));
                const preset = $.let(presets.filter((_$, o) => o.label.equal(pKey)).get(0n));
                const color = $.let(colors.filter((_$, o) => o.label.equal(cKey)).get(0n));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Orientation", oKey,
                                <SegmentGroup value={oKey} onChange={onOrientation} size="sm"
                                    items={orientations.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Variant", vKey,
                                <SegmentGroup value={vKey} onChange={onVariant} size="sm"
                                    items={variants.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Size", sKey,
                                <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                    items={sizes.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Content", pKey,
                                <SegmentGroup value={pKey} onChange={onContent} size="sm"
                                    items={presets.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            Configurator.Control("Colour", cKey,
                                <SegmentGroup value={cKey} onChange={onColor} size="sm"
                                    items={colors.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                        ]}
                        preview={
                            <DataList
                                orientation={orientation}
                                variant={listVariant}
                                size={size}
                                background={color.background}
                                borderColor={color.borderColor}
                                labelColor={color.labelColor}
                                valueColor={color.valueColor}
                                items={preset.items}
                            />
                        }
                                                spec={[
                            Configurator.Spec("Rows", East.print(preset.items.size())),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
