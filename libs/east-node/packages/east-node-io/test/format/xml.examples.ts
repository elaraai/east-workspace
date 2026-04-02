/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, StringType, variant, example } from "@elaraai/east";
import { Format } from "@elaraai/east-node-io";

export const xmlParse = example({
    keywords: ["xml", "XML", "parse", "read", "element"],
    description: "Parse an XML string and extract the root tag name",
    fn: East.asyncFunction([], StringType, ($) => {
        const xmlData = $.let(East.value("<book>East Guide</book>"));
        const blob = $.let(xmlData.encodeUtf8());
        const config = $.let(East.value({
            preserveWhitespace: false,
            decodeEntities: true,
        }));
        const result = $.let(Format.XML.parse(blob, config));
        return result.unwrap().tag;
    }),
    inputs: [],
    returns: "book",
});

export const xmlSerialize = example({
    keywords: ["xml", "XML", "serialize", "write", "output"],
    description: "Serialize an XML node to a string",
    fn: East.asyncFunction([], StringType, ($) => {
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
        return result.decodeUtf8();
    }),
    inputs: [],
    returns: "<book>East Guide</book>",
});
