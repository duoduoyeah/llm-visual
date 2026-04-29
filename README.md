# llm-visual

## Usage

Start a local server in this directory:

```bash
python3 -m http.server 8000
```

Open the viewer with the default trace:

```
http://localhost:8000/viewer.html
```

To load a specific trace, pass its path via the `trace` query param:

```
http://localhost:8000/viewer.html?trace=./examples/d8_r20_simplestory.json
```
