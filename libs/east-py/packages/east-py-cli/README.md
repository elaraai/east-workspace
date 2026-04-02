# east-py-cli

[![License: BSL 1.1](https://img.shields.io/badge/License-BSL%201.1-orange.svg)](LICENSE.md)

Command-line interface for running East IR programs with Python platform functions.

## Installation

```bash
uv add east-py-cli

# Platform packages are installed separately as needed
uv add east-py-std          # console, crypto, fetch, fs, path, random, time
uv add east-py-io           # s3, sqlite, postgres, mysql, redis, mongodb, xlsx, xml, gzip, tar, zip, ftp, sftp
uv add east-py-datascience  # sklearn, scipy, xgboost, lightgbm, ngboost, torch, shap, optuna, simanneal, mads
```

## Usage

### Running Programs

```bash
# Run with platform packages
east-py run program.beast2 -p east-py-std

# Run with multiple platforms
east-py run program.json -p east-py-std -p east-py-io -p east-py-datascience

# With input and output files
east-py run program.beast2 \
  -p east-py-std \
  --input data.beast2 \
  --input config.json \
  --output result.beast2

# Verbose output
east-py run program.beast2 -p east-py-std -v
```

### Version and Platform Info

```bash
# Show CLI version
east-py version

# Show version with platform info
east-py version -p east-py-std -p east-py-io
```

Example output:
```
east-py-cli 0.1.0
east-py 0.1.0

Platforms:
  east-py-std 0.1.0 (47 platform functions)
  east-py-io 0.1.0 (59 platform functions)
```

## File Formats

IR and data files are auto-detected by extension:

| Extension | Format |
|-----------|--------|
| `.beast2`, `.beast` | Binary East v2 |
| `.east` | East text format |
| `.json` | JSON |

## Creating Platform Packages

Platform packages must export a `platform` attribute containing a list of platform functions:

```python
# my_platform/__init__.py
from east.runtime.platform import platform_function

@platform_function("my_func", inputs=[StringType], output=IntegerType)
def my_func_impl(s):
    return len(s)

platform = [my_func_impl]
```

## License

**BSL 1.1 (Business Source License):**
- Non-production use (evaluation, testing, development) is free
- Production use by or on behalf of for-profit entities requires a commercial license
- Code becomes AGPL-3.0 four years after each release

See [LICENSE.md](LICENSE.md) for full details.

**Commercial licensing:** support@elara.ai

### Ecosystem

- **[East Node](https://github.com/elaraai/east-node)**: Node.js platform functions for I/O, databases, and system operations. Connect East programs to filesystems, SQL/NoSQL databases, cloud storage, and network services.
  - [@elaraai/east-node-std](https://www.npmjs.com/package/@elaraai/east-node-std): Filesystem, console, HTTP fetch, crypto, random distributions, timestamps
  - [@elaraai/east-node-io](https://www.npmjs.com/package/@elaraai/east-node-io): SQLite, PostgreSQL, MySQL, MongoDB, S3, FTP, SFTP
  - [@elaraai/east-node-cli](https://www.npmjs.com/package/@elaraai/east-node-cli): CLI for running East IR programs in Node.js

- **[East Python](https://github.com/elaraai/east-py)**: Python runtime and platform functions for data science and machine learning. Execute East programs with access to optimization solvers, gradient boosting, neural networks, and model explainability.
  - [@elaraai/east-py-datascience](https://www.npmjs.com/package/@elaraai/east-py-datascience): TypeScript types for optimization, gradient boosting, neural networks, explainability

- **[East UI](https://github.com/elaraai/east-ui)**: East types and expressions for building dashboards and interactive layouts. Define UIs as data structures that render consistently across React, web, and other environments.
  - [@elaraai/east-ui](https://www.npmjs.com/package/@elaraai/east-ui): 50+ typed UI components for layouts, forms, charts, tables, dialogs
  - [@elaraai/east-ui-components](https://www.npmjs.com/package/@elaraai/east-ui-components): React renderer with Chakra UI styling

- **[e3 - East Execution Engine](https://github.com/elaraai/e3)**: Durable execution engine for running East pipelines at scale. Features Git-like content-addressable storage, automatic memoization, task queuing, and real-time monitoring.
  - [@elaraai/e3](https://www.npmjs.com/package/@elaraai/e3): SDK for authoring e3 packages with typed tasks and pipelines
  - [@elaraai/e3-core](https://www.npmjs.com/package/@elaraai/e3-core): Git-like object store, task queue, result caching
  - [@elaraai/e3-types](https://www.npmjs.com/package/@elaraai/e3-types): Shared type definitions for e3 packages
  - [@elaraai/e3-cli](https://www.npmjs.com/package/@elaraai/e3-cli): `e3 init`, `e3 run`, `e3 logs` commands for managing and monitoring tasks
  - [@elaraai/e3-api-client](https://www.npmjs.com/package/@elaraai/e3-api-client): HTTP client for remote e3 servers
  - [@elaraai/e3-api-server](https://www.npmjs.com/package/@elaraai/e3-api-server): REST API server for e3 repositories

## Links

- **Website**: [https://elaraai.com/](https://elaraai.com/)
- **East Repository**: [https://github.com/elaraai/East](https://github.com/elaraai/East)
- **Issues**: [https://github.com/elaraai/east-py/issues](https://github.com/elaraai/east-py/issues)
- **Email**: support@elara.ai

## About Elara

East is developed by [Elara AI Pty Ltd](https://elaraai.com/), an AI-powered platform that creates economic digital twins of businesses that optimize performance. Elara combines business objectives, decisions and data to help organizations make data-driven decisions across operations, purchasing, sales and customer engagement, and project and investment planning. East powers the computational layer of Elara solutions, enabling the expression of complex business logic and data in a simple, type-safe and portable language.

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/)*
