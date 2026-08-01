/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, East, FloatType, IntegerType, NullType, StringType, StructType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Badge, Box, Button, Card, Chart, HStack, MetricChip, Reactive, Story, Text, VStack } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

const STORY_RAIL_RIGHT_DATA = [
    { week: "wk 1", actual: 820n, forecast: 825n }, { week: "wk 2", actual: 860n, forecast: 862n },
    { week: "wk 3", actual: 880n, forecast: 886n }, { week: "wk 4", actual: 930n, forecast: 898n },
    { week: "wk 5", actual: 1060n, forecast: 922n }, { week: "wk 6", actual: 1115n, forecast: 946n },
];
const STORY_STEP_LENGTHS_DATA = [
    { week: "wk 1", actual: 820n }, { week: "wk 2", actual: 860n },
    { week: "wk 3", actual: 880n }, { week: "wk 4", actual: 930n },
    { week: "wk 5", actual: 1060n }, { week: "wk 6", actual: 1115n },
];
const STORY_CARD_KEYFRAME_DATA = [
    { region: "NA", half: "wk 1–4", orders: 846n }, { region: "NA", half: "wk 5–8", orders: 1110n },
    { region: "EU", half: "wk 1–4", orders: 612n }, { region: "EU", half: "wk 5–8", orders: 668n },
];
const STORY_ACTIVE_STEP_STATIC_DATA = [
    { week: "wk 1", actual: 820n, forecast: 825n }, { week: "wk 2", actual: 860n, forecast: 862n },
    { week: "wk 3", actual: 880n, forecast: 886n }, { week: "wk 4", actual: 930n, forecast: 898n },
    { week: "wk 5", actual: 1060n, forecast: 922n }, { week: "wk 6", actual: 1115n, forecast: 946n },
];

export const storyBasic = example({
    keywords: ["Story", "Step", "stage", "Chart", "narrative", "scrollytelling"],
    description: "The spec's Q4 review: one evolving chart driven by four prose beats (rail-left)",
    fn: East.function([], UIComponentType, ($) => {
        const orders = $.const([
            { week: "wk 1", actual: 820n, forecast: 825n }, { week: "wk 2", actual: 860n, forecast: 862n },
            { week: "wk 3", actual: 880n, forecast: 886n }, { week: "wk 4", actual: 930n, forecast: 898n },
            { week: "wk 5", actual: 1060n, forecast: 922n }, { week: "wk 6", actual: 1115n, forecast: 946n },
            { week: "wk 7", actual: 1150n, forecast: 970n }, { week: "wk 8", actual: 1185n, forecast: 994n },
        ], ArrayType(StructType({ week: StringType, actual: IntegerType, forecast: IntegerType })));
        const uplift = $.const([
            { region: "NA", half: "wk 1–4", orders: 846n }, { region: "NA", half: "wk 5–8", orders: 1110n },
            { region: "EU", half: "wk 1–4", orders: 612n }, { region: "EU", half: "wk 5–8", orders: 668n },
            { region: "APAC", half: "wk 1–4", orders: 418n }, { region: "APAC", half: "wk 5–8", orders: 426n },
        ], ArrayType(StructType({ region: StringType, half: StringType, orders: IntegerType })));
        return (
            <Story title="Q4 demand review" stageHeight={340} height={440}>
                <Story.Step id="demand" eyebrow="Demand" title="Demand ran hot"
                            stage={<Box height="100%" width="100%">
                                <Chart height="fill" layers={Chart.Line(orders, { x: r => r.week, y: r => r.actual }, { key: "actual", color: "teal.solid" })} grid />
                            </Box>}>
                    <Text>Orders climbed steadily from week 4 and never gave the gain back — the exit rate is 34% above the start of the quarter.</Text>
                    <MetricChip tone="positive"><Text>▲ +34% vs start of Q4</Text></MetricChip>
                </Story.Step>
                <Story.Step id="forecast" eyebrow="Forecast" title="The plan missed the turn"
                            stage={<Box height="100%" width="100%">
                                <Chart height="fill" layers={[
                                    Chart.Line(orders, { x: r => r.week, y: r => r.actual }, { key: "actual", color: "teal.solid" }),
                                    Chart.Line(orders, { x: r => r.week, y: r => r.forecast }, { key: "forecast", color: "gray.solid", dash: "4 3" }),
                                ]} grid legend />
                            </Box>}>
                    <Text>The committed forecast (dashed) tracked well until week 4, then kept its old slope. By week 8 the gap is 18% — that gap is the whole story.</Text>
                    <MetricChip tone="negative"><Text>▼ forecast −18% at wk 8</Text></MetricChip>
                </Story.Step>
                <Story.Step id="promo" eyebrow="Cause" title="One event explains the spike"
                            stage={<Box height="100%" width="100%">
                                <Chart height="fill" layers={[
                                    Chart.Line(orders, { x: r => r.week, y: r => r.actual }, { key: "actual", color: "teal.solid" }),
                                    Chart.refDot({ x: "wk 4", y: 930, label: "promo live" }),
                                ]} grid />
                            </Box>}>
                    <Text>The week-4 inflection lands on the retail promo going live. Demand stepped up and stayed up — a level shift, not a transient.</Text>
                    <Badge colorPalette="teal">promo live · Nov 14</Badge>
                </Story.Step>
                <Story.Step id="regions" eyebrow="Where" title="The gap wasn't uniform"
                            stage={<Box height="100%" width="100%">
                                <Chart height="fill" layers={Chart.Column(uplift, { x: r => r.region, y: r => r.orders, by: r => r.half })} grid legend />
                            </Box>}>
                    <Text>NA absorbed nearly all of the uplift; EU moved modestly; APAC ran flat. Re-forecast NA only — touching the others adds noise, not signal.</Text>
                    <HStack gap="2">
                        <MetricChip tone="positive"><Text>▲ NA +29%</Text></MetricChip>
                        <MetricChip tone="neutral"><Text>≈ APAC +2%</Text></MetricChip>
                    </HStack>
                </Story.Step>
            </Story>
        );
    }),
    inputs: [],
});

export const storyStacked = example({
    keywords: ["Story", "layout", "stacked", "responsive", "narrow"],
    description: "Stacked layout: stage on top, prose beneath (the forced sub-720px shape)",
    fn: East.function([], UIComponentType, ($) => {
        const uplift = $.const([
            { region: "NA", half: "wk 1–4", orders: 846n }, { region: "NA", half: "wk 5–8", orders: 1110n },
            { region: "EU", half: "wk 1–4", orders: 612n }, { region: "EU", half: "wk 5–8", orders: 668n },
            { region: "APAC", half: "wk 1–4", orders: 418n }, { region: "APAC", half: "wk 5–8", orders: 426n },
        ], ArrayType(StructType({ region: StringType, half: StringType, orders: IntegerType })));
        return (
            <Story layout="stacked" title="Q4 demand review" stageHeight={200} height={440}>
                <Story.Step id="regions" eyebrow="Where" title="The gap wasn't uniform"
                            stage={<Box height="100%" width="100%">
                                <Chart height="fill" layers={Chart.Column(uplift, { x: r => r.region, y: r => r.orders, by: r => r.half })} grid legend />
                            </Box>}>
                    <Text>NA absorbed nearly all of the uplift; EU moved modestly; APAC ran flat.</Text>
                </Story.Step>
                <Story.Step id="action" eyebrow="Action" title="Re-forecast NA only">
                    <Text>Touching the other regions adds noise, not signal.</Text>
                    <MetricChip tone="positive"><Text>▲ NA +29%</Text></MetricChip>
                </Story.Step>
            </Story>
        );
    }),
    inputs: [],
});

export const storyReactive = example({
    keywords: ["Story", "Reactive", "State", "bind", "active", "progress", "onStepEnter", "interactive"],
    description: "Bound narrative position: external surfaces read and drive the active step",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const active = $.let(State.bind([IntegerType], "q4-review.step", 0n));
            const scrub = $.let(State.bind([FloatType], "q4-review.progress", 0.0));
            const next = $.const(East.function([], NullType, $ => {
                $(active.write(active.read().add(1n)));
            }));
            const entered = $.let(State.bind([StringType], "q4-review.lastEntered", ""));
            const onStepEnter = $.const(East.function([StringType], NullType, ($, id) => {
                $(entered.write(id));
            }));
            const orders = $.const([
                { week: "wk 1", actual: 820n, forecast: 825n }, { week: "wk 2", actual: 860n, forecast: 862n },
                { week: "wk 3", actual: 880n, forecast: 886n }, { week: "wk 4", actual: 930n, forecast: 898n },
                { week: "wk 5", actual: 1060n, forecast: 922n }, { week: "wk 6", actual: 1115n, forecast: 946n },
            ], ArrayType(StructType({ week: StringType, actual: IntegerType, forecast: IntegerType })));
            return (
                <VStack gap="6">
                    <Story active={active} progress={scrub} title="Q4 demand review" height={440}
                           onStepEnter={onStepEnter}>
                        <Story.Step id="demand" eyebrow="Demand" title="Demand ran hot"
                                    stage={<Box height="100%" width="100%">
                                        <Chart height="fill" layers={Chart.Line(orders, { x: r => r.week, y: r => r.actual }, { color: "teal.solid" })} grid />
                                    </Box>}>
                            <Text>Orders climbed steadily.</Text>
                        </Story.Step>
                        <Story.Step id="forecast" eyebrow="Forecast" title="The plan missed the turn"
                                    stage={<Box height="100%" width="100%">
                                        <Chart height="fill" layers={[
                                            Chart.Line(orders, { x: r => r.week, y: r => r.actual }, { key: "actual", color: "teal.solid" }),
                                            Chart.Line(orders, { x: r => r.week, y: r => r.forecast }, { key: "forecast", color: "gray.solid", dash: "4 3" }),
                                        ]} grid legend />
                                    </Box>}>
                            <Text>The forecast missed the turn.</Text>
                        </Story.Step>
                    </Story>
                    <HStack gap="3">
                        <Text>{East.str`Reviewing beat ${active.read().add(1n)} of 2`}</Text>
                        <Button onClick={next}>Skip ahead →</Button>
                    </HStack>
                    <Story.Progress count={2} active={active} title="Q4 demand review" />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Chrome variants — static enumeration panel (consolidation epic #455).
// ============================================================================

export const storyChromeVariants = example({
    keywords: ["Story", "layout", "rail-right", "mirror", "Chart", "Step", "eyebrow", "title", "body", "beat", "Progress", "chrome", "dots", "counter", "standalone", "stepLength", "compact", "runway", "pacing"],
    description: "Story chrome variant panel — rail right (mirrored layout: stage left, prose right), step basic (one narrative beat: id, eyebrow, title, and a rail body), progress standalone (title, dots, counter, prev/next), step lengths (compact step runway: less scroll per beat for short, punchy stories)",
    fn: East.function([], UIComponentType, ($) => {
        const railRightOrders = $.const(STORY_RAIL_RIGHT_DATA, ArrayType(StructType({ week: StringType, actual: IntegerType, forecast: IntegerType })));
        const stepLengthsOrders = $.const(STORY_STEP_LENGTHS_DATA, ArrayType(StructType({ week: StringType, actual: IntegerType })));
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">RAIL RIGHT</Text>
                    <Story layout="rail-right" title="Q4 demand review" stageHeight={340} height={440}>
                        <Story.Step id="demand" eyebrow="Demand" title="Demand ran hot"
                                    stage={<Box height="100%" width="100%">
                                        <Chart height="fill" layers={Chart.Line(railRightOrders, { x: r => r.week, y: r => r.actual }, { key: "actual", color: "teal.solid" })} grid />
                                    </Box>}>
                            <Text>Orders climbed steadily from week 4 and never gave the gain back.</Text>
                        </Story.Step>
                        <Story.Step id="forecast" eyebrow="Forecast" title="The plan missed the turn"
                                    stage={<Box height="100%" width="100%">
                                        <Chart height="fill" layers={[
                                            Chart.Line(railRightOrders, { x: r => r.week, y: r => r.actual }, { key: "actual", color: "teal.solid" }),
                                            Chart.Line(railRightOrders, { x: r => r.week, y: r => r.forecast }, { key: "forecast", color: "gray.solid", dash: "4 3" }),
                                        ]} grid legend />
                                    </Box>}>
                            <Text>The committed forecast (dashed) kept its old slope after the week-4 turn.</Text>
                        </Story.Step>
                    </Story>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">STEP BASIC</Text>
                    <Story.Step id="demand" eyebrow="Demand" title="Demand ran hot">
                        <Text>Orders climbed from week 4 and never gave the gain back.</Text>
                    </Story.Step>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">PROGRESS STANDALONE</Text>
                    <Story.Progress count={4} title="Q4 demand review" />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">STEP LENGTHS</Text>
                    <Story stepLength="compact" stageHeight={320} height={440}>
                        <Story.Step id="one" eyebrow="01" title="Quick beat"
                                    stage={<Box height="100%" width="100%">
                                        <Chart height="fill" layers={Chart.Line(stepLengthsOrders, { x: r => r.week, y: r => r.actual }, { color: "teal.solid" })} grid />
                                    </Box>}>
                            <Text>compact = 36vh of runway per step; default = 52vh; long = 72vh.</Text>
                        </Story.Step>
                        <Story.Step id="two" eyebrow="02" title="Another quick beat">
                            <Text>Step length sets pacing — the runway the reader scrolls through per keyframe.</Text>
                        </Story.Step>
                    </Story>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Authoring — static enumeration panel (consolidation epic #455).
// ============================================================================

export const storyAuthoring = example({
    keywords: ["Story", "stage", "Card", "framing", "Button", "CTA", "activeStep", "static", "snapshot", "deterministic", "Step", "conditional", "ifElse", "runtime children"],
    description: "Story authoring panel — card keyframe (keyframes own their framing by composing Card; a final step carries the call to action), active step static (activeStep forces one deterministic keyframe), conditional step (steps are values — a conditional step via ifElse is legal)",
    fn: East.function([], UIComponentType, ($) => {
        const uplift = $.const(STORY_CARD_KEYFRAME_DATA, ArrayType(StructType({ region: StringType, half: StringType, orders: IntegerType })));
        const orders = $.const(STORY_ACTIVE_STEP_STATIC_DATA, ArrayType(StructType({ week: StringType, actual: IntegerType, forecast: IntegerType })));
        const openRun = $.const(East.function([], NullType, _$ => {
            // Route to the Observe surface with the slice pre-bound.
        }));
        const detailed = $.let(true);
        const detailStep = $.let(
            <Story.Step id="detail" title="Detail"><Text>The detailed beat.</Text></Story.Step>,
            UIComponentType,
        );
        const summaryStep = $.let(
            <Story.Step id="summary" title="Summary"><Text>The summary beat.</Text></Story.Step>,
            UIComponentType,
        );
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">CARD KEYFRAME</Text>
                    <Story stageHeight={380} height={440}>
                        <Story.Step id="finding" eyebrow="Finding" title="NA absorbed the uplift"
                                    stage={<Card header={{ title: "Uplift by region", description: "wk 1–4 vs wk 5–8" }}>
                                        <Box height="260px" width="100%">
                                            <Chart height="fill" layers={Chart.Column(uplift, { x: r => r.region, y: r => r.orders, by: r => r.half })} grid legend />
                                        </Box>
                                    </Card>}>
                            <Text>A keyframe that wants the Card treatment composes Card like anywhere else — the stage itself owns no chrome.</Text>
                        </Story.Step>
                        <Story.Step id="cta" eyebrow="Next" title="Re-forecast NA only">
                            <Text>Interactive bodies are allowed — the last step routinely carries the call to action.</Text>
                            <Button onClick={openRun}>Open the run →</Button>
                        </Story.Step>
                    </Story>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">ACTIVE STEP STATIC</Text>
                    <Story activeStep="forecast" stageHeight={320}>
                        <Story.Step id="demand" title="Demand ran hot"
                                    stage={<Box height="100%" width="100%">
                                        <Chart height="fill" layers={Chart.Line(orders, { x: r => r.week, y: r => r.actual }, { color: "teal.solid" })} grid />
                                    </Box>}>
                            <Text>Beat one.</Text>
                        </Story.Step>
                        <Story.Step id="forecast" title="The plan missed the turn"
                                    stage={<Box height="100%" width="100%">
                                        <Chart height="fill" layers={[
                                            Chart.Line(orders, { x: r => r.week, y: r => r.actual }, { key: "actual", color: "teal.solid" }),
                                            Chart.Line(orders, { x: r => r.week, y: r => r.forecast }, { key: "forecast", color: "gray.solid", dash: "4 3" }),
                                        ]} grid legend />
                                    </Box>}>
                            <Text>Beat two — rendered active without scroll; the snapshot pipeline renders one PNG per step.</Text>
                        </Story.Step>
                    </Story>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">CONDITIONAL STEP</Text>
                    <Story height={320}>
                        <Story.Step id="always" title="Always">
                            <Text>Always shown.</Text>
                        </Story.Step>
                        {detailed.ifElse(_$ => detailStep, _$ => summaryStep)}
                    </Story>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});
