#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Per-project configuration: ``[tool.east-py]`` in ``pyproject.toml``.

One file configures every surface — ``east-py lint``, ``east-py check``, the
flake8 plugin, the pylsp plugin and ``east-py lsp`` — so a project states its
diagnostics policy once, where the rest of its python tooling is configured::

    [tool.east-py]
    check = true                       # opt into the BUILD tier (see below)
    disable = ["no-deprecated-alias"]  # rules to skip
    exclude = ["fixtures", "vendor"]   # extra directory names not to walk

``check`` is **off by default, deliberately**. The rules read a file; the
build check RUNS it, and importing a module executes it. A project opts in
when it is happy for its modules to be imported on save by an editor, which is
also when the module honours the ``EAST_CHECK`` guard. An explicit
``east-py check`` on the command line is consent in itself and never consults
this.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from pathlib import Path

__all__ = ["EastPyConfig", "find_pyproject", "load_config"]

#: the section a project configures East diagnostics under
SECTION = "east-py"


@dataclass(frozen=True)
class EastPyConfig:
    """A project's diagnostics policy. The defaults are what an unconfigured
    project gets: every rule on, nothing extra excluded, the build tier off."""

    #: rule names to skip
    disable: tuple[str, ...] = ()
    #: extra directory names not to walk
    exclude: tuple[str, ...] = ()
    #: whether an EDITOR may run the build tier — importing the module
    check: bool = False
    #: the pyproject.toml this came from, or None when there was none
    source: Path | None = field(default=None, compare=False)


def find_pyproject(start: str | Path) -> Path | None:
    """The nearest ``pyproject.toml`` at or above ``start``.

    Args:
        start: A file or directory to search upward from.

    Returns:
        The path, or None when there is no pyproject above ``start``.
    """
    here = Path(start).resolve()
    if here.is_file():
        here = here.parent
    for directory in [here, *here.parents]:
        candidate = directory / "pyproject.toml"
        if candidate.is_file():
            return candidate
    return None


def load_config(start: str | Path) -> EastPyConfig:
    """The ``[tool.east-py]`` policy governing ``start``.

    A missing file, a missing section, and a malformed one all yield the
    defaults: a diagnostics tool must never be what stops a project building,
    so unreadable configuration is ignored rather than raised.

    Args:
        start: A file or directory inside the project.

    Returns:
        The project's :class:`EastPyConfig`.
    """
    path = find_pyproject(start)
    if path is None:
        return EastPyConfig()
    try:
        with path.open("rb") as handle:
            table = tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError):
        return EastPyConfig()
    section = table.get("tool", {}).get(SECTION)
    if not isinstance(section, dict):
        return EastPyConfig(source=path)
    return EastPyConfig(
        disable=_names(section.get("disable")),
        exclude=_names(section.get("exclude")),
        check=section.get("check") is True,
        source=path,
    )


def _names(value: object) -> tuple[str, ...]:
    """A list-of-strings setting, ignoring anything else it might be."""
    if not isinstance(value, list):
        return ()
    return tuple(item for item in value if isinstance(item, str))
