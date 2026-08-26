"""Configuration loading."""

import json
import os


def load_config(path=None):
    path = path or os.environ.get("CODEMAP_CONFIG", "config.json")
    with open(path) as f:
        return json.load(f)


def validate_config(config):
    return config.get("enabled", False)
