#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""A pull reader over a JSON document — the python twin of east-node-std's.

Holds one chunk of text and the path it has descended, never the document and
never a batch. Values are constructed one at a time, directly against the East
type, so nothing intermediate is materialised either.

Strict by construction: it compiles the very patterns ``json_schema_for``
emits, so the published contract and the check on receipt are one definition.
Error text matches east-node-std's word for word — a payload rejected on one
runtime must be rejected the same way, with the same pointer, on every other.
"""

import codecs
import json
import re
from datetime import UTC, datetime
from typing import Any, NoReturn

from east.serialization.json_schema import EAST_JSON_PATTERNS
from east.types.types import EastType
from east.types.values import EastArray, EastBlob, EastDict, EastRef, EastSet, EastStruct
from east.types.values import EastVariant as EastValueVariant

# How many bytes each refill pulls from the source.
CHUNK_BYTES = 64 * 1024

# How deeply a document may nest before it is refused. JSON is an untrusted-input
# boundary, and skipping past a value recurses per level, so a document of
# nothing but brackets would otherwise exhaust the stack. The same limit east-c's
# parser applies (``JSON_MAX_DEPTH``), so every runtime refuses the same
# documents.
MAX_DEPTH = 2048

_INTEGER_RE = re.compile(EAST_JSON_PATTERNS.integer)
_DATETIME_RE = re.compile(EAST_JSON_PATTERNS.datetime)
_BLOB_RE = re.compile(EAST_JSON_PATTERNS.blob)
_FLOAT_SPECIALS = EAST_JSON_PATTERNS.float_specials

_WHITESPACE = (" ", "\t", "\n", "\r")
_DIGITS = "0123456789"


def _q(value: Any) -> str:
    """JSON-quote a value the way JavaScript's ``JSON.stringify`` does.

    ``ensure_ascii`` is off so a non-ASCII string quotes identically on both
    runtimes; the error text is part of the cross-runtime contract.
    """
    return json.dumps(value, ensure_ascii=False)


class JsonReadError(Exception):
    """A document that does not satisfy the contract, located by pointer."""

    def __init__(self, message: str, pointer: str) -> None:
        super().__init__(message if pointer == "" else f"{pointer}: {message}")
        self.pointer = pointer


def _pointer_of(path: list[str]) -> str:
    if not path:
        return ""
    return "/" + "/".join(s.replace("~", "~0").replace("/", "~1") for s in path)


def _parse_pointer(pointer: str) -> list[str]:
    """RFC 6901: ``""`` is the whole document; every other pointer starts with ``/``."""
    if pointer == "":
        return []
    if not pointer.startswith("/"):
        raise JsonReadError(
            f'a JSON Pointer must be empty or start with "/", got {_q(pointer)}', ""
        )
    return [s.replace("~1", "/").replace("~0", "~") for s in pointer[1:].split("/")]


class _Chunks:
    """A source of document text, pulled a chunk at a time."""

    def next(self) -> str | None:
        raise NotImplementedError

    def close(self) -> None:
        raise NotImplementedError


class _StringChunks(_Chunks):
    def __init__(self, text: str) -> None:
        self._text: str | None = text

    def next(self) -> str | None:
        text, self._text = self._text, None
        return text

    def close(self) -> None:
        """Nothing is held."""


class _FileChunks(_Chunks):
    def __init__(self, path: str) -> None:
        self._file = open(path, "rb")  # noqa: SIM115 — closed by close()
        self._decoder = codecs.getincrementaldecoder("utf-8")()
        self._done = False

    def next(self) -> str | None:
        if self._done:
            return None
        raw = self._file.read(CHUNK_BYTES)
        if not raw:
            self._done = True
            # Flush any bytes the decoder is holding for a split code point.
            tail = self._decoder.decode(b"", final=True)
            return tail or None
        return self._decoder.decode(raw)

    def close(self) -> None:
        self._file.close()


class JsonReader:
    """A pull reader over a JSON document."""

    def __init__(self, chunks: _Chunks) -> None:
        self._chunks = chunks
        self._buf = ""
        self._pos = 0
        self._eof = False
        self._path: list[str] = []
        self._index = 0
        self._started = False
        self._container: str | None = None
        self._depth = 0
        self._closed = False
        self._recursive: dict[int, EastType] = {}

    # ── construction ────────────────────────────────────────────────────

    @staticmethod
    def open_file(path: str, pointer: str) -> "JsonReader":
        """Open a file and descend to the container the pointer names."""
        return JsonReader._open(_FileChunks(path), pointer, enter=True)

    @staticmethod
    def open_text(text: str, pointer: str) -> "JsonReader":
        """Open an in-memory payload and descend to the container."""
        return JsonReader._open(_StringChunks(text), pointer, enter=True)

    @staticmethod
    def open_value_file(path: str, pointer: str) -> "JsonReader":
        """Open a file and stop in front of the value, for reading it whole."""
        return JsonReader._open(_FileChunks(path), pointer, enter=False)

    @staticmethod
    def open_value_text(text: str, pointer: str) -> "JsonReader":
        """Open a payload and stop in front of the value, for reading it whole."""
        return JsonReader._open(_StringChunks(text), pointer, enter=False)

    @staticmethod
    def _open(chunks: _Chunks, pointer: str, *, enter: bool) -> "JsonReader":
        reader = JsonReader(chunks)
        try:
            reader._descend(pointer, enter=enter)
        except BaseException:
            reader.close()
            raise
        return reader

    def close(self) -> None:
        """Close the reader and release the file it holds."""
        if self._closed:
            return
        self._closed = True
        self._chunks.close()

    # ── character access ────────────────────────────────────────────────

    def _fill(self) -> bool:
        while self._pos >= len(self._buf):
            if self._eof:
                return False
            chunk = self._chunks.next()
            if chunk is None:
                self._eof = True
                return False
            # Drop the consumed prefix so the buffer stays bounded.
            self._buf = self._buf[self._pos :] + chunk
            self._pos = 0
        return True

    def _peek(self) -> str | None:
        return self._buf[self._pos] if self._fill() else None

    def _ensure(self, count: int) -> bool:
        """Buffer at least ``count`` characters from the cursor, if they exist."""
        while len(self._buf) - self._pos < count:
            if self._eof:
                return False
            chunk = self._chunks.next()
            if chunk is None:
                self._eof = True
                return False
            self._buf = self._buf[self._pos :] + chunk
            self._pos = 0
        return True

    def _take(self) -> str:
        if not self._fill():
            self._fail("unexpected end of document")
        char = self._buf[self._pos]
        self._pos += 1
        return char

    def _skip_space(self) -> None:
        while True:
            char = self._peek()
            if char in _WHITESPACE:
                self._pos += 1
                continue
            return

    def _expect(self, ch: str) -> None:
        self._skip_space()
        char = self._peek()
        if char != ch:
            got = "end of document" if char is None else _q(char)
            self._fail(f"expected {_q(ch)}, got {got}")
        self._pos += 1

    def _fail(self, message: str) -> NoReturn:
        raise JsonReadError(message, _pointer_of(self._path))

    # ── tokens ──────────────────────────────────────────────────────────

    def _read_string(self) -> str:
        self._skip_space()
        self._expect('"')
        out: list[str] = []
        while True:
            char = self._take()
            if char == '"':
                return "".join(out)
            if char != "\\":
                # JSON forbids raw control characters inside a string.
                if char < " ":
                    self._fail(
                        f"unescaped control character U+{ord(char):04x} in string"
                    )
                out.append(char)
                continue
            esc = self._take()
            simple = {
                '"': '"', "\\": "\\", "/": "/", "b": "\b",
                "f": "\f", "n": "\n", "r": "\r", "t": "\t",
            }
            if esc in simple:
                out.append(simple[esc])
                continue
            if esc == "u":
                hexits = "".join(self._take() for _ in range(4))
                if not re.fullmatch(r"[0-9a-fA-F]{4}", hexits):
                    self._fail(f'invalid \\u escape "\\u{hexits}"')
                code = int(hexits, 16)
                # A high surrogate followed by an escaped low surrogate is ONE
                # astral code point. Python strings are code points, not UTF-16
                # code units, so decoding the halves separately would leave two
                # lone surrogates where east-node and east-c produce the
                # character — the same divergence east-c's parser guards.
                if 0xD800 <= code <= 0xDBFF and self._ensure(6):
                    ahead = self._buf[self._pos : self._pos + 6]
                    if (
                        ahead[0] == "\\"
                        and ahead[1] == "u"
                        and re.fullmatch(r"[0-9a-fA-F]{4}", ahead[2:])
                    ):
                        low = int(ahead[2:], 16)
                        if 0xDC00 <= low <= 0xDFFF:
                            self._pos += 6
                            code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)
                out.append(chr(code))
                continue
            self._fail(f'invalid escape "\\{esc}"')

    def _read_number(self) -> str:
        """The raw text of a JSON number, exactly as written."""
        self._skip_space()
        out: list[str] = []
        if self._peek() == "-":
            out.append(self._take())
        first = self._peek()
        if first is None or first not in _DIGITS:
            self._fail("expected a number")
        if first == "0":
            out.append(self._take())
        else:
            while (c := self._peek()) is not None and c in _DIGITS:
                out.append(self._take())
        if self._peek() == ".":
            out.append(self._take())
            if (c := self._peek()) is None or c not in _DIGITS:
                self._fail("expected a digit after the decimal point")
            while (c := self._peek()) is not None and c in _DIGITS:
                out.append(self._take())
        if self._peek() in ("e", "E"):
            out.append(self._take())
            if self._peek() in ("+", "-"):
                out.append(self._take())
            if (c := self._peek()) is None or c not in _DIGITS:
                self._fail("expected a digit in the exponent")
            while (c := self._peek()) is not None and c in _DIGITS:
                out.append(self._take())
        return "".join(out)

    def _read_literal(self, word: str) -> None:
        self._skip_space()
        for ch in word:
            if self._take() != ch:
                self._fail(f"expected {word}")

    def _skip_value(self) -> None:
        """Consume one value without constructing anything.

        Iterative on purpose. The document's nesting is untrusted, and python's
        own recursion limit is lower than ``MAX_DEPTH`` — riding the interpreter
        stack would make this runtime refuse, with a different error, documents
        that east-node and east-c accept.
        """
        stack: list[str] = []
        while True:
            self._skip_space()
            char = self._peek()
            if char is None:
                self._fail("unexpected end of document")
            descended = False
            if char == "[":
                self._pos += 1
                stack.append("[")
                if len(stack) > MAX_DEPTH:
                    self._fail(f"document nests deeper than {MAX_DEPTH}")
                self._skip_space()
                if self._peek() == "]":
                    self._pos += 1
                    stack.pop()
                else:
                    descended = True
            elif char == "{":
                self._pos += 1
                stack.append("{")
                if len(stack) > MAX_DEPTH:
                    self._fail(f"document nests deeper than {MAX_DEPTH}")
                self._skip_space()
                if self._peek() == "}":
                    self._pos += 1
                    stack.pop()
                else:
                    self._read_string()
                    self._expect(":")
                    descended = True
            elif char == '"':
                self._read_string()
            elif char == "-" or char in _DIGITS:
                self._read_number()
            elif char == "t":
                self._read_literal("true")
            elif char == "f":
                self._read_literal("false")
            elif char == "n":
                self._read_literal("null")
            else:
                self._fail(f"unexpected character {_q(char)}")

            if descended:
                # A container was opened; read its first member or element.
                continue

            # A complete value has been consumed — unwind every container it
            # finished, then read whatever follows a separator.
            need_next = False
            while stack:
                self._skip_space()
                sep = self._take()
                close = "]" if stack[-1] == "[" else "}"
                if sep == close:
                    stack.pop()
                    continue
                if sep != ",":
                    if stack[-1] == "[":
                        self._fail('expected "," or "]" in array')
                    self._fail('expected "," or "}" in object')
                if stack[-1] == "{":
                    self._read_string()
                    self._expect(":")
                need_next = True
                break
            if not need_next:
                return

    # ── navigation ──────────────────────────────────────────────────────

    def _descend(self, pointer: str, *, enter: bool) -> None:
        for segment in _parse_pointer(pointer):
            self._skip_space()
            char = self._peek()
            if char == "{":
                self._pos += 1
                self._enter_object_member(segment)
            elif char == "[":
                self._pos += 1
                self._enter_array_index(segment)
            else:
                where = "end of document" if char is None else _q(char)
                self._fail(f"cannot descend into {where} looking for {_q(segment)}")
            self._path.append(segment)
        if not enter:
            return
        self._skip_space()
        char = self._peek()
        if char not in ("[", "{"):
            where = "end of document" if char is None else _q(char)
            self._fail(f"expected an array or object to iterate, got {where}")
        self._pos += 1
        self._container = char

    def _enter_object_member(self, key: str) -> None:
        self._skip_space()
        if self._peek() == "}":
            self._fail(f"no member {_q(key)}")
        while True:
            name = self._read_string()
            self._expect(":")
            if name == key:
                return
            self._skip_value()
            self._skip_space()
            sep = self._take()
            if sep == "}":
                self._fail(f"no member {_q(key)}")
            if sep != ",":
                self._fail('expected "," or "}" in object')

    def _enter_array_index(self, segment: str) -> None:
        if not re.fullmatch(r"0|[1-9][0-9]*", segment):
            self._fail(f"expected an array index, got {_q(segment)}")
        target = int(segment)
        self._skip_space()
        if self._peek() == "]":
            self._fail(f"no element {target}")
        i = 0
        while True:
            if i == target:
                return
            self._skip_value()
            self._skip_space()
            sep = self._take()
            if sep == "]":
                self._fail(f"no element {target}")
            if sep != ",":
                self._fail('expected "," or "]" in array')
            i += 1

    # ── iteration ───────────────────────────────────────────────────────

    def more(self) -> bool:
        """Whether another element remains in the container being iterated.

        A predicate: it consumes the container's closing bracket once there is
        nothing left, and otherwise leaves the cursor where it was. Advancing is
        :meth:`next`'s job, so the two do not have to alternate.
        """
        if self._container is None:
            return False
        close = "]" if self._container == "[" else "}"
        self._skip_space()
        if self._peek() == close:
            self._pos += 1
            self._container = None
            return False
        return True

    def next(self, typ: EastType) -> Any:
        """Read the next element of the container as ``typ``."""
        if self._container is None:
            self._fail("the reader is exhausted")
        # The separator belongs to the advance, not to the predicate, so reading
        # two elements in a row does not need a `more` between them.
        if self._started:
            self._skip_space()
            char = self._peek()
            close = "]" if self._container == "[" else "}"
            if char == close:
                self._pos += 1
                self._container = None
                self._fail("the reader is exhausted")
            if char != ",":
                self._fail(f'expected "," or {_q(close)}')
            self._pos += 1
        self._started = True
        self._path.append(str(self._index))
        self._index += 1
        try:
            if self._container == "{":
                return self._read_member(typ)
            return self.read_value(typ)
        finally:
            self._path.pop()

    def _read_member(self, typ: EastType) -> Any:
        """One object member, as a ``{key, value}`` struct."""
        if typ.type != "Struct":
            self._fail("iterating an object needs a Struct of key and value")
        fields = typ.value
        names = [f["name"] for f in fields]
        if len(fields) != 2 or "key" not in names or "value" not in names:
            self._fail("iterating an object needs a Struct with exactly the fields key and value")
        key_type = next(f["type"] for f in fields if f["name"] == "key")
        value_type = next(f["type"] for f in fields if f["name"] == "value")
        name = self._read_string()
        self._expect(":")
        if key_type.type != "String":
            self._fail("iterating an object needs a String key")
        value = self.read_value(value_type)
        return EastStruct({"key": name, "value": value})

    # ── typed reads ─────────────────────────────────────────────────────

    def read_value(self, typ: EastType) -> Any:
        """Read one whole value, strictly, as ``typ``."""
        self._depth += 1
        if self._depth > MAX_DEPTH:
            self._depth -= 1
            self._fail(f"document nests deeper than {MAX_DEPTH}")
        try:
            return self._read_value_inner(typ)
        except RecursionError:
            # This runtime's own stack gives out before MAX_DEPTH: the typed
            # read recurses per level and python's limit is well below it. The
            # document is still refused for nesting, with the contract's error
            # rather than a bare RecursionError escaping json_next.
            self._fail("document nests deeper than this runtime can read")
        finally:
            self._depth -= 1

    def _read_value_inner(self, typ: EastType) -> Any:  # noqa: PLR0911, PLR0912
        kind = typ.type

        if kind == "Null":
            self._read_literal("null")
            return None

        if kind == "Boolean":
            self._skip_space()
            char = self._peek()
            if char == "t":
                self._read_literal("true")
                return True
            if char == "f":
                self._read_literal("false")
                return False
            self._fail("expected a boolean")

        if kind == "String":
            return self._read_string()

        if kind == "Integer":
            # East JSON writes Integer as a decimal string, so no value ever
            # passes through a float.
            self._skip_space()
            if self._peek() != '"':
                self._fail("expected Integer as a quoted decimal string")
            text = self._read_string()
            if not _INTEGER_RE.fullmatch(text):
                self._fail(f"{_q(text)} is not a 64-bit integer in East JSON's form")
            return int(text)

        if kind == "Float":
            self._skip_space()
            if self._peek() == '"':
                text = self._read_string()
                if text not in _FLOAT_SPECIALS:
                    self._fail(f"{_q(text)} is not one of the non-finite float spellings")
                return -0.0 if text == "-0.0" else float(text)
            return float(self._read_number())

        if kind == "DateTime":
            self._skip_space()
            if self._peek() != '"':
                self._fail("expected DateTime as a string")
            text = self._read_string()
            if not _DATETIME_RE.fullmatch(text):
                self._fail(f"{_q(text)} is not East JSON's UTC date-time form")
            parsed = _parse_utc_datetime(text)
            if parsed is None:
                self._fail(f"{_q(text)} is not a real date")
            return parsed

        if kind == "Blob":
            self._skip_space()
            if self._peek() != '"':
                self._fail("expected Blob as a string")
            text = self._read_string()
            if not _BLOB_RE.fullmatch(text):
                self._fail(f"{_q(text)} is not East JSON's 0x-prefixed lowercase hex form")
            return EastBlob(bytes.fromhex(text[2:]))

        if kind == "Array":
            items: list[Any] = []
            self._each_element(lambda i: self._push_read(str(i), typ.value, items.append))
            return EastArray(typ.value, items)

        if kind == "Set":
            element = typ.value
            out: Any = EastSet(element, [])

            def add(value: Any) -> None:
                if value in out:
                    self._fail("duplicate element in Set")
                out.add(value)

            self._each_element(lambda i: self._push_read(str(i), element, add))
            return out

        if kind == "Vector":
            element = typ.value
            values: list[Any] = []
            self._each_element(lambda i: self._push_read(str(i), element, values.append))
            return _tensor_vector(element, values, self._fail)

        if kind == "Matrix":
            element = typ.value
            rows: list[list[Any]] = []

            def read_row(i: int) -> None:
                self._path.append(str(i))
                try:
                    row: list[Any] = []
                    self._each_element(lambda j: self._push_read(str(j), element, row.append))
                    rows.append(row)
                finally:
                    self._path.pop()

            self._each_element(read_row)
            cols = len(rows[0]) if rows else 0
            for r, row in enumerate(rows):
                if len(row) != cols:
                    self._fail(f"Matrix row {r} has {len(row)} columns, expected {cols}")
            return _tensor_matrix(element, rows, cols, self._fail)

        if kind == "Dict":
            key_type = typ.value["key"]
            value_type = typ.value["value"]
            out_dict: Any = EastDict(key_type, value_type)

            def read_entry(i: int) -> None:
                self._path.append(str(i))
                try:
                    key, value = self._read_entry(key_type, value_type)
                    if key in out_dict:
                        self._fail("duplicate key in Dict")
                    out_dict[key] = value
                finally:
                    self._path.pop()

            self._each_element(read_entry)
            return out_dict

        if kind == "Ref":
            return EastRef(self._read_one_element_array(typ.value))

        if kind == "Struct":
            return self._read_struct(typ.value)

        if kind == "Variant":
            return self._read_variant(typ.value)

        if kind == "Recursive":
            payload = typ.value
            if payload.type == "wrapper":
                wrapper = payload.value
                self._recursive[wrapper["id"]] = wrapper["inner"]
                return self.read_value(wrapper["inner"])
            inner = self._recursive.get(payload.value)
            if inner is None:
                self._fail("unresolved recursive type")
            return self.read_value(inner)

        if kind == "Never":
            self._fail("Never has no values, so no document satisfies it")

        return self._fail(f"{kind} has no JSON form")

    def _push_read(self, segment: str, typ: EastType, sink: Any) -> None:
        self._path.append(segment)
        try:
            sink(self.read_value(typ))
        finally:
            self._path.pop()

    def _each_element(self, body: Any) -> None:
        """Run ``body`` for each element of a JSON array."""
        self._expect("[")
        self._skip_space()
        if self._peek() == "]":
            self._pos += 1
            return
        i = 0
        while True:
            body(i)
            self._skip_space()
            sep = self._take()
            if sep == "]":
                return
            if sep != ",":
                self._fail('expected "," or "]" in array')
            i += 1

    def _read_one_element_array(self, inner: EastType) -> Any:
        self._expect("[")
        value = self.read_value(inner)
        self._skip_space()
        if self._take() != "]":
            self._fail("expected a Ref to hold exactly one element")
        return value

    def _read_entry(self, key_type: EastType, value_type: EastType) -> tuple[Any, Any]:
        self._expect("{")
        key: Any = None
        value: Any = None
        have_key = have_value = False
        self._skip_space()
        if self._peek() == "}":
            self._fail("a Dict entry needs key and value")
        while True:
            name = self._read_string()
            self._expect(":")
            if name == "key":
                if have_key:
                    self._fail('duplicate "key" in Dict entry')
                self._path.append("key")
                try:
                    key = self.read_value(key_type)
                finally:
                    self._path.pop()
                have_key = True
            elif name == "value":
                if have_value:
                    self._fail('duplicate "value" in Dict entry')
                self._path.append("value")
                try:
                    value = self.read_value(value_type)
                finally:
                    self._path.pop()
                have_value = True
            else:
                self._fail(f"unexpected field {_q(name)} in Dict entry")
            self._skip_space()
            sep = self._take()
            if sep == "}":
                break
            if sep != ",":
                self._fail('expected "," or "}" in Dict entry')
        if not have_key or not have_value:
            self._fail("a Dict entry needs both key and value")
        return key, value

    def _read_struct(self, fields: list[dict[str, Any]]) -> Any:
        self._expect("{")
        by_name = {f["name"]: f["type"] for f in fields}
        seen: dict[str, Any] = {}
        self._skip_space()
        if self._peek() != "}":
            while True:
                name = self._read_string()
                self._expect(":")
                if name not in by_name:
                    self._fail(f"unexpected field {_q(name)}")
                if name in seen:
                    self._fail(f"duplicate field {_q(name)}")
                self._path.append(name)
                try:
                    seen[name] = self.read_value(by_name[name])
                finally:
                    self._path.pop()
                self._skip_space()
                sep = self._take()
                if sep == "}":
                    break
                if sep != ",":
                    self._fail('expected "," or "}" in object')
        else:
            self._pos += 1
        # Field order is the type's, not the document's — JSON objects are
        # unordered, so the encoder's order is not something to require.
        out: dict[str, Any] = {}
        for field in fields:
            if field["name"] not in seen:
                self._fail(f"missing field {_q(field['name'])}")
            out[field["name"]] = seen[field["name"]]
        return EastStruct(out)

    def _read_variant(self, cases: list[dict[str, Any]]) -> Any:
        self._expect("{")
        by_name = {c["name"]: c["type"] for c in cases}
        tag: str | None = None
        value: Any = None
        have_value = False
        self._skip_space()
        if self._peek() == "}":
            self._fail("a Variant needs type and value")
        while True:
            name = self._read_string()
            self._expect(":")
            if name == "type":
                if tag is not None:
                    self._fail('duplicate "type" in Variant')
                tag = self._read_string()
                if tag not in by_name:
                    self._fail(f"unknown variant case {_q(tag)}")
                if have_value:
                    # The payload arrived first; it could not be typed then.
                    self._fail('a Variant must carry "type" before "value"')
            elif name == "value":
                if have_value:
                    self._fail('duplicate "value" in Variant')
                if tag is None:
                    self._fail('a Variant must carry "type" before "value"')
                self._path.append(tag)
                try:
                    value = self.read_value(by_name[tag])
                finally:
                    self._path.pop()
                have_value = True
            else:
                self._fail(f"unexpected field {_q(name)} in Variant")
            self._skip_space()
            sep = self._take()
            if sep == "}":
                break
            if sep != ",":
                self._fail('expected "," or "}" in Variant')
        if tag is None or not have_value:
            self._fail("a Variant needs both type and value")
        return EastValueVariant(tag, value)


def _parse_utc_datetime(text: str) -> datetime | None:
    """East JSON's UTC date-time text as a ``datetime``, or None for an unreal day.

    The pattern bounds each field independently but cannot rule out a day the
    month does not have, so the calendar is asked. (JavaScript's ``Date`` will
    not: it rolls 30 February into 2 March rather than failing, which is why
    both runtimes check rather than trusting construction.)
    """
    try:
        return datetime(
            int(text[0:4]), int(text[5:7]), int(text[8:10]),
            int(text[11:13]), int(text[14:16]), int(text[17:19]),
            int(text[20:23]) * 1000,
            tzinfo=UTC,
        )
    except ValueError:
        return None


def _tensor_dtype(element: EastType, fail: Any) -> Any:
    """The storage dtype an East tensor element maps to."""
    from east.types.values.tensor import EAST_ELEMENT_TO_DTYPE

    dtype = EAST_ELEMENT_TO_DTYPE.get(element.type)
    if dtype is None:
        return fail(
            f"a Vector or Matrix element must be Float, Integer or Boolean, got {element.type}"
        )
    return dtype


def _tensor_vector(element: EastType, values: list[Any], fail: Any) -> Any:
    import numpy as np
    from east.types.values import EastVector

    dtype = _tensor_dtype(element, fail)
    return EastVector(element, np.array(values, dtype=dtype))


def _tensor_matrix(element: EastType, rows: list[list[Any]], cols: int, fail: Any) -> Any:
    import numpy as np
    from east.types.values import EastMatrix

    dtype = _tensor_dtype(element, fail)
    flat = [v for row in rows for v in row]
    return EastMatrix(element, np.array(flat, dtype=dtype), len(rows), cols)


__all__ = ["MAX_DEPTH", "JsonReadError", "JsonReader"]
