# compressor vs Caveman — head-to-head

A controlled benchmark of compressor against the viral **Caveman** prompt
([juliusbrussee/caveman](https://github.com/juliusbrussee/caveman), ~"cuts 65%
of tokens by talking like caveman"). Caveman is an *output-shaping* instruction
pack; compressor's main lever is *input compression* (a hook that shrinks tool
output) plus light output discipline. The point of the test: in real agent
work, which end of the token budget actually matters?

## Method

- **Run** `bench-20260614-020738`, suite `caveman`, model `claude-sonnet-4-6`,
  3 trials, Claude-plan billed. Numbers are medians of the usage Claude reports
  in the result JSON; cost is the **API-equivalent** figure (not dollars billed).
- **Arms** (all delivered via Claude Code's output-style / system-prompt
  channel, `keep-coding-instructions: true`, so the only variable is the
  instruction body + the hook):
  - `full` — true baseline, no instructions, no hook.
  - `optimized` / `slim` — compressor (instruction pack **+ compression hook**).
  - `caveman` — the real Caveman skill (`full` intensity), **no hook** (it has
    no input-compression mechanism — that asymmetry is the whole comparison).
- **Tasks** — two input-heavy (where the hook acts): `huge-log-diagnosis`,
  `large-file-edit`; two output-heavy (Caveman's home turf): `explain-codebase`,
  `review-diff`. Treatment delivery was proven before spending (canaries +
  a probe showing Caveman visibly shaping output).

## Result

**Every arm scored 100% success on all 12 cells — no quality loss for either
tool.** So the comparison is purely about tokens, at equal quality.

| Arm | API-equiv cost vs baseline | Output tokens vs baseline | Success |
|---|---|---|---|
| compressor **slim** | **−51.7%** | −10.9% | 100% |
| compressor **optimized** | **−48.7%** | −15.8% | 100% |
| **caveman** | −42.2% | −9.4% | 100% |

compressor saves **more total tokens than Caveman** — and, against the meme,
compressor's *output* came out at least as small as Caveman's. The famous
"caveman talk → fewer tokens" effect is real but the smaller lever.

## Where the difference comes from

**Input-heavy task — `huge-log-diagnosis` (median context volume = input + cache):**

| Arm | context volume | vs baseline |
|---|---|---|
| full | 376,195 | — |
| compressor optimized | 283,130 | **−24.7%** |
| caveman | 446,271 | **+18.6%** |

compressor's hook compressed the 376k-token log → −25% context. Caveman, blind
to input, made it **worse** — its terse replies spawned extra tool calls
(Bash ×17 vs full's ×14) re-reading the log. This is "input-blind" made concrete.

**Output-heavy, simple prose — `explain-codebase`:** Caveman wins here, the
honest way: 718 output tokens vs baseline 777 (**−7.6%**), while compressor's
gentle output discipline was roughly flat (819). Terse caveman-speak genuinely
trims simple explanations.

**Output-heavy, verbose — `review-diff`:** the baseline rambled to 21,726 output
tokens; every treatment reined it in hard — caveman −81%, optimized −85%, slim
−87%. compressor cut the most, and the reduced output also shrank fed-back
context (212k → ~76k for both).

## Takeaway

On these agent tasks, at identical 100% success:

- **Bottom line:** compressor cuts ~49–52% of token cost; Caveman ~42%.
- **Output tokens:** compressor matched or beat Caveman on aggregate; Caveman's
  edge is real only on the simplest prose.
- **Input:** the decider. compressor's hook removes input compressor can't see;
  on the log-heavy task Caveman didn't just fail to help — it backfired (+19%).

Caveman optimizes the part of the budget the model *writes*; in agent sessions
the tokens are overwhelmingly in what it *reads*. Fewer tokens, same work — by
compressing the 99%, not the rounding error.

*Reproduce:* `compressor benchmark --suite bench/suites/caveman.json --modes
full,optimized,slim --competitor caveman --trials 3 --auth subscription`.
