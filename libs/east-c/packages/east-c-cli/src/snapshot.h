/*
 * Snapshot: reproducible bundle of an East program invocation.
 *
 * A .east-snapshot is an uncompressed POSIX ustar archive containing:
 *   - manifest.json   (east-JSON of SnapshotManifestType)
 *   - ir.<ext>        (verbatim copy of the IR file)
 *   - input-N.<ext>   (verbatim copy of each input, in positional order)
 *
 * See docs/snapshot-format.md for the shared cross-runtime contract.
 */
#ifndef EAST_CLI_SNAPSHOT_H
#define EAST_CLI_SNAPSHOT_H

#include <stdbool.h>
#include <stddef.h>

typedef struct {
    char *ir_path;           /* absolute path to extracted IR file */
    char **input_paths;      /* absolute paths to extracted input files */
    size_t num_inputs;
    char **packages;         /* package names from manifest */
    size_t num_packages;
    char *_extract_dir;      /* owned temp dir to clean up */
} SnapshotExtract;

/* Write a snapshot to `out_path`. Returns 0 on success, non-zero on failure.
 * Uses CLI version string for the manifest runtime.cli field. */
int snapshot_write(const char *out_path,
                   const char *ir_path,
                   const char **input_paths, size_t num_inputs,
                   const char **packages, size_t num_packages,
                   const char *cli_version_str);

/* Extract a snapshot into a fresh temp dir. Caller must call
 * snapshot_extract_free() to release temp dir + paths.
 * Returns 0 on success, non-zero on failure (in which case `out` is untouched). */
int snapshot_read(const char *in_path, SnapshotExtract *out);

void snapshot_extract_free(SnapshotExtract *ex);

#endif
