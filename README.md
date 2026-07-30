# Eyeball Transformer

## Usage

Start a local server (auto-picks a free port starting at 8000):

```bash
./serve.py            # or: python3 serve.py
./serve.py 9000       # or pin an explicit port
```

The script `cd`s into this directory automatically and prints the URL,
so you can run it from anywhere.

The index page (`http://localhost:<port>/`) lists every example JSON
under `examples/`. The list is read from `examples/manifest.json`,
which is regenerated from the dump scripts (or via
`python -m scripts.dump.refresh_examples_manifest` from the repo root).

To load a specific file directly, pass its path via the `trace`
query param on the matching renderer page (`dataloader.html`,
`attention.html`, `rope.html`):

```
http://localhost:<port>/rope.html?trace=./examples/some_rope_dump.json
```

## Status

The **generation-trace** visualization (schema + renderer) has been torn
down and is being rewritten. Only the dataloader, attention, and RoPE
renderers are live right now.
