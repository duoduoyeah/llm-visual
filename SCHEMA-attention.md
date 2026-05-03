# Attention-Mask Trace Schema

Sibling to `SCHEMA.md` and `SCHEMA-dataloader.md`. Consumed by `attention.html`.

A file describes one or more **attention-mask matrices** (square, N×N) with
optional metadata per query/key position.

## Top-level shape

```json
{
  "schema_version": "1",
  "kind": "attention",
  "name": "MIM Model 1 | N=16 doc_lens=[8,8]",
  "matrices": [ <matrix>, ... ]
}
```

| field | required | description |
|---|---|---|
| `schema_version` | yes | Bump on incompatible changes. Current: `"1"`. |
| `kind` | yes | Must be `"attention"`. |
| `name` | yes | Free-form label shown in the page header. |
| `matrices` | yes | Array of one or more matrices. The page shows a dropdown to pick one. |

## Matrix

```json
{
  "name": "butterfly (orig coords)",
  "N": 16,
  "rows": [ <axis_entry>, ... ],
  "cols": [ <axis_entry>, ... ],
  "mask": [[0,1,...,1], ...]
}
```

| field | required | description |
|---|---|---|
| `name` | yes | Short label for the matrix dropdown. |
| `N` | yes | Side length. Must equal `len(rows) == len(cols) == len(mask)` and each `len(mask[i]) == N`. |
| `rows` | yes | Length-N axis entries describing each query position (top-to-bottom). |
| `cols` | yes | Length-N axis entries describing each key position (left-to-right). |
| `mask` | yes | N×N integer (0 or 1). `mask[q][k] == 1` means query `q` can attend to key `k`. |

## Axis entry

```json
{ "label": "p=1", "doc": 0, "is_bos": true, "extra": "prefix → orig 2" }
```

| field | required | description |
|---|---|---|
| `label` | yes | Short string shown along the axis. Keep ≤ ~6 chars for legibility. |
| `doc` | no | Integer doc id. The renderer draws a thicker boundary between consecutive entries with different `doc` values. |
| `is_bos` | no | Boolean. Renderer styles BOS labels italic / muted. |
| `extra` | no | Free-form annotation shown in the hover tooltip. |

## Producer checklist

1. Compute the boolean visibility matrix for each variant you want to show.
2. Build axis entries for rows and cols. If row-axis and col-axis describe the same positions (square mask of identical semantics), pass the same list to both.
3. Wrap into one matrix per variant; collect into the top-level `matrices` array.
4. Write JSON conforming to this schema.

The renderer is responsible for layout, sticky labels, doc-boundary rendering, hover tooltips, and color.
