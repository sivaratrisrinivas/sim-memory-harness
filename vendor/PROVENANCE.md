# Vendored Sim code

Source: https://github.com/simstudioai/sim
Commit: 8df65ad39a10a6c34c61ff0674e0e8a7ad2164f0 (2026-10-16, "v0.9.25: search improvements")
Licence: Apache-2.0 (see ../LICENSE-sim-Apache-2.0). Copyright the Sim authors.

The four files in `sim/` are copied **byte for byte** from `apps/sim/lib/memory/` at that commit:

- `history-window.ts` (message window, token window)
- `context-policy.ts` (history token budget, group selection)
- `context-tokens.ts` (token counting guard)
- `constants.ts` (defaults)

Nothing in them is edited. `SHA256SUMS` lets CI prove that (`npm run verify-vendor`).
Their imports are resolved by `tsconfig.json` paths to small stand-ins in `src/shims/`
(token counter, model limits, the `Message` type). Those stand-ins are the only faked parts.
