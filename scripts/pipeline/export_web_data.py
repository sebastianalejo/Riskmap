"""Publica el dataset canónico como JSON estático para Firebase Hosting.

El frontend deja de leer ``crime_incidents`` en cada visita: descarga estos
archivos (una sola transferencia, cacheada por Hosting) y trabaja en memoria.
Así el plan Spark no consume sus 50 000 lecturas diarias de Firestore.

Uso (desde la raíz del repositorio):

    python scripts/pipeline/export_web_data.py
    python scripts/pipeline/export_web_data.py --check

Salidas en ``frontend/public/data``:

    manifest.json                 versión, fecha, conteos y nombres con hash
    files/incidents-map.<hash>.json
    files/incidents-analysis.<hash>.json
    files/crime-monthly.<hash>.json
    files/predict-stats.<hash>.json
    export_report.json            filas leídas/válidas/descartadas

El modo ``--check`` valida el manifest y los archivos ya generados (útil en CI).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

PIPELINE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PIPELINE_DIR.parents[1]
sys.path.insert(0, str(PIPELINE_DIR))

from incidents_dataset import (  # noqa: E402
    LEGACY_SOURCE,
    int_or_none,
    load_rows,
    risk_level,
)

SCHEMA_VERSION = 1
RISK_ORDER = ["bajo", "medio", "alto"]
RISK_INDEX = {risk: index for index, risk in enumerate(RISK_ORDER)}
MODALITIES = ["estafa", "extorsion", "hurto", "otros", "robo", "secuestro", "violencia_mujer"]

MAP_COLUMNS = [
    "id",
    "lat",
    "lng",
    "district",
    "crimeType",
    "riskLevel",
    "source",
    "year",
    "hour",
    "dayOfWeek",
]
ANALYSIS_COLUMNS = [
    "id",
    "district",
    "crimeType",
    "year",
    "hour",
    "dayOfWeek",
    "riskLevel",
    "historicalFrequency",
]
MONTHLY_COLUMNS = ["year", "month", "ubigeo", "district", "total", "porModalidad"]

DEFAULT_LEGACY = REPO_ROOT / "data" / "raw" / "inei" / "points_2022_legacy.csv"
DEFAULT_INCIDENTS = REPO_ROOT / "data" / "processed" / "incidents_lima.csv"
DEFAULT_MONTHLY = REPO_ROOT / "data" / "processed" / "sidpol_monthly_lima.csv"
DEFAULT_OUT = REPO_ROOT / "frontend" / "public" / "data"


def _csv_row_count(path: Path) -> int:
    return int(len(pd.read_csv(path, dtype=str, encoding="utf-8-sig")))


def _display_path(path: Path) -> str:
    """Ruta relativa al repo si es posible; absoluta si viene de fuera."""
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def _source_name(payload: dict) -> str:
    value = payload.get("source")
    return str(value).strip() if isinstance(value, str) and value.strip() else "desconocida"


def load_incidents(
    legacy_path: Path,
    incidents_path: Path,
) -> tuple[list[tuple[str, dict]], dict]:
    """Normaliza ambas fuentes, deduplica por ID y devuelve filas + reporte."""
    combined: dict[str, dict] = {}
    report: dict = {"inputs": {}, "sources": {}, "errors": []}

    for label, path, forced_source in (
        ("legacy", legacy_path, LEGACY_SOURCE),
        ("inei", incidents_path, None),
    ):
        rows, errors, schema = load_rows(path)
        raw_rows = _csv_row_count(path)
        if forced_source:
            for _doc_id, payload in rows:
                payload["source"] = forced_source

        added = 0
        for doc_id, payload in rows:
            if doc_id in combined:
                continue
            combined[doc_id] = payload
            added += 1

        report["inputs"][label] = _display_path(path)
        report["sources"][label] = {
            "schema": schema,
            "raw_rows": raw_rows,
            "valid_rows": len(rows),
            "added_rows": added,
            "duplicates_or_invalid": max(0, raw_rows - len(rows)),
            "errors": len(errors),
        }
        report["errors"].extend(f"{label}: {error}" for error in errors)

    ordered = sorted(combined.items(), key=lambda item: item[0])
    return ordered, report


def build_map_rows(rows: list[tuple[str, dict]]) -> list[list]:
    points: list[list] = []
    for doc_id, payload in rows:
        risk = risk_level(payload)
        crime_type = str(payload.get("crime_type") or "").strip().lower()
        district = str(payload.get("district") or "").strip().upper()
        points.append(
            [
                doc_id,
                round(float(payload["latitude"]), 5),
                round(float(payload["longitude"]), 5),
                district or None,
                crime_type or None,
                risk,
                _source_name(payload),
                int_or_none(payload.get("occurred_year")),
                int_or_none(payload.get("hour")),
                str(payload.get("day_of_week") or "").strip().lower() or None,
            ]
        )
    return points


def build_analysis_rows(rows: list[tuple[str, dict]]) -> list[list]:
    incidents: list[list] = []
    for doc_id, payload in rows:
        incidents.append(
            [
                doc_id,
                str(payload.get("district") or "").strip().upper() or None,
                str(payload.get("crime_type") or "").strip().lower() or None,
                int_or_none(payload.get("occurred_year")),
                int_or_none(payload.get("hour")),
                str(payload.get("day_of_week") or "").strip().lower() or None,
                risk_level(payload),
                int_or_none(payload.get("historical_frequency")),
            ]
        )
    return incidents


def load_monthly(monthly_path: Path) -> tuple[list[list], dict]:
    frame = pd.read_csv(monthly_path, dtype=str, encoding="utf-8-sig")
    rows: list[list] = []
    errors: list[str] = []

    for index, raw in enumerate(frame.to_dict(orient="records"), start=2):
        try:
            year = int(float(raw["year"]))
            month = int(float(raw["month"]))
            total = int(float(raw["total"]))
            if not 1 <= month <= 12:
                raise ValueError("month fuera de 1-12")
            if total < 0:
                raise ValueError("total negativo")
            ubigeo = str(raw["ubigeo"]).strip().zfill(6)
            district = str(raw["district"]).strip().upper()
            counts = [max(0, int(float(raw.get(modality) or 0))) for modality in MODALITIES]
        except (KeyError, TypeError, ValueError) as exc:
            errors.append(f"Fila {index}: {exc}")
            continue
        rows.append([year, month, ubigeo, district, total, counts])

    rows.sort(key=lambda row: (row[0], row[1], row[2]))
    report = {
        "input": _display_path(monthly_path),
        "raw_rows": len(frame),
        "valid_rows": len(rows),
        "errors": len(errors),
    }
    return rows, {"report": report, "errors": errors}


def build_predict_stats(rows: list[tuple[str, dict]]) -> dict:
    by_type_district: dict[str, list[int]] = {}
    by_type: dict[str, list[int]] = {}
    types: set[str] = set()
    districts: set[str] = set()

    for _doc_id, payload in rows:
        risk = risk_level(payload)
        if risk not in RISK_INDEX:
            continue
        crime_type = str(payload.get("crime_type") or "").strip().lower()
        district = str(payload.get("district") or "").strip().upper()
        if not crime_type or not district:
            continue
        index = RISK_INDEX[risk]
        by_type_district.setdefault(f"{crime_type}|{district}", [0, 0, 0])[index] += 1
        by_type.setdefault(crime_type, [0, 0, 0])[index] += 1
        types.add(crime_type)
        districts.add(district)

    return {
        "riskOrder": RISK_ORDER,
        "byTypeDistrict": dict(sorted(by_type_district.items())),
        "byType": dict(sorted(by_type.items())),
        "types": sorted(types),
        "districts": sorted(districts),
    }


def _json_bytes(payload: dict) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _write_data_file(files_dir: Path, base: str, payload: dict) -> dict:
    data = _json_bytes(payload)
    digest = hashlib.sha256(data).hexdigest()
    name = f"{base}.{digest[:12]}.json"
    path = files_dir / name
    path.write_bytes(data)
    return {
        "name": f"files/{name}",
        "bytes": len(data),
        "sha256": digest,
        "count": len(payload.get("points", payload.get("incidents", payload.get("rows", [])))),
    }


def write_outputs(
    out_dir: Path,
    *,
    map_payload: dict,
    analysis_payload: dict,
    monthly_payload: dict,
    predict_payload: dict,
    dataset_report: dict,
    monthly_report: dict,
    generated_at: str,
) -> dict:
    files_dir = out_dir / "files"
    files_dir.mkdir(parents=True, exist_ok=True)

    # Elimina versiones anteriores para no acumular archivos con hash.
    for base in ("incidents-map", "incidents-analysis", "crime-monthly", "predict-stats"):
        for old in files_dir.glob(f"{base}.*.json"):
            old.unlink()

    files = {
        "map": _write_data_file(files_dir, "incidents-map", map_payload),
        "analysis": _write_data_file(files_dir, "incidents-analysis", analysis_payload),
        "monthly": _write_data_file(files_dir, "crime-monthly", monthly_payload),
        "predict": _write_data_file(files_dir, "predict-stats", predict_payload),
    }

    counts = {
        "incidents": len(map_payload["points"]),
        "mapPoints": len(map_payload["points"]),
        "analysisRows": len(analysis_payload["incidents"]),
        "monthlyRows": len(monthly_payload["rows"]),
        "sources": {},
    }
    for point in map_payload["points"]:
        source = point[6] or "desconocida"
        counts["sources"][source] = counts["sources"].get(source, 0) + 1

    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": generated_at,
        "dataset": "INEI DataCrime 2021-2024 + puntos 2022 (IDs deterministas, sin duplicados)",
        "counts": counts,
        "files": files,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    report = {
        "generated_at": generated_at,
        "schema_version": SCHEMA_VERSION,
        "inputs": dataset_report["inputs"],
        "sources": dataset_report["sources"],
        "monthly": monthly_report,
        "valid": {
            "incidents": counts["incidents"],
            "monthly": counts["monthlyRows"],
        },
        "errors": dataset_report["errors"] + monthly_report["errors"],
        "outputs": {key: value for key, value in files.items()},
    }
    (out_dir / "export_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def check_outputs(out_dir: Path) -> list[str]:
    """Valida manifest, archivos y conteos sin regenerar nada."""
    errors: list[str] = []
    manifest_path = out_dir / "manifest.json"
    if not manifest_path.exists():
        return [f"Falta {manifest_path}"]

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"manifest.json inválido: {exc}"]

    if manifest.get("schemaVersion") != SCHEMA_VERSION:
        errors.append(
            f"schemaVersion {manifest.get('schemaVersion')!r} != {SCHEMA_VERSION}"
        )

    files = manifest.get("files") or {}
    expected_counts = {
        "map": ("points", manifest.get("counts", {}).get("mapPoints")),
        "analysis": ("incidents", manifest.get("counts", {}).get("analysisRows")),
        "monthly": ("rows", manifest.get("counts", {}).get("monthlyRows")),
    }
    for key in ("map", "analysis", "monthly", "predict"):
        info = files.get(key) or {}
        name = info.get("name")
        if not name:
            errors.append(f"manifest.files.{key} sin nombre")
            continue
        path = out_dir / name
        if not path.exists():
            errors.append(f"Falta el archivo {path}")
            continue
        data = path.read_bytes()
        if info.get("bytes") not in (None, len(data)):
            errors.append(f"{name}: bytes {len(data)} != manifest {info.get('bytes')}")
        digest = hashlib.sha256(data).hexdigest()
        if info.get("sha256") not in (None, digest):
            errors.append(f"{name}: sha256 no coincide")
        try:
            payload = json.loads(data)
        except json.JSONDecodeError as exc:
            errors.append(f"{name}: JSON inválido: {exc}")
            continue
        if payload.get("schemaVersion") != SCHEMA_VERSION:
            errors.append(f"{name}: schemaVersion distinto")
        if key in expected_counts:
            field, expected = expected_counts[key]
            actual = len(payload.get(field) or [])
            if expected is not None and actual != expected:
                errors.append(f"{name}: {field} {actual} != manifest {expected}")

    report_path = out_dir / "export_report.json"
    if not report_path.exists():
        errors.append(f"Falta {report_path}")
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Genera los JSON estáticos del dataset para Firebase Hosting."
    )
    parser.add_argument("--legacy", type=Path, default=DEFAULT_LEGACY)
    parser.add_argument("--incidents", type=Path, default=DEFAULT_INCIDENTS)
    parser.add_argument("--monthly", type=Path, default=DEFAULT_MONTHLY)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Solo valida manifest/archivos existentes (no lee los CSV).",
    )
    args = parser.parse_args(argv)

    out_dir = args.out.resolve()
    if args.check:
        errors = check_outputs(out_dir)
        if errors:
            print("Datos publicados: ERROR")
            for error in errors:
                print(f"  - {error}")
            return 1
        print(f"Datos publicados: OK ({out_dir})")
        return 0

    for path in (args.legacy, args.incidents, args.monthly):
        if not path.exists():
            print(f"No existe el CSV: {path}", file=sys.stderr)
            return 1

    generated_at = datetime.now(timezone.utc).isoformat()
    rows, dataset_report = load_incidents(args.legacy.resolve(), args.incidents.resolve())
    monthly_rows, monthly_result = load_monthly(args.monthly.resolve())

    map_payload = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": generated_at,
        "columns": MAP_COLUMNS,
        "points": build_map_rows(rows),
    }
    analysis_payload = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": generated_at,
        "columns": ANALYSIS_COLUMNS,
        "incidents": build_analysis_rows(rows),
    }
    monthly_payload = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": generated_at,
        "columns": MONTHLY_COLUMNS,
        "modalities": MODALITIES,
        "rows": monthly_rows,
    }
    predict_payload = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": generated_at,
        **build_predict_stats(rows),
    }

    manifest = write_outputs(
        out_dir,
        map_payload=map_payload,
        analysis_payload=analysis_payload,
        monthly_payload=monthly_payload,
        predict_payload=predict_payload,
        dataset_report=dataset_report,
        monthly_report={**monthly_result["report"], "errors": monthly_result["errors"]},
        generated_at=generated_at,
    )

    print(f"Dataset publicado en {out_dir}")
    print(f"  incidentes: {manifest['counts']['incidents']}")
    print(f"  puntos de mapa: {manifest['counts']['mapPoints']}")
    print(f"  filas de análisis: {manifest['counts']['analysisRows']}")
    print(f"  filas mensuales: {manifest['counts']['monthlyRows']}")
    print(f"  fuentes: {manifest['counts']['sources']}")
    for key, info in manifest["files"].items():
        print(f"  {key:8s} {info['name']} ({info['bytes'] / 1024:.1f} KB)")
    if dataset_report["errors"] or monthly_result["errors"]:
        print(f"  avisos: {len(dataset_report['errors']) + len(monthly_result['errors'])} fila(s)")
    print(f"  reporte: {out_dir / 'export_report.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
