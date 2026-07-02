"""Scaffold test — proves the package imports and pytest wiring runs (PRD-001a FR-2)."""

from pipecat_app import SCAFFOLD_VERSION


def test_scaffold_imports() -> None:
    assert SCAFFOLD_VERSION == "0.0.0"
