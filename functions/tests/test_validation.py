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


def test_predict_normaliza_crime_type_y_district(validation):
    body = valid_payload()
    body["crime_type"] = "  Robo Agravado  "
    body["district"] = "la victoria"
    cleaned = validation.validate_predict_payload(body, FEATURES)
    assert cleaned["crime_type"] == "robo agravado"
    assert cleaned["district"] == "LA VICTORIA"


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


# ── filas completas de incidente (importaciones) ─────────────────────────────


def test_incident_row_valida_y_normaliza(validation):
    row = valid_payload() | {"risk_level": " ALTO ", "extra": "se descarta"}
    cleaned = validation.validate_incident_row(row, FEATURES, "risk_level")
    assert cleaned["risk_level"] == "alto"
    assert cleaned["crime_type"] == "robo agravado"
    assert "extra" not in cleaned
    assert set(cleaned) == set(FEATURES + ["risk_level"])


def test_incident_row_sin_campo(validation):
    row = valid_payload() | {"risk_level": "alto"}
    del row["district"]
    with pytest.raises(validation.ValidationError, match="Faltan campos"):
        validation.validate_incident_row(row, FEATURES, "risk_level")


def test_incident_row_risk_level_invalido(validation):
    row = valid_payload() | {"risk_level": "extremo"}
    with pytest.raises(validation.ValidationError, match="risk_level"):
        validation.validate_incident_row(row, FEATURES, "risk_level")


def test_incident_row_no_objeto(validation):
    with pytest.raises(validation.ValidationError):
        validation.validate_incident_row(["no", "es", "fila"], FEATURES, "risk_level")


# ── tareas de entrenamiento y publicación (Fase 4) ───────────────────────────


def test_parse_task_valida(validation):
    task = validation.parse_task(
        {
            "features": ["district", "latitude", "longitude"],
            "target": "crime_type",
            "split": "temporal",
            "time_column": "occurred_year",
        }
    )
    assert task["features"] == ["district", "latitude", "longitude"]
    assert task["split"] == "temporal"
    assert task["time_column"] == "occurred_year"


def test_parse_task_split_por_defecto(validation):
    task = validation.parse_task({"features": ["district"], "target": "crime_type"})
    assert task["split"] == "random"
    assert validation.parse_task(None) is None


def test_parse_task_errores(validation):
    with pytest.raises(validation.ValidationError, match="objeto JSON"):
        validation.parse_task("no soy objeto")
    with pytest.raises(validation.ValidationError, match="features"):
        validation.parse_task({"features": [], "target": "crime_type"})
    with pytest.raises(validation.ValidationError, match="duplicados"):
        validation.parse_task({"features": ["a", "a"], "target": "crime_type"})
    with pytest.raises(validation.ValidationError, match="también una feature"):
        validation.parse_task({"features": ["district"], "target": "district"})
    with pytest.raises(validation.ValidationError, match="split"):
        validation.parse_task({"features": ["district"], "target": "t", "split": "magico"})
    with pytest.raises(validation.ValidationError, match="time_column"):
        validation.parse_task({"features": ["district"], "target": "t", "split": "temporal"})
    with pytest.raises(validation.ValidationError, match="group_column"):
        validation.parse_task({"features": ["district"], "target": "t", "split": "district"})


def test_predict_con_features_de_modalidad(validation):
    body = {"district": "la victoria", "latitude": -12.071, "longitude": -77.02}
    cleaned = validation.validate_predict_payload(body, ["district", "latitude", "longitude"])
    assert cleaned == {"district": "LA VICTORIA", "latitude": -12.071, "longitude": -77.02}


def test_predict_con_occurred_year(validation):
    assert validation.validate_predict_payload({"occurred_year": 2024}, ["occurred_year"]) == {
        "occurred_year": 2024
    }
    with pytest.raises(validation.ValidationError):
        validation.validate_predict_payload({"occurred_year": 1800}, ["occurred_year"])


def test_decode_artifact_b64(validation):
    import base64

    payload = b"contenido-de-modelo"
    assert validation.decode_artifact_b64(base64.b64encode(payload).decode()) == payload

    with pytest.raises(validation.ValidationError):
        validation.decode_artifact_b64("no-es-base64!!")
    with pytest.raises(validation.ValidationError):
        validation.decode_artifact_b64("")
    with pytest.raises(validation.ValidationError):
        validation.decode_artifact_b64(12345)


def test_decode_artifact_excede_tamano(validation, monkeypatch):
    import base64

    monkeypatch.setattr(validation, "MAX_ARTIFACT_BYTES", 4)
    with pytest.raises(validation.ValidationError, match="tamaño máximo"):
        validation.decode_artifact_b64(base64.b64encode(b"12345").decode())


# ── esquema v2: filas del dataset INEI 2021-2024 ─────────────────────────────


def test_arcgis_row_valida(validation):
    cleaned = validation.validate_arcgis_incident_row(
        {
            "crime_type": "robo agravado",
            "district": "miraflores",
            "latitude": "-12.1219",
            "longitude": "-77.0297",
            "occurred_year": "2024",
            "severity_level": "ALTA",
            "macro_category": "delitos contra el patrimonio",
        }
    )
    assert cleaned["district"] == "MIRAFLORES"
    assert cleaned["occurred_year"] == 2024
    assert cleaned["severity_level"] == "alta"
    assert set(cleaned) == {
        "crime_type",
        "district",
        "latitude",
        "longitude",
        "occurred_year",
        "severity_level",
        "macro_category",
    }


def test_arcgis_row_errores(validation):
    base = {
        "crime_type": "hurto",
        "district": "LINCE",
        "latitude": -12.08,
        "longitude": -77.03,
        "occurred_year": 2024,
        "severity_level": "baja",
    }
    with pytest.raises(validation.ValidationError, match="Faltan campos"):
        validation.validate_arcgis_incident_row({k: v for k, v in base.items() if k != "latitude"})
    with pytest.raises(validation.ValidationError, match="severity_level"):
        validation.validate_arcgis_incident_row(dict(base, severity_level="imposible"))
    with pytest.raises(validation.ValidationError, match="occurred_year"):
        validation.validate_arcgis_incident_row(dict(base, occurred_year=1800))


def test_arcgis_row_macro_por_defecto(validation):
    cleaned = validation.validate_arcgis_incident_row(
        {
            "crime_type": "hurto",
            "district": "LINCE",
            "latitude": -12.08,
            "longitude": -77.03,
            "occurred_year": 2024,
            "severity_level": "baja",
        }
    )
    assert cleaned["macro_category"] == "otros"


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
