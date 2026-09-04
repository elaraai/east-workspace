#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Transfer module - FTP and SFTP file transfer.

The ``*_impl`` functions are plain Python callables taking and returning East
values and can be called directly from project code without an IR round-trip.
"""

from east_py_io.transfer.ftp_impl import (
    ftp_close,
    ftp_close_all,
    ftp_connect,
    ftp_delete,
    ftp_get,
    ftp_impl,
    ftp_list,
    ftp_put,
)
from east_py_io.transfer.sftp_impl import (
    sftp_close,
    sftp_close_all,
    sftp_connect,
    sftp_delete,
    sftp_get,
    sftp_impl,
    sftp_list,
    sftp_put,
)
from east_py_io.transfer.types import (
    ConnectionHandleType,
    FileEntryType,
    FileListType,
    FtpConfigType,
    SftpConfigType,
)

__all__ = [
    # Types
    "FtpConfigType",
    "SftpConfigType",
    "ConnectionHandleType",
    "FileEntryType",
    "FileListType",
    # FTP
    "ftp_impl",
    "ftp_connect",
    "ftp_put",
    "ftp_get",
    "ftp_list",
    "ftp_delete",
    "ftp_close",
    "ftp_close_all",
    # SFTP
    "sftp_impl",
    "sftp_connect",
    "sftp_put",
    "sftp_get",
    "sftp_list",
    "sftp_delete",
    "sftp_close",
    "sftp_close_all",
]
