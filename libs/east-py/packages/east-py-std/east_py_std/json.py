#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Reading JSON documents that do not fit in memory.

The ingest half of the contract boundary: ``json_schema_for(T)`` publishes what
a producer must send, and these read it back under exactly that contract. One
element is in flight at a time, whatever the document's size, so the natural
home is an ``e3.streamTask`` producer that emits as it reads.
"""

import uuid
from collections.abc import Callable
from typing import Any

from east.runtime.platform import (
    generic_platform_function,
    platform_function,
    platform_functions,
)

# The reader itself is east-c's, reached through east-py's Cython bridge — the
# same arrangement every other codec here uses. east-py-std stays pure python
# and holds only the handle table.
from east.serialization.json_reader import JsonReader
from east.types.types import BooleanType, EastType, NullType, StringType

# Open readers, keyed by the opaque handle an East program carries.
_readers: dict[str, JsonReader] = {}


def _hold(reader: JsonReader) -> str:
    handle = str(uuid.uuid4())
    _readers[handle] = reader
    return handle


def _get(handle: str, fn: str) -> JsonReader:
    reader = _readers.get(handle)
    if reader is None:
        raise RuntimeError(f"{fn}: no open JSON reader for this handle")
    return reader


@platform_function(name="json_open", inputs=[StringType, StringType], output=StringType)
def json_open(path: str, pointer: str) -> str:
    """Open a JSON file and position a reader on the container to iterate.

    Args:
        path: ``String`` (``str``) - the file to read.
        pointer: ``String`` (``str``) - RFC 6901 pointer to the container,
            ``""`` for the whole document.

    Returns:
        ``String`` (``str``) - an opaque handle.

    Raises:
        RuntimeError: If the file cannot be opened, the pointer does not
            resolve, or the node it names is not an array or object.
    """
    try:
        return _hold(JsonReader.open_file(path, pointer))
    except OSError as err:
        raise RuntimeError(f"json_open: {err}") from err
    except Exception as err:
        raise RuntimeError(f"json_open: {err}") from err


@platform_function(name="json_open_text", inputs=[StringType, StringType], output=StringType)
def json_open_text(text: str, pointer: str) -> str:
    """Open an in-memory JSON payload, as :func:`json_open` opens a file.

    Args:
        text: ``String`` (``str``) - the document.
        pointer: ``String`` (``str``) - RFC 6901 pointer to the container.

    Returns:
        ``String`` (``str``) - an opaque handle.

    Raises:
        RuntimeError: If the pointer does not resolve, or the node it names is
            not an array or object.
    """
    try:
        return _hold(JsonReader.open_text(text, pointer))
    except Exception as err:
        raise RuntimeError(f"json_open_text: {err}") from err


@platform_function(name="json_more", inputs=[StringType], output=BooleanType)
def json_more(handle: str) -> bool:
    """Whether the container being iterated has another element.

    A predicate, not an advance: :func:`json_next` moves the cursor, so the two
    need not alternate and asking twice is harmless.

    Args:
        handle: ``String`` (``str``) - a handle from :func:`json_open`.

    Returns:
        ``Boolean`` (``bool``) - ``True`` while elements remain.

    Raises:
        RuntimeError: If the handle is not open, or the document is malformed.
    """
    try:
        return _get(handle, "json_more").more()
    except RuntimeError:
        raise
    except Exception as err:
        raise RuntimeError(f"json_more: {err}") from err


@generic_platform_function(
    type_parameters=["T"], name="json_next", inputs=[StringType], output="T"
)
def json_next(_platform_list: Any, T: EastType) -> Callable[[str], Any]:  # noqa: N803
    """Read the next element of the container as ``T``.

    Strict: it accepts exactly what ``json_schema_for(T)`` describes, which is
    what the ENCODER emits rather than what the historic decoder tolerated. An
    integer must be a quoted decimal in i64 range — not ``"0x10"``, not
    ``" 7 "``, not ``"007"``; a timestamp must carry an explicit ``+00:00``,
    not ``Z`` and not a numeric offset; a blob's hex must be lowercase.

    When the container is a JSON object, ``T`` must be a ``Struct`` of exactly
    ``key`` and ``value``, and each member arrives as one of those — which is
    what a ``Dict`` output needs.

    Args:
        _platform_list: The platform list being registered (unused).
        T: ``EastType`` - the element type.

    Returns:
        ``read(handle)`` - takes ``String`` (``str``) and returns the decoded
        element of type ``T``.

    Raises:
        RuntimeError: From ``read(handle)`` when the element does not satisfy
            ``T``, naming the RFC 6901 pointer of the offending node.
    """

    def read(handle: str) -> Any:
        try:
            return _get(handle, "json_next").next(T)
        except RuntimeError:
            raise
        except Exception as err:
            raise RuntimeError(f"json_next: {err}") from err

    return read


@generic_platform_function(
    type_parameters=["T"], name="json_value", inputs=[StringType, StringType], output="T"
)
def json_value(_platform_list: Any, T: EastType) -> Callable[[str, str], Any]:  # noqa: N803
    """Read one whole value from a file, without iterating.

    For the small parts of a document whose large parts are streamed — an
    envelope's metadata beside a ten-million-row array. Everything outside the
    pointer is skipped rather than constructed.

    Args:
        _platform_list: The platform list being registered (unused).
        T: ``EastType`` - the value's type.

    Returns:
        ``read(path, pointer)`` - takes two ``String`` (``str``) values and
        returns the decoded value of type ``T``.

    Raises:
        RuntimeError: From ``read(path, pointer)`` when the file cannot be
            read, the pointer does not resolve, or the value does not satisfy
            ``T``.
    """

    def read(path: str, pointer: str) -> Any:
        try:
            reader = JsonReader.open_value_file(path, pointer)
        except Exception as err:
            raise RuntimeError(f"json_value: {err}") from err
        try:
            return reader.read_value(T)
        except Exception as err:
            raise RuntimeError(f"json_value: {err}") from err
        finally:
            reader.close()

    return read


@platform_function(name="json_close", inputs=[StringType], output=NullType)
def json_close(handle: str) -> None:
    """Close a reader and release the file it holds.

    Handles are held until closed, as a database connection is.

    Args:
        handle: ``String`` (``str``) - a handle from :func:`json_open`.

    Returns:
        ``Null`` (``None``).

    Raises:
        RuntimeError: If the handle is not open.
    """
    reader = _readers.get(handle)
    if reader is None:
        raise RuntimeError("json_close: no open JSON reader for this handle")
    del _readers[handle]
    reader.close()


# Collected from the @platform_function / @generic_platform_function decorations above.
json_impl = platform_functions(__name__)


__all__ = [
    "json_close",
    "json_impl",
    "json_more",
    "json_next",
    "json_open",
    "json_open_text",
    "json_value",
]
