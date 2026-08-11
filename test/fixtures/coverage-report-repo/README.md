# coverage-report-repo

EW-3. A repo whose coverage is deliberately, knowably partial, so the self-report has something
true to say:

- `src/app/api/clean` and `src/app/api/violating` - imports that resolve. The denominator.
- `src/app/api/missing` - one `@/*` import of a file that does not exist: one `unresolved_import`.
- `src/app/api/namespaceonly` - a namespace import of a real workspace package with an unused
  binding: one `unsupported_namespace_import_symbol`, which is a *named limitation* (a shape Drift
  knowingly does not resolve) rather than a gap to be fixed.

The point of the mix is that the two are reported differently: one lowers the resolution rate, the
other is named with remediation.
