/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, NullType, StringType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Deck, HStack, Reactive, Tag, Text, VStack } from "@elaraai/east-ui";

const LINES = [
    { id: "a-201", name: "Line A", state: "RUNNING", team: "Alpha", load: 0.62, skills: ["pack", "mix"] },
    { id: "b-114", name: "Line B", state: "DOWN", team: "Beta", load: 0.0, skills: ["mix"] },
    { id: "c-330", name: "Line C", state: "RUNNING", team: "Alpha", load: 0.81, skills: ["pack", "fill", "mix"] },
    { id: "d-407", name: "Line D", state: "IDLE", team: "Beta", load: 0.12, skills: ["fill"] },
];

export const deckBasic = example({
    keywords: ["Deck", "card", "cards", "collection", "grid", "status", "meter"],
    description: "Rows rendered as a wrapping grid of structured cards — title, status pill, load meter",
    fn: East.function([], UIComponentType, (_$) => (
        <Deck
            data={LINES}
            card={r => ({
                key: r.id,
                title: r.name,
                sublabel: r.team,
                icon: "industry",
                status: Deck.status(r.state, "info"),
                facts: [Deck.meter("Load", r.load.multiply(100.0), 100.0, East.str`${East.print(r.load.multiply(100.0))}%`)],
            })}
        />
    )),
    inputs: [],
});

export const deckGroupBy = example({
    keywords: ["Deck", "groupBy", "group", "toolbar", "summary", "chips"],
    description: "Named GROUP BY options (Status / Team / None) with group-head summaries — filtering flows through the slice interface, not a bespoke search",
    fn: East.function([], UIComponentType, (_$) => (
        <Deck
            data={LINES}
            card={r => ({
                key: r.id,
                title: r.name,
                sublabel: r.team,
                status: Deck.status(r.state, "info"),
                facts: [Deck.chips("Skills", r.skills)],
            })}
            groupBy={[
                { key: "state", label: "Status", value: r => r.state, summary: rows => East.str`${East.print(rows.size())} lines` },
                { key: "team", label: "Team", value: r => r.team },
            ]}
        />
    )),
    inputs: [],
});

export const deckListLayout = example({
    keywords: ["Deck", "layout", "list", "rows", "text"],
    description: "The list layout — full-width card rows instead of the wrapping grid",
    fn: East.function([], UIComponentType, (_$) => (
        <Deck
            data={LINES}
            card={r => ({
                key: r.id,
                title: r.name,
                sublabel: r.team,
                facts: [Deck.text("State", r.state)],
            })}
            layout="list"
        />
    )),
    inputs: [],
});

export const deckCustomFace = example({
    keywords: ["Deck", "render", "custom", "face", "compose"],
    description: "A fully custom card body via `render` — any UI composition beneath the structured face",
    fn: East.function([], UIComponentType, (_$) => (
        <Deck
            data={LINES}
            card={r => ({ key: r.id, title: r.name })}
            render={r => (
                <VStack gap="1" align="stretch">
                    <HStack gap="2">
                        <Tag>{r.team}</Tag>
                        <Tag>{r.state}</Tag>
                    </HStack>
                    <Text color="gray.500">{East.str`load ${East.print(r.load)}`}</Text>
                </VStack>
            )}
        />
    )),
    inputs: [],
});

export const deckDetail = example({
    keywords: ["Deck", "view", "detail", "open", "panel", "tone", "color", "hover", "peek", "onOpen", "onClose"],
    description: "The card VIEW state — tone-accented cards open a composed detail panel via `view` (prev/next traversal, Esc closes), with a hover peek and onOpen/onClose events",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const logBind = $.let(State.bind([StringType], "deck_view_log", "closed"));
            const log = $.let(logBind.read());
            const onOpen = $.const(East.function([StringType], NullType, ($, key) => {
                $(logBind.write(East.str`viewing ${key}`));
            }));
            const onClose = $.const(East.function([], NullType, ($) => {
                $(logBind.write("closed"));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Deck
                        data={LINES}
                        card={r => ({
                            key: r.id,
                            title: r.name,
                            sublabel: r.team,
                            tone: r.state.equals("DOWN").ifElse(
                                () => East.value(variant("danger", null), Deck.Types.Tone),
                                () => r.state.equals("RUNNING").ifElse(
                                    () => East.value(variant("success", null), Deck.Types.Tone),
                                    () => East.value(variant("neutral", null), Deck.Types.Tone),
                                ),
                            ),
                            status: Deck.status(r.state, "info"),
                        })}
                        view={r => (
                            <VStack gap="2" align="stretch">
                                <Text fontWeight="bold">{East.str`${r.name} — ${r.state}`}</Text>
                                <Text color="gray.500">{East.str`Team ${r.team} · load ${East.print(r.load.multiply(100.0))}%`}</Text>
                                <HStack gap="2">
                                    <Tag>{r.team}</Tag>
                                    <Tag>{r.state}</Tag>
                                </HStack>
                            </VStack>
                        )}
                        hover={r => (
                            <Text color="gray.500">{East.str`${r.name} · load ${East.print(r.load.multiply(100.0))}%`}</Text>
                        )}
                        onOpen={onOpen}
                        onClose={onClose}
                    />
                    <Text color="gray.500">{log}</Text>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const deckClickable = example({
    keywords: ["Deck", "onCardClick", "click", "tap", "Reactive", "State"],
    description: "Cards as tap targets — onCardClick writes the selected key to bound state",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const selectedBind = $.let(State.bind([StringType], "deck_selected", "none yet"));
            const selected = $.let(selectedBind.read());
            const onCardClick = $.const(East.function([StringType], NullType, ($, key) => {
                $(selectedBind.write(key));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Deck
                        data={LINES}
                        card={r => ({ key: r.id, title: r.name, sublabel: r.team })}
                        onCardClick={onCardClick}
                    />
                    <Text color="gray.500">{East.str`selected: ${selected}`}</Text>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
