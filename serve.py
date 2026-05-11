#!/usr/bin/env python3
"""Serve llm-visual locally on the first free port (preferred 8000+).

Usage:
    python3 llm-visual/serve.py            # auto-picks a free port
    python3 llm-visual/serve.py 9000       # explicit port
    ./llm-visual/serve.py                  # if the file is +x

cd's into this directory automatically so relative paths in the HTML
files resolve, regardless of where you invoked it from.
"""

from __future__ import annotations

import argparse
import http.server
import os
import socket
import sys


def _port_is_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("", port))
            return True
        except OSError:
            return False


def find_free_port(preferred: int = 8000, search_range: int = 1000) -> int:
    """Try `preferred`, then walk up to `preferred + search_range - 1`,
    then ask the OS for any free port as a last resort."""
    for port in range(preferred, preferred + search_range):
        if _port_is_free(port):
            return port
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("port", nargs="?", type=int, default=None,
                        help="explicit port; default: auto-pick from 8000+")
    parser.add_argument("--bind", default="0.0.0.0",
                        help="address to bind (default: 0.0.0.0 — accept any)")
    args = parser.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    os.chdir(here)

    port = args.port if args.port is not None else find_free_port()
    if args.port is not None and not _port_is_free(args.port):
        print(f"WARNING: port {args.port} is already in use, "
              f"http.server will fail to bind", file=sys.stderr)

    handler = http.server.SimpleHTTPRequestHandler
    server = http.server.ThreadingHTTPServer((args.bind, port), handler)
    print(f"Serving {here} on http://localhost:{port}")
    print(f"Open http://localhost:{port}/   (Ctrl-C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
