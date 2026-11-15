# W2 markers: small yield -> mechanism dropped. ../w2/PROJECTION.md
- Strict W2: 5 ids change (sugg), 2 of 36 legit_outliers cards lose outliers (dub D-024a81, D-418256 3->1), none loses all; harmed ACCEPT cal.com D-e5e923 (name token `notification`) -> narrowed: name token never explains naming-rule outliers. After: 2 ids, 0 ACCEPT.
- Why: 20/36 refused by guard gate (9 only because target decorates an entry point), 10 have <2 outliers, rest need >1 marker. Concentration test: touches 7 ACCEPT to gain 4. Guards-by-name would exempt real drift on twenty D-865fba.
- Rescoped W2: fold exemptions into rule wording; share structural exemptions across sibling rules of a role (R4 netbox); flag only members that could comply.
# W1-Py: worth it. ../w1py/PROJECTION.md
- Variant B (hide Py naming on plain-class roles): 61 shown, 27A/20W carried, 14 unlabelled -> 57.4% among labelled [44.3-67.2] vs 49.2. Variant A 56.9%.
- mixed_group: 10/16 Py WRONG removed/fixed.
- ACCEPT lost: netbox D-bc0c7d, wger D-db04dc (become 100% -> miner skips universal; asked to carry when inherited from proposed parent), saleor D-71795b, D-a6847e (B only).
- Inline vs ModelAdmin share `admin` kind -> splitting `inline`.
## W1-Py final (26db405, variant B + inline split)
- Universal rules dropped by consider() (k>=n "documentation, not a check"); carried only when unsplit mining proposed the same rule on that exact unsplit role (subtree version broadened netbox/** -> removed).
- 6 carried 0-outlier cards: netbox D-bc0c7d (same id, ACCEPT), wger D-db04dc->D-f93026 (ACCEPT), netbox D-937c0c->D-b69a13 & Misago D-b4e5ff->D-562769 (were WRONG for other kinds in scope; relabel), InvenTree D-c2b101, ralph D-102297 (unlabelled).
- 66 shown: 29A/22W/15 unlabelled -> 56.9% among labelled (49.2 before); by unchanged id only 24/43 55.8%.
- ACCEPT lost: saleor D-71795b, D-a6847e (W3 hide). mixed_group 10/16 removed/fixed.
