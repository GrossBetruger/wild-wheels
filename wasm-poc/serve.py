#!/usr/bin/env python3
"""Local dev server for wasm-poc that serves static files and records POST /perf-log to perf-log.jsonl."""
import http.server
import json
import os
import pathlib
import time

ROOT = pathlib.Path(__file__).resolve().parent
LOG_PATH = ROOT / "perf-log.jsonl"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        if self.path != "/perf-log":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(min(length, 65536))
        try:
            rec = json.loads(body.decode("utf-8"))
        except Exception:
            self.send_error(400)
            return
        rec["t"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        rec["source"] = "bevy-wasm-poc"
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, separators=(",", ":")) + "\n")
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    os.chdir(ROOT)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 8088), Handler)
    print("Serving wasm-poc on http://127.0.0.1:8088/ (logging to wasm-poc/perf-log.jsonl)", flush=True)
    server.serve_forever()
