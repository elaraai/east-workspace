# Changelog

What changed for a user of the packages, release by release, with the
migration a breaking change needs. A release's page on GitHub lists its pull
requests; this file is the record of behaviour. Changes land under
*Unreleased* and move into the release's section when it is cut
(`docs/conventions/WIRE_MIGRATION.md` names the kinds of wire change).

## Unreleased

### east-c

- **east-c-datascience is a package beside the runner, not a build of it.**
  The OR-Tools, XGBoost and neural-network platform functions ship as
  `@elaraai/east-c-datascience` (with `@elaraai/east-c-datascience-linux-x64`),
  installed beside `@elaraai/east-c-cli`: the runner opens the package's
  libraries when a program names `east-c-datascience`, and the `east-c`
  launcher points it at them. libtorch is fetched at install
  (`east-c-datascience fetch-libtorch`; `EAST_LIBTORCH=skip` skips it), and
  OR-Tools and XGBoost run without it. `east-c version -p east-c-datascience`
  reports the package, its libraries and where it was found. A new Docker tier
  `east-c-datascience` (FROM `east-c`) carries both. For a build from source,
  `-DEAST_C_DATASCIENCE=ON` now produces the two libraries
  (`libeast-c-datascience`, `libeast-c-nn`), which the build tree's CLI opens;
  the CLI needs CMake 3.24. OR-Tools' pinned archive is the AlmaLinux 9 build,
  so the libraries load on the runner's glibc floor (2.34).
- `EAST_C_PACKAGE_PATH` names the directories a package library is looked for
  in, instead of the installed packages.

### e3

- `STOCK_PLATFORMS_BY_RUNNER.east_c` lists `east-c-datascience`, and rack
  routing sends a runner listing it to the new `c-datascience` tier.
