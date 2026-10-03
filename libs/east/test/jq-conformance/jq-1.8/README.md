# jq 1.8's test suites

`jq.test`, `man.test`, `onig.test` and `optional.test` are jq's own test
suites, and `COPYING` its licence, as they are at the tag `jq-1.8.1` of
[jqlang/jq](https://github.com/jqlang/jq), commit
`4467af7068b1bcd7f882defff6e7ea674c5357f4` (`tests/` and `COPYING`).

jq is © 2012 Stephen Dolan and licensed under the MIT licence in `COPYING`.
`man.test` is generated from the examples in jq's manual, which jq licenses
under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) (`COPYING`);
it is reproduced here unchanged. Nothing here is published: the npm package
ships `dist/src` only.

They are data: nothing edits them. `test/query.conformance.spec.ts` runs every
case through East's checker and translator, and `devdocs/QUERY.md` §16 says
what it finds (#924).
