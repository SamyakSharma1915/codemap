"""API tests."""

from src.api.server import Server


def test_status():
    s = Server()
    assert s.handle_request("GET", "/status")["status"] == "ok"
