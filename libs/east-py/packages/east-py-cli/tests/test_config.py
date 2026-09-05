#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``[tool.east-py]`` in ``pyproject.toml`` (#653): one file configures every
surface, and the BUILD tier is opt-in because it imports the module."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from east.diagnostics import find_pyproject, load_config

from east_py_cli.lsp import lsp_build_diagnostics, lsp_diagnostics

BAD = ("from east import East, IntegerType\n"
       "\n"
       "@East.function([IntegerType], IntegerType)\n"
       "def halve(b, x):\n"
       "    return x // 2\n")

WRONG_OUT = ("from east import East\n"
             "from east.types.types import IntegerType, StringType\n"
             "\n"
             "wrong = East.function([IntegerType], StringType, lambda b, x: x + 1)\n")


def project(tmp_path: Path, toml: str | None, files: dict[str, str]) -> Path:
    if toml is not None:
        (tmp_path / "pyproject.toml").write_text(toml, encoding="utf-8")
    for name, source in files.items():
        (tmp_path / name).write_text(source, encoding="utf-8")
    return tmp_path


def test_an_unconfigured_project_gets_the_defaults(tmp_path):
    config = load_config(project(tmp_path, None, {}))
    assert config.disable == () and config.exclude == ()
    assert config.check is False, "the build tier must be off until a project asks for it"
    assert config.source is None


def test_the_section_is_read(tmp_path):
    toml = ('[tool.east-py]\ncheck = true\n'
            'disable = ["no-operator-fork"]\nexclude = ["fixtures"]\n')
    config = load_config(project(tmp_path, toml, {}))
    assert config.check is True
    assert config.disable == ("no-operator-fork",)
    assert config.exclude == ("fixtures",)
    assert config.source == tmp_path / "pyproject.toml"


def test_it_is_found_from_a_nested_file(tmp_path):
    (tmp_path / "src" / "pkg").mkdir(parents=True)
    project(tmp_path, '[tool.east-py]\ndisable = ["no-operator-fork"]\n', {})
    deep = tmp_path / "src" / "pkg" / "mod.py"
    deep.write_text(BAD, encoding="utf-8")
    assert find_pyproject(deep) == tmp_path / "pyproject.toml"
    assert load_config(deep).disable == ("no-operator-fork",)


def test_a_pyproject_without_the_section_is_the_defaults_but_records_its_source(tmp_path):
    config = load_config(project(tmp_path, '[project]\nname = "demo"\n', {}))
    assert config.disable == () and config.check is False
    assert config.source is not None


def test_malformed_configuration_is_ignored_rather_than_raised(tmp_path):
    # A diagnostics tool must never be what stops a project building.
    for toml in ('[tool.east-py\ncheck = true\n',
                 '[tool.east-py]\ndisable = "not-a-list"\ncheck = "yes"\n',
                 '[tool.east-py]\ndisable = [1, 2]\n'):
        config = load_config(project(tmp_path, toml, {}))
        assert config.disable == () and config.check is False


def test_the_rules_honour_disable_through_the_lsp_payload(tmp_path):
    configured = tmp_path / "configured"
    configured.mkdir()
    project(configured, '[tool.east-py]\ndisable = ["no-operator-fork"]\n', {"mod.py": BAD})
    assert lsp_diagnostics(BAD, str(configured / "mod.py")) == []

    # A SIBLING project, not a subdirectory: a nested file inherits the
    # configuration above it, which is the point of walking upward.
    plain = tmp_path / "plain"
    plain.mkdir()
    project(plain, '[project]\nname = "demo"\n', {"mod.py": BAD})
    assert lsp_diagnostics(BAD, str(plain / "mod.py")), "without the setting the rule still fires"


def test_a_nested_directory_inherits_the_configuration_above_it(tmp_path):
    project(tmp_path, '[tool.east-py]\ndisable = ["no-operator-fork"]\n', {})
    nested = tmp_path / "src" / "deep"
    nested.mkdir(parents=True)
    (nested / "mod.py").write_text(BAD, encoding="utf-8")
    assert lsp_diagnostics(BAD, str(nested / "mod.py")) == []


def test_the_build_tier_is_silent_until_the_project_opts_in(tmp_path):
    root = project(tmp_path, '[project]\nname = "demo"\n', {"mod.py": WRONG_OUT})
    assert lsp_build_diagnostics(str(root / "mod.py")) == [], \
        "an editor must not import someone's module without consent"


def test_the_build_tier_runs_once_the_project_opts_in(tmp_path):
    root = project(tmp_path, '[tool.east-py]\ncheck = true\n', {"mod.py": WRONG_OUT})
    found = lsp_build_diagnostics(str(root / "mod.py"))
    assert len(found) == 1, found
    assert "declared out is String" in found[0]["message"]


def test_east_py_check_on_the_command_line_never_consults_the_setting(tmp_path):
    # Running it is consent in itself.
    root = project(tmp_path, '[project]\nname = "demo"\n', {"mod.py": WRONG_OUT})
    result = subprocess.run([sys.executable, "-m", "east_py_cli", "check", str(root / "mod.py")],
                            capture_output=True, text=True, check=False)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "[build]" in result.stdout


def test_east_py_lint_applies_the_project_disable(tmp_path):
    root = project(tmp_path, '[tool.east-py]\ndisable = ["no-operator-fork"]\n', {"mod.py": BAD})
    result = subprocess.run([sys.executable, "-m", "east_py_cli", "lint", str(root)],
                            capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stdout
    assert "All clear." in result.stdout
