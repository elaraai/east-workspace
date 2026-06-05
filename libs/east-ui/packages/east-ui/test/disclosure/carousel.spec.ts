/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Carousel, Text } from "@elaraai/east-ui";
import * as ex from "./carousel.examples.js";

describeEast("Carousel", (test) => {
    Assert.examples(test, {
        carouselBasic: ex.carouselBasic,
        carouselLoop: ex.carouselLoop,
        carouselMultiSlide: ex.carouselMultiSlide,
        carouselNoControls: ex.carouselNoControls,
        carouselDraggable: ex.carouselDraggable,
        carouselMinimal: ex.carouselMinimal,
        carouselColourSlots: ex.carouselColourSlots,
        carouselInteractive: ex.carouselInteractive,
    });

    // =========================================================================
    // Basic Creation
    // =========================================================================

    test("creates carousel with single item", $ => {
        const carousel = $.let(Carousel.Root([Text.Root("Slide 1")]));
        $(Assert.equal(carousel.unwrap().unwrap("Carousel").items.size(), 1n));
    });

    test("creates carousel with multiple items", $ => {
        const carousel = $.let(Carousel.Root([
            Text.Root("Slide 1"),
            Text.Root("Slide 2"),
            Text.Root("Slide 3"),
        ]));
        $(Assert.equal(carousel.unwrap().unwrap("Carousel").items.size(), 3n));
    });

    test("creates carousel with no options — all options are none", $ => {
        const carousel = $.let(Carousel.Root([Text.Root("Slide 1")]));
        const c = carousel.unwrap().unwrap("Carousel");
        $(Assert.equal(c.index.hasTag("none"), true));
        $(Assert.equal(c.defaultIndex.hasTag("none"), true));
        $(Assert.equal(c.slidesPerView.hasTag("none"), true));
        $(Assert.equal(c.loop.hasTag("none"), true));
        $(Assert.equal(c.autoplay.hasTag("none"), true));
        $(Assert.equal(c.spacing.hasTag("none"), true));
        $(Assert.equal(c.onIndexChange.hasTag("none"), true));
        $(Assert.equal(c.style.hasTag("none"), true));
    });

    // =========================================================================
    // State on main — index / defaultIndex
    // =========================================================================

    test("creates carousel with controlled index", $ => {
        const carousel = $.let(Carousel.Root([
            Text.Root("Slide 1"),
            Text.Root("Slide 2"),
        ], { index: 1n }));
        $(Assert.equal(carousel.unwrap().unwrap("Carousel").index.unwrap("some"), 1n));
    });

    test("creates carousel with defaultIndex", $ => {
        const carousel = $.let(Carousel.Root([
            Text.Root("Slide 1"),
            Text.Root("Slide 2"),
        ], { defaultIndex: 0n }));
        $(Assert.equal(carousel.unwrap().unwrap("Carousel").defaultIndex.unwrap("some"), 0n));
    });

    // =========================================================================
    // Config on main — slidesPerView / slidesPerMove / loop / autoplay etc.
    // =========================================================================

    test("creates carousel with slidesPerView / slidesPerMove on main", $ => {
        const carousel = $.let(Carousel.Root([
            Text.Root("Slide 1"),
            Text.Root("Slide 2"),
            Text.Root("Slide 3"),
        ], { slidesPerView: 2n, slidesPerMove: 1n }));
        $(Assert.equal(carousel.unwrap().unwrap("Carousel").slidesPerView.unwrap("some"), 2n));
        $(Assert.equal(carousel.unwrap().unwrap("Carousel").slidesPerMove.unwrap("some"), 1n));
    });

    test("creates carousel with loop / autoplay / allowMouseDrag", $ => {
        const carousel = $.let(Carousel.Root([
            Text.Root("Slide 1"),
        ], { loop: true, autoplay: true, allowMouseDrag: true }));
        const c = carousel.unwrap().unwrap("Carousel");
        $(Assert.equal(c.loop.unwrap("some"), true));
        $(Assert.equal(c.autoplay.unwrap("some"), true));
        $(Assert.equal(c.allowMouseDrag.unwrap("some"), true));
    });

    test("creates carousel with showIndicators / showControls", $ => {
        const carousel = $.let(Carousel.Root([
            Text.Root("Slide 1"),
        ], { showIndicators: true, showControls: true }));
        const c = carousel.unwrap().unwrap("Carousel");
        $(Assert.equal(c.showIndicators.unwrap("some"), true));
        $(Assert.equal(c.showControls.unwrap("some"), true));
    });

    test("creates carousel with spacing on main (moved from style)", $ => {
        const carousel = $.let(Carousel.Root([
            Text.Root("Slide 1"),
        ], { spacing: "4" }));
        $(Assert.equal(carousel.unwrap().unwrap("Carousel").spacing.unwrap("some"), "4"));
    });

    test("creates carousel with padding inside style", $ => {
        const carousel = $.let(Carousel.Root([
            Text.Root("Slide 1"),
        ], { padding: "2" }));
        const sv = carousel.unwrap().unwrap("Carousel").style.unwrap("some");
        $(Assert.equal(sv.padding.unwrap("some"), "2"));
    });

    // =========================================================================
    // Visual (inside style)
    // =========================================================================

    test("creates carousel with horizontal orientation (inside style)", $ => {
        const carousel = $.let(Carousel.Root([
            Text.Root("Slide 1"),
        ], { orientation: "horizontal" }));
        $(Assert.equal(
            carousel.unwrap().unwrap("Carousel").style.unwrap("some").orientation.unwrap("some").hasTag("horizontal"),
            true,
        ));
    });

    test("creates carousel with vertical orientation", $ => {
        const carousel = $.let(Carousel.Root([
            Text.Root("Slide 1"),
        ], { orientation: "vertical" }));
        $(Assert.equal(
            carousel.unwrap().unwrap("Carousel").style.unwrap("some").orientation.unwrap("some").hasTag("vertical"),
            true,
        ));
    });

    test("creates carousel with full colour escape hatches", $ => {
        const carousel = $.let(Carousel.Root([
            Text.Root("Slide 1"),
        ], {
            indicatorColor: "#cbd5e1",
            activeIndicatorColor: "#3d5cff",
            controlColor: "#ffffff",
            controlBackground: "#1a2234",
        }));
        const s = carousel.unwrap().unwrap("Carousel").style.unwrap("some");
        $(Assert.equal(s.indicatorColor.unwrap("some"), "#cbd5e1"));
        $(Assert.equal(s.activeIndicatorColor.unwrap("some"), "#3d5cff"));
        $(Assert.equal(s.controlColor.unwrap("some"), "#ffffff"));
        $(Assert.equal(s.controlBackground.unwrap("some"), "#1a2234"));
    });

    // =========================================================================
    // Combined — kitchen sink
    // =========================================================================

    test("creates carousel with all main + style options", $ => {
        const carousel = $.let(Carousel.Root([
            Text.Root("Slide 1"),
            Text.Root("Slide 2"),
            Text.Root("Slide 3"),
        ], {
            defaultIndex: 0n,
            slidesPerView: 2n,
            slidesPerMove: 1n,
            loop: true,
            autoplay: false,
            allowMouseDrag: true,
            showIndicators: true,
            showControls: true,
            spacing: "4",
            orientation: "horizontal", padding: "2",
        }));
        const c = carousel.unwrap().unwrap("Carousel");
        const sv = c.style.unwrap("some");
        $(Assert.equal(c.items.size(), 3n));
        $(Assert.equal(c.defaultIndex.unwrap("some"), 0n));
        $(Assert.equal(c.slidesPerView.unwrap("some"), 2n));
        $(Assert.equal(c.slidesPerMove.unwrap("some"), 1n));
        $(Assert.equal(c.loop.unwrap("some"), true));
        $(Assert.equal(c.autoplay.unwrap("some"), false));
        $(Assert.equal(c.allowMouseDrag.unwrap("some"), true));
        $(Assert.equal(c.showIndicators.unwrap("some"), true));
        $(Assert.equal(c.showControls.unwrap("some"), true));
        $(Assert.equal(c.spacing.unwrap("some"), "4"));
        $(Assert.equal(sv.padding.unwrap("some"), "2"));
        $(Assert.equal(sv.orientation.unwrap("some").hasTag("horizontal"), true));
    });

    test("creates image carousel with indicators and controls", $ => {
        const carousel = $.let(Carousel.Root([
            Text.Root("Image 1"),
            Text.Root("Image 2"),
        ], { loop: true, showIndicators: true, showControls: true }));
        const c = carousel.unwrap().unwrap("Carousel");
        $(Assert.equal(c.loop.unwrap("some"), true));
        $(Assert.equal(c.showIndicators.unwrap("some"), true));
        $(Assert.equal(c.showControls.unwrap("some"), true));
    });

    test("creates multi-slide carousel", $ => {
        const carousel = $.let(Carousel.Root([
            Text.Root("Product 1"),
            Text.Root("Product 2"),
            Text.Root("Product 3"),
            Text.Root("Product 4"),
        ], { slidesPerView: 3n, slidesPerMove: 1n, spacing: "4" }));
        $(Assert.equal(carousel.unwrap().unwrap("Carousel").slidesPerView.unwrap("some"), 3n));
        $(Assert.equal(carousel.unwrap().unwrap("Carousel").slidesPerMove.unwrap("some"), 1n));
        $(Assert.equal(carousel.unwrap().unwrap("Carousel").spacing.unwrap("some"), "4"));
    });

    test("creates autoplay carousel", $ => {
        const carousel = $.let(Carousel.Root([
            Text.Root("Banner 1"),
            Text.Root("Banner 2"),
        ], { autoplay: true, loop: true, allowMouseDrag: true }));
        const c = carousel.unwrap().unwrap("Carousel");
        $(Assert.equal(c.autoplay.unwrap("some"), true));
        $(Assert.equal(c.loop.unwrap("some"), true));
        $(Assert.equal(c.allowMouseDrag.unwrap("some"), true));
    });

    test("creates vertical carousel", $ => {
        const carousel = $.let(Carousel.Root([
            Text.Root("Testimonial 1"),
            Text.Root("Testimonial 2"),
        ], { slidesPerView: 1n, orientation: "vertical" }));
        $(Assert.equal(
            carousel.unwrap().unwrap("Carousel").style.unwrap("some").orientation.unwrap("some").hasTag("vertical"),
            true,
        ));
        $(Assert.equal(carousel.unwrap().unwrap("Carousel").slidesPerView.unwrap("some"), 1n));
    });
}, { platformFns: TestImpl });
