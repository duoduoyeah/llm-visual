# Trace File Schema

This is the contract between trace **producers** (any LLM repo: nanochat, HF, vLLM, hand-written) and the **renderer** in this repo. Any producer that emits JSON conforming to this spec can be visualized.

## Top-level shape

```json
{
  "schema_version": "1",
  "vocab": { "<id>": "<text>", ... },
  "vocab_meta": { "<id>": { "is_special": true }, ... },
  "traces": [ <trace>, ... ]
}
```

| field | required | description |
|---|---|---|
| `schema_version` | yes | String. Bump when the schema changes incompatibly. Current: `"1"`. |
| `vocab` | yes | Map from `vocab_id` (as string) to its human-readable text. Only IDs that appear in any trace need to be present. |
| `vocab_meta` | no | Per-vocab-id extras. Renderer styles entries with `is_special: true` (italic, gray). |
| `traces` | yes | Array of one or more traces. The page shows a dropdown to pick one; the rest renders the chosen trace. |

## Trace

```json
{
  "name": "vanilla 32-token continuation",
  "prompt_text": "The capital of France is",
  "tokens": [ <token>, ... ]
}
```

| field | required | description |
|---|---|---|
| `name` | yes | Short label shown in the dropdown. |
| `prompt_text` | yes | The original prompt string. Shown above the figure. May be empty. |
| `tokens` | yes | Array of token entries (see below). |

## Token

```json
{
  "id": "t0",
  "vocab_id": 1234,
  "gen_step": 0,
  "position": { "abs": 0 },
  "forced": false,
  "input_steps": [0, 1]
}
```

| field | required | description |
|---|---|---|
| `id` | yes | String, unique within the trace. Used as an anchor by other tokens' `between` positions. Producers can just use `"t0"`, `"t1"`, ... |
| `vocab_id` | yes | Integer. Must be a key in the top-level `vocab`. |
| `gen_step` | yes | Integer. `0` = prompt. Step at which this token was generated/added. |
| `position` | yes | Exactly one of `{"abs": <int>}` or `{"between": ["<id_a>", "<id_b>"]}`. See **Position** below. |
| `forced` | no | Boolean. `true` = injected by the producer (e.g. tool-use output), not sampled. Renderer marks with a small indicator. Defaults to `false`. |
| `input_steps` | no | Array of ints — steps at which this token was input to the model. Currently stored but **not rendered** in v1. Reserved for future use (e.g. visualizing repeated re-feeds). |

## Position

Two forms:

### Absolute
```json
"position": { "abs": 5 }
```
Token sits at index 5 *as of the step it was generated*. Use this for normal autoregressive append.

### Between (relative)
```json
"position": { "between": ["t3", "t7"] }
```
Token sits **between** anchor tokens `t3` and `t7` in the displayed sequence.

**Constraints:**
- Both anchors must have `gen_step < this token's gen_step`. (Anchors are always *earlier* tokens.)
- At most one new token per `[a, b]` pair per step. Violations: renderer errors with `step N: multiple tokens claim position [a, b]: <token_ids>`.

**Layout rule (no empty slots):** the displayed column at step N is the token's ordinal place in the sequence as it exists at step N. Tokens slide right when something inserts to their left in a later step. The renderer animates the slide (~150ms).

### When to use which

- **Pure autoregressive** generation (most LLMs, including nanochat in normal use): always use `abs`. The producer emits `{"abs": <next_index>}` for each new token.
- **Speculative / parallel / tree decoding**: use `between` for tokens that get inserted mid-sequence based on prior tokens' relative positions.

A single trace can mix both forms.

## Step 0 (the prompt)

The prompt is just regular tokens with `gen_step: 0`. Use absolute positions `0..len-1`.

```json
"tokens": [
  { "id": "t0", "vocab_id": 11, "gen_step": 0, "position": { "abs": 0 } },
  { "id": "t1", "vocab_id": 22, "gen_step": 0, "position": { "abs": 1 } },
  { "id": "t2", "vocab_id": 33, "gen_step": 1, "position": { "abs": 2 } },
  ...
]
```

## Producer checklist

When instrumenting a repo (e.g. nanochat) to emit traces:

1. Run your generation. For each step, capture the new token(s) added.
2. Assign each token a unique string `id` within the trace (e.g. `t0`, `t1`, ...).
3. Record `vocab_id`, `gen_step`, and `position` for each token.
4. Build the `vocab` table: walk all tokens, collect unique `vocab_id`s, look each one up via your tokenizer's `id_to_token` (or equivalent). Optionally fill `vocab_meta.is_special` from your tokenizer's special-token list.
5. Wrap the prompt as `gen_step: 0` tokens with `abs` positions.
6. Write JSON conforming to this schema. One file may contain multiple traces (the page dropdown will switch between them).

The producer never needs to know anything about animation, color, or layout — that's the renderer's job.
