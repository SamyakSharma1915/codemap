"""Logging utilities."""


def log(message):
    print(f"[log] {message}")


def get_logger(name):
    return _Logger(name)


class _Logger:
    def __init__(self, name):
        self.name = name

    def info(self, msg):
        print(f"[{self.name}] {msg}")
