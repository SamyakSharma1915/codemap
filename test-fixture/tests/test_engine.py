"""Engine tests."""

from src.core.engine import Engine


def test_initialize():
    engine = Engine("t")
    assert engine.initialize() is True


def test_execute_empty():
    engine = Engine("t")
    assert engine.execute(None) is None


def test_parser_tokenize():
    from src.core.parser import parse
    assert len(parse("a + b")) == 3
