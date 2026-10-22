#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The optional-extra guards: what they probe, and what they say."""

import importlib
import importlib.util

import pytest
from east_py_datascience._common import extra_guard


def test_a_missing_module_names_the_extra_to_install():
    check = extra_guard("east_py_datascience_no_such_module", "google-or", "A capability")
    with pytest.raises(NotImplementedError, match=r"east-py-datascience\[google-or\]"):
        check()


def test_an_installed_module_passes():
    extra_guard("importlib", "google-or", "A capability")()


def test_the_google_or_guards_probe_ortools_and_scipy(monkeypatch):
    """The columnar linear model imports scipy beside ortools: the package's
    guards must probe both, so a host with ortools from elsewhere and no scipy
    is told to install the extra rather than failing on the import."""
    import east_py_datascience.google_or.types as google_or_types

    probed: list[str] = []
    real_find_spec = importlib.util.find_spec

    def recording_find_spec(name, *args):
        probed.append(name)
        return real_find_spec(name, *args)

    monkeypatch.setattr(importlib.util, "find_spec", recording_find_spec)
    importlib.reload(google_or_types)
    assert {"ortools", "scipy"} <= set(probed)
    assert hasattr(google_or_types, "_check_google_or_columns_support")
