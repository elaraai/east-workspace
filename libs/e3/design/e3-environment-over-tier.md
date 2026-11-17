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
  "namespaces": ["cuda", "nvidia"],
  "distributions": [
    { "name": "elaraai-east-py", "version": "1.0.109", "files": "sha256:9c1f…" },
    { "name": "torch", "version": "2.9.0+cu130", "files": "sha256:41be…" }
  ]
}
```

- Written to `/opt/e3/tier-manifest.json` by `tier-manifest.py`, a file of `@elaraai/e3-core`
  (standard library alone), sorted by name. An image's later layer that
  installs more writes it again: the datascience image's is its own.
- `distributions` are those of the site directory alone: an environment
  built over the tier imports from that directory, and no other of the
  interpreter's (the system's, a parent virtualenv's, `PYTHONPATH`'s). A name
  installed there twice, which no install makes, is listed for neither, as
  which files are whose cannot be told.
- Read by e3, it is checked as what it is, since it arrives from a rack and
  is written into an environment's `pyvenv.cfg` and import gate (section 9):
  the version a Python's, and the interpreter, base and site absolute paths,
  each on one line.
- `base` is the interpreter a virtualenv made over the tier runs: the one the
  image's own virtualenv was made from.
- `namespaces` is each directory at the top of the site directory that holds
  no `__init__` module: its namespace packages, whose parts an environment
  may leave to the tier singly (section 7).
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

Two things follow from matching by exact build:

- **The saving depends on the tier holding the build the lock pins.** A tier
  with another build of torch (a `+cu128` where the lock has `+cu130`, or the
  PyPI build where the lock has the PyTorch index's) holds another
  distribution: the project's ships whole, which is right, and saves nothing.
  Nothing yet makes a project's lock and a tier image resolve the same
  versions; #1662 proposes how a release pins them.
- **Every image of a tier writes its manifest with the same script.** An
  image built elsewhere for a tier, a rack's own GPU guest image say, has no
  manifest unless it runs `tier-manifest.py`, which is what gives it these
  digest rules. The script ships in each release's `@elaraai/e3-core` for
  that (3.6).

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
   in the tier. Distributions that install into one package with an
   `__init__` module are left to the tier together or not at all: Python
   finds such a package in the first directory that holds it, so a part that
   ships would hide the part left behind. A namespace package's parts are
   left singly (section 7). A distribution with native code that ships takes
   with it each distribution with native code it requires (section 8).
3. The virtualenv is pointed at the tier: `pyvenv.cfg`'s `home` names the
   directory of the tier's base interpreter, and a module in the
   environment's site directory, which a path file imports as Python starts,
   finds in the tier's site directory what was left there, runs its path
   files, and finds nothing else (section 9).
4. No interpreter is carried, and the link to the launching machine's is
   removed. The link to the tier's interpreter is made where the environment
   is composed, by the agent, with e3-core's `composeEnvironmentOverTier`: a
   layer holds no link that leads out of the environment, and that rule
   stays. The helper refuses an environment built over another interpreter.

So a project that pins another version of something the tier has ships its
own, and imports it; what it left to the tier is imported from there; and
nothing else of the tier's is imported or listed, as nothing else is where the
environment runs whole. A namespace package both hold parts of is read from
both, the environment's parts first, and a name in it that was not left to
the tier from the environment's parts alone.

A gate of the environment's own rather than `include-system-site-packages`,
because the images keep their packages in a virtualenv (`/opt/venv`): a
virtualenv made over another sees the base interpreter's packages, not that
virtualenv's, and would see all of them.

The tree is still built at the root a guest mounts it at
(`ENVIRONMENT_LAYER_ROOT`), and its layers are the package layers that remain
and the project layer.

**When it is built whole instead, as today:** no manifest (3.5); the project's
`requires-python` excludes the tier's minor; the environment is not python;
the build over the tier fails (8.4).

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
names `tier-manifests`: with its first heartbeat to the source, and then when
the source asks for it (section 8):

```json
{ "features": ["resources", "environments", "environments-over-tier"],
  "target": "x86_64-manylinux_2_28",
  "tiers": { "py": { "digest": "sha256:77ab…", "manifest": "{…}\n" },
             "py-datascience": { "digest": "sha256:c41d…", "manifest": "{…}\n" } } }
```

The hub keeps a manifest whose text is the bytes its digest names, for as
long as a rack reports it: no route is added for it, and a hub that restarts
asks for it, and has it again with the heartbeat after. It tells a session which image each rack
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
ghcr.io/elaraai/east-py cat /opt/e3/tier-manifest.json`). The images are
built after their release is made, so their manifests are not attached to
it. The script that writes one ships with it: `tier-manifest.py` is a file of
the release's `@elaraai/e3-core` package (`tier/tier-manifest.py`), beside the
reader of what it writes. An image built elsewhere for a tier takes it from
the package, which its lockfile pins, and so runs the release's own script
and not a copy of it.

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
  the tier's site directory; a pinned other version ships and wins; the path
  file of a distribution left to the tier runs, and no other (section 9).
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
   `include-system-site-packages` (3.3). Section 9 replaced the `.pth` with an
   import gate of the environment's own, after the review; the decision
   against `include-system-site-packages` stands.
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

## 7. The parts of a namespace package are left singly

Status: **approved 17 Nov 2026, and built.** It changed step 2 of 3.3 and the
manifest of 3.1, while no image had shipped a manifest and its form was
still free to change.

### 7.1 The fault, measured

As first built, distributions that installed into one top-level package were
left to the tier together or not at all. The rule is right for a package with
an `__init__.py`, which Python reads from the first directory that holds it.
It cost most where it was not needed.

torch's NVIDIA libraries all install into `nvidia/`: 15 distributions, 3.20 GB
installed, in the lock of 17 Nov 2026 for Linux x86_64. xgboost brings one
more, `nvidia-nccl-cu12` (0.43 GB), and asks for it at no version. So a
project with torch and xgboost locks a newer one than its tier holds (2.32.6
against 2.27.5 that day), the tier does not hold that build, and **all 16
ship, about 3.6 GB**, though the tier holds the other 15 exactly.
`cuda-pathfinder`, a small package that nothing pins, keeps `cuda-bindings`
(31 MB) the same way.

`nvidia/` and `cuda/` hold no `__init__.py`, in any of those distributions.
Python reads such a package, a namespace package, from **every** directory on
its path that holds a part of it. Its parts can be in two places.

### 7.2 Why the environment cannot decide alone

An environment sees its own distributions' files. It does not see the tier's
others. Were the tier to hold one distribution that installs
`nvidia/__init__.py`, `nvidia` would be an ordinary package there, Python
would stop at the first directory with that file, and a part the environment
ships could be passed over for the tier's older one, silently. So the tier
has to say which of its top-level packages are namespace packages.

### 7.3 The change

**The manifest names the tier's namespace packages.**

```json
{
  "version": 1,
  "python": { "version": "3.11.2", "executable": "/opt/venv/bin/python", "base": "/usr/bin/python3",
              "site": "/opt/venv/lib/python3.11/site-packages" },
  "namespaces": ["cuda", "nvidia"],
  "distributions": [ … ]
}
```

`namespaces` is each directory at the top of the site directory that holds no
`__init__` module, sorted: read from the directory itself, which is what
Python reads. The form stays version 1, since no image has shipped one; a
manifest without the field is refused.

**A top-level package binds its distributions unless it is a namespace
package on both sides**: no distribution of the environment installs an
`__init__` module in it, and the tier's manifest names it. Inside such a
package, distributions are bound one level down: by the directory or file
directly under it.

| Two distributions of the environment | Left to the tier |
|---|---|
| Share a top-level package that has an `__init__` module | Together or not at all |
| Share a top-level directory the tier does not name a namespace | Together or not at all |
| Share `nvidia/` only: `nvidia/cudnn` and `nvidia/nccl` | Each on its own |
| Share `nvidia/nccl`: xgboost's and torch's | Together or not at all |
| Share a namespace package inside a namespace package | Together or not at all: one level is read |

### 7.4 What it changes for a project

| The project, with no constraint of its own | As first built | With this |
|---|---|---|
| torch and xgboost | All 16 NVIDIA distributions ship: about 3.6 GB installed | The two that share `nvidia/nccl` ship: about 0.7 GB. The other 14 stay in the tier |
| torch | `cuda-bindings` ships with `cuda-pathfinder`: 31 MB | `cuda-pathfinder` ships alone |
| Either, with the release's pins as its constraints | Its own code | Its own code |

### 7.5 Tests

- The manifest script: a directory with no `__init__` module is named, one
  with one is not, nor a `.dist-info` or `__pycache__`; sorted; the same
  bytes twice.
- `readTierManifest`: a manifest without `namespaces` is refused.
- `leftToTier`: each row of 7.3's table, and a top-level package that one
  distribution of the environment gives an `__init__` module.
- The build over a tier: two distributions that share a namespace package,
  one the tier's build and one not. The first is left, the second ships, and
  both import, each from its own directory.

### 7.6 Decisions (approved 17 Nov 2026)

1. The manifest gains `namespaces`, required, in version 1.
2. Inside a namespace package, distributions are bound one level down; a
   namespace inside a namespace stays bound at that level.

### 7.7 What building it changed

- **An `__init__` module is any file named `__init__.`**, an extension
  module's included (`__init__.cpython-311-….so`), on both sides.
- **Compiled files bind nothing**, at any depth: a `__pycache__` directly in
  a namespace package would otherwise bind every module beside it.
- **The end-to-end test uses two real distributions** that share a namespace
  package, `jaraco.classes` and `jaraco.functools`: the tier's build of one is
  left, another version of the other ships, and both import, each from its
  own directory.

## 8. After the review: what a shipped part still meets

Status: **approved 17 Nov 2026, and built.** Three findings of the pull
request's review changed the manifest, the build and the report, while no
image had shipped a manifest and its form was still free to change.

### 8.1 A namespace package's part can be hidden by the tier's

Python reads a namespace package from the directories on its path it passes
before it finds a module or an ordinary package of that name, and imports
that one instead (PEP 420). The tier's site directory comes after the
environment's. So an environment that ships a part of a namespace package,
`pkg/` with no `__init__` module, while the tier holds an ordinary `pkg` or a
module `pkg.py`, runs the tier's: an older version, and nothing says so. A
pkgutil-style package, whose `__init__.py` calls `extend_path`, is an ordinary
one here too.

As first built, the manifest named `modules`: each name a module or an
ordinary package is imported by from the tier's site directory, or from a
directory its path files add. Once the environment was installed, a part of a
namespace package that would ship under one of those names refused the build
over the tier. Section 9 replaced both: the environment no longer has the
tier's site directory on its path, and looks a name inside a namespace
package both hold parts of up in its own parts unless it left that name to
the tier, at any depth. Nothing is refused, and the manifest names no
modules.

### 8.2 Native code finds native code by the environment's paths

An extension finds the libraries of a distribution it requires by a RUNPATH
relative to itself (`$ORIGIN/../../nvidia/cublas/lib`), or through
`site.getsitepackages()`, which names the environment's own site directory. A
torch that ships, with its NVIDIA libraries left to the tier, finds none of
them there.

So a distribution with native code (a file ending `.so`, with or without a
version after it, `.dylib`, `.pyd` or `.dll`) that ships takes with it each
distribution with native code it requires (`Requires-Dist`, by name, whatever
its markers say), with its group, and what that requires in turn. One left to
the tier takes nothing: the tier's copy finds the tier's libraries the same
way. A distribution with no native code that ships finds what it requires
through Python's path, which holds the tier's, and takes nothing.

| The environment's torch | Its NVIDIA libraries |
|---|---|
| The tier's build | Left to the tier |
| Another build | Ship with it |

### 8.3 A manifest's text is sent when it is wanted

A datascience tier's manifest is tens of KB, and a rack heartbeats every 15 s.
A rack sends a manifest's text with its first heartbeat to a source, and then
only with the heartbeat after an answer whose `x-e3-rack-tier-manifests-wanted`
header names its digest: a JSON array of the digests whose text the source
holds none of, and has not refused. Otherwise it sends the digest alone, by
which the hub keeps the text. A hub that started again holds none, and asks.

Rack protocol 3's structs are fixed, and the header leaves them as they are:
an agent that does not read it sends the text every time, as before, and a
text the hub refuses is said once in its log.

### 8.4 When a build over a tier fails

A build over a rack's image that fails (a dependency with no wheel for the
image's Python, say) is tried whole for the platform,
and the rack is served that. When both fail, the work stays local as
`environment:build-failed`, with the whole build's words.

### 8.5 Tests

- `leftToTier`: a torch of another build takes its native libraries with it,
  and theirs, and what shares a directory with them; one left to the tier
  takes nothing; a distribution with no native code takes nothing.
- The hub: a rack's first heartbeat carries the text and the next its digest
  alone; a hub that started again asks for it, once; a refused text is not
  asked for again (as section 9 narrows it).
- The placement: an environment whose build over the image fails is built
  whole and placed on the rack; both failing, it stays local.

## 9. After a further review: an environment sees only what it left to the tier

Status: **ruled 17 Nov 2026, and built.** Findings of a further review of the
pull request changed how an environment reaches its tier, the manifest, how a
spec an earlier release exported is read, and when the hub asks a rack for a
manifest. No image had shipped a manifest, and its form was still free to
change.

### 9.1 What an environment imports from its tier

As first built, a path file put the tier's whole site directory on
`sys.path`. A member whose lock has no scipy imported the tier's on a rack,
and failed to import it where it runs whole. pandas uses the optional
packages it finds (pyarrow-backed strings, bottleneck's reductions, which sum
in another order), so a rack's output could differ from a local run's, under
the one key that names both (3.4).

The tier's site directory is no longer on the path. The build writes a module
of its own into the environment's site directory, `_e3_tier.py`, and a path
file that imports it as Python starts, `zzz_e3_tier.pth`, read after the
environment's own. The module puts a finder before the path's on
`sys.meta_path`, which finds in the tier's site directory:

- a top-level module or package of a distribution left to the tier, when the
  environment holds none of that name;
- inside a namespace package both hold parts of, the parts left to the tier,
  and nothing else of the tier's: a name in it that was not left is looked for
  in the environment's own parts alone, and is not found when they hold none;
- the metadata of the distributions left to the tier (`importlib.metadata`),
  and of no other.

It runs the path files of the distributions left to the tier, as a site
directory's are read, and no other.

| A name | Imported from |
|---|---|
| The environment's own | The environment |
| Left to the tier | The tier |
| In the tier, and not in the environment's lock | Nowhere, as where the environment runs whole |
| A part of a namespace package the environment ships | The environment, whatever the tier holds of that name |

What the gate is given, e3-core's `tierImports` reads from the environment's
records and the tier's manifest: the names of what was left, at the levels
`leftToTier` binds distributions by (7.3), the top or one level down in a
namespace package on both sides; the namespace packages both hold parts of;
and the path files of what was left.

### 9.2 The manifest names no modules, and nothing is refused

8.1's `modules` and its refusal are gone. They read the top level alone,
while a namespace package's parts are left one level down: a distribution of
the tier's that the environment lacks, which installs `ns/sub/__init__.py`,
would hide an `ns/sub/` the environment ships. The gate looks a name inside a
namespace package both hold parts of up in the environment's own parts, at
any depth, unless it was left to the tier. So no build over a tier is refused
for a hidden part (a refusal that came only after the whole install, and was
tried again each run), and the manifest's form is version 1 without the
field.

With bytecode compiling on (`UV_COMPILE_BYTECODE=1`, or the workspace root's
`[tool.uv] compile-bytecode = true`), uv writes `.pyc` files that no `RECORD`
lists. Taking a distribution left to the tier out of the environment takes
the compiled files of each module it removes with it
(`__pycache__/<module>.*.pyc`), so neither a directory that holds only them
nor stale bytecode ships.

### 9.3 A spec an earlier release exported is refused

`workspace_python` (#1654) is a sixth case of the environment spec. A spec an
earlier release exported, of five cases, decodes under the new type, but gc,
which takes a spec by its current shape, would take it for a leaf and sweep
the files it names. Every reader of a spec (a build, a package export's walk,
the check that it fits a tier) reads it at the current type alone
(`decodeEnvironmentSpec`, e3-types), and refuses another: "the environment
<hash> was exported by an older e3 SDK — re-export its package with the
current one". [`WIRE_MIGRATION.md`](../../../docs/conventions/WIRE_MIGRATION.md)
lists the change.

### 9.4 When the hub asks for a manifest's text

A text the hub had refused was asked of no rack again, whatever the reason.
Now a text that is the bytes its digest names, and is still refused, is asked
of no rack, since every rack's text of that digest is those bytes. A text
that is not those bytes stops the asking of the rack that sent it alone: a
rack that names the digest honestly is asked, and its text kept (8.3).

### 9.5 Tests

- The gate, run by a Python over a tier of files: a package left to the tier
  imports, and one not left does not; only the first's metadata is listed;
  only its path file runs; the tier's site directory is not on the path; the
  parts of a namespace package the environment ships are imported from it
  over a package and a module of the tier's of those names.
- `tierImports`: what was left, at the top and one level down in a namespace
  package both hold parts of; the path files; only the namespace packages the
  environment holds parts of.
- The build over a tier: what the lock never installed, and a path file of no
  distribution left to the tier, are neither imported nor listed; a tier
  whose `jaraco` is an ordinary package builds, and the environment imports
  its own parts; with bytecode compiling on, the compiled files of what is
  left go too.
- `decodeEnvironmentSpec` refuses a spec of five cases, and each reader refuses
  through it.
- The hub: a rack that sent a text that was not the bytes of its digest is not
  asked again, and another that names the digest is; a text refused for its
  own bytes is asked of no rack.
