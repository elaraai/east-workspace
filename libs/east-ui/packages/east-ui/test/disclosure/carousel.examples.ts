/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Box, Carousel, Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui";

export const carouselBasic = example({
    keywords: ["Carousel", "Root", "showControls", "showIndicators", "basic"],
    description: "Simple slideshow with controls",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Carousel.Root([
                Box.Root([Text.Root("Slide 1")], { padding: "8", background: "teal.100", borderRadius: "md" }),
                Box.Root([Text.Root("Slide 2")], { padding: "8", background: "blue.100", borderRadius: "md" }),
                Box.Root([Text.Root("Slide 3")], { padding: "8", background: "purple.100", borderRadius: "md" }),
            ], {
                showControls: true,
                showIndicators: true,
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const carouselLoop = example({
    keywords: ["Carousel", "Root", "loop", "infinite"],
    description: "Infinite scrolling carousel",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Carousel.Root([
                Box.Root([Text.Root("First")], { padding: "8", background: "green.100", borderRadius: "md" }),
                Box.Root([Text.Root("Second")], { padding: "8", background: "orange.100", borderRadius: "md" }),
                Box.Root([Text.Root("Third")], { padding: "8", background: "pink.100", borderRadius: "md" }),
                Box.Root([Text.Root("Fourth")], { padding: "8", background: "cyan.100", borderRadius: "md" }),
            ], {
                loop: true,
                showControls: true,
                showIndicators: true,
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const carouselMultiSlide = example({
    keywords: ["Carousel", "Root", "slidesPerView", "spacing", "multiple"],
    description: "Show multiple slides at once",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Carousel.Root([
                Box.Root([Text.Root("1")], { padding: "4", background: "red.100", borderRadius: "md" }),
                Box.Root([Text.Root("2")], { padding: "4", background: "orange.100", borderRadius: "md" }),
                Box.Root([Text.Root("3")], { padding: "4", background: "yellow.100", borderRadius: "md" }),
                Box.Root([Text.Root("4")], { padding: "4", background: "green.100", borderRadius: "md" }),
                Box.Root([Text.Root("5")], { padding: "4", background: "blue.100", borderRadius: "md" }),
            ], {
                slidesPerView: 3n,
                spacing: "4",
                showControls: true,
                showIndicators: true,
            }),
        ], { width: "100%", background: "gray.50", padding: "4", borderRadius: "md" });
    }),
    inputs: [],
});

export const carouselNoControls = example({
    keywords: ["Carousel", "Root", "showControls", "showIndicators"],
    description: "Hide navigation controls",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Carousel.Root([
                Box.Root([Text.Root("Panel A")], { padding: "8", background: "gray.100", borderRadius: "md" }),
                Box.Root([Text.Root("Panel B")], { padding: "8", background: "gray.200", borderRadius: "md" }),
                Box.Root([Text.Root("Panel C")], { padding: "8", background: "gray.300", borderRadius: "md" }),
            ], {
                showControls: false,
                showIndicators: true,
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const carouselDraggable = example({
    keywords: ["Carousel", "Root", "allowMouseDrag", "drag", "swipe"],
    description: "Drag to navigate slides",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Carousel.Root([
                Box.Root([Text.Root("Drag me!")], { padding: "8", background: "teal.200", borderRadius: "md" }),
                Box.Root([Text.Root("Swipe left")], { padding: "8", background: "teal.300", borderRadius: "md" }),
                Box.Root([Text.Root("Or right")], { padding: "8", background: "teal.400", borderRadius: "md" }),
            ], {
                allowMouseDrag: true,
                showControls: true,
                showIndicators: true,
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const carouselMinimal = example({
    keywords: ["Carousel", "Root", "minimal", "showControls"],
    description: "Controls only, no indicators",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Carousel.Root([
                Box.Root([Text.Root("Image 1")], { padding: "8", background: "purple.100", borderRadius: "md" }),
                Box.Root([Text.Root("Image 2")], { padding: "8", background: "purple.200", borderRadius: "md" }),
                Box.Root([Text.Root("Image 3")], { padding: "8", background: "purple.300", borderRadius: "md" }),
            ], {
                showControls: true,
                showIndicators: false,
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const carouselColourSlots = example({
    keywords: ["Carousel", "Root", "style", "colour", "indicatorColor", "controlColor", "branded"],
    description: "Carousel with branded indicator + control colour escape hatches",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Carousel.Root([
                Box.Root([Text.Root("Branded 1")], { padding: "8", background: "blue.100", borderRadius: "md" }),
                Box.Root([Text.Root("Branded 2")], { padding: "8", background: "blue.200", borderRadius: "md" }),
                Box.Root([Text.Root("Branded 3")], { padding: "8", background: "blue.300", borderRadius: "md" }),
            ], {
                showControls: true,
                showIndicators: true,
                spacing: "3",
                style: {
                    indicatorColor: "#cbd5e1",
                    activeIndicatorColor: "#3d5cff",
                    controlColor: "#ffffff",
                    controlBackground: "#1a2234",
                },
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const carouselInteractive = example({
    keywords: ["Carousel", "Root", "Reactive", "State", "onIndexChange", "interactive"],
    description: "Navigate to see onIndexChange callback",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const indexBind = $.let(State.bind([IntegerType], "carousel_index", 0n));
            const currentIndex = $.let(indexBind.read());

            const onIndexChange = $.const(East.function(
                [IntegerType],
                NullType,
                ($, newIndex) => {
                    $(indexBind.write(newIndex));
                }
            ));

            return Stack.VStack([
                Box.Root([
                    Carousel.Root([
                        Box.Root([Text.Root("Welcome!")], { padding: "8", background: "blue.100", borderRadius: "md" }),
                        Box.Root([Text.Root("Features")], { padding: "8", background: "green.100", borderRadius: "md" }),
                        Box.Root([Text.Root("Pricing")], { padding: "8", background: "purple.100", borderRadius: "md" }),
                        Box.Root([Text.Root("Contact")], { padding: "8", background: "orange.100", borderRadius: "md" }),
                    ], {
                        showControls: true,
                        showIndicators: true,
                        onIndexChange,
                    }),
                ], { width: "100%" }),
                Text.Presets.Eyebrow(East.str`CURRENT · ${currentIndex.add(1n)} OF 4`),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
