# RoPE Positional-Encoding Trace Schema

Sibling to `SCHEMA.md`, `SCHEMA-attention.md`, `SCHEMA-dataloader.md`.
Consumed by `rope.html`.

A file describes one or more **positional-encoding variants** over the same
sequence (or different sequences). Each variant carries:

1. a **token table** — for every position, three position attributes (`abs_pos`,
   `q_pos`, `k_pos`).
2. a **distance map** — N×N matrix of the *effective relative position* the
   model sees when token `i` queries token `j`.

For plain RoPE under any positioning scheme, `distance[i][j] == q_pos[i] -
k_pos[j]`, so the field is **optional**: when omitted, the renderer derives it.
Variants whose effective distance is *not* a simple subtraction (band-dependent
schemes, content-dependent remapping) must supply `distance` explicitly.

## Top-level shape

```json
{
  "schema_version": "1",
  "kind": "rope",
  "name": "Toy RoPE schemes (N=10)",
  "variants": [ <variant>, ... ]
}
```

| field | required | description |
|---|---|---|
| `schema_version` | yes | Bump on incompatible changes. Current: `"1"`. |
| `kind` | yes | Must be `"rope"`. |
| `name` | yes | Free-form label shown in the page header. |
| `variants` | yes | Array of one or more variants. The page shows a dropdown to pick one. |

## Variant

```json
{
  "name": "plain RoPE",
  "N": 10,
  "tokens": [ <token>, ... ],
  "distance": [[0,-1,...], [1,0,...], ...]
}
```

| field | required | description |
|---|---|---|
| `name` | yes | Short label for the variant dropdown. |
| `N` | yes | Sequence length. Must equal `len(tokens)`; if `distance` is given, it must be N×N. |
| `tokens` | yes | Length-N array of token entries (see below), in sequence order. |
| `distance` | no | N×N number array. `distance[i][j]` is the effective relative position seen by query-i for key-j. If absent, renderer computes `tokens[i].q_pos - tokens[j].k_pos`. |

## Token entry

```json
{ "label": "the", "abs_pos": 1, "q_pos": 1, "k_pos": 1, "doc": 0, "is_bos": false, "extra": "..." }
```

| field | required | description |
|---|---|---|
| `label` | yes | Short string shown along the axis and in the table. Keep ≤ ~6 chars for legibility. |
| `abs_pos` | yes | Real position in the original sequence. Number (usually integer). |
| `q_pos` | yes | Position assigned to this token *as a query* — what RoPE rotates Q by. Number. |
| `k_pos` | yes | Position assigned to this token *as a key* — what RoPE rotated K by when this slot was written to the KV cache. Number. |
| `doc` | no | Integer doc id. Renderer draws a thicker boundary between consecutive tokens with different `doc` values, in both axes. |
| `is_bos` | no | Boolean. Renderer styles BOS labels italic / muted. |
| `extra` | no | Free-form annotation shown in the hover tooltip. |

## Producer checklist

1. Decide the variants you want to compare (plain, PI, NTK, self-extend, streaming-eviction, speculative branch, hidden-thinking, …).
2. For each variant, build the length-N token list. Set `abs_pos`/`q_pos`/`k_pos` per the scheme. They may be non-integer (PI, NTK).
3. If the scheme is "RoPE under custom positions" — leave `distance` off; the renderer will derive it.
4. If the scheme is band-dependent or otherwise non-subtractive — compute the N×N effective-distance matrix yourself and put it in `distance`.
5. Wrap into one variant per scheme; collect into `variants`. Write JSON conforming to this schema.

The renderer handles layout, sticky labels, doc-boundary rendering, hover
tooltips, and the diverging color scale.
