# dev5 report: the pre-registered measures and the dev5-py-check

Rates are over the shown Python cards of the opt-in view, unlabelled counted as WRONG
([`../../PREREG-F12-dev5-py-check.md`](../../PREREG-F12-dev5-py-check.md) §5 and §6). Repos by key only. The frozen
product is `F12` = `5bafc43d4366f183ab0a25d780533c9bb1725077`, binary sha256 `18681df2…80ba`. Figures are
`metrics.mjs`'s ([`metrics.md`](metrics.md), [`metrics.json`](metrics.json)) over [`final.jsonl`](final.jsonl).

## python (30 repos)

1. **Shown cards: 11**, from 10 of the 30 repos (0.37 per repo). All suggestion tier. No repository failed census.
2. **Not wrong: 100.0% (11/11)**; Wilson [74.1%, 100.0%]; cluster boot [100.0%, 100.0%], t [100.0%, 100.0%] over 10 repos.
3. **Per-card accept: 90.9% (10/11)**; Wilson [62.3%, 98.4%]; cluster boot [70.0%, 100.0%], t [70.1%, 100.0%] over 10 repos.
4. **By family** (shown / ACCEPT / TRIVIAL / WRONG): control 6 / 6 / 0 / 0; naming 3 / 2 / 1 / 0; layering 2 / 2 / 0 / 0;
   wrapper 0 shown. **By framework bucket** (repos; shown, accepted): Django/DRF 10 repos, 5 shown, 5; FastAPI 9, 3, 2;
   Flask 7, 1, 1; other Python 4, 2, 2.
5. **Yield:** 10 accepted cards over 30 repos, mean 0.33, median 0, 20 repos with none.
6. **WRONG causes:** none. The one TRIVIAL is `trivial_by: lint`. Unlabelled: 0.
7. **Flag precision** (no target): 17 of the 19 per-outlier verdicts in the A and B records of the Python cards are
   `mistake` (5) or `look` (12): 89.5%.
8. **Agreement** (the 13 queued cards, both labellers): exact 92.3% (12/13); chance-corrected agreement is not reported
   below n = 30. Confusion (A rows, B columns): ACCEPT/ACCEPT 11, ACCEPT/WRONG 1, TRIVIAL/TRIVIAL 1. One card was
   adjudicated; C sided with A. With the adjudicated card counted as WRONG (the F4 reading), not wrong is 90.9% (10/11).
   **Default census (proposals off):** 0 Python cards shown over 30 repos.

The queue held 13 cards: two cards of one repo (P10) are not Python and are shown in the default view too. They were
labelled with the rest (both ACCEPT) and are in no figure above; the pre-registered shown set is the 11 Python cards.

## The dev5-py-check (PLAN-R11 §3; point estimates, joint)

- **(n)** at least 10 shown Python cards: 11: **MET**
- **(b)** not wrong at least 70.0%: 100.0% (11/11): **MET**
- **(c)** per-card accept within 10.0 points of the build-set in-sample figure: dev5 90.9% (10/11) against in-sample
  83.3% (25/30, the `F12` binary, pre-registration §1): +7.6 points: **MET**

**The check passes.** By §8 of the pre-registration, mined Python proposals turn on by default in the next commit on
the pull-request branch, subject to the transfer condition (A2): that commit's opt-in census on the 50 build repos must
have the `view_sha256` of the frozen binary, `d65ef377aa065d063a913d4ab5acc8dc5bc8ead54f4a261b9114d37288f94065`.
Decision D13-py is closed with this run cited. dev5 joins the build set with this report.

## What this does and does not show

- **It is a small sample.** Eleven cards is one above the minimum of ten. The accept rate's Wilson interval runs from
  62% to 98%. The yield (0.37 shown cards per repo) is below the build set's 0.60.
  *(Corrected 2026-11-11, after the report was pushed: this item first said one card fewer would have left the check
  not evaluable; ten cards meet the minimum. No measure or verdict changes.)*
- **It is the first out-of-sample reading of the two new families that showed cards**: control (6 of 6 accepted) and
  layering (2 of 2). The pre-registration's stated weakness was that these families were admitted on labels now in
  sample; here they held. The wrapper family showed no card, so it has no out-of-sample reading yet.
- **It is not a held-out result.** PLAN-R11 §3 stands: a held-out pass is needed before any Python accuracy claim. This
  check decides only whether proposals are shown by default.
- **Bar (c) is two-sided.** With 11 cards it could be met only by 9 or 10 accepted; 11 of 11 would have failed it as
  too far above the in-sample figure.
