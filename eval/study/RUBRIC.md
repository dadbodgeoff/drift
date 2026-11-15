# Labeling rubric: proposed codebase conventions

A tool read each repository and proposed "conventions": rules that most code in
one part of the repo follows. Each proposal shows the rule, its evidence
(how many members follow it out of the total), an example member, and the
outliers (members that do not follow it).

Imagine you are a senior maintainer of that repository. The tool would let you
accept a convention so that NEW code in that part of the repo (often written by
AI coding agents) is checked against it. For each proposal, decide:

- **ACCEPT**: You would plausibly accept it. It reflects a deliberate team or
  architectural choice (an auth/permission wrapper, a required base class or
  decorator, a layering boundary, a shared helper everyone uses, a naming
  scheme the team chose), and new code in that area that broke it would most
  likely be a mistake or would at least deserve a second look in review.
- **TRIVIAL**: True, but not worth enforcing: required by the framework or
  language anyway (the build would fail without it), so obvious nobody would
  get it wrong, or describing what the code *is* rather than a choice.
- **WRONG**: The rule misdescribes the code, the group of files is not a
  meaningful group, or the outliers are legitimately different (the rule should
  not apply to them), so enforcing it would mostly produce false alarms.

Judge from the repository itself: open the example and two or three outliers
(and, if needed, a couple of other members) before deciding. Do not guess from
the rule text alone. Decide each proposal on its own merits; there is no
expected distribution.

Also note, separately, whether the rule's wording is clear enough that a
developer would understand what to do (`clear: true/false`).

Output one JSON object per line:

{"repo": "...", "id": "D-xxxxxx", "label": "ACCEPT|TRIVIAL|WRONG", "clear": true, "reason": "one sentence citing what you saw in the files"}
