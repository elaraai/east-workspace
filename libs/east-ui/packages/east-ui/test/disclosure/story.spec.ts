/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Story, Text } from "@elaraai/east-ui/internal";
import * as ex from "./story.examples.js";

describeEast("Story", (test) => {
    Assert.examples(test, {
        storyBasic: ex.storyBasic,
        storyStepBasic: ex.storyStepBasic,
        storyProgressStandalone: ex.storyProgressStandalone,
        storyRailRight: ex.storyRailRight,
        storyStacked: ex.storyStacked,
        storyStepLengths: ex.storyStepLengths,
        storyCardKeyframe: ex.storyCardKeyframe,
        storyActiveStepStatic: ex.storyActiveStepStatic,
        storyConditionalStep: ex.storyConditionalStep,
        storyReactive: ex.storyReactive,
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
