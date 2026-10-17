# Demo voiceover (about 86 seconds)

Voice: Kokoro af_heart, speed 0.95, loudness about -16 LUFS. Screen: the live page, scrolled through by script.

1. Sim's memory windowing has unit tests. But if a change broke how the final request is put together, those tests would not show it. This harness makes that visible.

2. It replays one hundred twenty made-up conversations through Sim's real windowing code, unchanged. Plain code checks each request. No model judge.

3. Four settings. With no memory, every fact is lost, by design. Full context keeps seventy nine percent on dev and eighty seven on held out. The ten message window keeps fifty four and sixty two. The token window, fifty eight and sixty five.

4. Here is one case. An order ID is given, then eleven messages follow. Full context and the token window still hold it. The ten message window has already cut it.

5. Bulky tool results change the picture. Only three messages follow the fact here, yet the four thousand token window lost it, because one tool result is bigger than the whole window.

6. To trust the checker, I broke request assembly seven ways. It caught six. The one it missed is a real gap in my cases, and the page says so.

7. What is faked: token counts, model limits, and there is no live model or summary mode. Facts kept means the exact text is in the request.

8. The next step would be running the same check on real traces. This is a harness, not a claim that Sim has a bug.
