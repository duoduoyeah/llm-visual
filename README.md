# Eyeball Transformer

## Usage

Start a local server (auto-picks a free port starting at 8000):

```bash
./serve.py            # or: python3 serve.py
./serve.py 9000       # or pin an explicit port
```

The script `cd`s into this directory automatically and prints the URL,
so you can run it from anywhere.

`llm-visual` does not have its own `.venv`, `pyproject.toml`, `uv.lock`, or `.env`.
The uv project environment lives at the repo root, and `serve.py` only uses
Python's standard library. Running it with `python3` is enough for the viewer.

The index page (`http://localhost:<port>/`) discovers JSON examples under
`examples/` directly from the server directory listing. It walks nested folders
such as `examples/core_layouts/`, skips `example_cache/`, `manifest.json`, and
non-visual JSON dumps, reads each visual JSON's `kind` and `name`, and routes
the card to the matching viewer. No manifest regeneration step is needed.

To pull the HPCC core layout examples into this repo:

```bash
mkdir -p llm-visual/examples
scp -r 'hpcc-zyang-login:/bigdata/blilab/zyang199/forensics-nanochat/llm-visual/examples/core_layouts/' \
    llm-visual/examples/
```

To load a specific trace directly, pass its path via the `trace` query param:

```text
http://localhost:<port>/viewer.html?trace=./examples/d8_r20_simplestory.json
```
