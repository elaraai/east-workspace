# The paths every Makefile in this checkout shares. Make supplies them, so no
# script, spec or test works a path out itself (#1114): the checkout's root,
# and the test corpora it exports and its gates read, each under the
# checkout's own tmp/ (gitignored), so two checkouts on one machine never read
# each other's.
#
# Each one is exported: the scripts and tests make runs read it from the
# environment. A variable already set wins.
#
# Include it relative to the Makefile: `include paths.mk` from the root's,
# `include ../../paths.mk` from a lib's, `include ../../../../paths.mk` from a
# package's.

REPO_ROOT := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))

# east's describeEast suites as IR (`make -C libs/east test-export`)
export EAST_TEST_IR_DIR ?= $(REPO_ROOT)/tmp/east-test-ir
# east's examples as IR (`make -C libs/east export-examples`)
export EAST_EXAMPLES_IR_DIR ?= $(REPO_ROOT)/tmp/east-examples-ir
# east-node-std's suites (`make -C libs/east-node test-export-std`)
export EAST_NODE_STD_IR ?= $(REPO_ROOT)/tmp/east-node-std
# east-node-io's suites (`make -C libs/east-node test-export-io`)
export EAST_NODE_IO_IR ?= $(REPO_ROOT)/tmp/east-node-io
# east-py-datascience's suites (`make -C libs/east-py test-export`)
export EAST_DATASCIENCE_IR_DIR ?= $(REPO_ROOT)/tmp/east-py-datascience
# east-ui's suites (`make -C libs/east-ui test-export`)
export EAST_UI_TEST_IR ?= $(REPO_ROOT)/tmp/east-ui-tests
# e3-ui-showcase's suites (`make -C libs/east-ui/packages/e3-ui-showcase test`)
export E3_UI_SHOWCASE_TEST_IR ?= $(REPO_ROOT)/tmp/e3-ui-showcase-tests
# The checkout's own east-node CLI, which east-py's three-way sweep runs
export EAST_NODE_CLI ?= $(REPO_ROOT)/libs/east-node/packages/east-node-cli/bin/east-node.mjs
