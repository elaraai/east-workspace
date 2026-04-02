#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""XML platform functions for East.

Provides XML parsing and serialization for East programs.
"""

import re

from east.runtime.platform import PlatformFunction
from east.types.types import BlobType, StringType, VariantType
from east.types.values import EastArray, EastBlob, EastDict, EastStruct, EastVariant

from .types import XmlNodeType, XmlParseConfigType, XmlSerializeConfigType


def parse_xml(xml: str, preserve_whitespace: bool, decode_entities: bool) -> EastStruct:
    """Parse XML string into XmlNode structure."""
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
        # Decode numeric entities
        text = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), text)
        text = re.sub(r"&#x([0-9a-fA-F]+);", lambda m: chr(int(m.group(1), 16)), text)
        return text

    def parse_element() -> EastStruct:
        nonlocal pos

        # Expect '<'
        if pos >= length or xml[pos] != "<":
            raise Exception(f"Expected '<' at position {pos}")
        advance()

        # Parse tag name
        tag_start = pos
        while pos < length and re.match(r"[a-zA-Z0-9:_-]", xml[pos]):
            advance()
        tag = xml[tag_start:pos]

        if not tag:
            raise Exception(f"Invalid tag name at position {pos}")

        # Parse attributes
        attributes: EastDict = EastDict(StringType, StringType)

        while pos < length:
            skip_whitespace()

            # Check for end of opening tag
            if pos < length and xml[pos] == ">":
                break
            if pos + 1 < length and xml[pos : pos + 2] == "/>":
                break

            # Parse attribute name
            attr_name_start = pos
            while pos < length and re.match(r"[a-zA-Z0-9:_-]", xml[pos]):
                advance()
            attr_name = xml[attr_name_start:pos]

            if not attr_name:
                raise Exception(f"Invalid attribute name at position {pos}")

            skip_whitespace()

            # Expect '='
            if pos >= length or xml[pos] != "=":
                raise Exception(f"Expected '=' after attribute name at position {pos}")
            advance()

            skip_whitespace()

            # Parse attribute value
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
            advance()  # skip closing quote

            attributes[attr_name] = attr_value

        # Check for self-closing tag
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

        # Expect '>'
        if pos >= length or xml[pos] != ">":
            raise Exception(f"Expected '>' at position {pos}")
        advance()

        # Parse children
        children: EastArray = EastArray(
            VariantType([("TEXT", StringType), ("ELEMENT", XmlNodeType)]), []
        )

        while pos < length:
            # Check for closing tag
            if pos + 1 < length and xml[pos : pos + 2] == "</":
                advance(2)

                # Parse closing tag name
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

            # Check for CDATA section
            if pos + 8 < length and xml[pos : pos + 9] == "<![CDATA[":
                advance(9)

                cdata_start = pos
                while pos + 2 < length and xml[pos : pos + 3] != "]]>":
                    advance()

                if pos + 2 >= length:
                    raise Exception(f"Unclosed CDATA section at position {pos}")

                cdata_text = xml[cdata_start:pos]
                advance(3)  # skip ']]>'

                if not preserve_whitespace:
                    cdata_text = cdata_text.strip()

                if cdata_text:
                    children.append(EastVariant("TEXT", cdata_text))

            # Check for comment
            elif pos + 3 < length and xml[pos : pos + 4] == "<!--":
                advance(4)

                while pos + 2 < length and xml[pos : pos + 3] != "-->":
                    advance()

                if pos + 2 >= length:
                    raise Exception(f"Unclosed comment at position {pos}")

                advance(3)  # skip '-->'
                # Comments are ignored

            # Check for nested element
            elif pos < length and xml[pos] == "<":
                child_element = parse_element()
                children.append(EastVariant("ELEMENT", child_element))

            # Parse text content
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

    # Skip XML declaration and processing instructions
    while pos < length:
        skip_whitespace()

        if pos + 1 < length and xml[pos : pos + 2] == "<?":
            # Skip processing instruction
            while pos + 1 < length and xml[pos : pos + 2] != "?>":
                advance()
            if pos + 1 < length:
                advance(2)
        elif pos + 3 < length and xml[pos : pos + 4] == "<!--":
            # Skip comment
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
    """Serialize XmlNode structure to XML string."""
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

        # Serialize attributes
        for name, value in node["attributes"].items():
            result += f' {name}="{encode_xml_entities(value)}"'

        children = node["children"]

        # Check if element has children
        if len(children) == 0:
            if self_closing:
                result += "/>"
            else:
                result += "></" + node["tag"] + ">"
            return result

        result += ">"

        # Check if children are all text
        all_text = all(child.type == "TEXT" for child in children)

        if not all_text and use_indent:
            result += "\n"

        # Serialize children
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
                # ELEMENT
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


def xml_parse_impl(blob: EastBlob, config: EastStruct) -> EastStruct:
    """Parse XML data from a binary blob."""
    try:
        xml_str = bytes(blob).decode("utf-8")
        preserve_whitespace = config["preserveWhitespace"]
        decode_entities = config["decodeEntities"]
        return parse_xml(xml_str, preserve_whitespace, decode_entities)
    except Exception as e:
        raise Exception(f"XML parse failed: {e}") from e


def xml_serialize_impl(node: EastStruct, config: EastStruct) -> EastBlob:
    """Serialize XML node to bytes."""
    try:
        xml_str = serialize_xml(node, config)
        return EastBlob(xml_str.encode("utf-8"))
    except Exception as e:
        raise Exception(f"XML serialize failed: {e}") from e


# Platform function implementations
xml_impl = [
    PlatformFunction(
        name="xml_parse",
        inputs=[BlobType, XmlParseConfigType],
        output=XmlNodeType,
        type="sync",
        fn=xml_parse_impl,
    ),
    PlatformFunction(
        name="xml_serialize",
        inputs=[XmlNodeType, XmlSerializeConfigType],
        output=BlobType,
        type="sync",
        fn=xml_serialize_impl,
    ),
]

__all__ = [
    "xml_impl",
    "xml_parse_impl",
    "xml_serialize_impl",
]
