#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""East Python CLI - Command-line interface for running East IR programs.

Usage:
    east-py run [--runtime PKG]... [--input FILE]... [--output FILE] <ir_file>
    east-py transpile <ir_file> [-o out.py] [--name NAME]
    east-py lint [PATH]... [--format text|json] [--disable RULE]...
    east-py lsp
    east-py version
"""

from east_py_cli.cli import main

__version__ = "0.1.0"

__all__ = ["main", "__version__"]
