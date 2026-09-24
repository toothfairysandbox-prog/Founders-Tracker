#!/usr/bin/env python3
"""A stand-in for Supabase Storage, just enough of it to test against.

Implements the three calls js/attachments.js actually makes, and enforces the
two things worth enforcing: a Bearer token must be present, and so must the
apikey header. Anything else 401s, which is what the real thing does.
"""
import http.server, json, re, socketserver, urllib.parse

FILES = {}          # path -> bytes
BUCKET = "attachments"


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _authed(self):
        return (self.headers.get("Authorization", "").startswith("Bearer ")
                and bool(self.headers.get("apikey")))

    def _send(self, code, obj=None):
        body = json.dumps(obj or {}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "POST,DELETE,GET,OPTIONS")
        self.end_headers()
        self.body_written = True
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(200)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n)
        if not self._authed():
            return self._send(401, {"message": "no auth"})

        m = re.match(r"^/storage/v1/object/sign/%s/(.+)$" % BUCKET, path)
        if m:
            key = m.group(1)
            if key not in FILES:
                return self._send(404, {"message": "not found"})
            return self._send(200, {"signedURL":
                                    "/object/sign/%s/%s?token=testtoken" % (BUCKET, key)})

        m = re.match(r"^/storage/v1/object/%s/(.+)$" % BUCKET, path)
        if m:
            key = m.group(1)
            if key in FILES:
                return self._send(409, {"message": "exists"})
            FILES[key] = raw
            return self._send(200, {"Key": "%s/%s" % (BUCKET, key)})

        self._send(404, {"message": "no route"})

    def do_DELETE(self):
        path = urllib.parse.urlparse(self.path).path
        if not self._authed():
            return self._send(401, {"message": "no auth"})
        m = re.match(r"^/storage/v1/object/%s/(.+)$" % BUCKET, path)
        if m and m.group(1) in FILES:
            del FILES[m.group(1)]
            return self._send(200, {"message": "deleted"})
        self._send(404, {"message": "not found"})

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/__reset":
            FILES.clear()
            return self._send(200, {"ok": True})
        if path == "/__files":
            return self._send(200, {"paths": sorted(FILES),
                                    "sizes": {k: len(v) for k, v in FILES.items()}})
        m = re.match(r"^/storage/v1/object/sign/%s/(.+)$" % BUCKET, path)
        if m and m.group(1) in FILES:
            data = FILES[m.group(1)]
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            self.send_response(200)
            if q.get("download"):
                self.send_header("Content-Disposition",
                                 'attachment; filename="%s"' % q["download"][0])
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            return self.wfile.write(data)
        self._send(404, {"message": "not found"})


class S(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    import os
    S(("", int(os.environ.get("SUPA_PORT", "8100"))), H).serve_forever()
