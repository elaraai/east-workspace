/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Disclosure JSX tags for {@link StoryFactory | Story} — a scroll-driven
 * narrative where prose steps in a rail drive one persistent sticky stage
 * through keyframes. Use it for the rendered conclusion of an analysis (a
 * postmortem, a model-run explanation, a quarterly review) where the
 * *sequence* of readings carries the argument; random-access beats are
 * {@link Tabs}, equal-weight siblings with no shared visual are a Carousel.
 */

import { Story as StoryFactory } from "../../disclosure/story/index.js";
import { container, optionsTag, type ContainerProps, type OptionsProps, type JsxTag } from "../combinators.js";

/** Step/Progress tags + types surfaced on the `<Story>` tag. */
type StoryBuilders = {
    Step: JsxTag<ContainerProps<typeof StoryFactory.Step>>;
    Progress: JsxTag<OptionsProps<typeof StoryFactory.Progress>>;
    Layout: typeof StoryFactory.Layout;
    Types: typeof StoryFactory.Types;
};

/**
 * Scroll-driven narrative — steps are the children, each carrying its
 * keyframe on the `stage` prop; the reader's scrollbar is the timeline.
 * Bind the position with `active` (a plain `State.bind([IntegerType], …)`
 * struct) only when something outside the story must read or drive it;
 * omit it and Story manages position internally. `title` opts into the
 * sticky one-row progress chrome; `layout`, `stageHeight`, and
 * `stepLength` shape the rail/stage geometry. Remaining options follow
 * `StoryOptions`.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Story, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const review = East.function([], UIComponentType, _$ => (
 *     <Story title="Q4 demand review" stageHeight={420} stepLength="default">
 *         <Story.Step id="demand" eyebrow="Demand" title="Demand ran hot"
 *                     stage={<Text>keyframe 1</Text>}>
 *             <Text>Orders climbed from week 6 and never gave the gain back.</Text>
 *         </Story.Step>
 *         <Story.Step id="forecast" eyebrow="Forecast" title="The plan missed the turn"
 *                     stage={<Text>keyframe 2</Text>}>
 *             <Text>The committed forecast kept its old slope.</Text>
 *         </Story.Step>
 *     </Story>
 * ));
 * ```
 *
 * @remarks
 * Carries `Story.Step` and `Story.Progress` tags, the `Story.Layout`
 * helper, and `Story.Types` — one import gives the whole family. Desugars
 * to `Story.Root(steps, options)`; `<Story.Step>` desugars to
 * `Story.Step(body, { id, … })` and `<Story.Progress>` to
 * `Story.Progress(options)`.
 */
export const Story: JsxTag<ContainerProps<typeof StoryFactory.Root>> & StoryBuilders =
    Object.assign(container(StoryFactory.Root), {
        Step: container(StoryFactory.Step),
        Progress: optionsTag(StoryFactory.Progress),
        Layout: StoryFactory.Layout,
        Types: StoryFactory.Types,
    });
