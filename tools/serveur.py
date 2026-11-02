"""Serveur de développement statique sans cache : python tools/serveur.py [port]"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class SansCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8737
    racine = Path(__file__).resolve().parent.parent
    ThreadingHTTPServer(('127.0.0.1', port), partial(SansCache, directory=str(racine))).serve_forever()
