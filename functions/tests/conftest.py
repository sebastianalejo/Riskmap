"""Carga `crime_ml/validation.py` de forma aislada.

Se evita importar el paquete `crime_ml` completo (que arrastra pandas/sklearn)
porque la validación no depende de ellos.
"""

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest

_VALIDATION_PATH = Path(__file__).resolve().parents[1] / "crime_ml" / "validation.py"


@pytest.fixture(scope="session")
def validation() -> ModuleType:
    spec = importlib.util.spec_from_file_location("crime_ml_validation", _VALIDATION_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
