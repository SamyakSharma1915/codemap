"""Core engine for my-project."""

from config import load_config
from parser import parse


class Engine:
    """The main execution engine."""

    def __init__(self, name):
        self.name = name
        self.config = load_config()

    def initialize(self):
        self.tree = parse("main.py")
        return self.tree is not None

    def execute(self, payload):
        if payload is None:
            return None
        result = self._run(payload)
        return result

    def shutdown(self):
        self.config = None
        return True

    def _run(self, payload):
        return {"ok": True, "size": len(str(payload))}


def load_model(path):
    return Engine(path)
