#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""XML parsing and serialization platform functions for East.

The ``*_impl`` functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip.
"""

import re

from east.runtime.platform import platform_function, platform_functions
from east.types.types import BlobType, StringType, VariantType
from east.types.values import EastArray, EastBlob, EastDict, EastStruct, EastVariant

from .types import XmlNodeType, XmlParseConfigType, XmlSerializeConfigType


def parse_xml(xml: str, preserve_whitespace: bool, decode_entities: bool) -> EastStruct:
    """Parse an XML string into an ``XmlNodeType`` structure."""
    # Skip UTF-8 BOM if present
    if xml and ord(xml[0]) == 0xFEFF:
        xml = xml[1:]

    pos = 0
    length = len(xml)

    def advance(count: int = 1) -> None:
        nonlocal pos
        pos += count

    def skip_whitespace() -> None:
        nonlocal pos
        while pos < length and xml[pos] in " \t\n\r":
            pos += 1

    def decode_xml_entities(text: str) -> str:
        if not decode_entities:
            return text
        text = text.replace("&lt;", "<")
        text = text.replace("&gt;", ">")
        text = text.replace("&amp;", "&")
        text = text.replace("&quot;", '"')
        text = text.replace("&apos;", "'")
        text = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), text)
        text = re.sub(r"&#x([0-9a-fA-F]+);", lambda m: chr(int(m.group(1), 16)), text)
        return text

    def parse_element() -> EastStruct:
        nonlocal pos

        if pos >= length or xml[pos] != "<":
            raise Exception(f"Expected '<' at position {pos}")
        advance()

        tag_start = pos
        while pos < length and re.match(r"[a-zA-Z0-9:_-]", xml[pos]):
            advance()
        tag = xml[tag_start:pos]

        if not tag:
            raise Exception(f"Invalid tag name at position {pos}")

        attributes: EastDict = EastDict(StringType, StringType)

        while pos < length:
            skip_whitespace()

            if pos < length and xml[pos] == ">":
                break
            if pos + 1 < length and xml[pos : pos + 2] == "/>":
                break

            attr_name_start = pos
            while pos < length and re.match(r"[a-zA-Z0-9:_-]", xml[pos]):
                advance()
            attr_name = xml[attr_name_start:pos]

            if not attr_name:
                raise Exception(f"Invalid attribute name at position {pos}")

            skip_whitespace()

            if pos >= length or xml[pos] != "=":
                raise Exception(f"Expected '=' after attribute name at position {pos}")
            advance()

            skip_whitespace()

            if pos >= length or xml[pos] not in "\"'":
                raise Exception(f"Expected quote for attribute value at position {pos}")

            quote = xml[pos]
            advance()

            value_start = pos
            while pos < length and xml[pos] != quote:
                advance()

            if pos >= length:
                raise Exception(f"Unclosed attribute value at position {pos}")

            attr_value = decode_xml_entities(xml[value_start:pos])
            advance()

            attributes[attr_name] = attr_value

        if pos + 1 < length and xml[pos : pos + 2] == "/>":
            advance(2)
            return EastStruct(
                {
                    "tag": tag,
                    "attributes": attributes,
                    "children": EastArray(
                        VariantType([("TEXT", StringType), ("ELEMENT", XmlNodeType)]), []
                    ),
                }
            )

        if pos >= length or xml[pos] != ">":
            raise Exception(f"Expected '>' at position {pos}")
        advance()

        children: EastArray = EastArray(
            VariantType([("TEXT", StringType), ("ELEMENT", XmlNodeType)]), []
        )

        while pos < length:
            if pos + 1 < length and xml[pos : pos + 2] == "</":
                advance(2)

                close_tag_start = pos
                while pos < length and re.match(r"[a-zA-Z0-9:_-]", xml[pos]):
                    advance()
                close_tag = xml[close_tag_start:pos]

                if close_tag != tag:
                    raise Exception(
                        f"Mismatched closing tag: expected '</{tag}>', "
                        f"found '</{close_tag}>' at position {pos}"
                    )

                skip_whitespace()

                if pos >= length or xml[pos] != ">":
                    raise Exception(f"Expected '>' in closing tag at position {pos}")
                advance()

                break

            if pos + 8 < length and xml[pos : pos + 9] == "<![CDATA[":
                advance(9)

                cdata_start = pos
                while pos + 2 < length and xml[pos : pos + 3] != "]]>":
                    advance()

                if pos + 2 >= length:
                    raise Exception(f"Unclosed CDATA section at position {pos}")

                cdata_text = xml[cdata_start:pos]
                advance(3)

                if not preserve_whitespace:
                    cdata_text = cdata_text.strip()

                if cdata_text:
                    children.append(EastVariant("TEXT", cdata_text))

            elif pos + 3 < length and xml[pos : pos + 4] == "<!--":
                advance(4)

                while pos + 2 < length and xml[pos : pos + 3] != "-->":
                    advance()

                if pos + 2 >= length:
                    raise Exception(f"Unclosed comment at position {pos}")

                advance(3)

            elif pos < length and xml[pos] == "<":
                child_element = parse_element()
                children.append(EastVariant("ELEMENT", child_element))

            else:
                text_start = pos
                while pos < length and xml[pos] != "<":
                    advance()

                text = xml[text_start:pos]

                if not preserve_whitespace:
                    text = text.strip()

                if text:
                    text = decode_xml_entities(text)
                    children.append(EastVariant("TEXT", text))

        return EastStruct(
            {
                "tag": tag,
                "attributes": attributes,
                "children": children,
            }
        )

    while pos < length:
        skip_whitespace()

        if pos + 1 < length and xml[pos : pos + 2] == "<?":
            while pos + 1 < length and xml[pos : pos + 2] != "?>":
                advance()
            if pos + 1 < length:
                advance(2)
        elif pos + 3 < length and xml[pos : pos + 4] == "<!--":
            advance(4)
            while pos + 2 < length and xml[pos : pos + 3] != "-->":
                advance()
            if pos + 2 < length:
                advance(3)
        else:
            break

    skip_whitespace()

    if pos >= length:
        raise Exception("Empty XML document")

    return parse_element()


def serialize_xml(node: EastStruct, config: EastStruct) -> str:
    """Serialize an ``XmlNodeType`` structure to an XML string."""
    indent_opt = config["indent"]
    indent_str = indent_opt.value if indent_opt.type == "some" else ""
    use_indent = len(indent_str) > 0

    include_declaration = config["includeXmlDeclaration"]
    encode_entities = config["encodeEntities"]
    self_closing = config["selfClosingTags"]

    def encode_xml_entities(text: str) -> str:
        if not encode_entities:
            return text
        text = text.replace("&", "&amp;")
        text = text.replace("<", "&lt;")
        text = text.replace(">", "&gt;")
        text = text.replace('"', "&quot;")
        text = text.replace("'", "&apos;")
        return text

    def serialize_element(node: EastStruct, depth: int) -> str:
        current_indent = indent_str * depth if use_indent else ""
        next_indent = indent_str * (depth + 1) if use_indent else ""

        result = current_indent + "<" + node["tag"]

        for name, value in node["attributes"].items():
            result += f' {name}="{encode_xml_entities(value)}"'

        children = node["children"]

        if len(children) == 0:
            if self_closing:
                result += "/>"
            else:
                result += "></" + node["tag"] + ">"
            return result

        result += ">"

        all_text = all(child.type == "TEXT" for child in children)

        if not all_text and use_indent:
            result += "\n"

        for child in children:
            if child.type == "TEXT":
                text = encode_xml_entities(child.value)
                if all_text:
                    result += text
                elif use_indent:
                    result += next_indent + text + "\n"
                else:
                    result += text
            else:
                result += serialize_element(child.value, depth + 1)
                if use_indent:
                    result += "\n"

        if not all_text and use_indent:
            result += current_indent

        result += "</" + node["tag"] + ">"

        return result

    xml = ""

    if include_declaration:
        xml += '<?xml version="1.0" encoding="UTF-8"?>\n'

    xml += serialize_element(node, 0)

    return xml


@platform_function(
    name="xml_parse",
    inputs=[BlobType, XmlParseConfigType],
    output=XmlNodeType,
)
def xml_parse_impl(blob: EastBlob, config: EastStruct) -> EastStruct:
    """Parse an XML document from a UTF-8 binary blob.

    The parser handles element nesting, attributes, CDATA sections, and
    text nodes. Processing instructions and comments are discarded.

    Args:
        blob: ``Blob`` (``EastBlob``) - UTF-8 encoded XML bytes (a
            leading UTF-8 BOM is stripped automatically).
        config: ``XmlParseConfigType`` (``EastStruct``) with fields:

            - ``preserveWhitespace`` (``Boolean``): when ``False``,
              text content is stripped of leading/trailing whitespace
              and empty text nodes are dropped.
            - ``decodeEntities`` (``Boolean``): when ``True``, standard
              XML entities (``&lt;``, ``&gt;``, ``&amp;``, ``&quot;``,
              ``&apos;``) and numeric character references are decoded
              in text and attribute values.

    Returns:
        ``XmlNodeType`` (``EastStruct``): the root element with
        ``tag`` (``String``), ``attributes`` (``Dict<String, String>``),
        and ``children``
        (``Array<Variant<TEXT: String, ELEMENT: XmlNodeType>>``).

    Raises:
        RuntimeError: ``blob`` is not valid UTF-8, the XML is
            malformed (mismatched tags, unclosed sections, empty
            document), or parsing fails for any other reason.
    """
    try:
        xml_str = bytes(blob).decode("utf-8")
        preserve_whitespace = config["preserveWhitespace"]
        decode_entities = config["decodeEntities"]
        return parse_xml(xml_str, preserve_whitespace, decode_entities)
    except Exception as e:
        raise Exception(f"XML parse failed: {e}") from e


@platform_function(
    name="xml_serialize",
    inputs=[XmlNodeType, XmlSerializeConfigType],
    output=BlobType,
)
def xml_serialize_impl(node: EastStruct, config: EastStruct) -> EastBlob:
    """Serialize an ``XmlNodeType`` element tree to a UTF-8 binary blob.

    Args:
        node: ``XmlNodeType`` (``EastStruct``) - the root element to
            serialize; see ``XmlNodeType`` for structure.
        config: ``XmlSerializeConfigType`` (``EastStruct``) with fields:

            - ``indent`` (``Option<String>``): indent string per depth
              level (e.g. ``"  "``); no indentation when absent or empty.
            - ``includeXmlDeclaration`` (``Boolean``): prepend
              ``<?xml version="1.0" encoding="UTF-8"?>\\n``.
            - ``encodeEntities`` (``Boolean``): encode ``<``, ``>``,
              ``&``, ``"``, ``'`` in text content and attribute values.
            - ``selfClosingTags`` (``Boolean``): write empty elements as
              ``<tag/>`` rather than ``<tag></tag>``.

    Returns:
        ``Blob`` (``EastBlob``) - the UTF-8 encoded XML bytes.

    Raises:
        RuntimeError: serialization fails.
    """
    try:
        xml_str = serialize_xml(node, config)
        return EastBlob(xml_str.encode("utf-8"))
    except Exception as e:
        raise Exception(f"XML serialize failed: {e}") from e


# Collected from the @platform_function decorations above.
xml_impl = platform_functions(__name__)

__all__ = [
    "xml_impl",
    "xml_parse_impl",
    "xml_serialize_impl",
]
