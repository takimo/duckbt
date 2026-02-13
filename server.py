#!/usr/bin/env python3

# DuckBT Development Server (Sets COOP/COEP/CORP headers required by DuckDB-WASM)
# DuckBT 開発サーバー (DuckDB-WASM 動作に必要な COOP/COEP/CORP ヘッダーを設定)

import sys

if sys.version_info < (3, 0):
    sys.exit("Error: Python 3.x required")

import http.server
import socketserver

PORT = 8000

class CrossOriginHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'credentialless')
        self.send_header('Cross-Origin-Resource-Policy', 'cross-origin')
        super().end_headers()

if __name__ == "__main__":
    print("Server running at http://localhost:{}".format(PORT))
    try:
        with socketserver.TCPServer(("127.0.0.1", PORT), CrossOriginHandler) as httpd:
            httpd.allow_reuse_address = True
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped")