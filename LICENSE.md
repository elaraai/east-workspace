Copyright (c) 2025 Elara AI Pty Ltd

# East Workspace — Multi-License Repository

This repository contains multiple components released under different
licenses. Each component directory under `libs/` that contains its own
`LICENSE.md` is governed **exclusively** by that file, which takes
precedence over this one. This file licenses everything not otherwise
covered, and summarizes the per-component split.

## License by component

- **Dual AGPL-3.0 / Commercial** — `east`, `east-node`, `east-ui`, and the
  e3 SDK (`@elaraai/e3`, `@elaraai/e3-types`).
- **Business Source License 1.1** — `east-c`, `east-py` (runtime, std, io,
  cli), and the e3 server stack (`@elaraai/e3-core`, `@elaraai/e3-cli`,
  `@elaraai/e3-api-client`, `@elaraai/e3-api-server`, `@elaraai/e3-api-tests`).
- **Hybrid (TypeScript AGPL-3.0 / Python BSL 1.1)** — `east-py-datascience`.

For the full terms of any component, see its `libs/<name>/LICENSE.md` and
the per-package `LICENSE.md`.

## Repository-level files

All files that are **not** part of a component carrying its own
`LICENSE.md` — including the build tooling, `scripts/`, `docs/`,
`.github/`, the `Makefile`, and top-level configuration — are licensed
under the GNU Affero General Public License v3.0 or later
(AGPL-3.0-or-later).

Full text: https://www.gnu.org/licenses/agpl-3.0.html

## Commercial licensing

To use any dual-licensed component without the source-disclosure
requirements of AGPL-3.0, or to discuss licensing for Business Source
License components, contact Elara AI Pty Ltd at support@elara.ai.

## Contributions

By submitting a contribution you agree to license it under the license(s)
applicable to the component you are contributing to. See
[CONTRIBUTING.md](CONTRIBUTING.md) and [CLA.md](CLA.md).

## Governing Law

This file is governed by the laws of New South Wales, Australia.

---

*Elara AI Pty Ltd*
