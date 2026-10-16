"""Validación de payloads de la API (Fase 1).

Sin dependencias de terceros para poder probarse de forma aislada
(ver `functions/tests/test_validation.py`).

Cubre:
- `predict`: campos obligatorios, tipos y rangos de las features del modelo.
- `dataset` de entrenamiento e `rows` de importación: tamaño y forma del payload.
- `csv_text`: tipo y tamaño máximo.
- parámetros de los proxies INEI (`bbox` y `layer`).

Los errores se señalan con `ValidationError`; `main.py` responde 400 con `detail`.
"""

from __future__ import annotations

import math
import numbers
from typing import Any

DAYS_OF_WEEK = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")
RISK_LEVELS = ("bajo", "medio", "alto")

# Bbox de Lima Metropolitana con margen (dataset canónico: lat -12.52..-11.71, lon -77.17..-76.66).
# Debe coincidir con firestore.rules y con frontend/src/pages/DataPage.tsx.
LAT_MIN, LAT_MAX = -12.7, -11.5
LON_MIN, LON_MAX = -77.5, -76.5

MAX_STR_CRIME_TYPE = 60
MAX_STR_DISTRICT = 80
MAX_HOUR = 23
MAX_FREQUENCY = 1_000_000

MAX_ROWS_DATASET = 20_000
MAX_ROWS_IMPORT = 20_000
MAX_CSV_BYTES = 5 * 1024 * 1024

MAX_LAYER = 9_999
MAX_QUERY_LIMIT = 1_000
DEFAULT_QUERY_LIMIT = 400


class ValidationError(ValueError):
    """Payload inválido: la API responde 400 con `detail`."""


def _is_number(value: Any) -> bool:
    """Acepta int/float nativos y escalares numéricos de pandas/numpy (registrados en numbers)."""
    return isinstance(value, numbers.Number) and not isinstance(value, bool)


def _require_str(value: Any, field: str, *, max_length: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"'{field}' debe ser un texto no vacío.")
    value = value.strip()
    if len(value) > max_length:
        raise ValidationError(f"'{field}' excede la longitud máxima ({max_length}).")
    return value


def _require_number(
    value: Any,
    field: str,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float:
    if not _is_number(value):
        raise ValidationError(f"'{field}' debe ser un número.")
    number = float(value)
    if not math.isfinite(number):
        raise ValidationError(f"'{field}' debe ser un número finito.")
    if minimum is not None and number < minimum:
        raise ValidationError(f"'{field}' debe ser mayor o igual a {minimum}.")
    if maximum is not None and number > maximum:
        raise ValidationError(f"'{field}' debe ser menor o igual a {maximum}.")
    return number


def _require_int(value: Any, field: str, *, minimum: int, maximum: int) -> int:
    if not _is_number(value):
        raise ValidationError(f"'{field}' debe ser un número entero.")
    number = float(value)
    if not math.isfinite(number) or not number.is_integer():
        raise ValidationError(f"'{field}' debe ser un número entero.")
    int_value = int(number)
    if not minimum <= int_value <= maximum:
        raise ValidationError(f"'{field}' debe estar entre {minimum} y {maximum}.")
    return int_value


def validate_predict_payload(body: Any, required_fields: Any) -> dict[str, Any]:
    """Valida y normaliza el payload de `predict_crime`.

    Devuelve el diccionario de features limpio (hour/frecuencia como int,
    lat/lon como float, `day_of_week` en minúsculas).
    """
    if not isinstance(body, dict):
        raise ValidationError("El cuerpo debe ser un objeto JSON.")

    missing = [field for field in required_fields if field not in body]
    if missing:
        raise ValidationError(f"Faltan campos obligatorios: {missing}")

    cleaned: dict[str, Any] = {}
    for field in required_fields:
        value = body[field]
        if field == "crime_type":
            # Se normaliza a minúsculas: así se almacena y así se entrenó el modelo.
            cleaned[field] = _require_str(value, field, max_length=MAX_STR_CRIME_TYPE).lower()
        elif field == "district":
            # Se normaliza a mayúsculas: así lo usa localPredict y el resto del dataset.
            cleaned[field] = _require_str(value, field, max_length=MAX_STR_DISTRICT).upper()
        elif field == "day_of_week":
            day = value.strip().lower() if isinstance(value, str) else value
            if day not in DAYS_OF_WEEK:
                raise ValidationError(f"'day_of_week' debe ser uno de: {', '.join(DAYS_OF_WEEK)}.")
            cleaned[field] = day
        elif field == "hour":
            cleaned[field] = _require_int(value, field, minimum=0, maximum=MAX_HOUR)
        elif field == "historical_frequency":
            cleaned[field] = _require_int(value, field, minimum=1, maximum=MAX_FREQUENCY)
        elif field == "latitude":
            cleaned[field] = _require_number(value, field, minimum=LAT_MIN, maximum=LAT_MAX)
        elif field == "longitude":
            cleaned[field] = _require_number(value, field, minimum=LON_MIN, maximum=LON_MAX)
        else:
            # Fail-closed: si el esquema FEATURES cambia, exige actualizar este validador.
            raise ValidationError(f"Campo sin regla de validación: '{field}'.")

    return cleaned


def validate_incident_row(row: Any, feature_fields: Any, target_field: str) -> dict[str, Any]:
    """Valida y normaliza una fila completa de incidente (features + variable objetivo).

    Devuelve la fila con exactamente las columnas del esquema (descarta extras),
    lista para escribir en Firestore con el Admin SDK (que no pasa por las reglas).
    """
    if not isinstance(row, dict):
        raise ValidationError("La fila debe ser un objeto.")
    cleaned = validate_predict_payload(row, feature_fields)

    target = row.get(target_field)
    risk = target.strip().lower() if isinstance(target, str) else target
    if risk not in RISK_LEVELS:
        raise ValidationError(f"'{target_field}' debe ser uno de: {', '.join(RISK_LEVELS)}.")
    cleaned[target_field] = risk
    return cleaned


def validate_dataset_rows(dataset: Any) -> list[dict[str, Any]]:
    """Valida el array `dataset` del endpoint de entrenamiento."""
    if not isinstance(dataset, list) or not dataset:
        raise ValidationError("'dataset' debe ser un array no vacío.")
    if len(dataset) > MAX_ROWS_DATASET:
        raise ValidationError(f"'dataset' excede el máximo de {MAX_ROWS_DATASET} filas.")
    if not all(isinstance(row, dict) for row in dataset):
        raise ValidationError("'dataset' debe ser un array de objetos.")
    return dataset


def validate_import_rows(rows: Any) -> list[dict[str, Any]]:
    """Valida el array `rows` del endpoint de importación."""
    if not isinstance(rows, list) or not rows:
        raise ValidationError("'rows' debe ser un array no vacío.")
    if len(rows) > MAX_ROWS_IMPORT:
        raise ValidationError(f"'rows' excede el máximo de {MAX_ROWS_IMPORT} filas.")
    if not all(isinstance(row, dict) for row in rows):
        raise ValidationError("'rows' debe ser un array de objetos.")
    return rows


def validate_csv_text(csv_text: Any) -> str:
    """Valida el texto CSV (tipo y tamaño máximo)."""
    if not isinstance(csv_text, str) or not csv_text.strip():
        raise ValidationError("Envía JSON { csv_text: '...contenido csv...' } con columnas requeridas.")
    if len(csv_text.encode("utf-8")) > MAX_CSV_BYTES:
        raise ValidationError(f"'csv_text' excede el tamaño máximo ({MAX_CSV_BYTES // (1024 * 1024)} MB).")
    return csv_text


def parse_test_size(value: Any) -> float:
    """Valida `test_size` (0.05–0.45) sin lanzar TypeError."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValidationError("'test_size' debe ser un número entre 0.05 y 0.45.")
    test_size = float(value)
    if not 0.05 <= test_size <= 0.45:
        raise ValidationError("'test_size' debe estar entre 0.05 y 0.45.")
    return test_size


def validate_layer(layer: Any) -> int:
    """Valida el parámetro `layer` del proxy ArcGIS (entero positivo)."""
    if isinstance(layer, bool) or layer is None:
        raise ValidationError("Parámetro 'layer' inválido: debe ser un entero positivo (ej. 107).")
    text = str(layer).strip()
    if not text.isdigit():
        raise ValidationError("Parámetro 'layer' inválido: debe ser un entero positivo (ej. 107).")
    layer_int = int(text)
    if not 1 <= layer_int <= MAX_LAYER:
        raise ValidationError(f"Parámetro 'layer' fuera de rango (1–{MAX_LAYER}).")
    return layer_int


def parse_limit(limit_raw: Any) -> int:
    """Normaliza `limit` a 1–1000; usa el valor por defecto si no es un entero válido."""
    try:
        limit = int(str(limit_raw).strip())
    except (TypeError, ValueError):
        return DEFAULT_QUERY_LIMIT
    return max(1, min(limit, MAX_QUERY_LIMIT))


def validate_bbox(xmin: Any, ymin: Any, xmax: Any, ymax: Any) -> tuple[float, float, float, float]:
    """Valida el bbox WGS84 del proxy ArcGIS (numérico y coherente)."""
    if any(value is None or str(value).strip() == "" for value in (xmin, ymin, xmax, ymax)):
        raise ValidationError("Parámetros xmin, ymin, xmax, ymax requeridos (WGS84 grados).")

    values: list[float] = []
    for name, value in (("xmin", xmin), ("ymin", ymin), ("xmax", xmax), ("ymax", ymax)):
        try:
            values.append(float(str(value).strip()))
        except (TypeError, ValueError):
            raise ValidationError(f"Parámetro '{name}' debe ser numérico.") from None

    xmin_f, ymin_f, xmax_f, ymax_f = values
    if not -180 <= xmin_f < xmax_f <= 180:
        raise ValidationError("Rango inválido: se requiere -180 <= xmin < xmax <= 180.")
    if not -90 <= ymin_f < ymax_f <= 90:
        raise ValidationError("Rango inválido: se requiere -90 <= ymin < ymax <= 90.")
    return xmin_f, ymin_f, xmax_f, ymax_f
