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

To load a specific trace directly, pass its path via the `trace`
query param:

```
http://localhost:<port>/viewer.html?trace=./examples/d8_r20_simplestory.json
```
