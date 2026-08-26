"""Application entry point."""

from core.engine import Engine


def main():
    engine = Engine("my-project")
    engine.initialize()
    print("running", engine.execute("hello"))


if __name__ == "__main__":
    main()
