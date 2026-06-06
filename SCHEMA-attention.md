# Attention Trace Schema

Sibling to `SCHEMA-generation.md` and `SCHEMA-dataloader.md`. Consumed by `attention.html`.

A file describes one or more **attention matrices** with optional metadata per
query/key position. Version 2 keeps the original binary visibility `mask` and
adds optional row-normalized attention `weights`.

## Top-level shape

```json
{
  "schema_version": "2",
  "kind": "attention",
  "name": "Block-MT synthetic attention line view | vanilla baseline + MT hypothesis",
  "matrices": [ <matrix>, ... ]
}
```

| field | required | description |
|---|---|---|
| `schema_version` | yes | Bump on incompatible changes. Current: `"2"`. The renderer also accepts v1 mask-only traces. |
| `kind` | yes | Must be `"attention"`. |
| `name` | yes | Free-form label shown in the page header. |
| `matrices` | yes | Array of one or more matrices. The page shows a dropdown to pick one. |

## Matrix

Square or rectangular (`N_q x N_k`). The renderer derives the shape from
`rows.length` (= `N_q`) and `cols.length` (= `N_k`); the `N` field is
informational and may be omitted for rectangular matrices.

```json
{
  "name": "Block-MT normal (row order)",
  "N": 16,
  "rows": [ <axis_entry>, ... ],
  "cols": [ <axis_entry>, ... ],
  "mask": [[0,1,...,1], ...],
  "weights": [[0.0,0.18,...,0.0], ...]
}
```

| field | required | description |
|---|---|---|
| `name` | yes | Short label for the matrix dropdown. |
| `N` | optional | Convenience for square matrices. The actual shape is `len(rows) x len(cols)`; ignored if absent or if `rows.length != cols.length`. |
| `rows` | yes | Length-`N_q` axis entries describing each query position, top-to-bottom. |
| `cols` | yes | Length-`N_k` axis entries describing each key position, left-to-right. For compact / non-square matrices, `cols` may carry abstract slot labels rather than actual key positions. |
| `mask` | yes | `N_q x N_k` integer (0 or 1). `mask[q][k] == 1` means query `q` can attend to key `k` (or the abstract slot `k` of `q`'s context, in compact representations). |
| `weights` | optional | `N_q x N_k` floats in `[0,1]`, normally row-normalized attention mass. If present, the renderer colors visible nonzero cells by weight. If absent, it falls back to the binary `mask` coloring used by v1 traces. Keep masked cells at weight `0.0`. |
| `cell_labels` | optional | `N_q x N_k` array of short strings to render inside each cell. Used by compact / per-row representations where each cell's "actual" key differs per row (e.g., row q's `k0` cell maps to a different absolute key than row q+1's `k0`). Empty string means no text in that cell. |

## Axis entry

```json
{
  "label": "<sot>",
  "doc": 1,
  "thread": 1,
  "local_step": 0,
  "is_bos": true,
  "extra": "row=2 thread=1 local_step=0 rope=256"
}
```

| field | required | description |
|---|---|---|
| `label` | yes | Short string shown along the axis. Keep <= ~6 chars for legibility. |
| `doc` | no | Integer group id. The renderer draws a thicker boundary between consecutive entries with different `doc` values. For Block-MT line-aware views, set `doc = thread` to group by line. |
| `thread` | no | Integer Block-MT line id (`thread_idx`). Used for tooltips and label tinting. Vanilla baselines may omit this and keep line metadata only in `extra`. |
| `local_step` | no | Integer step within the line. `0` is the line's anchor (`<bos>` / `<sot>`). |
| `is_bos` | no | Boolean. Renderer styles anchor/BOS labels italic / highlighted. |
| `extra` | no | Free-form annotation shown in the hover tooltip. |

## Producer checklist

1. Compute the boolean visibility matrix for each variant you want to show.
2. If emitting attention weights, compute `weights` with the same shape as
   `mask`, keep masked cells at `0.0`, and row-normalize softmax rows when the
   matrix represents real attention.
3. Build axis entries for rows and cols. If row-axis and col-axis describe the
   same positions (square mask of identical semantics), pass the same list to
   both. For thread-major Block-MT views, reorder both axes and the matrices
   with the same position permutation.
4. Wrap into one matrix per variant; collect into the top-level `matrices`
   array. For the Block-MT line-view prototype, include the vanilla GPT
   baseline matrix before the MT matrices.
5. Write JSON conforming to this schema.

The renderer is responsible for layout, sticky labels, doc-boundary rendering,
hover tooltips, and color.
