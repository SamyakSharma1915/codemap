"""HTTP API server."""

from engine import Engine
from logger import log


class Server:
    def __init__(self):
        self.engine = Engine("api")

    def handle_request(self, method, path):
        log(f"{method} {path}")
        if path == "/status":
            return {"status": "ok"}
        if path.startswith("/engine"):
            return self.engine.execute(method)
        return {"error": "not found"}


def run():
    server = Server()
    server.handle_request("GET", "/status")
