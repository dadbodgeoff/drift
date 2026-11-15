# W1-TS closed as NO (prototype cea7ee4 local on ws/w1-ts-member-kinds, ungated, unpushed). ../w1ts/PROJECTION.md, proj2.md
- v1 (hook vs function only new split): 1 card changes (dub D-258285 -> D-9e1d82). 0 ACCEPT lost.
- 19 others separate by file role / export / base lineage / subdir / purpose; provable kinds only "schema-library-built" and "abstract class".
- v2: 3/20 mixed_group fixed, 5 re-id still wrong, 6 ACCEPT re-ids, 1 ACCEPT lost (novu D-6ded6b); best 53.0 -> 55.6.
- KEEP separately: zod schema with callback (z.object().refine(cb)) lowered as function -> 7/10 outliers on infisical D-4be5e9. Fact fix in TS lowering (L37), not selector.
