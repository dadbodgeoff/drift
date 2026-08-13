# Reply draft — #97 "Have evals build in"

> I would love if there would be evals build in so that one can easily see what llm I can use
> (one defines a list of llm …) for these tasks. So it judges what llm did a task good and which
> bad.

**Not built, and not planned in this form.** I want to be direct about that rather than point at
adjacent work and imply it is the same thing.

## What Drift does have

An evaluation harness, but it evaluates **Drift against real repositories**, not LLMs against
tasks:

- `pnpm eval:external` — seven open-source Next.js repos, checked on every change: does onboarding
  work, is the real data layer learned, is an injected violation caught with correct `file:line`
  evidence, is a properly layered route left alone.
- `pnpm eval:prepare` — does `drift prepare` surface the files a developer would actually open.

Different axis entirely. Those answer "is Drift correct"; you are asking "which model should I use
for this task, and can I stop paying for the expensive one when it does not help".

## Why I have not built what you asked for

Honestly: because judging model output quality needs a grader, and a grader that is itself a model
is a source of error I would have to evaluate before trusting any of the numbers it produced. I do
not currently have a way to do that which I would stand behind.

There is a narrower version that might be tractable and would use what already exists. Drift can
already answer, deterministically, whether a change violates the repo's conventions. So for a
fixed set of tasks, one could measure per model:

- did the produced change pass `drift check`
- how many new violations did it introduce
- did it follow patterns the repo already uses, or invent new ones

That is not "was the code good", but it is objective, needs no LLM judge, and is exactly the
signal you would want for routing cheap work to cheap models.

If that narrower framing is useful to you, say so on this issue. If you specifically want
subjective quality grading, I would rather tell you now that it is not on the near-term path.

## Correction

An earlier internal note assumed this issue was largely addressed by the existing harness. Reading
your request properly, that was wrong — the harness tests the tool, not the models.
