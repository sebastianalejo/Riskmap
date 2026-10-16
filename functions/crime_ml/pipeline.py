"""Pipeline scikit-learn del proyecto (entrenamiento, evaluación y predicción).

Acepta distintos esquemas mediante parámetros (compatibilidad con la API):

- `features` / `target`: columnas de entrada y variable objetivo
  (por defecto, las del esquema heredado de `crime_incidents`).
- `split`: método de partición entrenamiento/prueba —
  `random` (estratificado), `temporal` (años futuros como prueba) o
  `district` (distritos no vistos como prueba, validación geográfica).
- Métricas por clase, baseline de clase mayoritaria, matriz de confusión e
  importancias de variables (para interpretabilidad básica).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import GroupShuffleSplit, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

TARGET = "risk_level"
FEATURES = [
    "crime_type",
    "hour",
    "day_of_week",
    "district",
    "latitude",
    "longitude",
    "historical_frequency",
]

TOP_IMPORTANCES = 20
VALID_SPLITS = ("random", "temporal", "district")


class CrimeRiskPipelineCore:
    """Pipeline sklearn reutilizable en Cloud Functions y en el pipeline offline."""

    model_filename = "crime_risk_model.joblib"

    @classmethod
    def _build_pipeline(
        cls,
        categorical_features: list[str],
        numeric_features: list[str],
        seed: int,
    ) -> Pipeline:
        preprocessor = ColumnTransformer(
            transformers=[
                ("cat", OneHotEncoder(handle_unknown="ignore"), categorical_features),
                ("num", "passthrough", numeric_features),
            ]
        )

        estimator = RandomForestClassifier(
            n_estimators=250,
            max_depth=20,
            random_state=seed,
            class_weight="balanced",
        )

        return Pipeline(
            steps=[
                ("preprocessor", preprocessor),
                ("model", estimator),
            ]
        )

    # ── Particiones ──────────────────────────────────────────────────────────

    @classmethod
    def _split_data(
        cls,
        data: pd.DataFrame,
        target: str,
        *,
        split: str,
        test_size: float,
        time_column: str | None,
        group_column: str | None,
        seed: int,
    ) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
        indices = np.arange(len(data))
        y = data[target]

        if split == "random":
            stratify = y if int(y.value_counts().min()) >= 2 else None
            train_idx, test_idx = train_test_split(
                indices,
                test_size=test_size,
                random_state=seed,
                stratify=stratify,
            )
            return train_idx, test_idx, {"mode": "random", "stratified": stratify is not None}

        if split == "temporal":
            if not time_column:
                raise ValueError("split='temporal' requiere el parámetro time_column.")
            if time_column not in data.columns:
                raise ValueError(f"split='temporal': no existe la columna temporal '{time_column}'.")
            times = data[time_column]
            if pd.api.types.is_datetime64_any_dtype(times):
                times = times.dt.year
            unique_values = np.sort(pd.unique(times.dropna()))
            if len(unique_values) < 2:
                raise ValueError(f"'{time_column}' necesita al menos 2 valores distintos para el split temporal.")
            n_test = max(1, min(round(len(unique_values) * test_size), len(unique_values) - 1))
            test_values = set(unique_values[-n_test:])
            mask = times.isin(test_values).to_numpy()
            test_idx = indices[mask]
            train_idx = indices[~mask]
            return train_idx, test_idx, {
                "mode": "temporal",
                "time_column": time_column,
                "train_period": [str(unique_values[0]), str(unique_values[-n_test - 1])],
                "test_period": [str(unique_values[-n_test]), str(unique_values[-1])],
                "test_values": [str(v) for v in sorted(test_values)],
            }

        if split == "district":
            if not group_column:
                raise ValueError("split='district' requiere el parámetro group_column.")
            if group_column not in data.columns:
                raise ValueError(f"split='district': no existe la columna de grupos '{group_column}'.")
            groups = data[group_column]
            splitter = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=seed)
            train_idx, test_idx = next(splitter.split(indices, y, groups))
            test_groups = sorted({str(value) for value in groups.iloc[test_idx].unique()})
            train_groups = sorted({str(value) for value in groups.iloc[train_idx].unique()})
            return train_idx, test_idx, {
                "mode": "district",
                "group_column": group_column,
                "test_groups": test_groups,
                "train_groups_sample": train_groups[:10],
                "train_groups": len(train_groups),
            }

        raise ValueError(f"split debe ser uno de {VALID_SPLITS}.")

    # ── Entrenamiento ────────────────────────────────────────────────────────

    @classmethod
    def train_from_dataframe(
        cls,
        data: pd.DataFrame,
        test_size: float,
        artifact_path: Path,
        *,
        features: list[str] | None = None,
        target: str | None = None,
        split: str = "random",
        time_column: str | None = None,
        group_column: str | None = None,
        seed: int = 42,
    ) -> dict[str, Any]:
        features = list(features) if features else list(FEATURES)
        target = target or TARGET

        if not 0 < test_size < 1:
            raise ValueError("test_size debe estar entre 0 y 1 (exclusive).")
        if target in features:
            raise ValueError(f"'{target}' no puede ser a la vez variable objetivo y feature.")

        missing = set(features + [target]) - set(data.columns)
        if missing:
            raise ValueError(f"Faltan columnas en el dataset: {sorted(missing)}")
        if data.empty:
            raise ValueError("No hay datos disponibles para entrenamiento")

        null_targets = int(data[target].isna().sum())
        if null_targets:
            raise ValueError(f"{null_targets} filas sin valor en '{target}'.")
        if len(data) < 30:
            raise ValueError("Se requieren al menos 30 filas para entrenar.")
        if data[target].nunique() < 2:
            raise ValueError(f"'{target}' necesita al menos 2 clases.")

        train_idx, test_idx, split_info = cls._split_data(
            data,
            target,
            split=split,
            test_size=test_size,
            time_column=time_column,
            group_column=group_column,
            seed=seed,
        )
        if len(train_idx) == 0 or len(test_idx) == 0:
            raise ValueError("La partición dejó un conjunto vacío; revisa test_size y el modo de split.")

        X = data[features]
        y = data[target]
        X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
        y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]

        categorical_features = [f for f in features if not pd.api.types.is_numeric_dtype(X[f])]
        numeric_features = [f for f in features if f not in categorical_features]

        pipeline = cls._build_pipeline(categorical_features, numeric_features, seed)
        pipeline.fit(X_train, y_train)

        y_pred = pipeline.predict(X_test)
        classes = [str(c) for c in pipeline.named_steps["model"].classes_]
        matrix = confusion_matrix(y_test, y_pred, labels=classes).tolist()
        report = classification_report(y_test, y_pred, labels=classes, output_dict=True, zero_division=0)
        per_class = {
            class_name: {
                "precision": round(float(report[class_name]["precision"]), 4),
                "recall": round(float(report[class_name]["recall"]), 4),
                "f1": round(float(report[class_name]["f1-score"]), 4),
                "support": int(report[class_name]["support"]),
            }
            for class_name in classes
        }
        baseline = float(pd.Series(y_test).value_counts(normalize=True).max())

        metrics = {
            "accuracy": float(accuracy_score(y_test, y_pred)),
            "precision_weighted": float(precision_score(y_test, y_pred, average="weighted", zero_division=0)),
            "recall_weighted": float(recall_score(y_test, y_pred, average="weighted", zero_division=0)),
            "f1_weighted": float(f1_score(y_test, y_pred, average="weighted", zero_division=0)),
            "f1_macro": float(f1_score(y_test, y_pred, average="macro", zero_division=0)),
            "baseline_majority_accuracy": baseline,
            "per_class": per_class,
            "confusion_matrix": matrix,
            "classes": classes,
        }

        preprocessor = pipeline.named_steps["preprocessor"]
        estimator = pipeline.named_steps["model"]
        names = [str(name) for name in preprocessor.get_feature_names_out()]
        importances = sorted(
            zip(names, (float(value) for value in estimator.feature_importances_)),
            key=lambda pair: pair[1],
            reverse=True,
        )
        feature_importances = {
            "top": [{"feature": name, "importance": round(value, 6)} for name, value in importances[:TOP_IMPORTANCES]],
            "total_features": len(importances),
        }

        artifact_path = Path(artifact_path)
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(pipeline, artifact_path)

        return {
            "metrics": metrics,
            "model_path": str(artifact_path),
            "train_size": int(len(X_train)),
            "test_size": int(len(X_test)),
            "split": split,
            "split_info": split_info,
            "classes": classes,
            "feature_importances": feature_importances,
        }

    # ── Inferencia ───────────────────────────────────────────────────────────

    @classmethod
    def predict(cls, features: dict[str, Any], artifact_path: Path) -> str:
        artifact_path = Path(artifact_path)
        if not artifact_path.exists():
            raise FileNotFoundError("Modelo no entrenado. Ejecute entrenamiento primero.")

        pipeline: Pipeline = joblib.load(artifact_path)
        input_df = pd.DataFrame([features])
        prediction = pipeline.predict(input_df)
        return str(prediction[0])

    @classmethod
    def predict_proba(
        cls,
        features: dict[str, Any],
        artifact_path: Path,
        top_k: int = 5,
    ) -> list[tuple[str, float]]:
        """Devuelve las `top_k` clases más probables como [(etiqueta, probabilidad), …]."""
        artifact_path = Path(artifact_path)
        if not artifact_path.exists():
            raise FileNotFoundError("Modelo no entrenado. Ejecute entrenamiento primero.")

        pipeline: Pipeline = joblib.load(artifact_path)
        input_df = pd.DataFrame([features])
        probabilities = pipeline.predict_proba(input_df)[0]
        classes = [str(class_name) for class_name in pipeline.named_steps["model"].classes_]
        ranked = sorted(
            zip(classes, (float(value) for value in probabilities)),
            key=lambda pair: pair[1],
            reverse=True,
        )
        return ranked[: max(1, int(top_k))]
