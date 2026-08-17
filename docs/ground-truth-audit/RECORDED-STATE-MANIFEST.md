# Ground-truth audit — recorded state manifest

Binary SQLite state and the mutated-repo copy from the audit are NOT committed: the
papermark state DB alone is 189 MB, and a blob that size is permanent history bloat
for artifacts that are regenerable by re-running the workflow. The JSON/text evidence
in this directory is the actual measurement substrate and IS committed.

Durable copies (originals left in /tmp/gt-audit/ as a fallback):
  ~/drift-falsification/gt-audit-backup-2026-08-16/

| Artifact | Size | sha256 |
|---|---|---|
| state/auth-helper/repo_c5e67e6be2297ab7/drift.sqlite | 556K | 1f850164ea4a63dd… |
| state/data-access-run2/repo_e71ff414b8bc6786/drift.sqlite | 784K | 4ac8a5d05e02fdf5… |
| state/data-access/repo_e71ff414b8bc6786/drift.sqlite | 784K | 4a57d5e5a695d0b2… |
| state/fact-extraction/repo_f7b3a36578ddf3cc/drift.sqlite | 536K | f664eccee518f9f6… |
| state/fact-extraction2/repo_f151d05560eed72b/drift.sqlite | 484K | 709369b328d06710… |
| state/papermark/repo_c630ef25583f7263/drift.sqlite | 189M | 45d241a7e1fc4a83… |
| state/sensitive-fields-schema/repo_cd4e0ed7c929aeaa/drift.sqlite | 484K | 16eac3a35547fcb9… |
| state/sensitive-fields/repo_85e39efa7a3da55a/drift.sqlite | 500K | 2c3bb3d111643819… |
| state/taxonomy-mutation/repo_ea43ac15d90e51cb/drift.sqlite | 6.5M | 7a6338401f56a7d6… |
| state/taxonomy-run2/repo_11b231f73583e336/drift.sqlite | 6.5M | e42ce5a4de2d651e… |
| state/taxonomy/repo_11b231f73583e336/drift.sqlite | 6.5M | d7c37b312c9c6bb1… |
| taxonomy-mutated/ (repo copy) | 5.0M | see backup |
