# Builds the __PACKAGE_NAME__ tool -> build/__PACKAGE_NAME__.
#
# e3 captures this binary into the exported bundle via the task's
# `environment: { tools: { files: [...] } }`, so rebuilding it changes the
# environment hash and re-runs only the tasks that use it. Build before export:
#   make -C packages/native/__PACKAGE_NAME__
CC ?= cc
CFLAGS ?= -O2 -Wall -Wextra

build/__PACKAGE_NAME__: src/__PACKAGE_NAME__.c
	mkdir -p build
	$(CC) $(CFLAGS) -o $@ $<

.PHONY: clean
clean:
	rm -rf build
