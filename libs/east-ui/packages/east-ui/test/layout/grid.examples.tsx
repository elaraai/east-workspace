/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Button, Configurator, Grid, HStack, SegmentGroup, Switch, Text, VStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const gridBasic = example({
    keywords: ["Grid", "Root", "Item", "templateColumns", "repeat", "basic"],
    description: "Equal-width columns with gap",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Grid
                items={[
                    Grid.Item(<Box padding="2" background="bg.brand.subtle" borderRadius="sm"><Text>1</Text></Box>),
                    Grid.Item(<Box padding="2" background="bg.brand.subtle" borderRadius="sm"><Text>2</Text></Box>),
                    Grid.Item(<Box padding="2" background="bg.brand.subtle" borderRadius="sm"><Text>3</Text></Box>),
                    Grid.Item(<Box padding="2" background="bg.brand.subtle" borderRadius="sm"><Text>4</Text></Box>),
                    Grid.Item(<Box padding="2" background="bg.brand.subtle" borderRadius="sm"><Text>5</Text></Box>),
                    Grid.Item(<Box padding="2" background="bg.brand.subtle" borderRadius="sm"><Text>6</Text></Box>),
                ]}
                templateColumns="repeat(3, 1fr)"
                gap="3"
            />
        );
    }),
    inputs: [],
});

// ============================================================================
// Grid — live configurator over template, gaps, spans and alignment
// ============================================================================

export const gridVariants = example({
    keywords: ["Grid", "Root", "Item", "colSpan", "span", "columnGap", "rowGap", "gap", "templateColumns", "fixed", "px", "templateRows", "justifyItems", "alignItems", "centered", "auto-fit", "minmax", "responsive", "autoFlow", "dense", "packing", "header", "area", "templateAreas", "named-areas", "layout", "Reactive", "State", "interactive", "counter", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Grid configurator — template preset and gap axes plus span and centered switches driving one live grid; the aside bumps cell labels from a reactive counter",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Template is a preset axis (the stat precedent): each entry
                // swaps the whole grid — template strings, the items that make
                // them legible, and the colSpan a full-width header needs there.
                // `dense` carries a 2-col item so dense auto-flow has a gap to
                // back-fill; `areas` names its cells against templateAreas.
                const templates = $.const([
                    {
                        label: "3-col", cols: "repeat(3, 1fr)", rows: "auto", areas: "none", span: "3",
                        items: [
                            Grid.Item(<Box padding="2" background="bg.success.subtle" borderRadius="sm"><Text>Spans 2 columns</Text></Box>, { colSpan: "2" }),
                            Grid.Item(<Box padding="2" background="bg.success.subtle" borderRadius="sm"><Text>One</Text></Box>),
                            Grid.Item(<Box padding="2" background="bg.success.subtle" borderRadius="sm"><Text>Two</Text></Box>),
                            Grid.Item(<Box padding="2" background="bg.success.subtle" borderRadius="sm"><Text>Three</Text></Box>),
                            Grid.Item(<Box padding="2" background="bg.success.subtle" borderRadius="sm"><Text>Four</Text></Box>),
                        ],
                    },
                    {
                        label: "fixed", cols: "100px 200px 100px", rows: "auto", areas: "none", span: "3",
                        items: [
                            Grid.Item(<Box padding="2" background="bg.warning.subtle" borderRadius="sm"><Text>100px</Text></Box>),
                            Grid.Item(<Box padding="2" background="bg.warning.subtle" borderRadius="sm"><Text>200px</Text></Box>),
                            Grid.Item(<Box padding="2" background="bg.warning.subtle" borderRadius="sm"><Text>100px</Text></Box>),
                        ],
                    },
                    {
                        label: "auto-fit", cols: "repeat(auto-fit, minmax(80px, 1fr))", rows: "auto", areas: "none", span: "2",
                        items: [
                            Grid.Item(<Box padding="3" background="bg.brand.subtle" borderRadius="sm"><Text>Item 1</Text></Box>),
                            Grid.Item(<Box padding="3" background="bg.brand.subtle" borderRadius="sm"><Text>Item 2</Text></Box>),
                            Grid.Item(<Box padding="3" background="bg.brand.subtle" borderRadius="sm"><Text>Item 3</Text></Box>),
                            Grid.Item(<Box padding="3" background="bg.brand.subtle" borderRadius="sm"><Text>Item 4</Text></Box>),
                        ],
                    },
                    {
                        label: "dense", cols: "repeat(3, 1fr)", rows: "auto", areas: "none", span: "3",
                        items: [
                            Grid.Item(<Box padding="2" background="bg.subtle" borderRadius="sm"><Text>Wide</Text></Box>, { colSpan: "2" }),
                            Grid.Item(<Box padding="2" background="bg.subtle" borderRadius="sm"><Text>A</Text></Box>),
                            Grid.Item(<Box padding="2" background="bg.subtle" borderRadius="sm"><Text>B</Text></Box>),
                            Grid.Item(<Box padding="2" background="bg.subtle" borderRadius="sm"><Text>C</Text></Box>),
                        ],
                    },
                    {
                        label: "areas", cols: "120px 1fr", rows: "auto 1fr", areas: '"head head" "nav main"', span: "2",
                        items: [
                            Grid.Item(<Box padding="2" background="bg.brand.subtle" borderRadius="sm"><Text>Head</Text></Box>, { area: "head" }),
                            Grid.Item(<Box padding="2" background="bg.success.subtle" borderRadius="sm"><Text>Nav</Text></Box>, { area: "nav" }),
                            Grid.Item(<Box padding="2" background="bg.subtle" borderRadius="sm"><Text>Main</Text></Box>, { area: "main" }),
                        ],
                    },
                ], ArrayType(StructType({ label: StringType, cols: StringType, rows: StringType, areas: StringType, span: StringType, items: ArrayType(Grid.Types.Item) })));

                // Only the gap pair needs a struct — a columnGap is only legible
                // against the rowGap it contrasts with.
                const gaps = $.const([
                    { label: "even",  col: "3", row: "3" },
                    { label: "split", col: "8", row: "2" },
                    { label: "airy",  col: "6", row: "6" },
                ], ArrayType(StructType({ label: StringType, col: StringType, row: StringType })));

                const templateBind = $.let(State.bind([StringType], "grid_template", "3-col"));
                const gapsBind     = $.let(State.bind([StringType], "grid_gaps", "even"));
                const spanBind     = $.let(State.bind([BooleanType], "grid_span", false));
                const centeredBind = $.let(State.bind([BooleanType], "grid_centered", false));
                const counter      = $.let(State.bind([IntegerType], "grid_counter", 0n));

                const tKey     = $.let(templateBind.read());
                const gKey     = $.let(gapsBind.read());
                const spanOn   = $.let(spanBind.read());
                const centered = $.let(centeredBind.read());
                const count    = $.let(counter.read());

                const onTemplate = $.const(East.function([StringType], NullType, ($, next) => { $(templateBind.write(next)); }));
                const onGaps     = $.const(East.function([StringType], NullType, ($, next) => { $(gapsBind.write(next)); }));
                const onSpan     = $.const(East.function([BooleanType], NullType, ($, next) => { $(spanBind.write(next)); }));
                const onCentered = $.const(East.function([BooleanType], NullType, ($, next) => { $(centeredBind.write(next)); }));
                const inc        = $.const(East.function([], NullType, $ => {
                    const cur = $.let(counter.read());
                    $(counter.write(cur.add(1n)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const template = $.let(templates.filter((_$, o) => o.label.equal(tKey)).get(0n));
                const gap = $.let(gaps.filter((_$, o) => o.label.equal(gKey)).get(0n));

                // The span switch prepends a header item spanning the preset's
                // full column count (the old full-width header row).
                const headed = $.const([
                    Grid.Item(<Box padding="3" background="bg.subtle" borderRadius="sm"><Text>Full width header</Text></Box>, { colSpan: template.span }),
                ], ArrayType(Grid.Types.Item));
                const items = $.let(spanOn.ifElse(_$ => headed.concat(template.items), _$ => template.items));

                const flow = $.let(tKey.equal("dense").ifElse(_$ => variant("row dense", null), _$ => variant("row", null)));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Template", tKey,
                                <SegmentGroup value={tKey} onChange={onTemplate} size="sm"
                                    items={templates.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />,
                                "columns · rows · areas · flow per preset"),
                            Configurator.Control("Gaps", gKey,
                                <SegmentGroup value={gKey} onChange={onGaps} size="sm"
                                    items={gaps.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />,
                                "columnGap · rowGap pair"),
                            // A Slot, not a Control: the two switches report as
                            // the Span / Cells spec rows below rather than as one
                            // value.
                            Configurator.Slot("Items",
                                <HStack gap="5" align="center">
                                    <Switch checked={spanOn} label="Span" onChange={onSpan} />
                                    <Text textStyle="caption" color="fg.subtle">full-width header</Text>
                                    <Switch checked={centered} label="Centered" onChange={onCentered} />
                                    <Text textStyle="caption" color="fg.subtle">justifyItems · alignItems</Text>
                                </HStack>),
                        ]}
                        preview={
                            <Grid
                                items={items}
                                templateColumns={template.cols}
                                templateRows={template.rows}
                                templateAreas={template.areas}
                                autoFlow={flow}
                                columnGap={gap.col}
                                rowGap={gap.row}
                                justifyItems={centered.ifElse(_$ => variant("center", null), _$ => variant("flex-start", null))}
                                alignItems={centered.ifElse(_$ => variant("center", null), _$ => variant("stretch", null))}
                            />
                        }
                        aside={{
                            label: "Cells · Reactive",
                            body: (
                                <VStack gap="3" align="stretch">
                                    <Grid
                                        items={[
                                            Grid.Item(<Box padding="2" background="bg.brand.subtle" borderRadius="sm"><Text>{East.str`Cell A — ${East.print(count)}`}</Text></Box>),
                                            Grid.Item(<Box padding="2" background="bg.success.subtle" borderRadius="sm"><Text>{East.str`Cell B — ${East.print(count)}`}</Text></Box>),
                                            Grid.Item(<Box padding="2" background="bg.subtle" borderRadius="sm"><Text>{East.str`Cell C — ${East.print(count)}`}</Text></Box>),
                                        ]}
                                        templateColumns="repeat(3, 1fr)"
                                        gap="3"
                                    />
                                    <Button size="xs" onClick={inc}>Bump</Button>
                                </VStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Flow", tKey.equal("dense").ifElse(_$ => "row dense", _$ => "row")),
                            Configurator.Spec("Span", spanOn.ifElse(_$ => East.str`header spans ${template.span}`, _$ => "natural")),
                            Configurator.Spec("Cells", East.print(items.size())),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
