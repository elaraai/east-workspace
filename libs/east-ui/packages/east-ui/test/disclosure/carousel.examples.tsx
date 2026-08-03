/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Carousel, Separator, Text, VStack, Reactive } from "@elaraai/east-ui";

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
// Variants — static enumeration panel + interactive row (consolidation #455).
// ============================================================================

export const carouselVariants = example({
    keywords: ["Carousel", "Root", "loop", "infinite", "slidesPerView", "spacing", "multiple", "showControls", "showIndicators", "allowMouseDrag", "drag", "swipe", "minimal", "style", "colour", "indicatorColor", "controlColor", "branded", "Reactive", "State", "onIndexChange", "interactive"],
    description: "Carousel variant panel — loop (infinite scrolling), multi slide (multiple slides at once), no controls (hidden navigation), draggable (drag to navigate), minimal (controls only, no indicators), colour slots (branded indicator + control colour escape hatches), interactive (navigate to see the onIndexChange callback)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="LOOP" align="start" />
                <Box width="100%">
                    <Carousel loop={true} showControls={true} showIndicators={true}>
                        <Box padding="8" background="bg.success.subtle" borderRadius="md"><Text>First</Text></Box>
                        <Box padding="8" background="bg.warning.subtle" borderRadius="md"><Text>Second</Text></Box>
                        <Box padding="8" background="bg.subtle" borderRadius="md"><Text>Third</Text></Box>
                        <Box padding="8" background="bg.brand.subtle" borderRadius="md"><Text>Fourth</Text></Box>
                    </Carousel>
                </Box>
                <Separator label="MULTI SLIDE" align="start" />
                <Box width="100%" background="bg.subtle" padding="4" borderRadius="md">
                    <Carousel slidesPerView={3n} spacing="4" showControls={true} showIndicators={true}>
                        <Box padding="4" background="bg.danger.subtle" borderRadius="md"><Text>1</Text></Box>
                        <Box padding="4" background="bg.warning.subtle" borderRadius="md"><Text>2</Text></Box>
                        <Box padding="4" background="bg.warning.subtle" borderRadius="md"><Text>3</Text></Box>
                        <Box padding="4" background="bg.success.subtle" borderRadius="md"><Text>4</Text></Box>
                        <Box padding="4" background="bg.brand.subtle" borderRadius="md"><Text>5</Text></Box>
                    </Carousel>
                </Box>
                <Separator label="NO CONTROLS" align="start" />
                <Box width="100%">
                    <Carousel showControls={false} showIndicators={true}>
                        <Box padding="8" background="bg.canvas" borderRadius="md"><Text>Panel A</Text></Box>
                        <Box padding="8" background="bg.subtle" borderRadius="md"><Text>Panel B</Text></Box>
                        <Box padding="8" background="bg.emphasized" borderRadius="md"><Text>Panel C</Text></Box>
                    </Carousel>
                </Box>
                <Separator label="DRAGGABLE" align="start" />
                <Box width="100%">
                    <Carousel allowMouseDrag={true} showControls={true} showIndicators={true}>
                        <Box padding="8" background="bg.brand.subtle" borderRadius="md"><Text>Drag me!</Text></Box>
                        <Box padding="8" background="bg.brand.subtle" borderRadius="md"><Text>Swipe left</Text></Box>
                        <Box padding="8" background="bg.brand.subtle" borderRadius="md"><Text>Or right</Text></Box>
                    </Carousel>
                </Box>
                <Separator label="MINIMAL" align="start" />
                <Box width="100%">
                    <Carousel showControls={true} showIndicators={false}>
                        <Box padding="8" background="bg.subtle" borderRadius="md"><Text>Image 1</Text></Box>
                        <Box padding="8" background="bg.subtle" borderRadius="md"><Text>Image 2</Text></Box>
                        <Box padding="8" background="bg.subtle" borderRadius="md"><Text>Image 3</Text></Box>
                    </Carousel>
                </Box>
                <Separator label="COLOUR SLOTS" align="start" />
                <Box width="100%">
                    <Carousel
                        showControls={true}
                        showIndicators={true}
                        spacing="3"
                        indicatorColor="fg.subtle"
                        activeIndicatorColor="link"
                        controlColor="fg.inverse"
                        controlBackground="bg.inverse"
                    >
                        <Box padding="8" background="bg.brand.subtle" borderRadius="md"><Text>Branded 1</Text></Box>
                        <Box padding="8" background="bg.brand.subtle" borderRadius="md"><Text>Branded 2</Text></Box>
                        <Box padding="8" background="bg.brand.subtle" borderRadius="md"><Text>Branded 3</Text></Box>
                    </Carousel>
                </Box>
                <Separator label="INTERACTIVE" align="start" />
                <Reactive>{$ => {
                        const indexBind = $.let(State.bind([IntegerType], "carousel_index", 0n));
                        const currentIndex = $.let(indexBind.read());
                        const onIndexChange = $.const(East.function([IntegerType], NullType, ($, newIndex) => {
                            $(indexBind.write(newIndex));
                        }));
                        return (
                            <VStack gap="3" align="stretch">
                                <Box width="100%">
                                    <Carousel showControls={true} showIndicators={true} onIndexChange={onIndexChange}>
                                        <Box padding="8" background="bg.brand.subtle" borderRadius="md"><Text>Welcome!</Text></Box>
                                        <Box padding="8" background="bg.success.subtle" borderRadius="md"><Text>Features</Text></Box>
                                        <Box padding="8" background="bg.subtle" borderRadius="md"><Text>Pricing</Text></Box>
                                        <Box padding="8" background="bg.warning.subtle" borderRadius="md"><Text>Contact</Text></Box>
                                    </Carousel>
                                </Box>
                                {<Text.Eyebrow>{East.str`CURRENT · ${currentIndex.add(1n)} OF 4`}</Text.Eyebrow>}
                            </VStack>
                        );
                    }}</Reactive>
            </VStack>
        );
    }),
    inputs: [],
});
