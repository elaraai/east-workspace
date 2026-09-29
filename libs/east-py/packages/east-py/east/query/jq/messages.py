#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The checker's diagnostics: every sentence it says. The twin of ``messages.ts``.

The python front end says the same words as TypeScript's
(``libs/east/devdocs/QUERY.md`` §12 lists them).
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from typing import Any

from east.query.jq.spans import to_query_span, to_utf16
from east.types.construct import none, some
from east.types.values import EastStruct, EastVariant, east_null


def report(
    text: str, code: str, span: Any, message: str, *,
    suggestions: list[str] | None = None, fixes: list[EastStruct] | None = None, warning: bool = False,
) -> EastStruct:
    """Builds a diagnostic.

    Args:
        text: The program's UTF-16 view.
        code: The diagnostic's code.
        span: The text it is about (anything with ``from_`` and ``to``), or ``None``.
        message: Its sentence, led by its code.
        suggestions: Replacement texts for the span, best first.
        fixes: Its one-click fixes.
        warning: Whether it is a lint.

    Returns:
        The ``QueryErrorType`` value.
    """
    return EastStruct({
        "code": code,
        "fixes": list(fixes or []),
        "message": message,
        "severity": EastVariant("warning" if warning else "error", east_null),
        "span": none if span is None else some(to_query_span(text, span.from_, span.to)),
        "suggestions": list(suggestions or []),
    })


def edit(label: str, start: int, end: int, insert: str) -> EastStruct:
    """A fix of one edit: replace ``start`` to ``end`` (UTF-16 offsets) with ``insert``."""
    return EastStruct({
        "edits": [EastStruct({"insert": insert, "length": end - start, "offset": start})],
        "label": label,
    })


def distance(a: str, b: str) -> int:
    """The edit distance between two names: insertions, deletions and substitutions of UTF-16 code units."""
    a, b = to_utf16(a), to_utf16(b)
    previous = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        current = [i]
        for j in range(1, len(b) + 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (0 if a[i - 1] == b[j - 1] else 1)))
        previous = current
    return previous[len(b)]


def closest(name: str, candidates: Iterable[str]) -> list[str]:
    """The names closest to a misspelt one.

    Within ``max(2, ⌊length / 3⌋)`` edits, or containing it, or contained in
    it, nearest first, then in the order given.

    Args:
        name: The name as written.
        candidates: The names it could have meant.

    Returns:
        Up to three suggestions.
    """
    length = len(to_utf16(name))
    limit = max(2, length // 3)
    scored: list[tuple[int, int, str]] = []
    for order, candidate in enumerate(candidates):
        d = distance(name.lower(), candidate.lower())
        related = length >= 3 and (name in candidate or candidate in name)
        if d <= limit or related:
            scored.append((min(d, limit) if related else d, order, candidate))
    scored.sort(key=lambda s: (s[0], s[1]))
    return [candidate for _, _, candidate in scored[:3]]


def list_words(names: Sequence[str]) -> str:
    """Lists names in a sentence: ``a``, ``a and b``, ``a, b and c``."""
    if len(names) <= 1:
        return "".join(names)
    return f"{', '.join(names[:-1])} and {names[-1]}"


def _article(word: str) -> str:
    """"a" or "an" before a type's name."""
    return "an" if re.match(r"[AEIOU]", word, re.IGNORECASE) else "a"


def _did_you_mean(suggestion: str | None) -> str:
    return "" if suggestion is None else f" Did you mean {suggestion}?"


class MESSAGES:
    """The sentences, by situation: ``messages.ts``'s ``MESSAGES``."""

    @staticmethod
    def unknown_field(field: str, type_: str, suggestion: str | None = None) -> str:
        return f"unknown_field: {field} is not a field of {type_}.{_did_you_mean(suggestion)}"

    @staticmethod
    def unknown_dataset(field: str, suggestion: str | None = None) -> str:
        return f"unknown_field: {field} is not a dataset in this workspace.{_did_you_mean(suggestion)}"

    @staticmethod
    def unknown_payload_field(field: str, suggestion: str | None = None) -> str:
        return f"unknown_field: {field} is not a field of any case of this variant.{_did_you_mean(suggestion)}"

    @staticmethod
    def unknown_variant_field(field: str, path: str) -> str:
        return f"unknown_field: {field} is not a field of {path}: a variant reads as {{type, value}}."

    @staticmethod
    def unknown_case(path: str, name: str, cases: Sequence[str], suggestion: str | None = None) -> str:
        if suggestion is None:
            return f"unknown_case: {path} has no case {name}; its cases are {list_words(cases)}."
        return f"unknown_case: {path} has no case {name}. Did you mean {suggestion}?"

    @staticmethod
    def unknown_type(name: str, names: Sequence[str], suggestion: str | None = None) -> str:
        if suggestion is None:
            quoted = ['"' + n + '"' for n in names]
            return f"unknown_case: type gives {list_words(quoted)}, never {name}."
        return f"unknown_case: type never gives {name}. Did you mean {suggestion}?"

    @staticmethod
    def unknown_function(name: str, arity: int, suggestion: str | None = None) -> str:
        return f"unknown_function: {name}/{arity} is not a builtin or a def.{_did_you_mean(suggestion)}"

    @staticmethod
    def unknown_variable(name: str) -> str:
        return f"unknown_function: ${name} is not bound here."

    @staticmethod
    def unknown_label(name: str) -> str:
        return f"unknown_function: there is no label ${name} around this break."

    @staticmethod
    def arity(name: str, arities: Sequence[int], given: int) -> str:
        plural = "" if len(arities) == 1 and arities[0] == 1 else "s"
        return f"arity: {name} takes {list_words([str(a) for a in arities])} argument{plural}, not {given}."

    @staticmethod
    def not_a_field(field: str, type_: str) -> str:
        return f"type_mismatch: {field} reads a field, but its input is {type_}."

    @staticmethod
    def not_iterable(form: str, type_: str) -> str:
        return f"not_iterable: {form} needs an array; its input is {type_}."

    @staticmethod
    def not_iterable_null(form: str, type_: str) -> str:
        return f"not_iterable: {form} needs an array; its input is {type_}. Use {form}? to skip null."

    @staticmethod
    def not_indexable(target: str, type_: str) -> str:
        return f"not_indexable: {target} is {type_}."

    @staticmethod
    def key_type(form: str, key: str, key_text: str, given: str) -> str:
        return f"type_mismatch: {form} needs {_article(key)} {key} key; {key_text} is {given}."

    @staticmethod
    def mutable_key(key_text: str, given: str) -> str:
        return f"type_mismatch: {key_text} is {given}, and a dict's keys must be immutable."

    @staticmethod
    def slice_bound(given: str) -> str:
        return f"type_mismatch: .[a:b] needs Integer bounds, got {given}."

    @staticmethod
    def slice_update(form: str, given: str) -> str:
        return f"type_mismatch: {form} is updated with an array, not {given}."

    @staticmethod
    def string_slice(form: str) -> str:
        return f"type_mismatch: {form} cannot update part of a string; update the whole string."

    @staticmethod
    def update_key(text: str) -> str:
        return (f"unsupported: {text} gives more or fewer than one value; "
                "an update's keys and bounds give one each.")

    @staticmethod
    def walk_update(path: str, from_: str, to: str) -> str:
        return (f"type_mismatch: an update through {path} keeps each value's type, "
                f"but here {from_} would become {to}.")

    @staticmethod
    def struct_key(form: str) -> str:
        return f"type_mismatch: {form} on a struct needs a literal field name; a computed name needs a dict."

    @staticmethod
    def compares(op: str, left: str, right: str) -> str:
        return f"type_mismatch: {op} compares {left} with {right}."

    @staticmethod
    def never_equal(op: str) -> str:
        if op == "==":
            return "type_mismatch: Integer == Float is never true here."
        return "type_mismatch: Integer != Float is always true here."

    @staticmethod
    def arithmetic(op: str, left: str, right: str) -> str:
        return f"type_mismatch: {left} {op} {right} is not defined."

    @staticmethod
    def negate(type_: str) -> str:
        return f"type_mismatch: - negates a number, not {type_}."

    @staticmethod
    def whole_variant(path: str, type_: str) -> str:
        return (f"type_mismatch: {path} is {type_}; variants read as {{type, value}} — "
                f"compare {path}.type with a case name.")

    @staticmethod
    def narrow_first(path: str, type_: str, case_name: str, variant_path: str, leaf: str) -> str:
        return (f'type_mismatch: {path} is {type_} here — only the "{case_name}" case of {variant_path} has {leaf}. '
                f'Narrow first with select({variant_path}.type == "{case_name}").')

    @staticmethod
    def input(name: str, expected: str, given: str) -> str:
        return f"type_mismatch: {name} needs {expected}; its input is {given}."

    @staticmethod
    def date_as_string(name: str) -> str:
        return (f"type_mismatch: {name} needs a string; its input is DateTime. Compare its parts "
                f"(year == 2026 and month == 9), or its text (todate | {name}(…)).")

    @staticmethod
    def argument(name: str, position: str, expected: str, given: str) -> str:
        return f"type_mismatch: {name}'s {position} argument must be {expected}, not {given}."

    @staticmethod
    def run_argument(name: str, element: str, given: str, wrapped: str) -> str:
        return (f"type_mismatch: {name} takes an array as a run of elements, which must be {element}, not {given}. "
                f"To find one element, wrap it: {wrapped}.")

    @staticmethod
    def literal_argument(name: str, position: str, expected: str) -> str:
        return f"type_mismatch: {name}'s {position} argument must be {expected}, written in the query."

    @staticmethod
    def iso_date(value: str) -> str:
        return f"type_mismatch: {value} is not an ISO-8601 date — DateTime literals are parsed at check time."

    @staticmethod
    def empty_range(text: str) -> str:
        return f"type_mismatch: {text} yields nothing."

    @staticmethod
    def regex(pattern: str, reason: str) -> str:
        return f"type_mismatch: {pattern} is not an East regular expression: {reason}."

    @staticmethod
    def replacement(name: str) -> str:
        return (f"type_mismatch: {name}'s replacement can interpolate only the pattern's named groups, "
                "as \\(.name).")

    @staticmethod
    def mixed_delete(text: str) -> str:
        return f"ambiguous_output: {text} leaves values of different types where one type must hold them all."

    @staticmethod
    def mixed_keys() -> str:
        return ("type_mismatch: an object's keys are all written as names, or all computed — "
                "a struct or a dict, not both.")

    @staticmethod
    def no_common_type(a: str, b: str) -> str:
        return f"ambiguous_output: {a} and {b} have no common type."

    @staticmethod
    def accumulator(form: str, first: str, next_: str) -> str:
        return (f"cannot_infer: the accumulator of this {form} is {first}, then {next_}; "
                "start it with a value of the final type.")

    @staticmethod
    def recursion(name: str) -> str:
        return f"cannot_infer: {name} does not settle on one type for this input. Use recurse, while or until."

    @staticmethod
    def excluded(name: str) -> str:
        return f"unsupported: {name} is excluded — queries are deterministic and have no host access."

    @staticmethod
    def unavailable(name: str, reason: str) -> str:
        return f"unsupported: {name} is not available in queries: {reason}."

    @staticmethod
    def not_yet(name: str) -> str:
        return f"unsupported: {name} is not available in queries yet."

    @staticmethod
    def tooling(name: str) -> str:
        return f"unsupported: {name} needs the TypeScript IR printers; use it in e3 query."

    @staticmethod
    def whole_root(names: Sequence[str]) -> str:
        listed = ", ".join(f".{n}" for n in names[:3])
        return (f"unsupported: reading the whole root loads every dataset — name them: "
                f"{listed}{', …' if len(names) > 3 else ''}.")

    @staticmethod
    def async_call() -> str:
        return "unsupported: call cannot run an async function."

    @staticmethod
    def recursive_filter(name: str) -> str:
        return f"unsupported: {name} calls itself and takes a filter parameter. Use recurse, while or until."

    @staticmethod
    def regex_flag(flag: str) -> str:
        return f'unsupported: regex flag "{flag}" — East regular expressions take the flags g and i.'

    @staticmethod
    def format_code(code: str) -> str:
        return f"unsupported: %{code} — strftime and strptime take %Y %m %d %H %M %S %b %B %a %A %F %T and %%."

    @staticmethod
    def duplicate_outputs(generator: str) -> str:
        return (f"duplicate_outputs: select({generator} | …) emits the row once per matching element. "
                f"Use any({generator}; …).")

    @staticmethod
    def array_on_element(name: str, stream: str, type_: str, collected: str) -> str:
        return (f"array_builtin_on_element: {name} needs an array, but runs here on each element of {stream}, "
                f"which is {type_}. Collect the stream first: {collected}.")

    @staticmethod
    def duplicate_key(key: str) -> str:
        return f"duplicate_key: {key} is set twice in this object; the last one wins."

    @staticmethod
    def never_missing(path: str, type_: str) -> str:
        return f"never_missing: {path} is {type_}, never null, so //= changes nothing."

    @staticmethod
    def long_range(text: str, count: str) -> str:
        return f"long_range: {text} gives {count} values; a query returns 1 000 at most by default."


__all__ = ["MESSAGES", "closest", "distance", "edit", "list_words", "report"]
