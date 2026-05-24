#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Snapshot writer/reader — matches the cross-runtime format in
docs/snapshot-format.md.

A .east-snapshot is an uncompressed POSIX ustar archive containing
manifest.json, ir.<ext>, and input-<N>.<ext>. The manifest is east-JSON of
SnapshotManifestType (see the spec)."""

from __future__ import annotations

import io
import shutil
import tarfile
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from east.serialization.json import decode_json_for, encode_json_for
from east.types.types import (
    ArrayType,
    DateTimeType,
    IntegerType,
    StringType,
    StructType,
)

SNAPSHOT_FORMAT_VERSION = 1


SnapshotManifestType = StructType(
    [
        ("version", IntegerType),
        ("created_at", DateTimeType),
        ("runtime", StructType([("impl", StringType), ("cli", StringType)])),
        ("ir", StringType),
        ("inputs", ArrayType(StringType)),
        ("packages", ArrayType(StringType)),
    ]
)


@dataclass
class SnapshotExtract:
    """Paths to an extracted snapshot; call ``cleanup()`` to release."""

    ir_path: Path
    input_paths: list[Path]
    packages: list[str]
    _extract_dir: Path

    def cleanup(self) -> None:
        shutil.rmtree(self._extract_dir, ignore_errors=True)


def _ext_of(path: Path) -> str:
    s = path.suffix
    return s[1:] if s.startswith(".") else s


def _add_bytes(tar: tarfile.TarFile, name: str, data: bytes) -> None:
    info = tarfile.TarInfo(name=name)
    info.size = len(data)
    tar.addfile(info, io.BytesIO(data))


def write_snapshot(
    out_path: Path,
    ir_path: Path,
    input_paths: list[Path],
    packages: list[str],
    cli_version: str,
) -> None:
    """Write a .east-snapshot bundle. Must run before program execution so a
    crash still leaves the bundle behind."""
    ir_archive_name = f"ir.{_ext_of(ir_path)}"
    input_archive_names = [f"input-{i}.{_ext_of(p)}" for i, p in enumerate(input_paths)]

    manifest = {
        "version": SNAPSHOT_FORMAT_VERSION,
        "created_at": datetime.now(UTC),
        "runtime": {"impl": "east-py", "cli": cli_version},
        "ir": ir_archive_name,
        "inputs": input_archive_names,
        "packages": list(packages),
    }
    manifest_bytes = encode_json_for(SnapshotManifestType)(manifest)

    with tarfile.open(out_path, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        _add_bytes(tar, "manifest.json", manifest_bytes)
        _add_bytes(tar, ir_archive_name, Path(ir_path).read_bytes())
        for name, p in zip(input_archive_names, input_paths, strict=True):
            _add_bytes(tar, name, Path(p).read_bytes())


def read_snapshot(in_path: Path) -> SnapshotExtract:
    """Extract a .east-snapshot bundle into a fresh temp dir and return the
    paths the CLI should use. Caller must ``cleanup()`` when done."""
    with tarfile.open(in_path, mode="r") as tar:
        manifest_member = tar.getmember("manifest.json")
        f = tar.extractfile(manifest_member)
        if f is None:
            raise ValueError(f"snapshot is missing manifest.json: {in_path}")
        manifest_bytes = f.read()

        manifest = decode_json_for(SnapshotManifestType)(manifest_bytes)

        if manifest["version"] != SNAPSHOT_FORMAT_VERSION:
            raise ValueError(
                f"snapshot format version {manifest['version']} is not supported "
                f"(expected {SNAPSHOT_FORMAT_VERSION})"
            )

        extract_dir = Path(tempfile.mkdtemp(prefix="east-snapshot-"))
        for member in tar.getmembers():
            if member.name == "manifest.json":
                continue
            tar.extract(member, path=extract_dir, filter="data")

    ir_path = extract_dir / manifest["ir"]
    input_paths = [extract_dir / name for name in manifest["inputs"]]

    return SnapshotExtract(
        ir_path=ir_path,
        input_paths=input_paths,
        packages=list(manifest["packages"]),
        _extract_dir=extract_dir,
    )
