#!/usr/bin/env python3
"""Serve this remaster folder on localhost and open it in the browser.

Why not `python -m http.server`? It enables address reuse, and on Windows that lets a second
server bind a port that another remaster's server is still using - silently. The browser then
keeps showing the *previous* game. This launcher:
  - picks a stable default port per game (from GAME_ID), so two remasters rarely collide;
  - binds the port exclusively and moves to the next free port if it is taken;
  - sends no-cache headers, so a different game on a reused port is never served from cache;
  - opens the browser at the port it actually got, and prints it.

Usage: python serve.py [--port N] [--no-browser]
"""
import argparse, functools, os, socket, sys, webbrowser, zlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

GAME_ID = 'galaga'                      # set per remaster (the MAME set name)
TITLE = 'Galaga 3D'                     # shown in the console so the user can check
DEFAULT_PORT = 8000 + zlib.crc32(GAME_ID.encode()) % 1000


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def log_message(self, fmt, *args):  # keep the console readable
        pass


class ExclusiveServer(ThreadingHTTPServer):
    allow_reuse_address = False         # never share a port with another server
    daemon_threads = True

    def server_bind(self):
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):   # Windows
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=DEFAULT_PORT, help='first port to try')
    ap.add_argument('--no-browser', action='store_true')
    a = ap.parse_args()
    root = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NoCacheHandler, directory=root)
    httpd = None
    for port in range(a.port, a.port + 50):
        try:
            httpd = ExclusiveServer(('127.0.0.1', port), handler)
            break
        except OSError:
            print(f'port {port} is busy (another server is running there) - trying {port + 1}', flush=True)
    if httpd is None:
        sys.exit('no free port found; close other game server windows and try again')
    url = f'http://127.0.0.1:{port}/'
    print(f'{TITLE}  ->  {url}', flush=True)
    print('Keep this window open while playing; close it to stop the server.', flush=True)
    if not a.no_browser:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
