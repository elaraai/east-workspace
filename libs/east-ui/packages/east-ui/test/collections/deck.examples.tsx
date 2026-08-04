/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, East, FloatType, IntegerType, NullType, StringType, StructType, example, none, variant } from "@elaraai/east";
import { Slice, State, UIComponentType } from "@elaraai/east-ui";
import { Chart, Configurator, Deck, HStack, Reactive, SegmentGroup, Switch, Tag, Text, VStack } from "@elaraai/east-ui";

/** The board's status registry — one definition per state drives the
 *  solid tag (+ dot / pulse), the faint face wash, the fill colour,
 *  group-head swatches and the legend. Colours are standard tokens or
 *  custom CSS colours. */
const LINE_STATUSES = Deck.statuses({
    running:     { label: "Running",     color: "success",  pulse: true, hint: "producing" },
    standby:     { label: "Standby",     color: "link",               hint: "idle, ready" },
    maintenance: { label: "Maintenance", color: "warning",               hint: "planned work" },
    fault:       { label: "Fault",       color: "danger",   pulse: true, hint: "needs attention" },
    offline:     { label: "Offline",     color: "neutral",               hint: "powered down" },
});

const LINES = [
    { id: "a-201", name: "Line A", state: "running", team: "Alpha", load: 0.62, temp: 44.1, rate: 118.0 },
    { id: "b-114", name: "Line B", state: "fault", team: "Beta", load: 0.82, temp: 71.6, rate: 0.0 },
    { id: "c-330", name: "Line C", state: "running", team: "Alpha", load: 0.81, temp: 47.9, rate: 126.0 },
    { id: "d-407", name: "Line D", state: "standby", team: "Beta", load: 0.12, temp: 22.3, rate: 0.0 },
    { id: "e-118", name: "Line E", state: "maintenance", team: "Gamma", load: 0.0, temp: 21.0, rate: 0.0 },
    { id: "f-092", name: "Line F", state: "offline", team: "Gamma", load: 0.0, temp: 19.4, rate: 0.0 },
];

export const deckBasic = example({
    keywords: ["Deck", "card", "cards", "collection", "grid", "status", "statuses", "metric", "fill"],
    description: "Rows as a wrapping grid of mini cards — each carries an explicit status colour (solid tag + face wash + fill bar) from the deck's status registry, plus a raw-value metric strip",
    fn: East.function([], UIComponentType, (_$) => (
        <Deck
            data={LINES}
            statuses={LINE_STATUSES}
            card={r => ({
                key: r.id,
                title: r.name,
                sublabel: r.team,
                status: r.state,
                metrics: [
                    Deck.metric("Temp", r.temp, { format: v => East.str`${East.print(v)}°`, warn: r.state.equals("fault") }),
                    Deck.metric("Rate", r.rate, { format: Chart.format.compact() }),
                ],
                fill: { value: r.load.multiply(100.0), max: 100.0, format: v => East.str`${East.print(v)}%` },
            })}
        />
    )),
    inputs: [],
});

const SliceLineType = StructType({
    id: StringType,
    name: StringType,
    state: StringType,
    team: StringType,
    load: FloatType,
});

export const deckSlice = example({
    keywords: ["Deck", "slice", "filter", "search", "rail", "chrome", "count", "footer", "Slice.rows"],
    description: "A sliced deck — filtering and search flow through the slice interface (rail cluster + derived-count footer), exactly like Table",
    fn: East.function([], UIComponentType, (_$) => {
        const cfg = Slice.config(SliceLineType, {
            fields: { name: { label: "Name" }, state: { label: "State" }, team: { label: "Team" } },
            searchFieldIds: ["name", "state", "team"],
        });
        return (
            <Reactive>{$ => {
                const states = $.const(["running", "fault", "standby"], ArrayType(StringType));
                const teams = $.const(["Alpha", "Beta", "Gamma", "Delta"], ArrayType(StringType));
                const lines = $.const(East.Array.generate(48n, SliceLineType, East.function([IntegerType], SliceLineType, ($, i) => {
                    const row = $.let({
                        id: East.str`line-${i}`,
                        name: East.str`Line ${i}`,
                        state: states.get(i.remainder(3n)),
                        team: teams.get(i.remainder(4n)),
                        load: i.remainder(10n).toFloat().divide(10.0),
                    }, SliceLineType);
                    return row;
                })));
                const slice = $.let(Slice.bind([SliceLineType], "ex.deck.slice", cfg, Slice.state({}), lines, none));
                const narrowed = $.let(Slice.rows([SliceLineType], slice));
                return (
                    <Deck
                        data={narrowed}
                        statuses={LINE_STATUSES}
                        card={r => ({
                            key: r.id,
                            title: r.name,
                            sublabel: r.team,
                            status: r.state,
                            fill: { value: r.load.multiply(100.0), max: 100.0 },
                        })}
                        groupBy={[{ key: "team", label: "Team", value: r => r.team, summary: rows => East.str`${East.print(rows.size())} lines` }]}
                        slice={slice}
                        affordances={["filter", "search"]}
                        style={{ height: "420px" }}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

export const deckDetail = example({
    keywords: ["Deck", "onClick", "onHover", "popover", "detail", "Readout", "Rows", "Note", "footer", "legend", "onOpen", "onClose"],
    description: "The full board — status registry, metric strips, fill bars, a footer and legend, and onClick popovers composed from Deck.Readout / Deck.Rows / Deck.Note beneath the inherited card head",
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
                        statuses={LINE_STATUSES}
                        card={r => ({
                            key: r.id,
                            title: r.name,
                            sublabel: East.str`${r.id} · ${r.team}`,
                            status: r.state,
                            metrics: [
                                Deck.metric("Temp", r.temp, { format: v => East.str`${East.print(v)}°`, warn: r.state.equals("fault") }),
                                Deck.metric("Load", r.load.multiply(100.0), { format: v => East.str`${East.print(v)}%` }),
                            ],
                            fill: { value: r.load.multiply(100.0), max: 100.0, format: v => East.str`${East.print(v)}%` },
                        })}
                        onClick={r => (
                            <VStack gap="3" align="stretch">
                                {Deck.Readout([
                                    { label: "Temp", value: r.temp, format: v => East.str`${East.print(v)}`, unit: "°C", warn: r.state.equals("fault") },
                                    { label: "Load", value: r.load.multiply(100.0), unit: "%" },
                                    { label: "Rate", value: r.rate, format: Chart.format.compact() },
                                ])}
                                {Deck.Rows([
                                    { label: "Team", value: r.team },
                                    { label: "State", value: r.state },
                                    { label: "Line", value: r.id },
                                ])}
                                {Deck.Note(East.str`${r.name} · reviewed with the ${r.team} team`)}
                            </VStack>
                        )}
                        onHover={r => (
                            <Text color="fg.muted">{East.str`${r.name} · load ${East.print(r.load.multiply(100.0))}%`}</Text>
                        )}
                        onOpen={onOpen}
                        onClose={onClose}
                        footer={[
                            { label: "Lines", value: `${LINES.length}` },
                            { label: "Faulted", value: "1" },
                        ]}
                        legend
                    />
                    <Text color="fg.muted">{log}</Text>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const deckVariants = example({
    keywords: ["Deck", "groupBy", "group", "toolbar", "summary", "swatch", "layout", "list", "rows", "metric", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator", "onCardClick", "click", "tap", "Reactive", "State", "render", "custom", "face", "compose"],
    description: "Deck configurator — a layout axis plus grouped and custom-face switches driving one live deck of status cards; the aside reads the tapped card key",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // Enumerated axes are just their variants — `getTag()` gives the
            // segment key AND its label, so there is no parallel table to
            // keep in step.
            const layouts = $.const([
                variant("grid", null), variant("list", null),
            ], ArrayType(Deck.Types.Layout));

            const layoutBind = $.let(State.bind([StringType], "deck_layout", "grid"));
            const groupBind  = $.let(State.bind([BooleanType], "deck_group", false));
            const customBind = $.let(State.bind([BooleanType], "deck_custom", false));
            // The tap-target readout (folded from the old clickable example —
            // its State key is preserved): onCardClick writes the selected
            // key into the aside.
            const selectedBind = $.let(State.bind([StringType], "deck_selected", "none yet"));

            const lKey = $.let(layoutBind.read());
            const grouped = $.let(groupBind.read());
            const custom = $.let(customBind.read());
            const selected = $.let(selectedBind.read());

            const onLayout = $.const(East.function([StringType], NullType, ($, next) => { $(layoutBind.write(next)); }));
            const onGroup  = $.const(East.function([BooleanType], NullType, ($, next) => { $(groupBind.write(next)); }));
            const onCustom = $.const(East.function([BooleanType], NullType, ($, next) => { $(customBind.write(next)); }));
            const onCardClick = $.const(East.function([StringType], NullType, ($, key) => { $(selectedBind.write(key)); }));

            // Each selection is a lookup into the same array the control renders.
            const layout = $.let(layouts.filter((_$, v) => v.getTag().equal(lKey)).get(0n));
            const isList = $.let(layout.hasTag("list"));

            // `layout`, `groupBy` and `render` are build-time card config —
            // the mapper callbacks are reified when the deck is constructed —
            // so the axes pick between decks over the same registry + card
            // face (every one a tap target through the shared onCardClick).
            const structured = $.const(grouped.ifElse(
                _$ => isList.ifElse(
                    _$ => (
                        <Deck
                            data={LINES}
                            statuses={LINE_STATUSES}
                            card={r => ({
                                key: r.id,
                                title: r.name,
                                sublabel: r.team,
                                status: r.state,
                                metrics: [Deck.metric("Load", r.load.multiply(100.0), { format: v => East.str`${East.print(v)}%` })],
                                fill: { value: r.load.multiply(100.0), max: 100.0 },
                            })}
                            groupBy={[
                                { key: "state", label: "Status", value: r => r.state, summary: rows => East.str`${East.print(rows.size())} lines` },
                                { key: "team", label: "Team", value: r => r.team },
                            ]}
                            layout="list"
                            onCardClick={onCardClick}
                        />
                    ),
                    _$ => (
                        <Deck
                            data={LINES}
                            statuses={LINE_STATUSES}
                            card={r => ({
                                key: r.id,
                                title: r.name,
                                sublabel: r.team,
                                status: r.state,
                                metrics: [Deck.metric("Load", r.load.multiply(100.0), { format: v => East.str`${East.print(v)}%` })],
                                fill: { value: r.load.multiply(100.0), max: 100.0 },
                            })}
                            groupBy={[
                                { key: "state", label: "Status", value: r => r.state, summary: rows => East.str`${East.print(rows.size())} lines` },
                                { key: "team", label: "Team", value: r => r.team },
                            ]}
                            layout="grid"
                            onCardClick={onCardClick}
                        />
                    ),
                ),
                _$ => isList.ifElse(
                    _$ => (
                        <Deck
                            data={LINES}
                            statuses={LINE_STATUSES}
                            card={r => ({
                                key: r.id,
                                title: r.name,
                                sublabel: r.team,
                                status: r.state,
                                metrics: [Deck.metric("Load", r.load.multiply(100.0), { format: v => East.str`${East.print(v)}%` })],
                                fill: { value: r.load.multiply(100.0), max: 100.0 },
                            })}
                            layout="list"
                            onCardClick={onCardClick}
                        />
                    ),
                    _$ => (
                        <Deck
                            data={LINES}
                            statuses={LINE_STATUSES}
                            card={r => ({
                                key: r.id,
                                title: r.name,
                                sublabel: r.team,
                                status: r.state,
                                metrics: [Deck.metric("Load", r.load.multiply(100.0), { format: v => East.str`${East.print(v)}%` })],
                                fill: { value: r.load.multiply(100.0), max: 100.0 },
                            })}
                            layout="grid"
                            onCardClick={onCardClick}
                        />
                    ),
                ),
            ));

            // The custom-face switch swaps the structured face for a fully
            // custom `render` body — a minimal card head with any UI
            // composition beneath it — while the layout and grouped axes
            // keep working over the same rows.
            const customFace = $.const(grouped.ifElse(
                _$ => isList.ifElse(
                    _$ => (
                        <Deck
                            data={LINES}
                            card={r => ({ key: r.id, title: r.name })}
                            render={r => (
                                <VStack gap="1" align="stretch">
                                    <HStack gap="2">
                                        <Tag>{r.team}</Tag>
                                        <Tag>{r.state}</Tag>
                                    </HStack>
                                    <Text color="fg.muted">{East.str`load ${East.print(r.load)}`}</Text>
                                </VStack>
                            )}
                            groupBy={[
                                { key: "state", label: "Status", value: r => r.state, summary: rows => East.str`${East.print(rows.size())} lines` },
                                { key: "team", label: "Team", value: r => r.team },
                            ]}
                            layout="list"
                            onCardClick={onCardClick}
                        />
                    ),
                    _$ => (
                        <Deck
                            data={LINES}
                            card={r => ({ key: r.id, title: r.name })}
                            render={r => (
                                <VStack gap="1" align="stretch">
                                    <HStack gap="2">
                                        <Tag>{r.team}</Tag>
                                        <Tag>{r.state}</Tag>
                                    </HStack>
                                    <Text color="fg.muted">{East.str`load ${East.print(r.load)}`}</Text>
                                </VStack>
                            )}
                            groupBy={[
                                { key: "state", label: "Status", value: r => r.state, summary: rows => East.str`${East.print(rows.size())} lines` },
                                { key: "team", label: "Team", value: r => r.team },
                            ]}
                            layout="grid"
                            onCardClick={onCardClick}
                        />
                    ),
                ),
                _$ => isList.ifElse(
                    _$ => (
                        <Deck
                            data={LINES}
                            card={r => ({ key: r.id, title: r.name })}
                            render={r => (
                                <VStack gap="1" align="stretch">
                                    <HStack gap="2">
                                        <Tag>{r.team}</Tag>
                                        <Tag>{r.state}</Tag>
                                    </HStack>
                                    <Text color="fg.muted">{East.str`load ${East.print(r.load)}`}</Text>
                                </VStack>
                            )}
                            layout="list"
                            onCardClick={onCardClick}
                        />
                    ),
                    _$ => (
                        <Deck
                            data={LINES}
                            card={r => ({ key: r.id, title: r.name })}
                            render={r => (
                                <VStack gap="1" align="stretch">
                                    <HStack gap="2">
                                        <Tag>{r.team}</Tag>
                                        <Tag>{r.state}</Tag>
                                    </HStack>
                                    <Text color="fg.muted">{East.str`load ${East.print(r.load)}`}</Text>
                                </VStack>
                            )}
                            layout="grid"
                            onCardClick={onCardClick}
                        />
                    ),
                ),
            ));

            const deck = $.const(custom.ifElse(_$ => customFace, _$ => structured));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Layout", lKey,
                            <SegmentGroup value={lKey} onChange={onLayout} size="sm"
                                items={layouts.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        // Slots, not Controls: the switches report as the
                        // Grouping / Face spec rows below rather than as one
                        // value each.
                        Configurator.Slot("Grouping",
                            <HStack gap="5" align="center">
                                <Switch checked={grouped} label="Grouped" onChange={onGroup} />
                            </HStack>),
                        Configurator.Slot("Face",
                            <HStack gap="5" align="center">
                                <Switch checked={custom} label="Custom render" onChange={onCustom} />
                            </HStack>),
                    ]}
                    preview={deck}
                    aside={{
                        label: "Tap target · Reactive",
                        body: <Text color="fg.muted">{East.str`selected: ${selected}`}</Text>,
                    }}
                    spec={[
                        Configurator.Spec("Cards", `${LINES.length}`),
                        Configurator.Spec("Grouping", grouped.ifElse(_$ => "status · team options", _$ => "flat")),
                        Configurator.Spec("Face", custom.ifElse(_$ => "custom render", _$ => "structured")),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
