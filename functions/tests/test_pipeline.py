"""Pruebas del pipeline de ML (Fase 3): splits, métricas y predicción."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from crime_ml.pipeline import CrimeRiskPipelineCore

MODALITIES = ["robo agravado", "hurto", "estafa", "microcomercializacion de drogas"]
FEATURES = ["district", "latitude", "longitude"]
TARGET = "crime_type"


def make_dataset(seed: int = 7, per_cell: int = 30, districts: int = 6) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for year in (2021, 2022, 2023, 2024):
        for index in range(districts):
            district = f"DISTRITO {chr(65 + index)}"
            for _ in range(per_cell):
                rows.append(
                    {
                        "occurred_year": year,
                        "district": district,
                        "latitude": round(-12.1 + index * 0.02 + float(rng.normal(0, 0.005)), 6),
                        "longitude": round(-77.05 - index * 0.02 + float(rng.normal(0, 0.005)), 6),
                        "crime_type": MODALITIES[int(rng.integers(0, len(MODALITIES)))],
                    }
                )
    return pd.DataFrame(rows)


def train(df: pd.DataFrame, tmp_path, *, split: str = "random", **kwargs) -> dict:
    params = {"time_column": "occurred_year", "group_column": "district"}
    params.update(kwargs)
    return CrimeRiskPipelineCore.train_from_dataframe(
        df,
        test_size=0.25,
        artifact_path=tmp_path / "model.joblib",
        features=FEATURES,
        target=TARGET,
        split=split,
        **params,
    )


def test_split_random_devuelve_metricas_completas(tmp_path):
    result = train(make_dataset(), tmp_path)

    metrics = result["metrics"]
    assert 0 <= metrics["accuracy"] <= 1
    assert 0 <= metrics["f1_macro"] <= 1
    assert metrics["baseline_majority_accuracy"] <= 1
    assert len(metrics["confusion_matrix"]) == len(metrics["classes"]) == len(MODALITIES)
    assert set(metrics["per_class"]) == set(MODALITIES)
    assert (tmp_path / "model.joblib").exists()
    assert result["split"] == "random"
    assert result["split_info"]["stratified"] is True


def test_determinismo_con_misma_semilla(tmp_path):
    df = make_dataset()
    first = train(df, tmp_path / "a")
    second = train(df, tmp_path / "b")
    assert first["metrics"]["accuracy"] == second["metrics"]["accuracy"]


def test_split_temporal_separa_periodos(tmp_path):
    result = train(make_dataset(), tmp_path, split="temporal")

    info = result["split_info"]
    assert info["mode"] == "temporal"
    assert int(info["train_period"][1]) < int(info["test_period"][0])
    assert info["test_values"] == ["2024"]


def test_split_district_separa_grupos(tmp_path):
    result = train(make_dataset(), tmp_path, split="district")

    info = result["split_info"]
    assert info["mode"] == "district"
    assert info["test_groups"], "debe haber distritos de prueba"
    assert not set(info["test_groups"]) & set(info["train_groups_sample"])


def test_importancias_de_variables(tmp_path):
    result = train(make_dataset(), tmp_path)
    top = result["feature_importances"]
    assert 0 < len(top["top"]) <= 20
    assert top["total_features"] >= len(top["top"])
    assert all(0 <= item["importance"] <= 1 for item in top["top"])


def test_predict_con_categoria_desconocida(tmp_path):
    result = train(make_dataset(), tmp_path)
    prediction = CrimeRiskPipelineCore.predict(
        {"district": "DISTRITO Z", "latitude": -12.05, "longitude": -77.05},
        tmp_path / "model.joblib",
    )
    assert prediction in MODALITIES
    assert result["classes"] == sorted(MODALITIES)


def test_errores_de_validacion(tmp_path):
    df = make_dataset()

    with pytest.raises(ValueError, match="Faltan columnas"):
        CrimeRiskPipelineCore.train_from_dataframe(
            df.drop(columns=["latitude"]),
            test_size=0.25,
            artifact_path=tmp_path / "m.joblib",
            features=FEATURES,
            target=TARGET,
        )

    with pytest.raises(ValueError, match="time_column"):
        train(df, tmp_path, split="temporal", time_column=None)

    with pytest.raises(ValueError, match="sin valor"):
        train(df.assign(crime_type=None), tmp_path)

    with pytest.raises(ValueError, match="al menos 2 clases"):
        single = df.assign(crime_type="hurto")
        train(single, tmp_path)

    with pytest.raises(ValueError, match="al menos 30 filas"):
        train(df.head(10), tmp_path)

    with pytest.raises(ValueError, match="no puede ser a la vez"):
        CrimeRiskPipelineCore.train_from_dataframe(
            df,
            test_size=0.25,
            artifact_path=tmp_path / "m2.joblib",
            features=FEATURES + [TARGET],
            target=TARGET,
        )
