"""Pruebas de `crime_ml/validation.py` (Fase 1)."""

from __future__ import annotations

import pytest

FEATURES = [
    "crime_type",
    "hour",
    "day_of_week",
    "district",
    "latitude",
    "longitude",
    "historical_frequency",
]


def valid_payload() -> dict:
    return {
        "crime_type": "robo agravado",
        "hour": 22,
        "day_of_week": "viernes",
        "district": "LA VICTORIA",
        "latitude": -12.071,
        "longitude": -77.0201,
        "historical_frequency": 270,
    }


# ── predict_crime ────────────────────────────────────────────────────────────


def test_predict_payload_valido(validation):
    cleaned = validation.validate_predict_payload(valid_payload(), FEATURES)
    assert cleaned["hour"] == 22
    assert cleaned["latitude"] == -12.071
    assert cleaned["day_of_week"] == "viernes"


def test_predict_normaliza_dia_a_minusculas(validation):
    body = valid_payload()
    body["day_of_week"] = " Viernes "
    cleaned = validation.validate_predict_payload(body, FEATURES)
    assert cleaned["day_of_week"] == "viernes"


def test_predict_cuerpo_no_objeto(validation):
    with pytest.raises(validation.ValidationError):
        validation.validate_predict_payload([1, 2, 3], FEATURES)


def test_predict_faltan_campos(validation):
    body = valid_payload()
    del body["district"]
    with pytest.raises(validation.ValidationError, match="Faltan campos"):
        validation.validate_predict_payload(body, FEATURES)


def test_predict_hora_fuera_de_rango(validation):
    body = valid_payload()
    body["hour"] = 25
    with pytest.raises(validation.ValidationError):
        validation.validate_predict_payload(body, FEATURES)


def test_predict_hora_booleana_rechazada(validation):
    body = valid_payload()
    body["hour"] = True
    with pytest.raises(validation.ValidationError):
        validation.validate_predict_payload(body, FEATURES)


def test_predict_hora_no_entera(validation):
    body = valid_payload()
    body["hour"] = 22.5
    with pytest.raises(validation.ValidationError):
        validation.validate_predict_payload(body, FEATURES)


def test_predict_latitud_fuera_de_lima(validation):
    body = valid_payload()
    body["latitude"] = 40.4
    with pytest.raises(validation.ValidationError):
        validation.validate_predict_payload(body, FEATURES)


def test_predict_longitud_no_numerica(validation):
    body = valid_payload()
    body["longitude"] = "abc"
    with pytest.raises(validation.ValidationError):
        validation.validate_predict_payload(body, FEATURES)


def test_predict_texto_demasiado_largo(validation):
    body = valid_payload()
    body["crime_type"] = "x" * 61
    with pytest.raises(validation.ValidationError):
        validation.validate_predict_payload(body, FEATURES)


# ── dataset / rows ───────────────────────────────────────────────────────────


def test_dataset_valido(validation):
    rows = [valid_payload()]
    assert validation.validate_dataset_rows(rows) == rows


def test_dataset_vacio(validation):
    with pytest.raises(validation.ValidationError):
        validation.validate_dataset_rows([])


def test_dataset_no_lista(validation):
    with pytest.raises(validation.ValidationError):
        validation.validate_dataset_rows("no soy una lista")


def test_dataset_filas_no_objeto(validation):
    with pytest.raises(validation.ValidationError):
        validation.validate_dataset_rows([1, 2])


def test_dataset_excede_maximo(validation, monkeypatch):
    monkeypatch.setattr(validation, "MAX_ROWS_DATASET", 2)
    with pytest.raises(validation.ValidationError, match="excede"):
        validation.validate_dataset_rows([valid_payload()] * 3)


def test_import_rows_excede_maximo(validation, monkeypatch):
    monkeypatch.setattr(validation, "MAX_ROWS_IMPORT", 2)
    with pytest.raises(validation.ValidationError, match="excede"):
        validation.validate_import_rows([valid_payload()] * 3)


# ── csv_text ─────────────────────────────────────────────────────────────────


def test_csv_text_valido(validation):
    assert validation.validate_csv_text("a,b\n1,2") == "a,b\n1,2"


def test_csv_text_vacio(validation):
    with pytest.raises(validation.ValidationError):
        validation.validate_csv_text("   ")


def test_csv_text_excede_tamano(validation, monkeypatch):
    monkeypatch.setattr(validation, "MAX_CSV_BYTES", 10)
    with pytest.raises(validation.ValidationError, match="tamaño máximo"):
        validation.validate_csv_text("x" * 11)


# ── test_size / layer / limit / bbox ─────────────────────────────────────────


def test_test_size_valido(validation):
    assert validation.parse_test_size(0.2) == 0.2
    assert validation.parse_test_size(0.45) == 0.45
    assert validation.parse_test_size(0.05) == 0.05


def test_test_size_invalido(validation):
    for value in ("abc", True, None, 0.5, 0.01):
        with pytest.raises(validation.ValidationError):
            validation.parse_test_size(value)


def test_layer_valido(validation):
    assert validation.validate_layer("107") == 107
    assert validation.validate_layer(107) == 107


def test_layer_invalido(validation):
    for value in ("abc", "107/../otro", "-1", "0", "10000", None, True):
        with pytest.raises(validation.ValidationError):
            validation.validate_layer(value)


def test_limit_normaliza(validation):
    assert validation.parse_limit("500") == 500
    assert validation.parse_limit("0") == 1
    assert validation.parse_limit("99999") == validation.MAX_QUERY_LIMIT
    assert validation.parse_limit("abc") == validation.DEFAULT_QUERY_LIMIT


def test_bbox_valido(validation):
    assert validation.validate_bbox("-77.2", "-12.3", "-76.8", "-11.8") == (-77.2, -12.3, -76.8, -11.8)


def test_bbox_invalido(validation):
    for args in (
        (None, "-12", "-76", "-11"),
        ("a", "-12", "-76", "-11"),
        ("-76", "-12", "-77", "-11"),  # xmin > xmax
        ("-77", "-11", "-76", "-12"),  # ymin > ymax
        ("-200", "-12", "-76", "-11"),
    ):
        with pytest.raises(validation.ValidationError):
            validation.validate_bbox(*args)
