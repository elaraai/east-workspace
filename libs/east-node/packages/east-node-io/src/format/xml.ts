/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BlobType, RecursiveType, StructType, StringType, DictType, ArrayType, VariantType, BooleanType, OptionType, variant, type ValueTypeOf, SortedMap } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { EastError } from "@elaraai/east/internal";

// XML Type Definitions

/**
 * XmlNode represents an XML element with its tag, attributes, and children.
 *
 * Children can be either TEXT nodes (string content) or ELEMENT nodes (nested XML elements).
 * This recursive structure allows representing arbitrary XML trees.
 */
export const XmlNode = RecursiveType(self =>
    StructType({
        tag: StringType,                                // Element tag name (e.g., "book")
        attributes: DictType(StringType, StringType),  // Attributes map (e.g., {"id": "123"})
        children: ArrayType(VariantType({
            TEXT: StringType,                           // Text content
            ELEMENT: self,                              // Nested element (recursive)
        })),
    })
);

export type XmlNodeValue = ValueTypeOf<typeof XmlNode>;

// Configuration Types

export const XmlParseConfig = StructType({
    preserveWhitespace: BooleanType,        // Default: false (trim text nodes)
    decodeEntities: BooleanType,            // Default: true (&lt; -> <, etc.)
});

export const XmlSerializeConfig = StructType({
    indent: OptionType(StringType),         // Default: none, Example: "  " for 2 spaces
    includeXmlDeclaration: BooleanType,     // Default: true (<?xml version="1.0"?>)
    encodeEntities: BooleanType,            // Default: true (< -> &lt;, etc.)
    selfClosingTags: BooleanType,           // Default: true (<br/> vs <br></br>)
});

// Platform Functions

/**
 * Parses XML data from a binary blob into a recursive tree structure.
 *
 * Converts XML-formatted binary data into an {@link XmlNode} recursive structure,
 * where each node contains a tag name, attributes dictionary, and children array.
 * Children can be either TEXT nodes (string content) or ELEMENT nodes (nested elements).
 *
 * Supports XML declarations, namespaces (as attributes), CDATA sections,
 * entity decoding, comments (ignored), processing instructions (ignored),
 * and configurable whitespace handling.
 *
 * This is a platform function for the East language, enabling XML parsing
 * in East programs running on Node.js.
 *
 * @param blob - The XML data as a binary blob (UTF-8 encoded)
 * @param config - Parsing configuration including whitespace and entity handling options
 * @returns An {@link XmlNode} representing the root element of the XML document
 *
 * @throws {EastError} When XML is malformed with specific error messages:
 * - "Expected '<' at line N, column M" - Missing opening tag bracket
 * - "Invalid tag name at line N, column M" - Tag name contains invalid characters
 * - "Expected '=' after attribute name at line N, column M" - Missing equals in attribute
 * - "Expected quote for attribute value at line N, column M" - Attribute value not quoted
 * - "Unclosed attribute value at line N, column M" - Missing closing quote
 * - "Expected '>' at line N, column M" - Missing closing bracket
 * - "Mismatched closing tag: expected '</X>', found '</Y>' at line N, column M" - Tag mismatch
 * - "Expected '>' in closing tag at line N, column M" - Malformed closing tag
 * - "Unclosed comment at line N, column M" - Comment not properly closed
 * - "Unclosed CDATA section at line N, column M" - CDATA not properly closed
 * - "Empty XML document" - No root element found
 *
 * @example
 * ```ts
 * const parseXML = East.function([BlobType], XmlNode, ($, xmlBlob) => {
 *     const config = $.const(East.value({
 *         preserveWhitespace: false,
 *         decodeEntities: true,
 *     }, XmlParseConfig));
 *
 *     return xml_parse(xmlBlob, config);
 *     // Returns: { tag: "book", attributes: {"id": "123"}, children: [...] }
 * });
 * ```
 *
 * @remarks
 * - Skips XML declarations (`<?xml version="1.0"?>`) and processing instructions
 * - Ignores comments (`<!-- comment -->`) - they are not preserved
 * - Handles CDATA sections (`<![CDATA[...]]>`) as text without entity decoding
 * - Decodes predefined entities (`&lt;`, `&gt;`, `&amp;`, `&quot;`, `&apos;`)
 * - Decodes numeric entities (decimal `&#65;` and hexadecimal `&#x41;`)
 * - Namespaces are treated as regular attributes (e.g., `xmlns:foo="..."`)
 * - Preserves namespace prefixes in tag names (e.g., `foo:element`)
 * - Skips UTF-8 BOM (0xEF 0xBB 0xBF) if present at start
 * - Tracks line and column numbers for precise error reporting
 */
export const xml_parse = East.platform("xml_parse", [BlobType, XmlParseConfig], XmlNode);

/**
 * Serializes a recursive XML tree structure into XML-formatted binary data.
 *
 * Converts an {@link XmlNode} recursive structure into XML-formatted binary data.
 * Supports configurable indentation, XML declarations, entity encoding,
 * and self-closing tag formatting.
 *
 * This is a platform function for the East language, enabling XML serialization
 * in East programs running on Node.js.
 *
 * @param node - The {@link XmlNode} root element to serialize
 * @param config - Serialization configuration including indentation and formatting options
 * @returns A binary blob containing the XML-formatted data (UTF-8 encoded)
 *
 * @example
 * ```ts
 * const serializeXML = East.function([XmlNode], BlobType, ($, doc) => {
 *     const config = $.const(East.value({
 *         indent: variant('some', "  "),
 *         includeXmlDeclaration: true,
 *         encodeEntities: true,
 *         selfClosingTags: true,
 *     }, XmlSerializeConfig));
 *
 *     return xml_serialize(doc, config);
 *     // Returns blob that decodes to:
 *     // <?xml version="1.0" encoding="UTF-8"?>
 *     // <book id="123">
 *     //   <title>East Guide</title>
 *     // </book>
 * });
 * ```
 *
 * @remarks
 * - Automatically encodes special characters (`<`, `>`, `&`, `"`, `'`) when encodeEntities is true
 * - Attributes are serialized in the order they appear in the dictionary (sorted)
 * - Empty elements are serialized as self-closing tags (`<br/>`) when selfClosingTags is true
 * - Mixed content (text and elements) avoids extra newlines for simple text-only content
 * - Indentation is applied recursively to nested elements
 * - XML declaration includes `version="1.0"` and `encoding="UTF-8"` when enabled
 */
export const xml_serialize = East.platform("xml_serialize", [XmlNode, XmlSerializeConfig], BlobType);

/**
 * Node.js implementation of XML platform functions.
 *
 * Pass this array to {@link East.compile} to enable XML operations.
 */
const XmlImpl: PlatformFunction[] = [
    xml_parse.implement((blob: Uint8Array, config: ValueTypeOf<typeof XmlParseConfig>) => {
        try {
            return parseXml(blob, config);
        } catch (err: any) {
            if (err instanceof EastError) throw err;
            throw new EastError(`XML parsing failed: ${err.message}`, {
                location: [{ filename: "xml_parse", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    xml_serialize.implement((node: XmlNodeValue, config: ValueTypeOf<typeof XmlSerializeConfig>) => {
        try {
            return serializeXml(node, config);
        } catch (err: any) {
            if (err instanceof EastError) throw err;
            throw new EastError(`XML serialization failed: ${err.message}`, {
                location: [{ filename: "xml_serialize", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
];

/**
 * Grouped XML platform functions.
 *
 * Provides XML parsing and serialization operations for East programs.
 *
 * @example
 * ```ts
 * import { East, BlobType } from "@elaraai/east";
 * import { XML, XmlParseConfig, XmlNode } from "@elaraai/east-node-std";
 *
 * const parseXML = East.function([BlobType], XmlNode, ($, xmlBlob) => {
 *     const config = $.const(East.value({
 *         preserveWhitespace: false,
 *         decodeEntities: true,
 *     }, XmlParseConfig));
 *
 *     return XML.parse(xmlBlob, config);
 * });
 *
 * const compiled = East.compile(parseXML.toIR(), XML.Implementation);
 * const xmlData = new TextEncoder().encode("<book id='123'><title>East Guide</title></book>");
 * compiled(xmlData);  // Returns parsed XML tree
 * ```
 */
export const XML = {
    /**
     * Parses XML data from a binary blob into a recursive tree structure.
     *
     * Converts XML-formatted binary data into an XmlNode recursive structure.
     * Supports XML declarations, namespaces, CDATA, entity decoding, and comments.
     *
     * @param blob - The XML data as a binary blob (UTF-8 encoded)
     * @param config - Parsing configuration
     * @returns An XmlNode representing the root element
     * @throws {EastError} When XML is malformed
     *
     * @example
     * ```ts
     * const parseXML = East.function([BlobType], XmlNode, ($, xmlBlob) => {
     *     const config = $.const(East.value({
     *         preserveWhitespace: false,
     *         decodeEntities: true,
     *     }, XmlParseConfig));
     *
     *     return XML.parse(xmlBlob, config);
     * });
     *
     * const compiled = East.compile(parseXML.toIR(), XML.Implementation);
     * const xmlData = new TextEncoder().encode("<book><title>East</title></book>");
     * compiled(xmlData);  // Returns: { tag: "book", attributes: Map{}, children: [...] }
     * ```
     */
    parse: xml_parse,

    /**
     * Serializes a recursive XML tree structure into XML-formatted binary data.
     *
     * Converts an XmlNode recursive structure into XML-formatted binary data.
     * Supports indentation, XML declarations, entity encoding, and self-closing tags.
     *
     * @param node - The XmlNode root element to serialize
     * @param config - Serialization configuration
     * @returns A binary blob containing the XML-formatted data
     *
     * @example
     * ```ts
     * const serializeXML = East.function([XmlNode], BlobType, ($, doc) => {
     *     const config = $.const(East.value({
     *         indent: variant('some', "  "),
     *         includeXmlDeclaration: true,
     *         encodeEntities: true,
     *         selfClosingTags: true,
     *     }, XmlSerializeConfig));
     *
     *     return XML.serialize(doc, config);
     * });
     *
     * const compiled = East.compile(serializeXML.toIR(), XML.Implementation);
     * const xmlNode = { tag: "book", attributes: new Map(), children: [] };
     * compiled(xmlNode);  // Returns blob: "<?xml version=\"1.0\"?>\n<book/>"
     * ```
     */
    serialize: xml_serialize,

    /**
     * Node.js implementation of XML platform functions.
     *
     * Pass this to {@link East.compile} to enable XML operations.
     */
    Implementation: XmlImpl,

    /**
     * Type definitions for XML operations.
     */
    Types: {
        /**
         * XML parsing configuration type.
         */
        ParseConfig: XmlParseConfig,

        /**
         * XML serialization configuration type.
         */
        SerializeConfig: XmlSerializeConfig,

        /**
         * XML node recursive type (element with tag, attributes, and children).
         */
        Node: XmlNode,
    },
} as const;

// Export for backwards compatibility
export { XmlImpl };

// Helper Functions

function parseXml(
    blob: Uint8Array,
    config: ValueTypeOf<typeof XmlParseConfig>
): XmlNodeValue {
    const decoder = new TextDecoder();
    let xml = decoder.decode(blob);

    // Skip UTF-8 BOM if present
    if (xml.charCodeAt(0) === 0xFEFF) {
        xml = xml.substring(1);
    }

    const { preserveWhitespace, decodeEntities } = config;

    let pos = 0;
    let line = 1n;
    let column = 1n;

    // Helper: advance position tracking
    const advance = (count: number = 1) => {
        for (let i = 0; i < count; i++) {
            if (xml[pos + i] === '\n') {
                line++;
                column = 1n;
            } else {
                column++;
            }
        }
        pos += count;
    };

    // Helper: skip whitespace
    const skipWhitespace = () => {
        while (pos < xml.length && /\s/.test(xml[pos]!)) {
            advance();
        }
    };

    // Helper: decode XML entities
    const decodeXmlEntities = (text: string): string => {
        if (!decodeEntities) return text;

        return text
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
            .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    };

    // Helper: parse element
    const parseElement = (): XmlNodeValue => {
        // Expect '<'
        if (xml[pos] !== '<') {
            throw new EastError(`Expected '<' at line ${line}, column ${column}`, {
                location: [{ filename: "xml_parse", line, column }]
            });
        }
        advance(); // skip '<'

        // Parse tag name
        const tagStart = pos;
        while (pos < xml.length && /[a-zA-Z0-9:_-]/.test(xml[pos]!)) {
            advance();
        }
        const tag = xml.substring(tagStart, pos);

        if (tag.length === 0) {
            throw new EastError(`Invalid tag name at line ${line}, column ${column}`, {
                location: [{ filename: "xml_parse", line, column }]
            });
        }

        // Parse attributes
        const attributes = new SortedMap<string, string>();

        while (pos < xml.length) {
            skipWhitespace();

            // Check for end of opening tag
            if (xml[pos] === '>' || (xml[pos] === '/' && xml[pos + 1] === '>')) {
                break;
            }

            // Parse attribute name
            const attrNameStart = pos;
            while (pos < xml.length && /[a-zA-Z0-9:_-]/.test(xml[pos]!)) {
                advance();
            }
            const attrName = xml.substring(attrNameStart, pos);

            if (attrName.length === 0) {
                throw new EastError(`Invalid attribute name at line ${line}, column ${column}`, {
                    location: [{ filename: "xml_parse", line, column }]
                });
            }

            skipWhitespace();

            // Expect '='
            if (xml[pos] !== '=') {
                throw new EastError(`Expected '=' after attribute name at line ${line}, column ${column}`, {
                    location: [{ filename: "xml_parse", line, column }]
                });
            }
            advance(); // skip '='

            skipWhitespace();

            // Parse attribute value
            const quote = xml[pos];
            if (quote !== '"' && quote !== "'") {
                throw new EastError(`Expected quote for attribute value at line ${line}, column ${column}`, {
                    location: [{ filename: "xml_parse", line, column }]
                });
            }
            advance(); // skip opening quote

            const valueStart = pos;
            while (pos < xml.length && xml[pos] !== quote) {
                advance();
            }

            if (pos >= xml.length) {
                throw new EastError(`Unclosed attribute value at line ${line}, column ${column}`, {
                    location: [{ filename: "xml_parse", line, column }]
                });
            }

            const attrValue = decodeXmlEntities(xml.substring(valueStart, pos));
            advance(); // skip closing quote

            attributes.set(attrName, attrValue);
        }

        // Check for self-closing tag
        if (xml[pos] === '/' && xml[pos + 1] === '>') {
            advance(2); // skip '/>'
            return {
                tag,
                attributes,
                children: [],
            };
        }

        // Expect '>'
        if (xml[pos] !== '>') {
            throw new EastError(`Expected '>' at line ${line}, column ${column}`, {
                location: [{ filename: "xml_parse", line, column }]
            });
        }
        advance(); // skip '>'

        // Parse children
        const children: any[] = [];

        while (pos < xml.length) {
            // Check for closing tag
            if (xml[pos] === '<' && xml[pos + 1] === '/') {
                advance(2); // skip '</'

                // Parse closing tag name
                const closeTagStart = pos;
                while (pos < xml.length && /[a-zA-Z0-9:_-]/.test(xml[pos]!)) {
                    advance();
                }
                const closeTag = xml.substring(closeTagStart, pos);

                if (closeTag !== tag) {
                    throw new EastError(`Mismatched closing tag: expected '</${tag}>', found '</${closeTag}>' at line ${line}, column ${column}`, {
                        location: [{ filename: "xml_parse", line, column }]
                    });
                }

                skipWhitespace();

                if (xml[pos] !== '>') {
                    throw new EastError(`Expected '>' in closing tag at line ${line}, column ${column}`, {
                        location: [{ filename: "xml_parse", line, column }]
                    });
                }
                advance(); // skip '>'

                break;
            }
            // Check for CDATA section
            else if (xml.substring(pos, pos + 9) === '<![CDATA[') {
                advance(9); // skip '<![CDATA['

                const cdataStart = pos;
                while (pos < xml.length && xml.substring(pos, pos + 3) !== ']]>') {
                    advance();
                }

                if (pos >= xml.length) {
                    throw new EastError(`Unclosed CDATA section at line ${line}, column ${column}`, {
                        location: [{ filename: "xml_parse", line, column }]
                    });
                }

                let cdataText = xml.substring(cdataStart, pos);
                advance(3); // skip ']]>'

                // CDATA content is preserved as-is, no entity decoding
                // But whitespace trimming still applies based on config
                if (!preserveWhitespace) {
                    cdataText = cdataText.trim();
                }

                if (cdataText.length > 0) {
                    children.push(variant('TEXT', cdataText));
                }
            }
            // Check for comment
            else if (xml.substring(pos, pos + 4) === '<!--') {
                advance(4); // skip '<!--'

                while (pos < xml.length && xml.substring(pos, pos + 3) !== '-->') {
                    advance();
                }

                if (pos >= xml.length) {
                    throw new EastError(`Unclosed comment at line ${line}, column ${column}`, {
                        location: [{ filename: "xml_parse", line, column }]
                    });
                }

                advance(3); // skip '-->'
                // Comments are ignored by default
            }
            // Check for nested element
            else if (xml[pos] === '<') {
                const childElement = parseElement();
                children.push(variant('ELEMENT', childElement));
            }
            // Parse text content
            else {
                const textStart = pos;
                while (pos < xml.length && xml[pos] !== '<') {
                    advance();
                }

                let text = xml.substring(textStart, pos);

                if (!preserveWhitespace) {
                    text = text.trim();
                }

                if (text.length > 0) {
                    text = decodeXmlEntities(text);
                    children.push(variant('TEXT', text));
                }
            }
        }

        return {
            tag,
            attributes,
            children,
        };
    };

    // Skip XML declaration and processing instructions
    while (pos < xml.length) {
        skipWhitespace();

        if (xml.substring(pos, pos + 2) === '<?') {
            // Skip processing instruction
            while (pos < xml.length && xml.substring(pos, pos + 2) !== '?>') {
                advance();
            }
            if (pos < xml.length) {
                advance(2); // skip '?>'
            }
        } else if (xml.substring(pos, pos + 4) === '<!--') {
            // Skip comment
            advance(4);
            while (pos < xml.length && xml.substring(pos, pos + 3) !== '-->') {
                advance();
            }
            if (pos < xml.length) {
                advance(3); // skip '-->'
            }
        } else {
            break;
        }
    }

    skipWhitespace();

    if (pos >= xml.length) {
        throw new EastError('Empty XML document', {
            location: [{ filename: "xml_parse", line: 1n, column: 1n }]
        });
    }

    return parseElement();
}

function serializeXml(
    node: XmlNodeValue,
    config: ValueTypeOf<typeof XmlSerializeConfig>
): Uint8Array {
    const { indent, includeXmlDeclaration, encodeEntities, selfClosingTags } = config;
    const indentStr = indent.type === 'some' ? indent.value : '';
    const useIndent = indentStr.length > 0;

    // Helper: encode XML entities
    const encodeXmlEntities = (text: string): string => {
        if (!encodeEntities) return text;

        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    };

    // Helper: serialize element recursively
    const serializeElement = (node: XmlNodeValue, depth: number): string => {
        const currentIndent = useIndent ? indentStr.repeat(depth) : '';
        const nextIndent = useIndent ? indentStr.repeat(depth + 1) : '';

        let result = currentIndent + '<' + node.tag;

        // Serialize attributes (Dict keys are sorted alphabetically)
        const attrs = Array.from(node.attributes.entries());
        for (const [name, value] of attrs) {
            result += ' ' + name + '="' + encodeXmlEntities(value) + '"';
        }

        // Check if element has children
        if (node.children.length === 0) {
            if (selfClosingTags) {
                result += '/>';
            } else {
                result += '></' + node.tag + '>';
            }
            return result;
        }

        result += '>';

        // Check if children are all text (avoid extra newlines for simple text content)
        const allText = node.children.every(child => child.type === 'TEXT');

        if (!allText && useIndent) {
            result += '\n';
        }

        // Serialize children
        for (const child of node.children) {
            if (child.type === 'TEXT') {
                const text = encodeXmlEntities(child.value);
                if (allText) {
                    result += text;
                } else if (useIndent) {
                    result += nextIndent + text + '\n';
                } else {
                    result += text;
                }
            } else {
                // ELEMENT
                result += serializeElement(child.value, depth + 1);
                if (useIndent) {
                    result += '\n';
                }
            }
        }

        if (!allText && useIndent) {
            result += currentIndent;
        }

        result += '</' + node.tag + '>';

        return result;
    };

    let xml = '';

    if (includeXmlDeclaration) {
        xml += '<?xml version="1.0" encoding="UTF-8"?>\n';
    }

    xml += serializeElement(node, 0);

    return new TextEncoder().encode(xml);
}
