/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, NullType, StringType, StructType, VariantType, example, variant } from "@elaraai/east";
import { State, Style, UIComponentType } from "@elaraai/east-ui";
import { Badge, Box, Button, Card, Configurator, HStack, SegmentGroup, Switch, Text, VStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const cardBasic = example({
    keywords: ["Card", "Root", "basic"],
    description: "Simple card container",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Card>
                <Text>This is a basic card with some content.</Text>
            </Card>
        );
    }),
    inputs: [],
});

// ============================================================================
// Card — live configurator over header, body, sizing and slot axes
// ============================================================================

export const cardVariants = example({
    keywords: ["Card", "Root", "header", "eyebrow", "Header", "title", "description", "footer", "Button", "actions", "meta", "Section", "multi-section", "flush", "bodyPadding", "full-bleed", "padding", "Badge", "rich content", "height", "overflow", "dimensions", "flex", "Stack", "HStack", "fill", "body", "constrain", "scroll", "sizing", "fillBody", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator", "state", "loading", "Skeleton", "empty", "EmptyState", "error", "permission-denied", "access denied"],
    description: "Card configurator — header, body, sizing and runtime-state axes plus footer / sections switches driving one live card; the aside shares one row between two flex cards",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Header / footer slots are composed at build time, so the
                // header axis is a plain key array and the preview picks the
                // matching prebuilt card below (the chip-rail presence
                // precedent); the slot content itself never changes.
                const headers = $.const(["none", "eyebrow", "full", "compound"], ArrayType(StringType));

                // Body is a preset axis — flush and bodyPadding only read
                // against each other (flush overrides the padding).
                const bodies = $.const([
                    { label: "default", flush: false, pad: "18px 20px" },
                    { label: "flush",   flush: true,  pad: "18px 20px" },
                    { label: "tight",   flush: false, pad: "6px 8px" },
                ], ArrayType(StructType({ label: StringType, flush: BooleanType, pad: StringType })));

                // Sizing is a preset axis: fixed-height scroll, flex growth, and
                // the #320 fill-body contract — a height-bounded Card constrains
                // its body so a `fill scrollY` child scrolls inside the card
                // instead of overflowing it.
                const sizings = $.const([
                    { label: "fixed",     height: "200px", width: "100%",  flex: "none", overflow: variant("auto", null) },
                    { label: "flexible",  height: "auto",  width: "100%",  flex: "1",    overflow: variant("visible", null) },
                    { label: "fill-body", height: "240px", width: "280px", flex: "none", overflow: variant("visible", null) },
                ], ArrayType(StructType({ label: StringType, height: StringType, width: StringType, flex: StringType, overflow: Style.Types.Overflow })));

                // Runtime state is the shared states contract — `ready` plus
                // the fallback quartet. The selected variant lowers onto every
                // prebuilt leaf, so the fallback bodies render inside whichever
                // header / footer / sizing combination is configured.
                const states = $.const([
                    variant("ready", null), variant("loading", null), variant("empty", null),
                    variant("error", null), variant("permission-denied", null),
                ], ArrayType(VariantType({
                    ready: NullType, loading: NullType, empty: NullType,
                    error: NullType, "permission-denied": NullType,
                })));

                // The three bodies the switches and the #320 preset pick between.
                const scrollBody = $.const([
                    <Box fill scrollY>
                        <VStack align="stretch" gap="2">
                            {Array.from({ length: 20 }, (_, i) => <Text>{`Row ${i + 1}`}</Text>)}
                        </VStack>
                    </Box>,
                ], ArrayType(UIComponentType));

                const sectionedBody = $.const([
                    <Text>Top-level summary line.</Text>,
                    Card.Section([<Text>Scope A details</Text>], { title: "Scope" }),
                    Card.Section([
                        <HStack gap="2">
                            <Button>Apply</Button>
                            <Button variant="subtle">Revert</Button>
                        </HStack>,
                    ], { title: "Actions" }),
                ], ArrayType(UIComponentType));

                const richBody = $.const([
                    <HStack gap="2">
                        <Badge colorPalette="success" variant="solid">New</Badge>
                        <Badge colorPalette="brand" variant="solid">Featured</Badge>
                    </HStack>,
                    <Text>This card demonstrates how multiple components can be nested inside a card body.</Text>,
                ], ArrayType(UIComponentType));

                const headerBind   = $.let(State.bind([StringType], "card_header", "full"));
                const bodyBind     = $.let(State.bind([StringType], "card_body", "default"));
                const sizingBind   = $.let(State.bind([StringType], "card_sizing", "flexible"));
                const stateBind    = $.let(State.bind([StringType], "card_state", "ready"));
                const footerBind   = $.let(State.bind([BooleanType], "card_footer", true));
                const sectionsBind = $.let(State.bind([BooleanType], "card_sections", false));

                const hKey       = $.let(headerBind.read());
                const bKey       = $.let(bodyBind.read());
                const sKey       = $.let(sizingBind.read());
                const stKey      = $.let(stateBind.read());
                const footerOn   = $.let(footerBind.read());
                const sectionsOn = $.let(sectionsBind.read());

                const onHeader   = $.const(East.function([StringType], NullType, ($, next) => { $(headerBind.write(next)); }));
                const onBody     = $.const(East.function([StringType], NullType, ($, next) => { $(bodyBind.write(next)); }));
                const onSizing   = $.const(East.function([StringType], NullType, ($, next) => { $(sizingBind.write(next)); }));
                const onState    = $.const(East.function([StringType], NullType, ($, next) => { $(stateBind.write(next)); }));
                const onFooter   = $.const(East.function([BooleanType], NullType, ($, next) => { $(footerBind.write(next)); }));
                const onSections = $.const(East.function([BooleanType], NullType, ($, next) => { $(sectionsBind.write(next)); }));

                // Each selection is a lookup into the same array the control renders.
                const body = $.let(bodies.filter((_$, o) => o.label.equal(bKey)).get(0n));
                const sizing = $.let(sizings.filter((_$, o) => o.label.equal(sKey)).get(0n));
                const cardState = $.let(states.filter((_$, v) => v.getTag().equal(stKey)).get(0n));

                const kids = $.let(sKey.equal("fill-body").ifElse(
                    _$ => scrollBody,
                    _$ => sectionsOn.ifElse(_$ => sectionedBody, _$ => richBody),
                ));

                // One prebuilt card per header form × footer presence; every
                // leaf shares the same East-driven body and style expressions.
                // The compound leaf keeps the content + actions footer so both
                // footer compositions stay reachable.
                const preview = $.const(hKey.equal("none").ifElse(
                    _$ => footerOn.ifElse(
                        _$ => (
                            <Card
                                footer={{ actions: [
                                    <Button variant="outline" size="sm">Cancel</Button>,
                                    <Button variant="solid" colorPalette="brand" size="sm">Save</Button>,
                                ] }}
                                flush={body.flush} bodyPadding={body.pad}
                                height={sizing.height} width={sizing.width} flex={sizing.flex} overflow={sizing.overflow} state={cardState}
                            >
                                {kids}
                            </Card>
                        ),
                        _$ => (
                            <Card
                                flush={body.flush} bodyPadding={body.pad}
                                height={sizing.height} width={sizing.width} flex={sizing.flex} overflow={sizing.overflow} state={cardState}
                            >
                                {kids}
                            </Card>
                        ),
                    ),
                    _$ => hKey.equal("eyebrow").ifElse(
                        _$ => footerOn.ifElse(
                            _$ => (
                                <Card
                                    header={{ eyebrow: "Run summary" }}
                                    footer={{ actions: [
                                        <Button variant="outline" size="sm">Cancel</Button>,
                                        <Button variant="solid" colorPalette="brand" size="sm">Save</Button>,
                                    ] }}
                                    flush={body.flush} bodyPadding={body.pad}
                                    height={sizing.height} width={sizing.width} flex={sizing.flex} overflow={sizing.overflow} state={cardState}
                                >
                                    {kids}
                                </Card>
                            ),
                            _$ => (
                                <Card
                                    header={{ eyebrow: "Run summary" }}
                                    flush={body.flush} bodyPadding={body.pad}
                                    height={sizing.height} width={sizing.width} flex={sizing.flex} overflow={sizing.overflow} state={cardState}
                                >
                                    {kids}
                                </Card>
                            ),
                        ),
                        _$ => hKey.equal("full").ifElse(
                            _$ => footerOn.ifElse(
                                _$ => (
                                    <Card
                                        header={{ eyebrow: "Featured", title: "Featured Article", description: "A brief summary of what this card contains" }}
                                        footer={{ actions: [
                                            <Button variant="outline" size="sm">Cancel</Button>,
                                            <Button variant="solid" colorPalette="brand" size="sm">Save</Button>,
                                        ] }}
                                        flush={body.flush} bodyPadding={body.pad}
                                        height={sizing.height} width={sizing.width} flex={sizing.flex} overflow={sizing.overflow} state={cardState}
                                    >
                                        {kids}
                                    </Card>
                                ),
                                _$ => (
                                    <Card
                                        header={{ eyebrow: "Featured", title: "Featured Article", description: "A brief summary of what this card contains" }}
                                        flush={body.flush} bodyPadding={body.pad}
                                        height={sizing.height} width={sizing.width} flex={sizing.flex} overflow={sizing.overflow} state={cardState}
                                    >
                                        {kids}
                                    </Card>
                                ),
                            ),
                            _$ => footerOn.ifElse(
                                _$ => (
                                    <Card
                                        header={{ eyebrow: "Forecast · SE region", title: "Per plan week", meta: "14s ago" }}
                                        footer={{ content: [<Text>Last synced 14:32</Text>], actions: [<Button variant="subtle">Export</Button>] }}
                                        flush={body.flush} bodyPadding={body.pad}
                                        height={sizing.height} width={sizing.width} flex={sizing.flex} overflow={sizing.overflow} state={cardState}
                                    >
                                        {kids}
                                    </Card>
                                ),
                                _$ => (
                                    <Card
                                        header={{ eyebrow: "Forecast · SE region", title: "Per plan week", meta: "14s ago" }}
                                        flush={body.flush} bodyPadding={body.pad}
                                        height={sizing.height} width={sizing.width} flex={sizing.flex} overflow={sizing.overflow} state={cardState}
                                    >
                                        {kids}
                                    </Card>
                                ),
                            ),
                        ),
                    ),
                ));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Header", hKey,
                                <SegmentGroup value={hKey} onChange={onHeader} size="sm"
                                    items={headers.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                            Configurator.Control("Body", bKey,
                                <SegmentGroup value={bKey} onChange={onBody} size="sm"
                                    items={bodies.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            Configurator.Control("Sizing", sKey,
                                <SegmentGroup value={sKey} onChange={onSizing} size="sm"
                                    items={sizings.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            Configurator.Control("State", stKey,
                                <SegmentGroup value={stKey} onChange={onState} size="sm"
                                    items={states.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            // A Slot, not a Control: the two switches report as
                            // the Footer / Sections spec rows below rather than
                            // as one value.
                            Configurator.Slot("Slots",
                                <HStack gap="5" align="center">
                                    <Switch checked={footerOn} label="Footer" onChange={onFooter} />
                                    <Switch checked={sectionsOn} label="Sections" onChange={onSections} />
                                </HStack>),
                        ]}
                        preview={preview}
                        aside={{
                            label: "Flex · shared row",
                            body: (
                                <HStack gap="4" width="100%">
                                    <Card header={{ eyebrow: "Flex card 1" }} flex="1">
                                        <Text>flex: 1 fills available space.</Text>
                                    </Card>
                                    <Card header={{ eyebrow: "Flex card 2" }} flex="1">
                                        <Text>Both cards share the row equally.</Text>
                                    </Card>
                                </HStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Footer", footerOn.ifElse(
                                _$ => hKey.equal("compound").ifElse(_$ => "content + actions", _$ => "actions"),
                                _$ => "none")),
                            Configurator.Spec("Sections", sKey.equal("fill-body").ifElse(
                                _$ => "fill scrollY body",
                                _$ => sectionsOn.ifElse(_$ => "2 hairline", _$ => "inline body"))),
                            Configurator.Spec("Body render", stKey.equal("ready").ifElse(
                                _$ => "children",
                                _$ => East.str`${stKey} fallback`)),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
