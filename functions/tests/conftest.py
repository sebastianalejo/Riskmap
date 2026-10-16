"""Carga módulos de `crime_ml/` de forma aislada.

Se evita importar el paquete `crime_ml` completo (que arrastra pandas/sklearn)
porque `validation` y `artifacts` no dependen de ellos.
"""

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import pytest

_MODULES_DIR = Path(__file__).resolve().parents[1] / "crime_ml"

# Permite que `functions/tests` importe `crime_ml.pipeline` (necesario para las
# pruebas de ML; requiere scikit-learn/pandas instalados).
_FUNCTIONS_DIR = _MODULES_DIR.parent
if str(_FUNCTIONS_DIR) not in sys.path:
    sys.path.insert(0, str(_FUNCTIONS_DIR))


def _load_module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def validation() -> ModuleType:
    return _load_module("crime_ml_validation", _MODULES_DIR / "validation.py")


@pytest.fixture(scope="session")
def artifacts() -> ModuleType:
    return _load_module("crime_ml_artifacts", _MODULES_DIR / "artifacts.py")
