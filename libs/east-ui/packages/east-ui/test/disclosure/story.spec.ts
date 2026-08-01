/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Story, Text } from "@elaraai/east-ui/internal";
import { type ExprType } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./story.examples.js";

describeEast("Story", (test) => {
    Assert.examples(test, {
        storyBasic: ex.storyBasic,
        storyStacked: ex.storyStacked,
        storyReactive: ex.storyReactive,
        storyChromeVariants: ex.storyChromeVariants,
        storyAuthoring: ex.storyAuthoring,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#463).
    // =========================================================================

    test("storyChromeVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.storyChromeVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 4n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "RAIL RIGHT"));
        $(Assert.equal(rows.get(1n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "STEP BASIC"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "PROGRESS STANDALONE"));
        $(Assert.equal(rows.get(3n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "STEP LENGTHS"));
    });

    test("storyAuthoring panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.storyAuthoring.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 3n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "CARD KEYFRAME"));
        $(Assert.equal(rows.get(1n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "ACTIVE STEP STATIC"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "CONDITIONAL STEP"));
    });

    // =========================================================================
    // Story.Step — beat construction
    // =========================================================================

    test("creates a step with id, eyebrow, title, and body", $ => {
        const step = $.let(Story.Step([
            Text.Root("Orders climbed steadily."),
        ], { id: "demand", eyebrow: "Demand", title: "Demand ran hot" }).unwrap().unwrap("StoryStep"));
        $(Assert.equal(step.id, "demand"));
        $(Assert.equal(step.eyebrow.unwrap("some"), "Demand"));
        $(Assert.equal(step.title.unwrap("some"), "Demand ran hot"));
        $(Assert.equal(step.stage.hasTag("none"), true));
        $(Assert.equal(step.body.size(), 1n));
    });

    test("a step without a stage holds none (previous keyframe semantics)", $ => {
        const step = $.let(Story.Step([Text.Root("Beat.")], { id: "b" }).unwrap().unwrap("StoryStep"));
        $(Assert.equal(step.stage.hasTag("none"), true));
        $(Assert.equal(step.eyebrow.hasTag("none"), true));
    });

    test("a step stage carries any UIComponent subtree", $ => {
        const step = $.let(Story.Step([Text.Root("Beat.")], {
            id: "kf",
            stage: Text.Root("keyframe"),
        }).unwrap().unwrap("StoryStep"));
        $(Assert.equal(step.stage.unwrap("some").unwrap().unwrap("Text").value, "keyframe"));
    });

    // =========================================================================
    // Story.Root — container construction
    // =========================================================================

    test("creates a story with steps, chrome title, and style presets", $ => {
        const story = $.let(Story.Root([
            Story.Step([Text.Root("One.")], { id: "one" }),
            Story.Step([Text.Root("Two.")], { id: "two" }),
        ], { title: "Q4 review", layout: "rail-right", stageHeight: 320, stepLength: "compact" })
            .unwrap().unwrap("Story"));
        $(Assert.equal(story.steps.size(), 2n));
        $(Assert.equal(story.title.unwrap("some"), "Q4 review"));
        const style = $.let(story.style.unwrap("some"));
        $(Assert.equal(style.layout.unwrap("some").hasTag("rail-right"), true));
        $(Assert.equal(style.stageHeight.unwrap("some"), "320px"));
        $(Assert.equal(style.stepLength.unwrap("some").hasTag("compact"), true));
    });

    test("defaults: no bindings, no chrome, no style", $ => {
        const story = $.let(Story.Root([
            Story.Step([Text.Root("One.")], { id: "one" }),
        ]).unwrap().unwrap("Story"));
        $(Assert.equal(story.active.hasTag("none"), true));
        $(Assert.equal(story.progress.hasTag("none"), true));
        $(Assert.equal(story.activeStep.hasTag("none"), true));
        $(Assert.equal(story.title.hasTag("none"), true));
        $(Assert.equal(story.style.hasTag("none"), true));
    });

    test("activeStep static override is carried", $ => {
        const story = $.let(Story.Root([
            Story.Step([Text.Root("One.")], { id: "one" }),
        ], { activeStep: "one" }).unwrap().unwrap("Story"));
        $(Assert.equal(story.activeStep.unwrap("some"), "one"));
    });

    // =========================================================================
    // Story.Progress — standalone chrome
    // =========================================================================

    test("creates standalone progress chrome", $ => {
        const chrome = $.let(Story.Progress({ count: 4, title: "Q4 review" })
            .unwrap().unwrap("StoryProgress"));
        $(Assert.equal(chrome.count, 4n));
        $(Assert.equal(chrome.title.unwrap("some"), "Q4 review"));
        $(Assert.equal(chrome.active.hasTag("none"), true));
    });
}, { platformFns: TestImpl });
