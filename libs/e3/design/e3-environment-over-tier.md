# Environments built over their base tier (#1655)

Status: **approved 16 Nov 2026, and built** in the same change as #1654: all
of it but the rack agent's own half (3.7), which is the agent's. Section 6
lists what building it changed. It follows
[`e3-environment-granularity.md`](e3-environment-granularity.md) and
[`e3-rack-delegation.md`](e3-rack-delegation.md), and pairs with the
member-only install (#1654), which it assumes.

## 1. The problem, in numbers

A rack runs a task's environment from layers the launching machine built: an
interpreter layer, package layers holding everything the lock installs, and a
project layer. The tier image the rack boots already holds much of it.

A member that uses torch, on `py-datascience`, ships 3.08 GB of layers
(5.4 GB installed). The tier has the same torch build. After #1654 a member
ships only its own dependencies, and this change removes what the tier already
has: such a member ships its own code and whatever the tier lacks.

## 2. What a user sees

Nothing changes in a project. A run on a rack that boots environments over
its tier builds less and says so:

```
$ e3 dataflow run . dev --rack
  [ENV] 3f9a2b1c0d4e for x86_64-manylinux_2_28 over py-datascience: building
  [ENV] 3f9a2b1c0d4e built in 41 s: 2 layers, 6.2 MB (2 new), 31 distributions from the tier
  [RACK] train → workshop (cap 16 GB)
```

On a rack that does not, or for a project whose Python the tier does not
have, the line and the layers are today's:

```
  [ENV] 3f9a2b1c0d4e for x86_64-manylinux_2_28: building
  [ENV] 3f9a2b1c0d4e built in 48 s: 4 layers, 2.1 GB (1 new)
```

## 3. Design

### 3.1 A tier says what it contains

Each python runtime image (`docker/images/Dockerfile.east-py`,
`Dockerfile.east-py-datascience`) ends with a step that writes its manifest:

```json
{
  "version": 1,
  "python": { "version": "3.11.2", "executable": "/opt/venv/bin/python", "base": "/usr/bin/python3",
              "site": "/opt/venv/lib/python3.11/site-packages" },
  "distributions": [
    { "name": "elaraai-east-py", "version": "1.0.109", "files": "sha256:9c1f…" },
    { "name": "torch", "version": "2.9.0+cu130", "files": "sha256:41be…" }
  ]
}
```

- Written to `/opt/e3/tier-manifest.json` by `docker/images/tier-manifest.py`
  (standard library alone), sorted by name. An image's later layer that
  installs more writes it again: the datascience image's is its own.
- `base` is the interpreter a virtualenv made over the tier runs: the one the
  image's own virtualenv was made from.
- A manifest's **digest** is the SHA-256 of its bytes.
- The node and C tiers write none: this change is python environments.

### 3.2 What makes two distributions the same

Name (PEP 503), version (local label included: `+cu130` is not `+cpu`), and
**the digest of the files it installed**: the rows of its `RECORD` — each
file's path, hash and size in the site directory — sorted, leaving out the
bookkeeping an installer writes beside them (`RECORD` itself, `INSTALLER`,
`REQUESTED`, `direct_url.json`), compiled files, and what is installed
outside the site directory: a script, whose first line names the interpreter
it was installed for, so it differs on every machine.

- Never name and version alone.
- It can say "different" of two installs of one wheel (an installer that
  writes another file). That ships a copy the tier had, as today: larger, and
  still right. It cannot say "same" of different files.
- It needs no change to how images install. The cost: the launching machine
  still downloads what the tier has, once, into uv's cache, to learn that it
  is the same. It neither packs nor ships it.

This departs from the issue's "wheel hash": uv keeps no wheel hash for a
distribution it has installed, so an image could not say one without
installing from a hashed lock.

### 3.3 The build leaves out what the tier has

`materializeEnvironmentFor` takes the tier's manifest beside the platform.
With one:

1. The virtualenv is made with the tier's Python minor (`uv venv --python
   3.11`), and the environment installed for the platform as today (the
   member-only sync of #1654, the required distributions, the project's
   wheels).
2. Each installed distribution the manifest holds as the same (3.2) is
   removed from the site directory, with its `.dist-info`. Its scripts stay:
   they run on the environment's interpreter, which finds the distribution
   in the tier. Distributions that install into one top-level package (a
   family that shares `nvidia/`, say) are left to the tier together or not at
   all: Python finds a package in the first directory that holds it, so a
   part that ships would hide the part left behind.
3. The virtualenv is pointed at the tier: `pyvenv.cfg`'s `home` names the
   directory of the tier's base interpreter, and one `.pth` file in the
   environment's site directory adds the tier's with `site.addsitedir`, so the
   tier's own `.pth` files are read as a site directory's are.
4. No interpreter is carried, and the link to the launching machine's is
   removed. The link to the tier's interpreter is made where the environment
   is composed, by the agent, with e3-core's `composeEnvironmentOverTier`: a
   layer holds no link that leads out of the environment, and that rule
   stays. The helper refuses an environment built over another interpreter.

So `sys.path` holds the environment's site directory first, then the tier's: a
project that pins another version of something the tier has ships its own,
and its own wins.

A `.pth` rather than `include-system-site-packages`, because the images keep
their packages in a virtualenv (`/opt/venv`): a virtualenv made over another
sees the base interpreter's packages, not that virtualenv's.

The tree is still built at the root a guest mounts it at
(`ENVIRONMENT_LAYER_ROOT`), and its layers are the package layers that remain
and the project layer.

**When it is built whole instead, as today:** no manifest (3.5); the project's
`requires-python` excludes the tier's minor; the environment is not python.

### 3.4 What names the layers

The spec hash does not change: it is in every task's cache key, and what a
task computes does not depend on where its packages came from. The **layers'**
key gains the tier and its manifest's digest:

```
env-layers/manifests/<envHash>-<e3Version>-<platform>.json                       built whole
env-layers/manifests/<envHash>-<e3Version>-<platform>-<tier>-<digest 12>.json    built over a tier
```

A new tier image has a new manifest, and so a new key: the environment is
built again over it, which is cheap, since it is small. The layer manifest
records `over: { tier, manifest: "sha256:…" }`, and a rack composes it only
over a tier whose manifest is that one.

### 3.5 Negotiated per rack

A rack that can boot an environment over its tier says so with its
heartbeats, in the report it already sends (JSON, read for what a reader
knows, so no rack protocol number moves). It names each tier image by its
manifest's digest, and sends the manifest's text to a source whose hello
names `tier-manifests`:

```json
{ "features": ["resources", "environments", "environments-over-tier"],
  "target": "x86_64-manylinux_2_28",
  "tiers": { "py": { "digest": "sha256:77ab…", "manifest": "{…}\n" },
             "py-datascience": { "digest": "sha256:c41d…", "manifest": "{…}\n" } } }
```

The hub keeps a manifest whose text is the bytes its digest names, for as
long as a rack reports it: no route is added for it, and a hub that restarts
has it again with the next heartbeat. It tells a session which image each rack
names, and answers a manifest by its digest. The launching machine builds an
environment over an image only for racks that name it; for any other rack it
builds whole. Two racks with different images of one tier are two builds.

The feature word gates the rack's side: a rack that does not say it is never
built for. The hub's control protocol says more of each rack and gains the
manifest request, so its number moves (4 → 5), as it does whenever a
launching machine asks its hub something an older hub would not know.

A rack that names an image is served the layers built over it when its
session keeps them, and the whole environment's otherwise: so an environment
that does not fit the image runs there too.

| The rack | The environment |
|---|---|
| Says `environments-over-tier`, names the lease's tier's manifest | Built over that tier; composed over it |
| Says `environments` alone | Built whole, as today |
| Names a manifest whose text the hub does not hold | Built whole |
| Project's Python is not the tier's minor | Built whole |
| Its tier image changes | A new digest: built again over it |

### 3.6 Where a manifest comes from: one change to the ruling

The ruling was that each image writes its manifest at build, the release
ships it, and `@elaraai/e3-rack` carries the stock tiers' manifests for its
version. The last part cannot be done as written: the images are built
**after** npm and PyPI serve the release, from the published packages
(`docker-publish.yml`), so a package cannot contain the manifest of an image
built from it.

Proposed instead: the image carries its manifest (3.1); a launching machine
gets the manifest of the tier a rack actually boots **from that rack, through
the hub, by the digest its heartbeat names**. It is then always the manifest
of the image that will run the work, a rack's own tier image included.

An image's manifest is read from the image (`docker run --rm
ghcr.io/elaraai/east-py cat /opt/e3/tier-manifest.json`). Attaching each to
its release as an asset, for inspection, is not built: the publish workflow
would have to write to a release, which is a change to the release of its
own.

### 3.7 What is e3's, and what is the rack agent's

- **In this repository**: the manifest script and the two Dockerfiles; the
  manifest's type and digest; the build over a tier (e3-core); the layers'
  key and `over` (e3-rack); the report's `tiers` and the hub's manifest
  request; the test agent, which is given a manifest of a Python of this
  machine's, so the whole path runs in the suites.
- **The rack agent's**: reading the manifest from its tier images, saying the
  feature, the digests and the manifests' text in its report, and booting an
  environment over its tier: unpacking its layers, then linking its
  interpreter with `composeEnvironmentOverTier`. Until an agent says the
  feature, every environment is built whole.

## 4. Tests

- The manifest script over a virtualenv of known distributions: names,
  versions, file digests, sorted; the same install twice gives the same bytes.
- Identity: the same wheel installed twice is the same; `+cpu` against
  `+cu130`, and one changed file, are not.
- The build: a workspace member over a manifest that holds one of its
  dependencies ships the other and its own code; the pruned one imports from
  the tier's site directory; a pinned other version ships and wins; the
  tier's `.pth` file is read.
- Built whole: no manifest, and a `requires-python` that excludes the tier's
  minor.
- The key and `over`; a rack that names another manifest is not given the
  layers.
- End to end on the test agent: a task whose environment is built over the
  test tier runs and returns the local run's output.

## 5. Decisions (approved 16 Nov 2026)

1. The manifest reaches the launching machine from the rack through the hub,
   not inside `@elaraai/e3-rack` (3.6).
2. Identity is the digest of a distribution's installed files, bookkeeping
   left out (3.2).
3. The tier's packages are reached by a `.pth` with `site.addsitedir`, not
   `include-system-site-packages` (3.3).
4. A project whose Python is not the tier's minor is built whole (3.3).
5. The launching machine still downloads what the tier has, and does not
   ship it (3.2).
6. Python environments first; node environments later.

## 6. What building it changed

- **Scripts are outside the identity, and stay.** A script's first line names
  the interpreter it was installed for, so a digest that held it would make
  every distribution with a console script differ from the tier's. Scripts
  are left out of the digest and are never removed (3.2, 3.3).
- **The interpreter link is the agent's to make.** The layer format refuses a
  link that leads out of the environment, as its unpacker must. So the build
  ships no link to the tier's interpreter, and the agent makes it after
  unpacking, through one shared helper (3.3 step 4).
- **The manifest names the base interpreter** (`python.base`): a virtualenv's
  `home` must be the interpreter the tier's own virtualenv was made from, not
  that virtualenv.
- **Families move together** (3.3 step 2).
- **No image label.** A label cannot be computed inside the image's build;
  the manifest file's own bytes are what is digested.
- **Whether an environment fits a tier is asked before it is built**
  (`environmentFitsTier`: a python environment whose lock's `requires-python`
  takes the tier's Python), so one that does not is built whole once, under
  the whole build's key, and shared with every rack.
- **The manifest travels in the report.** A rack only ever calls its source,
  so nothing can ask it for a manifest. Its report carries the text, which
  the hub checks against the digest and keeps in memory; the launching
  machine asks the hub and keeps nothing on disk, since a manifest is only
  of use while a rack reports it.
