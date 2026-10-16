"""Entrenamiento reproducible del clasificador de modalidad (Fase 3).

Tarea (real y no circular): predecir la **modalidad del delito** a partir de
contexto espacial (distrito y coordenadas), usando datos reales del INEI.

Splits disponibles con `--split`:
- `random`   — partición estratificada aleatoria (referencia optimista).
- `temporal` — entrena con años anteriores y prueba con los años más recientes.
- `district` — prueba con distritos no vistos (validación geográfica).

Uso (desde la raíz del repositorio):

    python scripts/pipeline/train.py --split temporal

Salidas:
    models/processed/crime_modality_model.joblib   (artefacto)
    models/reports/metrics_<split>.json            (métricas, con hash del dataset)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import sklearn

PIPELINE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PIPELINE_DIR.parents[1]
sys.path.insert(0, str(REPO_ROOT / "functions"))

from crime_ml.pipeline import CrimeRiskPipelineCore  # noqa: E402

DEFAULT_FEATURES = ["district", "latitude", "longitude"]
DEFAULT_TARGET = "crime_type"
DEFAULT_TIME_COLUMN = "occurred_year"
DEFAULT_GROUP_COLUMN = "district"


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description="Entrena el clasificador de modalidad (datos INEI).")
    parser.add_argument("--csv", type=Path, default=REPO_ROOT / "data" / "processed" / "incidents_lima.csv")
    parser.add_argument("--split", choices=("random", "temporal", "district"), default="random")
    parser.add_argument("--test-size", type=float, default=0.25)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--features", nargs="+", default=DEFAULT_FEATURES)
    parser.add_argument("--target", default=DEFAULT_TARGET)
    parser.add_argument("--time-column", default=DEFAULT_TIME_COLUMN)
    parser.add_argument("--group-column", default=DEFAULT_GROUP_COLUMN)
    parser.add_argument("--artifact", type=Path, default=REPO_ROOT / "models" / "processed" / "crime_modality_model.joblib")
    parser.add_argument("--metrics", type=Path, default=None)
    args = parser.parse_args()

    if not args.csv.exists():
        print(f"No existe el dataset {args.csv}. Ejecuta primero scripts/pipeline/ingest_inei.py")
        return 1

    data = pd.read_csv(args.csv)
    result = CrimeRiskPipelineCore.train_from_dataframe(
        data,
        test_size=args.test_size,
        artifact_path=args.artifact,
        features=args.features,
        target=args.target,
        split=args.split,
        time_column=args.time_column,
        group_column=args.group_column,
        seed=args.seed,
    )

    metrics_path = args.metrics or REPO_ROOT / "models" / "reports" / f"metrics_{args.split}.json"
    metrics_path.parent.mkdir(parents=True, exist_ok=True)

    document = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "task": {
            "question": "¿Qué modalidad de delito es más probable dado el contexto espacial (distrito y coordenadas)?",
            "features": args.features,
            "target": args.target,
            "split": args.split,
        },
        "dataset": {
            "path": str(args.csv.relative_to(REPO_ROOT)) if args.csv.is_relative_to(REPO_ROOT) else str(args.csv),
            "rows": int(len(data)),
            "sha256": file_sha256(args.csv),
        },
        "environment": {
            "python": platform.python_version(),
            "pandas": pd.__version__,
            "scikit_learn": sklearn.__version__,
        },
        "config": {"test_size": args.test_size, "seed": args.seed},
        "result": result,
    }
    with open(metrics_path, "w", encoding="utf-8") as handle:
        json.dump(document, handle, ensure_ascii=False, indent=2, default=str)

    metrics = result["metrics"]
    print(f"\nSplit: {args.split}  |  train={result['train_size']}  test={result['test_size']}")
    print(f"Accuracy: {metrics['accuracy']:.3f}   F1 macro: {metrics['f1_macro']:.3f}   "
          f"baseline (clase mayoritaria): {metrics['baseline_majority_accuracy']:.3f}")
    print("\nRecall por clase:")
    for class_name, values in sorted(metrics["per_class"].items(), key=lambda item: -item[1]["support"]):
        print(f"  {class_name:<40} recall={values['recall']:.3f}  support={values['support']}")
    print("\nTop variables:")
    for item in result["feature_importances"]["top"][:5]:
        print(f"  {item['feature']:<45} {item['importance']:.4f}")
    print(f"\nArtefacto: {result['model_path']}")
    print(f"Métricas:  {metrics_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
