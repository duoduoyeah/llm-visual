# Dataloader Trace Schema

Sibling to `SCHEMA.md` (the generation-trace schema). This one is consumed by
`dataloader.html` and describes a **batch of rows** as the model would see
them at training time, with `inputs` and `targets` paired column-by-column.

There is no `gen_step` here — this is data, not generation.

## Top-level shape

```json
{
  "schema_version": "1",
  "kind": "dataloader",
  "name": "simple_story / B=4 T=512 / split=train",
  "vocab": { "<id>": "<text>", ... },
  "vocab_meta": { "<id>": { "is_special": true }, ... },
  "rows": [ <row>, ... ]
}
```

| field | required | description |
|---|---|---|
| `schema_version` | yes | Bump when the schema changes incompatibly. Current: `"1"`. |
| `kind` | yes | Must be `"dataloader"`. Distinguishes this from generation traces. |
| `name` | yes | Short label shown in the title (e.g. dataset / B / T / split). |
| `vocab` | yes | Map from `vocab_id` (as string) to its human-readable text. |
| `vocab_meta` | no | Per-vocab-id extras. Renderer styles entries with `is_special: true`. |
| `rows` | yes | Array of one or more rows. The page shows a dropdown to pick one. |

## Row

```json
{
  "name": "batch 0",
  "T": 512,
  "inputs":  [<vocab_id>, ...],
  "targets": [<vocab_id>, ...],
  "doc_idx": [0, 0, ..., 1, 1, ...]
}
```

(`name` is just a free-form label shown in the row dropdown; the convention
above means "the 0-th sample within the dumped batch" — pick whatever
labelling makes sense for your producer.)

| field | required | description |
|---|---|---|
| `name` | yes | Short label shown in the row dropdown. |
| `T` | yes | Sequence length. Must equal `len(inputs) == len(targets) == len(doc_idx)`. |
| `inputs` | yes | Token-id sequence the model receives at each position. |
| `targets` | yes | Token-id sequence the model is asked to predict at each position. For standard causal LM, `targets[i] == inputs[i+1]` *within* a doc (and may cross doc boundaries depending on the dataloader). A value of `-1` means "no target at this position". |
| `doc_idx` | yes | Integer per position naming which doc-within-row each position belongs to (0-indexed, monotone non-decreasing). Computed by the producer from BOS markers in `inputs`. The renderer uses this to tint adjacent docs differently. |

## Producer checklist

When emitting a dataloader trace from any LLM repo:

1. Run one batch through the dataloader. For each of the first N rows you want to inspect:
2. Record `inputs[i]` and `targets[i]` (the two `[T]` tensors the model sees).
3. Walk `inputs` and assign a `doc_idx`: increment whenever a BOS token is seen.
4. Build the `vocab` table: union of all `vocab_id`s across rows, looked up via `tokenizer.id_to_token`. Mark known specials in `vocab_meta`.
5. Write JSON conforming to this schema.

The producer never needs to know anything about layout, color, wrap width, or
tooltip behavior — that's the renderer's job.
