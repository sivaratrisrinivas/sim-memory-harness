# Sim memory replay harness

A replay and eval harness for [Sim](https://github.com/simstudioai/sim)'s agent memory. It runs Sim's **real** windowing and budget code over 120 made-up conversations under four memory settings, then checks the request that would go to the model with plain code. No LLM judge, no live model.

Independent project. Not affiliated with Sim. It does not claim a bug in Sim: dropping old messages is how these settings are meant to work. The aim is to make the result visible, and to catch a change that breaks assembly by accident.

**Why.** Sim's windowing has unit tests, but a slip in how the final request is assembled (order, system prompt, a split tool exchange, the wrong conversation) would not show up in them. This harness replays conversations and asserts on the assembled request.

Live page: https://sivaratrisrinivas.github.io/sim-memory-harness/ (static, no build step, demo video on the page). Run the checks yourself in under a minute:

```
npm ci
npm run check      # verify vendored files, typecheck, 12 tests, regenerate cases and results, fail on any diff
```

## What is real, what is faked

| Real | Faked or stand-in |
|---|---|
| `history-window.ts`, `context-policy.ts`, `context-tokens.ts`, `constants.ts`, copied byte for byte from Sim commit `8df65ad39a10a6c34c61ff0674e0e8a7ad2164f0` (2026-10-16, Apache-2.0). `vendor/SHA256SUMS` proves they are unmodified. | **Token counts**: `ceil(chars / 4)` (`src/shims/accurate.ts`). Sim uses a model tokenizer. Sim's own rule that text over 4,096 characters is counted by UTF-8 bytes is real and applies. |
| Sim defaults: window 10 messages, 4,000 tokens, 16,000 token history budget, 90% context use. | **Model limits**: fixed 32,000 token window (Sim's own fallback for an unknown model), 600 fixed tokens and 4,096 output tokens as made-up reserves. Real adapters also budget tool schemas and files, so real windows are tighter. |
| Stage order of the real path: setting window (`executor/handlers/agent/memory.ts`), then the request budget (`providers/conversation-generation.ts`). | **No live LLM.** "Fact kept" means the exact text is in the request. It is a proxy for a correct answer. |
| The checker: ordinary code, in `src/checks.ts`. | **Summary mode is not built** (needs an LLM call). **`agent_memory_read` is not modelled.** **Store and tool-exchange groups** are an in-memory stand-in (`src/assemble.ts`). **All conversations are synthetic.** |

Settings tested (Sim memory type, defaults): none, full context (`conversation`), sliding window by messages (10), sliding window by tokens (4,000). Every non-none setting then goes through the request-level history budget (16,000 tokens), as in Sim.

## How it was built (evals-skills)

Followed the original [evals-skills](https://github.com/ai-evals-course/evals-skills): `evals-start` routing, then `generate-synthetic-data`, `error-discovery`, `write-code-eval`.

1. **Dimensions** (where I expected failures): fact type (ID or number, constraint, preference, correction that supersedes an older value, isolation against a near-twin neighbor conversation id), load shape (short chat, chit-chat, tool heavy, long paste), fact distance (1, 3, 7, 9, 11, 19 messages after the fact; 9 and 11 straddle the 10-message edge).
2. **Tuples**: 5 fact types x 4 load shapes x 6 distances = 120, all kept. I wrote the tuples and templates myself with a seeded generator (`src/generate.ts`) instead of using an LLM, so each fact is an exact string. The user did not review the 20-tuple draft the skill asks for; a human should look at `data/cases.json`.
3. **Frozen split**: 72 dev, 48 held out, stratified by fact type x load shape (20 strata of 6). `data/split.json` holds the sha256; `npm run run` refuses to run if it changes. Nothing was tuned on dev; the split exists so that anything built later can be judged on cases it never saw.
4. **Checker** (`write-code-eval`): seven checks, each returns pass and a reason. `facts_kept` (exact normalised text present; for a correction the new value must be present and must not come before the old one), `correction_order`, `history_order` (history is an unmodified, in-order suffix of what was stored), `system_kept`, `probe_last`, `tool_pairs` (no orphan tool result, no unanswered tool call), `isolation` (no id from the neighbor conversation in the request). "Request valid" is the structure checks; "facts kept" is the survival metric.
5. **Error discovery**: not the interactive review loop (no human reviewer here). I grouped the 72 dev failures by cause with code that records where each fact was cut (stage 1 window or stage 2 budget) and read through cases in the timeline view. Held-out failures are counted against the same causes, not used to make new ones.
6. **Checker validation**: unit tests of known passes, known failures and borderline cases (`tests/checks.test.ts`); a mutation check (seven injected assembly regressions, dev cases); agreement with a second, naive implementation of the facts check on all 480 runs. This is not agreement with human labels; I did not hand label.

## Workflow check against evals-skills

| Skill step | What was done | Gap left |
|---|---|---|
| `evals-start` (routing) | No traces exist, so: `generate-synthetic-data`, then `error-discovery`; the failure modes are rule based, so `write-code-eval`. `validate-evaluator` is for LLM judges; for code checkers it points to unit tests. | none |
| `generate-synthetic-data` | Three starting dimensions (fact type, load shape, fact distance), tuples crossed to 120, templates written by hand with a seeded generator (two steps: tuples, then text), realism filter by tests (every fact planted, no neighbor id leaks into the target). | The skill wants a human to review 20 draft tuples. Nobody has. Read `data/cases.json`. |
| `error-discovery` | Failures grouped by cause with code, then read in the timeline view; taxonomy on the page, counted again on held out. | The skill is an interactive human review. This was not; there are no open-coded human notes. |
| `write-code-eval` | One check per failure rule, each returns pass and reason; known pass, known fail and borderline unit tests. | none |
| `validate-evaluator` (adapted for code) | Unit tests; mutation check (7/7 caught, after adding probes); a second naive implementation agrees on 480 of 480 runs; a 30 run spot audit (below). | No domain-expert labels, no TPR/TNR against humans. |

Spot audit: I read 30 seeded random (case, setting) runs (17 of them "none", which are trivial) and compared the raw request to the verdict. 30 of 30 agree. This is me, not a domain expert.

## Results

Facts kept = the planted fact is in the request. Counts, not only percentages. Full tables and per-case timelines: `results/results.json`, `results/RESULTS.md`, and the live page.

| Setting | Dev (72) | Held out (48) | Request valid (dev / held out) |
|---|---|---|---|
| None | 0/72 | 0/48 | 72/72 and 48/48 |
| Full context | 57/72 (79.2%) | 42/48 (87.5%) | 72/72 and 48/48 |
| Window: last 10 messages | 39/72 (54.2%) | 30/48 (62.5%) | 72/72 and 48/48 |
| Window: 4,000 tokens | 42/72 (58.3%) | 31/48 (64.6%) | 72/72 and 48/48 |

Held-out is a bit higher than dev for every setting that holds history. With 48 cases, gaps of this size are within noise, and the split is stratified, so I read it as no sign of the numbers being specific to dev.

What the numbers say (about this synthetic set, not about Sim users):

- Short and chit-chat conversations: full context and the token window keep every fact (60 of 60); the 10-message window keeps 40 of 60. It loses the fact once 11 or more messages follow it. That is the default behaving as documented.
- Bulky messages decide most of the rest. In tool-heavy cases, the token windows and full context lose most facts (9/30, 6/30, 9/30 for full, 4,000 tokens, 10 messages). In long-paste cases the 4,000 token window keeps 7 of 30, because a 3,000 to 9,000 character paste counts by bytes and fills it. These shape numbers depend on the bulk sizes I chose (tool results 1.2k to 20k characters, pastes 3k to 9k). Treat the direction, not the level, as the finding.
- Reading the code: stage 2 (`selectConversationContextGroups`) stops at the first older group that does not fit instead of skipping it, so one large old tool result can hide smaller, older messages behind it. I have not measured how often that matters.
- Request structure was valid in all 480 real-code runs. The point of those checks is the next part.

### Does the checker see a broken request?

Seven injected regressions, 72 dev cases plus 6 probe cases (312 runs each): reversed history, dropped system prompt, dropped current message, window off by one, windows that ignore tool-exchange groups, a window that keeps the oldest messages, and a store that finds conversations by id prefix. **All seven are caught.** The last one, "windows ignore tool-exchange groups", was missed at first: in the 120 cases the 16,000 token budget evicts the orphaned tool message before the request is built, so nothing wrong reached the request. I added six regression probes (`p01` to `p06`, tool-heavy chats with 300 to 600 character tool results, outside the 120 and outside the frozen split) and the `tool_pairs` check now fires on 4 of 312 runs. The 120-case numbers did not change.

## Gaps and cautions

- No live model, no summary mode, no `agent_memory_read`. Exact text in the request is a proxy.
- Faked token counts and model limits; absolute numbers will move on a real tokenizer.
- Isolation passes by construction because the stand-in store does exact lookups. The check earns its place only against a real store adapter, or when someone breaks the lookup (see the prefix-leak mutant).
- Synthetic conversations and templates written by one person; no human reviewed the tuples. 120 cases is small.
- Possible overlap with Sim's internal evals is unknown. Not checked against any private work.

## Layout

```
vendor/sim/         unmodified Sim files + SHA256SUMS + PROVENANCE.md
src/shims/          the faked parts (tokens, model limits, Message type)
src/generate.ts     dimensions, tuples, templates, frozen split
src/assemble.ts     the four settings through the real code, plus injectable regressions
src/checks.ts       the code checker
src/run.ts          runs everything, writes results/
tests/              checker and dataset tests
index.html app.js style.css   the static page (reads results/results.json)
media/              demo video and captions
demo/               voiceover script and captions
```

## Licence and credit

Files in `vendor/sim/` are Sim's, © the Sim authors, Apache-2.0 (`LICENSE-sim-Apache-2.0`), copied unchanged from commit `8df65ad`. The rest of this repository is MIT licensed (`LICENSE`).

## CI

`.github/workflows/check.yml` runs `npm run check` on every push and pull request. It was added through the GitHub connector because the local token has no `workflow` scope.
