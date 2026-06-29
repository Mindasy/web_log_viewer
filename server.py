#!/usr/bin/env python3
"""Simple HTTP server for Web log viewer's Web"""
import http.server
import socketserver
import os
import sys
import webbrowser

PORT = 8765

class ReuseAddrServer(socketserver.TCPServer):
    allow_reuse_address = True

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.dirname(os.path.abspath(__file__)), **kwargs)

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {args[0]}")

if __name__ == '__main__':
    with ReuseAddrServer(("", PORT), Handler) as httpd:
        url = f"http://localhost:{PORT}"
        print(f"Web view logger's Web 已启动: {url}")
        print("按 Ctrl+C 停止服务器")
        try:
            webbrowser.open(url)
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n服务器已停止")
