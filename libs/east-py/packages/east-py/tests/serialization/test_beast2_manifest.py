#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Segment manifests, pinned against TypeScript's manifest writer.

A manifest directory — the manifest's file and, in ``<file>.segments/``, the
header and every segment it names as ``<sha256>.beast2`` — is the form e3
stores a collection in, and the one a runner reads a staged input from. This
runtime binds east-c's writer and reader, so what is asserted here is that the
directories python writes are TypeScript's to the byte
(``east/src/serialization/beast2/v5/manifest-writer.spec.ts``) and east-c's
(``tests/test_beast2_manifest.c``), that they read back as their values —
whole, and lazily through the manifest pager — and that the merge reads and
writes them. The fixtures and the pins are the same on all three sides.
"""

import hashlib
from pathlib import Path

import pytest
from east.runtime._compiler_eastc import open_manifest_file, paged_value_stats
from east.serialization._beast2_eastc import _encode_beast2_fence, _merge_blobs

from east import ArrayType, DictType, East, EastDict, EastSet, IntegerType, SetType, StringType
from east.serialization.beast2 import (
    SEGMENT_RULE_ARRAY,
    SEGMENT_RULE_KEYED,
    Beast2ManifestWriter,
    encode_beast2_paged_for,
    load_beast2_manifest,
    read_beast2_manifest,
)

#: TypeScript's manifests of the parity values below — the SHA-256 of each
#: manifest's bytes, as its Beast2ManifestWriter writes them.
DICT_MANIFEST = "5564111725b1962b7ae8c82cf91d24c4e1fb8d2c9613245693757fe4ff4187b0"
SET_MANIFEST = "7b2c57db1da82f98ef88018589dc7a4f96bac120472b35e9826dbd60c395789c"
ARRAY_MANIFEST = "127030afceae0c9590ad26ed26521cff170b8024229f28ccd54d647fc218df4c"
EMPTY_DICT_MANIFEST = "356518ed344e3e210d0a2acb26eef7eff25cd76ba08b1aedd0640af5256cefb0"

TABLE = DictType(StringType, IntegerType)


def _parity_dict() -> EastDict:
    d = EastDict(StringType, IntegerType)
    for i in range(50_000):
        d[f"k{i:07d}"] = i
    return d


@pytest.mark.parametrize(
    ("collection_type", "value", "pin", "entries", "rule"),
    [
        (TABLE, _parity_dict, DICT_MANIFEST, 38, SEGMENT_RULE_KEYED),
        (SetType(StringType), lambda: EastSet(StringType, [f"e{i:07d}" for i in range(50_000)]),
         SET_MANIFEST, 44, SEGMENT_RULE_KEYED),
        (ArrayType(StringType), lambda: [f"a{i:07d}" for i in range(50_000)],
         ARRAY_MANIFEST, 43, SEGMENT_RULE_ARRAY),
        (TABLE, lambda: EastDict(StringType, IntegerType), EMPTY_DICT_MANIFEST, 0, SEGMENT_RULE_KEYED),
    ],
    ids=["Dict", "Set", "Array", "empty Dict"],
)
def test_a_directory_is_the_one_typescript_writes(tmp_path, collection_type, value, pin, entries, rule):
    path = tmp_path / "value.beast2"
    with Beast2ManifestWriter(collection_type, path) as writer:
        writer.add_all(value())
    assert hashlib.sha256(path.read_bytes()).hexdigest() == pin

    manifest = read_beast2_manifest(path)
    assert (manifest["kind"], manifest["level"], manifest["rule"]) == ("$segments", 0, rule)
    assert len(manifest["entries"]) == entries
    # Every object — each segment, and the header they are written under — is
    # named by its own SHA-256, and the directory holds nothing else.
    names = [entry["hash"] for entry in manifest["entries"]] + [manifest["header"]]
    objects = Path(f"{path}.segments")
    for name in names:
        assert hashlib.sha256((objects / f"{name}.beast2").read_bytes()).hexdigest() == name
    assert sorted(p.name for p in objects.iterdir()) == sorted({f"{name}.beast2" for name in names})


def test_the_entries_carry_each_segments_count_size_and_first_key(tmp_path):
    path = tmp_path / "dict.beast2"
    with Beast2ManifestWriter(TABLE, path) as writer:
        writer.add_all(_parity_dict())
    manifest = read_beast2_manifest(path)
    start = 0
    for entry in manifest["entries"]:
        segment = Path(f"{path}.segments") / f"{entry['hash']}.beast2"
        assert entry["bytes"] == segment.stat().st_size
        assert entry["fence"] == _encode_beast2_fence(StringType, f"k{start:07d}")
        start += entry["count"]
    assert start == 50_000


def test_the_writer_writes_the_same_directory_however_it_is_fed(tmp_path):
    value = _parity_dict()
    path = tmp_path / "dict.beast2"
    with Beast2ManifestWriter(TABLE, path) as writer:
        for entry in list(value.items())[:10_000]:
            writer.add(entry)
        rest = EastDict(StringType, IntegerType)
        for key, number in list(value.items())[10_000:]:
            rest[key] = number
        writer.add_all(rest)
    assert hashlib.sha256(path.read_bytes()).hexdigest() == DICT_MANIFEST


def test_a_directory_reads_back_as_its_value(tmp_path):
    value = _parity_dict()
    path = tmp_path / "dict.beast2"
    with Beast2ManifestWriter(TABLE, path) as writer:
        writer.add_all(value)
    # A manifest records its type, so none need be given; one given must be it.
    assert dict(load_beast2_manifest(path).items()) == dict(value.items())
    assert dict(load_beast2_manifest(path, TABLE).items()) == dict(value.items())
    with pytest.raises(ValueError, match="declared type does not match the manifest"):
        load_beast2_manifest(path, DictType(StringType, StringType))


def test_a_directory_opens_lazily_and_a_keyed_read_decodes_one_segment(tmp_path):
    path = tmp_path / "dict.beast2"
    with Beast2ManifestWriter(TABLE, path) as writer:
        writer.add_all(_parity_dict())
    hold = open_manifest_file(TABLE, path)
    assert hold is not None
    read = East.compile(East.function([TABLE], IntegerType,
                                      lambda _b, d: d.size() + d.get("k0031415")))
    assert read(hold) == 50_000 + 31_415
    segments, decoded, _fences, hydrated = paged_value_stats(hold._east_c_paged)
    assert (segments, decoded, hydrated) == (38, 1, False)

    with pytest.raises(ValueError, match="cannot open a blob of type"):
        open_manifest_file(DictType(StringType, StringType), path)


def test_a_missing_segment_is_named_when_a_read_needs_it(tmp_path):
    path = tmp_path / "dict.beast2"
    with Beast2ManifestWriter(TABLE, path) as writer:
        writer.add_all(_parity_dict())
    gone = read_beast2_manifest(path)["entries"][7]["hash"]
    (Path(f"{path}.segments") / f"{gone}.beast2").unlink()
    with pytest.raises(ValueError, match=rf"{gone}\.beast2 cannot be read"):
        load_beast2_manifest(path)


def test_what_is_not_a_manifest_is_not_read_as_one(tmp_path):
    blob = tmp_path / "blob.beast2"
    blob.write_bytes(encode_beast2_paged_for(TABLE)(EastDict(StringType, IntegerType, {"a": 1})))
    assert read_beast2_manifest(blob) is None
    assert read_beast2_manifest(blob.read_bytes()) is None
    assert read_beast2_manifest(bytes(16)) is None
    empty = tmp_path / "empty.beast2"
    empty.write_bytes(b"")
    assert read_beast2_manifest(empty) is None
    with pytest.raises(ValueError, match="does not hold a manifest"):
        load_beast2_manifest(blob)


def test_a_writer_left_by_an_exception_writes_no_manifest(tmp_path):
    path = tmp_path / "dict.beast2"
    with pytest.raises(RuntimeError, match="strictly ascending"), \
            Beast2ManifestWriter(TABLE, path) as writer:
        writer.add(("b", 1))
        writer.add(("a", 2))
    assert not path.exists()


def test_the_merge_reads_manifest_directories_and_writes_one(tmp_path):
    # The halves of the parity Dict, each a directory, merge into
    # TypeScript's directory of the whole — and into the whole's blob.
    value = _parity_dict()
    evens = EastDict(StringType, IntegerType)
    odds = EastDict(StringType, IntegerType)
    for i, (key, number) in enumerate(value.items()):
        (odds if i % 2 else evens)[key] = number
    halves = [tmp_path / "evens.beast2", tmp_path / "odds.beast2"]
    for half, part in zip(halves, (evens, odds), strict=True):
        with Beast2ManifestWriter(TABLE, half) as writer:
            writer.add_all(part)

    merged = tmp_path / "merged.beast2"
    assert _merge_blobs(halves, merged, output_manifest=True) == {
        "inputs": 2, "entries": 50_000, "folds": 0,
    }
    assert hashlib.sha256(merged.read_bytes()).hexdigest() == DICT_MANIFEST

    blob = tmp_path / "merged-blob.beast2"
    _merge_blobs(halves, blob)
    assert blob.read_bytes() == encode_beast2_paged_for(TABLE)(value)
