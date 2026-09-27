add_executable(east-c-cli src/main.c)
set_target_properties(east-c-cli PROPERTIES OUTPUT_NAME east-c)
target_link_libraries(east-c-cli east-c-std)
if(WIN32)
    target_link_libraries(east-c-cli psapi)
endif()
target_compile_definitions(east-c-cli PRIVATE
    EAST_CLI_VERSION="${EAST_VERSION}"
    EAST_RUNTIME_VERSION="${EAST_VERSION}"
)

# CLI lifeline gate (issue #770): `exec --exit-with-parent` on a unit whose
# program never returns exits once its stdin pipe closes — on Windows over a
# synchronous pipe and an overlapped one. The unit is built from the
# protocol's type (hence the east-c link) around a checked-in program. Runs
# in the ASan tree too (leak-check's ctest pass), where the spawned CLI is
# instrumented and the gate fails on a sanitizer report in its stderr.
add_executable(test_cli_lifeline tests/test_cli_lifeline.c)
target_link_libraries(test_cli_lifeline east-c)
add_test(NAME cli_lifeline COMMAND test_cli_lifeline $<TARGET_FILE:east-c-cli>
         ${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures)
set_tests_properties(cli_lifeline PROPERTIES WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})

# CLI lazy paged-input gate (#516): spawns the binary with
# EAST_LAZY_INPUT_BYTES=1 over checked-in fixtures and pins the lazy
# contract end to end — the iteration-lock error on a paged $.for, pager
# error propagation through keyed `has` on a corrupt blob, the
# mutable-nested shape gate falling back to the eager decode, the residency
# of a mapped input, and a manifest-rooted input paging over its directory
# (wide fixtures the gate writes itself, hence the east-c link).
add_executable(test_cli_paged tests/test_cli_paged.c)
target_link_libraries(test_cli_paged east-c)
add_test(NAME cli_paged COMMAND test_cli_paged $<TARGET_FILE:east-c-cli>
         ${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures)
set_tests_properties(cli_paged PROPERTIES WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})

# CLI --profile gate: spawns the binary over a fixture whose helper is
# called 100 times and pins the epilogue — the helper listed with its call
# count and its source location, nothing printed without the flag, and the
# program's answer unchanged either way.
add_executable(test_cli_profile tests/test_cli_profile.c)
target_link_libraries(test_cli_profile east-c)
add_test(NAME cli_profile COMMAND test_cli_profile $<TARGET_FILE:east-c-cli>
         ${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures)
set_tests_properties(cli_profile PROPERTIES WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})

# CLI exec gate: the runner protocol's conformance corpus, which TypeScript
# exports beside the compliance IR (east/test/runner_corpus.spec.ts) — every
# unit copied into a scratch directory and executed with `exec`, its exit
# status, its result's outcome and every output byte held to the corpus.
# Skips (exit 77) unless `make test-export` has produced
# /tmp/east-test-ir/runner_corpus. Runs in the ASan tree too.
add_executable(test_cli_exec tests/test_cli_exec.c)
target_link_libraries(test_cli_exec east-c)
add_test(NAME cli_exec COMMAND test_cli_exec $<TARGET_FILE:east-c-cli>)
set_tests_properties(cli_exec PROPERTIES SKIP_RETURN_CODE 77 TIMEOUT 600
                     WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})

# CLI `ir` toolbox gate (#627): spawns the binary over checked-in IR fixtures
# and pins normalize (a fixed point, loc_ids zero, no map), diff (exit code +
# path, --raw) and convert (json <-> beast2 with the source map intact).
add_executable(test_cli_ir tests/test_cli_ir.c)
target_link_libraries(test_cli_ir east-c)
add_test(NAME cli_ir COMMAND test_cli_ir $<TARGET_FILE:east-c-cli>
         ${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures)
set_tests_properties(cli_ir PROPERTIES WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})
