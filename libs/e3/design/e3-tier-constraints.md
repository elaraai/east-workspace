# A project and its tier resolve the same torch (#1662)

Status: **approved 17 Nov 2026, and built** in this change. Section 7 lists
what building it changed, and section 8 what its review changed: the east-py
packages and their images move to Python 3.12, which leaves no NCCL library to
leave out, and an image takes its release's pins from the published package.
It follows [`e3-environment-over-tier.md`](e3-environment-over-tier.md)
(#1655), and is what makes that change pay off for a project that uses torch.

## 1. The problem, measured

An environment built over its tier leaves a distribution to the tier only
when the tier holds **that exact build**: the same name, version and installed
files. Nothing made a project and a tier resolve the same builds, and they
did not.

Resolved on 17 Nov 2026 for Python 3.11 on Linux x86_64, at release 1.0.108,
before this change:

| Who resolved | torch | Its NVIDIA libraries |
|---|---|---|
| The workspace's lock (`libs/east-py/uv.lock`), which the package's own tests ran against | 2.10.0 | `nvidia-*-cu12`, CUDA 12.8 |
| A `py-datascience` image built that day, unlocked: `uv pip install "elaraai-east-py-datascience[all]==1.0.108"` | 2.15.0 | CUDA 13 |
| A project that asked for the `torch` extra that day (`torch>=2.4.0`) | 2.15.0 | CUDA 13 |

The last two agreed only because both were resolved on the same day. An image
is resolved when its release is built, and a project when it locks.

Three faults followed, and the first is the one the issue names.

1. **A project's torch was not its tier's.** Against a tier that held the
   workspace's lock, a project that asked for torch and pytorch-lightning
   resolved 46 distributions, of which 11 were the tier's build and **none of
   the 20 that make up torch, its NVIDIA libraries and triton**. Those 20 are
   nearly all of an environment's size: 3.08 GB of layers in #1655's
   measurement.
2. **The image was not what was tested.** Of the 116 distributions the lock
   and that day's image both held, **70 were at another version**.
3. **The image missed the workspace's override.** The workspace sets
   `override-dependencies = ["shap>=0.51.0"]`, because econml pins `shap<0.49`
   and, as its comment says, shap before 0.51 cannot read current xgboost
   models. An override belongs to the workspace and is not part of what a
   package publishes, so the image resolved **shap 0.48.0** beside xgboost
   3.2.0, where the lock holds 0.51.0.

## 2. What a user sees

A member that uses torch asks for it through the package's extras, and names
no torch of its own:

```toml
# packages/python/trainer/pyproject.toml
[project]
name = "trainer"
dependencies = [
  "elaraai-east-py-datascience[torch,lightning]",   # not "torch", "pytorch-lightning"
]
```

Its lock then holds the torch from PyPI its release was tested with, which is
the torch of that release's `py-datascience` image. On a rack that boots such
an image, the member's environment leaves torch to the tier, and its `[ENV]`
line says how much it left:

```
before     [ENV] 3f9a2b1c0d4e built in …: … layers, … (… new), 11 distributions from the tier
pinned     [ENV] 3f9a2b1c0d4e built in …: … layers, … (… new), 31 distributions from the tier
```

The counts are resolved the same way as section 1, for Python 3.11 at release
1.0.108; the sizes wait on a build. With the extras pinned a torch member
resolves 46 distributions, **31 of them the tier's build, and 19 of the 20 in
torch's family**. What still ships is the 15 that nothing pins, numpy the
largest: aiohttp and four it needs, filelock, fsspec, idna, markupsafe, numpy,
packaging, setuptools, tqdm, typing-extensions and cuda-pathfinder.

So the pin leaves torch, its NVIDIA libraries and triton to the tier, and what
still ships is small beside them. The release's constraints (3.6) take it to
the project's own code.

**A member that also uses xgboost needs nothing more.** The extras ask for
xgboost 3.4 or later, whose NCCL library is `nvidia-nccl-cu13`, the one torch
pins (3.2): the tier holds the one library both load, and the member's
environment leaves it there with torch's other NVIDIA libraries.

| The project | The rack's tier image | What its environment ships |
|---|---|---|
| Asks for `[torch,lightning]`; the image is of a release with the same pin | Holds that torch | Its own code, and what nothing pins (numpy and the like) |
| The same, and adds the release's constraints (3.6) | Holds every pin | Its own code |
| Asks for `[torch,xgboost]` | Holds that torch | Its own code, and what nothing pins: xgboost's NCCL library is torch's |
| Asks for the extras, and takes torch from a PyTorch index | Holds PyPI's build | Its own torch, whole: the index's `+cpu` or `+cu130` build meets the pin, and is not the image's |
| Asks for the extras; the image is of a release with another pin | Holds another torch | Its own torch, whole: right, and no saving |
| Lists `torch` itself, any version | Any | Its own torch, whole, as before |
| Needs another torch than the release pins | Any | It drops the extras and lists torch, as the row above |
| Uses no torch | Any | Nothing of torch: #1654 already left it out |

## 3. Design

### 3.1 The extras pin torch and pytorch-lightning exactly

`libs/east-py/packages/east-py-datascience/pyproject.toml`:

```diff
 torch = [
-    "torch>=2.4.0",
+    "torch==2.15.0",
     "cloudpickle>=3.0.0",
 ]
 lightning = [
-    "torch>=2.4.0",
-    "pytorch-lightning>=2.2.0",
+    "torch==2.15.0",
+    "pytorch-lightning==2.6.6",
     "cloudpickle>=3.0.0",
 ]
```

and the same two lines in `all`. torch pins its NVIDIA libraries and triton
exactly, so the one pin fixes all of them.

- **The first pin is the newest**: torch 2.15.0 and pytorch-lightning 2.6.6,
  which is what a project on the extras resolved already. The lock moved to
  them with `uv lock --upgrade-package torch --upgrade-package
  pytorch-lightning`, and nothing else in it moved but what torch brings:
  triton 3.6.0 to 3.9.0, and the NVIDIA libraries from CUDA 12.8 to CUDA 13.
  torch's macOS wheels are now for macOS 14 and later.
- **The pin and the lock are held together** by `scripts/check-version-drift.mjs`,
  which runs on every pull request: the three extras pin both exactly, the
  same in each, at the one version the lock holds.
- **Moving the pin is one pull request**: the pin, and `uv lock`. The
  package's suites then run against the new torch before any release ships
  it.

What it costs, said plainly:

- A project that asks for the extras **and** names another torch no longer
  resolves. It drops the extras and lists torch itself.
- A project on the extras no longer gets a newer torch by locking again: it
  gets one when a release moves the pin.
- A Python the pinned torch has no wheel for cannot install the extras until
  the pin moves.
- A pin with no local label is met by every local label: a project that takes
  torch from a PyTorch index locks that index's build (`2.15.0+cpu`,
  `2.15.0+cu130`), which meets the extras and is not the image's, so it ships
  whole.

### 3.2 torch and xgboost share one NCCL library

Moving to torch 2.15.0 opened a fault that the lock had not had.

torch 2.11 and later bring their NCCL library as `nvidia-nccl-cu13`, pinned
exactly. xgboost 3.2.0, the newest that runs on Python 3.11, asks for
`nvidia-nccl-cu12`; xgboost 3.4 asks for `nvidia-nccl-cu13`, and needs Python
3.12. The two distributions install **the same file**,
`nvidia/nccl/lib/libnccl.so.2`. Whichever is installed last wins, and with
xgboost's older one on top, torch does not import:

```
libtorch_cuda.so: undefined symbol: ncclCommResume
```

It failed one run of the package's suites and passed the run before it, on
the same commit.

The east-py packages need Python 3.12, and the extras ask for xgboost 3.4 or
later (`xgboost>=3.4.0`), so the lock holds xgboost 3.4.1, which asks for
torch's own library on Linux: one NCCL library is installed,
`nvidia-nccl-cu13` 2.30.7, the one torch pins, and nothing is left out. This
change was first built by leaving xgboost's library out
(`exclude-dependencies`), and its review found that unworkable (8.1).

A project needs nothing for it: it locks the same xgboost through the extras,
or any xgboost 3.4 or later of its own.

### 3.3 Two pin files, exported from the lock

The release's pins are **the workspace's lock, exported**, with the setting
it was resolved under:

```sh
uv export --frozen --all-packages --all-extras --no-default-groups \
          --no-emit-workspace --no-emit-local --no-header
```

- `east-py-constraints.txt`: every third-party pin of the lock, with hashes
  and platform markers: 198 pins. It covers both python tiers, and anything
  built from a part of them.
- `east-py-overrides.txt`: the workspace's `override-dependencies`.
  `shap>=0.51.0` today.

`scripts/east-py-constraints.py <workspace> <out>` writes the two, from the
workspace root's `pyproject.toml` and `uv.lock` alone: a frozen export reads
no member's manifest. Each names the release it is of in its first line, and
with `--release <version>` the script refuses a lock that is another
release's. It refuses a workspace that excludes a distribution
(`exclude-dependencies`): no pin file keeps a distribution out of an install,
so an image would install what the lock left out.

They are **kept in `@elaraai/e3-core`**, in `tier/`, beside `tier-manifest.py`,
and are committed: nobody edits them, the release's version bump writes them
again of the lock it makes (`scripts/set-python-version.mjs`), and a test
holds them to the lock on every pull request.

This departs from the issue, which proposed `uv pip compile --universal
--generate-hashes` of the released package:

- **A compile at release time is a new resolution that nothing tested.** The
  lock is what the suites ran against.
- **A compile cannot reproduce the lock.** Under the lock's pins alone,
  `elaraai-east-py-datascience[all]` does not resolve: econml 0.16.0 depends
  on `shap>=0.38.1,<0.49.0`, which the override lifts.
- It needs no network, and no package to be published first.

The files are named for what they hold, the east-py packages' pins, where the
issue named one for one tier.

### 3.4 The images install under them

`Dockerfile.east-py`, `Dockerfile.east-py-datascience` and `Dockerfile.e3`
install a named release under its pins: `install-packages.sh` fetches the two
files from that release's published `@elaraai/e3-core` (`npm pack
@elaraai/e3-core@<version>`) into `/opt/e3/`, where they stay, refuses them
unless their first lines name that release, and passes them to each `uv pip
install` it runs.

```dockerfile
RUN EAST_PY_PINS_DIR=/opt/e3 /tmp/install-packages.sh --py-only
```

So an image holds the lock's build of everything, shap 0.52.0 and one NCCL
library included, and its tier manifest says so. The install script ends by
importing torch and xgboost in one process, so an image in which they do not
load together is not built.

The images' Python is 3.12, as uv builds it (`uv python install 3.12`, kept
under `/opt/python`): the system's is 3.11. The python tier's virtualenv is
made by it without pip (`python -m venv --without-pip /opt/venv`): made with
it, it also holds the pip a Python seeds a virtualenv with, at a version the
pins do not hold, which no package in it needs. An image built `FROM` a python
tier adds packages with `uv pip install`, which installs into its virtualenv.
The e3 image's virtualenv keeps its pip.

| The build | Installs |
|---|---|
| A version is named (`EAST_PY_VERSION=1.0.110`): a release's images | Under the pins its published `@elaraai/e3-core` ships, fetched as it is built |
| Those pins name another release | Refused, by name |
| `latest`, a local convenience | Unconstrained, as before, and keeps no pins |
| No uv on the `PATH` | Refused: a python install needs it |

### 3.5 The release ships them in a package

The two files and `tier-manifest.py` are files of the release's
`@elaraai/e3-core` (`tier/`), found by the package's name:

```
node_modules/@elaraai/e3-core/tier/tier-manifest.py
node_modules/@elaraai/e3-core/tier/east-py-constraints.txt
node_modules/@elaraai/e3-core/tier/east-py-overrides.txt
```

The release's own images take them from there (3.4), and so does **an image
built elsewhere for a tier**, a GPU guest image say: its lockfile pins the
package, where a release's assets can be replaced and nothing pins them. It
installs with uv under the two, then writes its manifest:

```sh
uv pip install --constraint east-py-constraints.txt --override east-py-overrides.txt \
               "elaraai-east-py-datascience[all]==<release>"
python tier-manifest.py /opt/e3/tier-manifest.json
```

pip takes constraints, and no overrides, so it cannot install under these.

### 3.6 A project that wants every pin

The extras' pin leaves torch to the tier, which is nearly all of the size.
For the rest, a project puts the release's settings in its workspace root:

```toml
[tool.uv]
override-dependencies = ["shap>=0.51.0"]      # with the causal and shap extras: the release's east-py-overrides.txt
constraint-dependencies = [
  # each pin of the release's east-py-constraints.txt it wants held, as `name==version ; marker`
  "numpy==2.3.5 ; platform_machine == 'x86_64' and sys_platform == 'darwin'",
  "numpy==2.4.4 ; platform_machine != 'x86_64' or sys_platform != 'darwin'",
]
```

A pin is taken with its marker, and nothing else of its line: not the
trailing `\`, which in a TOML string escapes the closing quote, nor the
`--hash` lines and `# via` notes after it. Every pin of a name goes in, or one
platform is held at another's version: numpy is pinned at 2.3.5 for macOS on
x86_64, where numba and llvmlite hold it, and at 2.4.4 everywhere else.

The override gives a project that uses the `causal` and `shap` extras together
a shap that reads current xgboost models: without it, it resolves shap 0.48.0.
e3's environment build ends with `uv pip check`, which reads each
distribution's own requirements and knows nothing of an override, so econml's
`shap<0.49.0` fails it. The build passes a failure whose every
incompatibility the lock's own settings explain, and fails every other (8.5).

### 3.7 What says it

- `east-py-datascience`'s README and skill: ask for the extras, not for torch;
  Python 3.12; how a pin is taken.
- The rack docs' section on environments over a tier: how a project gets the
  saving.
- The python images' Dockerfiles: their Python, and `uv pip install` in an
  image built from one.
- [`e3-environment-over-tier.md`](e3-environment-over-tier.md) points here.


## 4. What this does not do

- **Pin anything else.** xgboost, pymc and the rest float in a project's
  lock, and ship when they differ from the tier's. Section 3.6 holds them.
- **Write a project's settings for it.** Section 3.6 is by hand. A command
  that writes them from a release could follow, if the by-hand step is used.
- **Change the project template's dependencies.** It lists the package with
  no extras, and a member that wants torch asks for the extras itself. Its
  `requires-python` moves to 3.12 (8.1).
- **Fix the override for a project's own installs.** It is not published with
  a package. Section 3.6 documents the line.
- **Keep Python 3.11.** The packages, the template and the images move to 3.12
  (8.1).

## 5. Decisions (approved 17 Nov 2026)

1. The first pin is the newest torch, 2.15.0, with pytorch-lightning 2.6.6:
   the lock is upgraded to them, and the package's suites prove them (3.1).
2. torch stays at 2.15.0 where it met xgboost's NCCL library: first by
   leaving xgboost's out; at review, by moving to Python 3.12 and xgboost 3.4,
   which asks for torch's (3.2, 8.1).
3. The pins are the lock's export, not a compile at release time, with the
   overrides beside them (3.3).
4. One constraints file for both python tiers, named
   `east-py-constraints.txt` (3.3).
5. A named version is built under them; `latest` is not (3.4).
6. They ship in `@elaraai/e3-core`, and not as assets of the release (3.5).
7. The extras' pin is checked against the lock in the version drift check
   (3.1).

At review, the same day:

8. The east-py packages, the project template and the python images move to
   Python 3.12, and nothing is left out (8.1).
9. A named version's images take its pins from its published
   `@elaraai/e3-core` (8.2).
10. e3's environment build passes what the lock's own settings explain of
    `uv pip check`, and nothing else (8.5).

## 6. Tests

- The drift check (`scripts/test/extras-pins.test.mjs`): an extra that pins
  another torch than the lock, a range, a wildcard, a marker, two extras that
  disagree, a missing extra, and a lock that holds two versions, each refused
  by name; and this repository's own package and lock pass. The manifest is
  read with `tomllib`: a comment after a table's header, an indented header
  and an escaped quote read as TOML reads them, and a manifest that is not
  TOML is a drift error, not a stack trace.
- The script (`scripts/test/east-py-constraints.test.mjs`): the lock's pins
  with their hashes; the workspace's overrides; a workspace that excludes a
  distribution, refused; the same bytes twice, and from the root's manifest
  and lock alone; a release named as its tag names it; another release's
  refused, and nothing written.
- The files `@elaraai/e3-core` ships are the lock's, now: the overrides to the
  byte, the pins by name, version and marker, as sets, so a later uv that
  writes them in another order does not fail it, and a pin moved to another
  platform does.
- The lock holds one NCCL library, `nvidia-nccl-cu13`, and xgboost 3.4 or
  later.
- The image install script, with a `uv` and an `npm` that only say what they
  were asked, on a `PATH` of nothing else: a named release's pins are fetched
  from its published `@elaraai/e3-core` and installed under; pins that name
  another release are refused and nothing is installed; `latest` is installed
  under none and keeps none; with no uv, a python install fails.
- All of these run in `make check-version`, which the version drift workflow
  runs on every pull request. The drift check itself holds each committed pin
  file to the release it names.
- The release dry-run installs the published `@elaraai/e3-core` and finds the
  three files in it, by the package's name.
- The image test (`docker/tests/check-tier-pins.py`), for a named version: uv
  installs every distribution the image's manifest holds, at its version,
  into the image's interpreter under the pins, as a dry run that changes
  nothing, so each is at the version its own platform's pin allows; and the
  image holds one NCCL library. For every version, the east-py image's Python
  is 3.12 under `/opt/python`, its manifest names no pip, and `uv pip install
  --dry-run` runs in it. For every image with the datascience package: torch
  and xgboost import in one process. It runs where the image test runs: on a
  release's tag, or a dispatch of the image workflow, every image of a run at
  the one version its test job resolved (8.4).
- e3's environment build (`environment.spec.ts`): an environment whose
  workspace overrides a version and excludes a distribution builds, though
  uv's own check of it fails, and one whose capture missed a local package
  still fails. `lockExplainsCheck` passes a version the workspace overrides
  and a distribution it excludes, by PEP 503 name, and nothing else: a setting
  of the other kind, a count its lines do not make up, a line of another kind.
- The package's own suites run against the new torch in the python workflow,
  on Python 3.12.

## 7. What building it changed

- **torch 2.15.0 met xgboost's NCCL library** (3.2). The package's suites
  found it, on their second run. It is why there was a third pin file, which
  the review removed (8.1).
- **An environment that held both NCCL libraries loses the file they
  share** when uv removes xgboost's, though torch's is still listed:
  `uv sync --reinstall-package nvidia-nccl-cu13` puts it back, once. A fresh
  environment, an image and CI are not touched by it; a project that moves
  off an earlier xgboost is, once.
- **The pin files are committed, in `@elaraai/e3-core`**, and not written as
  an image is built or a release is made. One copy is what the package ships
  and what a pull request shows: a pin that moves is in the diff. The version
  bump writes them, so a release that could not is stopped before anything is
  published.
- **They ship in a package, not as release assets**: a consumer's lockfile
  pins a package, and nothing pins an asset.
- **The python tier's virtualenv is made without pip.** The first image run of
  a named version found setuptools 66.1.1 in the east-py image, the version
  Debian's Python seeds a virtualenv with, where the release pins 82.0.1:
  nothing installed asked for setuptools, so the install under the pins never
  touched it. Without the seeds, the image holds what its pins installed.
- **The files name their release**, in their first line, and uv's own header
  is left out: it names the directory the export ran in, which would make
  the same lock write different bytes.
- **The members' `dev` extras are in the constraints**, with pytest and the
  like: they hold every extra's pins. A constraint binds only what is
  installed.
- **One loose library kept a whole family**, as environments over a tier
  were first built: xgboost's `nvidia-nccl-cu12` kept all 16 NVIDIA
  distributions, about 3.6 GB. It was found by measuring for this change,
  and is fixed beneath it: the parts of a namespace package are now left to
  the tier singly ([`e3-environment-over-tier.md`](e3-environment-over-tier.md),
  section 7).

## 8. What its review changed

### 8.1 Python 3.12, and nothing left out

The review found the exclude unworkable, three ways:

- e3's environment build ends with `uv pip check`, which reads xgboost's own
  requirement, `nvidia-nccl-cu12` on Linux: an environment synced without it
  failed the check, on every Linux machine and in every rack build.
- An exclude is a workspace's setting, which no package publishes: a pip
  install of `[all]`, and every project the template made, held both
  libraries, and torch failed to import whenever xgboost's was written last.
  A project locks one xgboost for the lowest Python it admits, so this held
  for a project that ran on 3.12 and admitted 3.11.
- A `latest` image installs under no pin file, so under no exclude either, and
  uv installs wheels at once: which library won was a race, and the image's
  import check failed at random.

The exclude was sound by the libraries themselves: xgboost opens
`libnccl.so.2` by name only to train across several GPUs, and torch's library
exports every function xgboost's does. It was not sound by their metadata,
which every check and every other install reads.

So the east-py packages need Python 3.12 (`requires-python = ">=3.12"`), and
the extras ask for xgboost 3.4 or later, whose NCCL library is torch's: the
lock holds xgboost 3.4.1 and one NCCL library, and nothing is left out. With
them:

- the project template's `requires-python` is `>=3.12`, and so is the one the
  scaffolder writes for a python workspace's root;
- the python images install Python 3.12 with uv, under `/opt/python`, which
  their tier manifests name (`python.base`): a project's environment fits them
  when its lock takes 3.12;
- the release builds wheels for CPython 3.12 and 3.13, and the workflows run
  on 3.12;
- `east-py-excludes.txt` is gone, and the export refuses a workspace that
  excludes a distribution;
- ruff targets 3.12, and leaves out the rewrites to PEP 695's syntax (UP040,
  UP046, UP047), whose aliases and generics are other objects at run time
  than the ones the code builds and reads.

A project that admits 3.11 is locked to an earlier release of the packages,
which took 3.11.

### 8.2 Pins from the published package

The review found that pins were taken for a release's by their first line
alone, which names the members' version: the last release's, until the next
bump. Pins written again after a lock change kept the last release's name, so
a named build from main installed under pins that release was never tested
with. A named version's images now fetch the two files from its published
`@elaraai/e3-core`, which that release's bump wrote of the lock it published,
and still check the first line. The checkout's pins are not read, and an image
of a version builds once that version is published.

### 8.3 The image check reads each pin's platforms

The check took a version as pinned when any of the name's pins named it,
whatever its marker, so an image that held macOS's numpy passed. It now asks
uv to install what the image holds, under the pins, for the image's own
interpreter, as a dry run that must change nothing: uv reads each marker for
that interpreter (6).

### 8.4 One version for every image of a run

A dispatch of the image workflow with no version tested `latest`, unpinned,
and its build jobs then took the channel's version from npm and built it
under the checked-out ref's pins, which could be another release's. The
workflow's test job now resolves the version once, the tag's, the input's or
the channel's from npm, and waits until npm and PyPI serve it; every build job
builds that version, under its pins.

### 8.5 The rest

- e3's environment build passes a failed `uv pip check` whose every
  incompatibility the lock's own settings explain: a version its workspace
  overrides, as econml's `shap<0.49.0` under the override, or a distribution
  it excludes. It fails every other, a local package a capture missed among
  them (`lockExplainsCheck`).
- A python install that finds no uv fails, where it warned and built an image
  without its packages.
- The install script's global-npm dedupe runs only when it installs Node
  packages, and its tests run on a `PATH` of stand-in tools, so they never
  touch the machine's own npm root.
- The test that holds the shipped pins to the lock compares name, version and
  marker, as sets.
- The extras' pins are read from the manifest with `tomllib`.
- The two tooling files are under AGPL-3.0, as the repository's tooling is.
- The docs say how a pin is taken (`name==version ; marker`), that a PyTorch
  index's build of torch meets the extras' pin and ships, and that an image
  built `FROM` a python tier adds packages with `uv pip install`: its
  virtualenv holds no pip.
