"""Parser module."""

import re

from logger import get_logger


class Parser:
    def __init__(self, source):
        self.source = source
        self.tokens = []

    def tokenize(self):
        self.tokens = re.findall(r"\w+|[^\w\s]", self.source)
        return self.tokens

    def validate(self):
        return len(self.tokens) > 0


def parse(source):
    p = Parser(source)
    p.tokenize()
    return p.tokens
