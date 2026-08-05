/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, StructType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Carousel, Configurator, HStack, SegmentGroup, Select, Switch, Text, Reactive } from "@elaraai/east-ui";

export const carouselBasic = example({
    keywords: ["Carousel", "Root", "showControls", "showIndicators", "basic"],
    description: "Simple slideshow with controls",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Box width="100%">
                <Carousel showControls={true} showIndicators={true}>
                    <Box padding="8" background="bg.brand.subtle" borderRadius="md"><Text>Slide 1</Text></Box>
                    <Box padding="8" background="bg.brand.subtle" borderRadius="md"><Text>Slide 2</Text></Box>
                    <Box padding="8" background="bg.subtle" borderRadius="md"><Text>Slide 3</Text></Box>
                </Carousel>
            </Box>
        );
    }),
    inputs: [],
});

// ============================================================================
// Carousel — live configurator over every slideshow axis
// ============================================================================

export const carouselVariants = example({
    keywords: ["Carousel", "Root", "loop", "infinite", "slidesPerView", "spacing", "multiple", "showControls", "showIndicators", "allowMouseDrag", "drag", "swipe", "minimal", "style", "colour", "indicatorColor", "controlColor", "branded", "Reactive", "State", "onIndexChange", "interactive", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Carousel configurator — slide, chrome and colour axes plus loop and draggable switches driving one live carousel; the aside reads the reactive slide index back",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // A slide set is its slides PLUS the per-view count and spacing
                // that make them legible, so the axis is a struct.
                const sets = $.const([
                    {
                        label: "single", perView: 1n, spacing: "0",
                        slides: [
                            <Box padding="8" background="bg.success.subtle" borderRadius="md"><Text>First</Text></Box>,
                            <Box padding="8" background="bg.warning.subtle" borderRadius="md"><Text>Second</Text></Box>,
                            <Box padding="8" background="bg.subtle" borderRadius="md"><Text>Third</Text></Box>,
                            <Box padding="8" background="bg.brand.subtle" borderRadius="md"><Text>Fourth</Text></Box>,
                        ],
                    },
                    {
                        label: "multi", perView: 3n, spacing: "4",
                        slides: [
                            <Box padding="4" background="bg.danger.subtle" borderRadius="md"><Text>1</Text></Box>,
                            <Box padding="4" background="bg.warning.subtle" borderRadius="md"><Text>2</Text></Box>,
                            <Box padding="4" background="bg.warning.subtle" borderRadius="md"><Text>3</Text></Box>,
                            <Box padding="4" background="bg.success.subtle" borderRadius="md"><Text>4</Text></Box>,
                            <Box padding="4" background="bg.brand.subtle" borderRadius="md"><Text>5</Text></Box>,
                        ],
                    },
                ], ArrayType(StructType({ label: StringType, perView: IntegerType, spacing: StringType, slides: ArrayType(UIComponentType) })));

                // Chrome is the controls / indicators pair, so the axis is a
                // struct of the two booleans.
                const chromes = $.const([
                    { label: "full",       controls: true,  indicators: true },
                    { label: "controls",   controls: true,  indicators: false },
                    { label: "indicators", controls: false, indicators: true },
                    { label: "none",       controls: false, indicators: false },
                ], ArrayType(StructType({ label: StringType, controls: BooleanType, indicators: BooleanType })));

                // Colour slots come as a set — the recipe row mirrors the slot
                // recipe's defaults, branded shows the escape hatches.
                const colors = $.const([
                    { label: "recipe",  indicator: "border.strong", active: "{colors.brand.700}", control: "fg.default", controlBg: "bg.surface" },
                    { label: "branded", indicator: "fg.subtle",     active: "link",               control: "fg.inverse", controlBg: "bg.inverse" },
                ], ArrayType(StructType({ label: StringType, indicator: StringType, active: StringType, control: StringType, controlBg: StringType })));

                const slidesBind = $.let(State.bind([StringType], "carousel_slides", "single"));
                const chromeBind = $.let(State.bind([StringType], "carousel_chrome", "full"));
                const colorBind  = $.let(State.bind([StringType], "carousel_color", "recipe"));
                const loopBind   = $.let(State.bind([BooleanType], "carousel_loop", false));
                const dragBind   = $.let(State.bind([BooleanType], "carousel_drag", false));
                const indexBind  = $.let(State.bind([IntegerType], "carousel_index", 0n));

                const sKey = $.let(slidesBind.read());
                const chKey = $.let(chromeBind.read());
                const cKey = $.let(colorBind.read());
                const loop = $.let(loopBind.read());
                const drag = $.let(dragBind.read());
                const currentIndex = $.let(indexBind.read());

                const onSlides = $.const(East.function([StringType], NullType, ($, next) => { $(slidesBind.write(next)); }));
                const onChrome = $.const(East.function([StringType], NullType, ($, next) => { $(chromeBind.write(next)); }));
                const onColor  = $.const(East.function([StringType], NullType, ($, next) => { $(colorBind.write(next)); }));
                const onLoop   = $.const(East.function([BooleanType], NullType, ($, next) => { $(loopBind.write(next)); }));
                const onDrag   = $.const(East.function([BooleanType], NullType, ($, next) => { $(dragBind.write(next)); }));
                const onIndexChange = $.const(East.function([IntegerType], NullType, ($, newIndex) => {
                    $(indexBind.write(newIndex));
                }));

                // Each selection is a lookup into the same array the control renders.
                const slideSet = $.let(sets.filter((_$, o) => o.label.equal(sKey)).get(0n));
                const chrome = $.let(chromes.filter((_$, o) => o.label.equal(chKey)).get(0n));
                const color = $.let(colors.filter((_$, o) => o.label.equal(cKey)).get(0n));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Slides", sKey,
                                <SegmentGroup value={sKey} onChange={onSlides} size="sm"
                                    items={sets.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            Configurator.Control("Chrome", chKey,
                                <Select value={chKey} onChange={onChrome} size="sm"
                                    items={chromes.map((_$, o) => Select.Item(o.label, o.label))} />),
                            Configurator.Control("Colour", cKey,
                                <SegmentGroup value={cKey} onChange={onColor} size="sm"
                                    items={colors.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            // A Slot, not a Control: the two switches report as the
                            // Loop / Drag spec rows below rather than as one value.
                            Configurator.Slot("Motion",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={loop} label="Loop" onChange={onLoop} />
                                    <Switch checked={drag} label="Draggable" onChange={onDrag} />
                                </HStack>),
                        ]}
                        preview={
                            <Box width="100%">
                                <Carousel
                                    slidesPerView={slideSet.perView}
                                    spacing={slideSet.spacing}
                                    showControls={chrome.controls}
                                    showIndicators={chrome.indicators}
                                    loop={loop}
                                    allowMouseDrag={drag}
                                    indicatorColor={color.indicator}
                                    activeIndicatorColor={color.active}
                                    controlColor={color.control}
                                    controlBackground={color.controlBg}
                                    onIndexChange={onIndexChange}
                                >{slideSet.slides}</Carousel>
                            </Box>
                        }
                        aside={{
                            label: "Index · Reactive",
                            body: (
                                <Text.Eyebrow>{East.str`CURRENT · ${currentIndex.add(1n)} OF ${East.print(slideSet.slides.size())}`}</Text.Eyebrow>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Per view", East.print(slideSet.perView)),
                            Configurator.Spec("Loop", loop.ifElse(_$ => "on", _$ => "off")),
                            Configurator.Spec("Drag", drag.ifElse(_$ => "on", _$ => "off")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
