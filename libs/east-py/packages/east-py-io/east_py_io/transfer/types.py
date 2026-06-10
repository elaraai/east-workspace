#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Shared Transfer type definitions for East Python IO.

Provides East type definitions for FTP and SFTP operations.
"""

from east.types.types import (
    ArrayType,
    BooleanType,
    IntegerType,
    OptionType,
    StringType,
    StructType,
)

FtpConfigType = StructType(
    [
        ("host", StringType),
        ("port", IntegerType),
        ("user", StringType),
        ("password", StringType),
        ("secure", BooleanType),
    ]
)
"""FTP server connection configuration.

Fields: ``host`` (``String``), ``port`` (``Integer``),
``user`` (``String`` - login username), ``password`` (``String``),
``secure`` (``Boolean`` - request TLS/AUTH TLS upgrade; default ``False``
in most clients).
"""

SftpConfigType = StructType(
    [
        ("host", StringType),
        ("port", IntegerType),
        ("username", StringType),
        ("password", OptionType(StringType)),
        ("privateKey", OptionType(StringType)),
    ]
)
"""SFTP server connection configuration.

Fields: ``host`` (``String``), ``port`` (``Integer``),
``username`` (``String``), ``password`` (``Option<String>`` - used when
``privateKey`` is absent), ``privateKey`` (``Option<String>`` - PEM-encoded
private key; preferred over password when both are present).
"""

ConnectionHandleType = StringType
"""Opaque ``String`` handle returned by ``ftp_connect`` / ``sftp_connect``.

Pass to subsequent ``ftp_*`` / ``sftp_*`` calls to identify the session.
"""

FileEntryType = StructType(
    [
        ("name", StringType),
        ("path", StringType),
        ("size", IntegerType),
        ("isDirectory", BooleanType),
        ("modifiedTime", StringType),
    ]
)
"""Metadata for a single file or directory entry from ``ftp_list`` / ``sftp_list``.

Fields: ``name`` (``String`` - bare filename), ``path`` (``String`` - full
remote path), ``size`` (``Integer`` - bytes; 0 for directories),
``isDirectory`` (``Boolean``), ``modifiedTime`` (``String`` - ISO-8601 or
server-formatted mtime string; empty when not provided).
"""

FileListType = ArrayType(FileEntryType)
"""``Array<FileEntryType>`` returned by ``ftp_list`` / ``sftp_list``."""

__all__ = [
    "FtpConfigType",
    "SftpConfigType",
    "ConnectionHandleType",
    "FileEntryType",
    "FileListType",
]
