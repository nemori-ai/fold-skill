"""Serve the local visual prototype without stale module/style caches."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class PreviewHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    handler = partial(PreviewHandler, directory=str(Path(__file__).parent))
    with ThreadingHTTPServer(("127.0.0.1", 4173), handler) as server:
        print("Fold prototype: http://127.0.0.1:4173", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
