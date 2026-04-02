/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, variant } from "@elaraai/east";
import { describeEast, Assert, NodePlatform } from "@elaraai/east-node-std";
import { Format } from "@elaraai/east-node-io";
import * as ex from "./xml.examples.js";

await describeEast("XML Platform Functions", (test) => {
    Assert.examples(test, { xmlParse: ex.xmlParse, xmlSerialize: ex.xmlSerialize });

    test("parses simple XML element", $ => {
        const xmlData = $.let(East.value("<book>East Guide</book>"));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        const result = $.let(Format.XML.parse(blob, config));

        // Access tag through struct fields
        const tag = $.let(result.unwrap().tag);
        $(Assert.equal(tag, "book"));

        // Access children array
        const children = $.let(result.unwrap().children);
        const length = $.let(children.size());
        $(Assert.equal(length, 1n));

        // First child is a TEXT variant
        const child0 = $.let(children.get(0n));
        const textValue = $.let(child0.unwrap("TEXT"));
        $(Assert.equal(textValue, "East Guide"));
    });

    test("parses XML with attributes", $ => {
        const xmlData = $.let(East.value('<book id="123" lang="en">Content</book>'));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        const result = $.let(Format.XML.parse(blob, config));
        const attrs = $.let(result.unwrap().attributes);

        const id = $.let(attrs.get("id"));
        $(Assert.equal(id, "123"));

        const lang = $.let(attrs.get("lang"));
        $(Assert.equal(lang, "en"));
    });

    test("parses nested XML elements", $ => {
        const xmlData = $.let(East.value("<book><title>East</title><author>John</author></book>"));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        const result = $.let(Format.XML.parse(blob, config));
        const children = $.let(result.unwrap().children);
        const length = $.let(children.size());
        $(Assert.equal(length, 2n));

        // First child is an ELEMENT variant
        const child0 = $.let(children.get(0n));
        const titleElement = $.let(child0.unwrap("ELEMENT"));
        const titleTag = $.let(titleElement.unwrap().tag);
        $(Assert.equal(titleTag, "title"));

        const titleChildren = $.let(titleElement.unwrap().children);
        const titleText = $.let(titleChildren.get(0n));
        const titleValue = $.let(titleText.unwrap("TEXT"));
        $(Assert.equal(titleValue, "East"));
    });

    test("parses XML with entities", $ => {
        const xmlData = $.let(East.value("<text>&lt;html&gt; &amp; &quot;quote&quot;</text>"));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        const result = $.let(Format.XML.parse(blob, config));
        const children = $.let(result.unwrap().children);
        const child0 = $.let(children.get(0n));
        const text = $.let(child0.unwrap("TEXT"));
        $(Assert.equal(text, '<html> & "quote"'));
    });

    test("parses self-closing tag", $ => {
        const xmlData = $.let(East.value("<br/>"));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        const result = $.let(Format.XML.parse(blob, config));
        const tag = $.let(result.unwrap().tag);
        $(Assert.equal(tag, "br"));

        const children = $.let(result.unwrap().children);
        const length = $.let(children.size());
        $(Assert.equal(length, 0n));
    });

    test("serializes simple XML", $ => {
        const node = $.let(East.value({
            tag: "book",
            attributes: new Map(),
            children: [variant("TEXT", "East Guide")],
        }, Format.XML.Types.Node));

        const config = $.let(East.value({
            indent: variant('none', null),
            includeXmlDeclaration: false,
            encodeEntities: true,
            selfClosingTags: true,
        }));

        const result = $.let(Format.XML.serialize(node, config));
        const text = $.let(result.decodeUtf8());
        $(Assert.equal(text, "<book>East Guide</book>"));
    });

    test("serializes XML with attributes", $ => {
        const node = $.let(East.value({
            tag: "book",
            attributes: new Map([["id", "123"]]),
            children: [variant("TEXT", "Content")],
        }, Format.XML.Types.Node));

        const config = $.let(East.value({
            indent: variant('none', null),
            includeXmlDeclaration: false,
            encodeEntities: true,
            selfClosingTags: true,
        }));

        const result = $.let(Format.XML.serialize(node, config));
        const text = $.let(result.decodeUtf8());
        $(Assert.equal(text, '<book id="123">Content</book>'));
    });

    test("serializes nested XML", $ => {
        const node = $.let(East.value({
            tag: "book",
            attributes: new Map(),
            children: [
                variant("ELEMENT", {
                    tag: "title",
                    attributes: new Map(),
                    children: [variant("TEXT", "East")],
                }),
            ],
        }, Format.XML.Types.Node));

        const config = $.let(East.value({
            indent: variant('none', null),
            includeXmlDeclaration: false,
            encodeEntities: true,
            selfClosingTags: true,
        }));

        const result = $.let(Format.XML.serialize(node, config));
        const text = $.let(result.decodeUtf8());
        $(Assert.equal(text, "<book><title>East</title></book>"));
    });

    test("serializes with entities", $ => {
        const node = $.let(East.value({
            tag: "text",
            attributes: new Map(),
            children: [variant("TEXT", '<html> & "quote"')],
        }, Format.XML.Types.Node));

        const config = $.let(East.value({
            indent: variant('none', null),
            includeXmlDeclaration: false,
            encodeEntities: true,
            selfClosingTags: true,
        }));

        const result = $.let(Format.XML.serialize(node, config));
        const text = $.let(result.decodeUtf8());
        $(Assert.equal(text, "<text>&lt;html&gt; &amp; &quot;quote&quot;</text>"));
    });

    test("serializes self-closing tag", $ => {
        const node = $.let(East.value({
            tag: "br",
            attributes: new Map(),
            children: [],
        }, Format.XML.Types.Node));

        const config = $.let(East.value({
            indent: variant('none', null),
            includeXmlDeclaration: false,
            encodeEntities: true,
            selfClosingTags: true,
        }));

        const result = $.let(Format.XML.serialize(node, config));
        const text = $.let(result.decodeUtf8());
        $(Assert.equal(text, "<br/>"));
    });

    test("round-trip: parse and serialize", $ => {
        const originalXml = $.let(East.value('<book id="123"><title>East Guide</title></book>'));
        const blob = $.let(originalXml.encodeUtf8());

        const parseConfig = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        const parsed = $.let(Format.XML.parse(blob, parseConfig));

        const serializeConfig = $.let(East.value({
            indent: variant('none', null),
            includeXmlDeclaration: false,
            encodeEntities: true,
            selfClosingTags: true,
        }));

        const serialized = $.let(Format.XML.serialize(parsed, serializeConfig));
        const text = $.let(serialized.decodeUtf8());
        $(Assert.equal(text, originalXml));
    });

    // Edge Case Tests

    test("handles XML declaration", $ => {
        const xmlData = $.let(East.value('<?xml version="1.0" encoding="UTF-8"?><root>content</root>'));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        const result = $.let(Format.XML.parse(blob, config));
        const tag = $.let(result.unwrap().tag);
        $(Assert.equal(tag, "root"));
    });

    test("handles namespaces as regular attributes", $ => {
        const xmlData = $.let(East.value('<root xmlns:foo="http://example.com"><foo:element>test</foo:element></root>'));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        const result = $.let(Format.XML.parse(blob, config));
        const attrs = $.let(result.unwrap().attributes);
        const xmlns = $.let(attrs.get("xmlns:foo"));
        $(Assert.equal(xmlns, "http://example.com"));

        const children = $.let(result.unwrap().children);
        const child0 = $.let(children.get(0n));
        const element = $.let(child0.unwrap("ELEMENT"));
        const childTag = $.let(element.unwrap().tag);
        $(Assert.equal(childTag, "foo:element"));
    });

    test("handles numeric entities (decimal)", $ => {
        const xmlData = $.let(East.value("<text>&#65;&#66;&#67;</text>"));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        const result = $.let(Format.XML.parse(blob, config));
        const children = $.let(result.unwrap().children);
        const child0 = $.let(children.get(0n));
        const text = $.let(child0.unwrap("TEXT"));
        $(Assert.equal(text, "ABC"));
    });

    test("handles numeric entities (hexadecimal)", $ => {
        const xmlData = $.let(East.value("<text>&#x41;&#x42;&#x43;</text>"));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        const result = $.let(Format.XML.parse(blob, config));
        const children = $.let(result.unwrap().children);
        const child0 = $.let(children.get(0n));
        const text = $.let(child0.unwrap("TEXT"));
        $(Assert.equal(text, "ABC"));
    });

    test("skips comments", $ => {
        const xmlData = $.let(East.value("<root><!-- comment --><child>text</child></root>"));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        const result = $.let(Format.XML.parse(blob, config));
        const children = $.let(result.unwrap().children);
        const length = $.let(children.size());
        $(Assert.equal(length, 1n)); // Only child element, comment ignored
    });

    test("skips processing instructions", $ => {
        const xmlData = $.let(East.value('<?xml-stylesheet type="text/xsl" href="style.xsl"?><root>content</root>'));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        const result = $.let(Format.XML.parse(blob, config));
        const tag = $.let(result.unwrap().tag);
        $(Assert.equal(tag, "root"));
    });

    test("preserves whitespace when configured", $ => {
        const xmlData = $.let(East.value("<text>  space  </text>"));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: true,
            decodeEntities: true,
        }));

        const result = $.let(Format.XML.parse(blob, config));
        const children = $.let(result.unwrap().children);
        const child0 = $.let(children.get(0n));
        const text = $.let(child0.unwrap("TEXT"));
        $(Assert.equal(text, "  space  "));
    });

    test("trims whitespace by default", $ => {
        const xmlData = $.let(East.value("<text>  space  </text>"));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        const result = $.let(Format.XML.parse(blob, config));
        const children = $.let(result.unwrap().children);
        const child0 = $.let(children.get(0n));
        const text = $.let(child0.unwrap("TEXT"));
        $(Assert.equal(text, "space"));
    });

    test("handles multiple attributes", $ => {
        const xmlData = $.let(East.value('<element a="1" b="2" c="3">content</element>'));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        const result = $.let(Format.XML.parse(blob, config));
        const attrs = $.let(result.unwrap().attributes);
        const a = $.let(attrs.get("a"));
        const b = $.let(attrs.get("b"));
        const c = $.let(attrs.get("c"));
        $(Assert.equal(a, "1"));
        $(Assert.equal(b, "2"));
        $(Assert.equal(c, "3"));
    });

    test("serializes empty elements with closing tags when selfClosingTags=false", $ => {
        const node = $.let(East.value({
            tag: "br",
            attributes: new Map(),
            children: [],
        }, Format.XML.Types.Node));

        const config = $.let(East.value({
            indent: variant('none', null),
            includeXmlDeclaration: false,
            encodeEntities: true,
            selfClosingTags: false,
        }));

        const result = $.let(Format.XML.serialize(node, config));
        const text = $.let(result.decodeUtf8());
        $(Assert.equal(text, "<br></br>"));
    });

    test("handles UTF-8 BOM", $ => {
        const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
        const xmlBytes = new TextEncoder().encode("<root>test</root>");
        const combined = new Uint8Array(bom.length + xmlBytes.length);
        combined.set(bom, 0);
        combined.set(xmlBytes, bom.length);

        const blob = $.let(East.value(combined));
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        const result = $.let(Format.XML.parse(blob, config));
        const tag = $.let(result.unwrap().tag);
        $(Assert.equal(tag, "root"));
    });

    test("handles entities in attribute values", $ => {
        const xmlData = $.let(East.value('<element attr="&lt;value&gt;">content</element>'));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        const result = $.let(Format.XML.parse(blob, config));
        const attrs = $.let(result.unwrap().attributes);
        const attr = $.let(attrs.get("attr"));
        $(Assert.equal(attr, "<value>"));
    });

    test("handles mixed content (text and elements interleaved)", $ => {
        const xmlData = $.let(East.value("<p>Some <b>bold</b> text.</p>"));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        const result = $.let(Format.XML.parse(blob, config));
        const children = $.let(result.unwrap().children);
        const length = $.let(children.size());
        $(Assert.equal(length, 3n));

        const text1 = $.let(children.get(0n));
        const textValue1 = $.let(text1.unwrap("TEXT"));
        $(Assert.equal(textValue1, "Some"));

        const elem = $.let(children.get(1n));
        const boldElement = $.let(elem.unwrap("ELEMENT"));
        const boldTag = $.let(boldElement.unwrap().tag);
        $(Assert.equal(boldTag, "b"));

        const text2 = $.let(children.get(2n));
        const textValue2 = $.let(text2.unwrap("TEXT"));
        $(Assert.equal(textValue2, "text."));
    });

    test("handles deep nesting", $ => {
        const xmlData = $.let(East.value("<a><b><c><d><e>deep</e></d></c></b></a>"));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        const result = $.let(Format.XML.parse(blob, config));

        // Navigate to deepest element
        const children1 = $.let(result.unwrap().children);
        const b = $.let(children1.get(0n).unwrap("ELEMENT"));
        const children2 = $.let(b.unwrap().children);
        const c = $.let(children2.get(0n).unwrap("ELEMENT"));
        const children3 = $.let(c.unwrap().children);
        const d = $.let(children3.get(0n).unwrap("ELEMENT"));
        const children4 = $.let(d.unwrap().children);
        const e = $.let(children4.get(0n).unwrap("ELEMENT"));
        const children5 = $.let(e.unwrap().children);
        const text = $.let(children5.get(0n).unwrap("TEXT"));

        $(Assert.equal(text, "deep"));
    });

    test("includes XML declaration when configured", $ => {
        const node = $.let(East.value({
            tag: "root",
            attributes: new Map(),
            children: [],
        }, Format.XML.Types.Node));

        const config = $.let(East.value({
            indent: variant('none', null),
            includeXmlDeclaration: true,
            encodeEntities: true,
            selfClosingTags: true,
        }));

        const result = $.let(Format.XML.serialize(node, config));
        const text = $.let(result.decodeUtf8());
        const expectedStart = $.let(East.value('<?xml version="1.0" encoding="UTF-8"?>'));
        const hasDeclaration = $.let(text.startsWith(expectedStart));
        $(Assert.equal(hasDeclaration, true));
    });

    test("handles indentation with spaces", $ => {
        const node = $.let(East.value({
            tag: "root",
            attributes: new Map(),
            children: [
                variant("ELEMENT", {
                    tag: "child",
                    attributes: new Map(),
                    children: [variant("TEXT", "content")],
                }),
            ],
        }, Format.XML.Types.Node));

        const config = $.let(East.value({
            indent: variant('some', "  "),
            includeXmlDeclaration: false,
            encodeEntities: true,
            selfClosingTags: true,
        }));

        const result = $.let(Format.XML.serialize(node, config));
        const text = $.let(result.decodeUtf8());
        const expectedSubstring = $.let(East.value("\n  <child>"));
        const hasIndent = $.let(text.contains(expectedSubstring));
        $(Assert.equal(hasIndent, true));
    });

    // Error Handling Tests

    test("throws error on mismatched tags", $ => {
        const xmlData = $.let(East.value("<root><child>text</other></root>"));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        $(Assert.throws(Format.XML.parse(blob, config), /Mismatched closing tag/));
    });

    test("throws error on empty document", $ => {
        const xmlData = $.let(East.value(""));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        $(Assert.throws(Format.XML.parse(blob, config), /Empty XML document/));
    });

    test("throws error on unclosed quote in attribute", $ => {
        const xmlData = $.let(East.value('<root attr="value>content</root>'));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        $(Assert.throws(Format.XML.parse(blob, config), /Unclosed attribute value/));
    });

    // Special Characters in Attributes

    test("handles newlines in attribute values", $ => {
        const xmlData = $.let(East.value('<element attr="line1&#10;line2">content</element>'));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        const result = $.let(Format.XML.parse(blob, config));
        const attrs = $.let(result.unwrap().attributes);
        const attr = $.let(attrs.get("attr"));
        $(Assert.equal(attr, "line1\nline2"));
    });

    test("handles tabs in attribute values", $ => {
        const xmlData = $.let(East.value('<element attr="col1&#9;col2">content</element>'));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        const result = $.let(Format.XML.parse(blob, config));
        const attrs = $.let(result.unwrap().attributes);
        const attr = $.let(attrs.get("attr"));
        $(Assert.equal(attr, "col1\tcol2"));
    });

    test("serializes special characters in attribute values", $ => {
        const node = $.let(East.value({
            tag: "element",
            attributes: new Map([["attr", "line1\nline2"]]),
            children: [],
        }, Format.XML.Types.Node));

        const config = $.let(East.value({
            indent: variant('none', null),
            includeXmlDeclaration: false,
            encodeEntities: true,
            selfClosingTags: true,
        }));

        const result = $.let(Format.XML.serialize(node, config));
        const text = $.let(result.decodeUtf8());
        // Should preserve the newline character
        const expectedSubstring = $.let(East.value("line1\nline2"));
        const hasNewline = $.let(text.contains(expectedSubstring));
        $(Assert.equal(hasNewline, true));
    });

    // CDATA Tests

    test("handles CDATA sections", $ => {
        const xmlData = $.let(East.value("<root><![CDATA[<html>content & stuff</html>]]></root>"));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));

        const result = $.let(Format.XML.parse(blob, config));
        const children = $.let(result.unwrap().children);
        const child0 = $.let(children.get(0n));
        const text = $.let(child0.unwrap("TEXT"));
        // CDATA content should be preserved as-is without entity decoding
        $(Assert.equal(text, "<html>content & stuff</html>"));
    });
}, { platformFns: [...Format.XML.Implementation, ...NodePlatform] });
