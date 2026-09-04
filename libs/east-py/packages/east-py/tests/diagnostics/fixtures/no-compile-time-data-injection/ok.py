#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Reads that happen at runtime, where the deployment's data lives."""
import json
from pathlib import Path

from east import East, StringType

SEED_PATH = "seed.json"


def load_rows(path):
    return json.load(open(path))


def notes_for(name):
    return Path(name).read_text()
