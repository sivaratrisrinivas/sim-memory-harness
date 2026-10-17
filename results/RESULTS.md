# Results

Sim commit 8df65ad39a10a6c34c61ff0674e0e8a7ad2164f0. Frozen split sha256 c513e5719e4b01c097cdbba83986c3c053b6f87c4d4fa11d2a8a7e0521a7fd89.
FAKED: token counter (chars/4), model limits (32k), no live LLM, no summary mode.

| Setting | Dev facts kept | Held-out facts kept | Dev request valid | Held-out request valid | Mean history tokens (dev / held-out) |
|---|---|---|---|---|---|
| None | 0/72 (0%) | 0/48 (0%) | 72/72 (100%) | 48/48 (100%) | 0 / 0 |
| Full context | 57/72 (79.2%) | 42/48 (87.5%) | 72/72 (100%) | 48/48 (100%) | 4320 / 4241 |
| Window: last 10 messages | 39/72 (54.2%) | 30/48 (62.5%) | 72/72 (100%) | 48/48 (100%) | 3610 / 3688 |
| Window: 4,000 tokens | 42/72 (58.3%) | 31/48 (64.6%) | 72/72 (100%) | 48/48 (100%) | 302 / 314 |

Mutation check (dev): 6/7 injected regressions caught.
Naive-checker agreement: 480/480.
