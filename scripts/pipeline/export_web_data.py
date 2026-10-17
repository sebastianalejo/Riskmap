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
    complete_arcgis_fields,
    int_or_none,
    load_rows,
    risk_level,
)

SCHEMA_VERSION = 2
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
    "source",
]
MONTHLY_COLUMNS = ["year", "month", "ubigeo", "district", "total", "porModalidad"]

DEFAULT_LEGACY = REPO_ROOT / "data" / "raw" / "inei" / "points_2022_legacy.csv"
DEFAULT_INCIDENTS = REPO_ROOT / "data" / "processed" / "incidents_lima.csv"
DEFAULT_CALLAO = REPO_ROOT / "data" / "processed" / "callao_incidents_lima.csv"
DEFAULT_MONTHLY = REPO_ROOT / "data" / "processed" / "sidpol_monthly_lima.csv"
DEFAULT_POPULATION = REPO_ROOT / "data" / "processed" / "population_lima.csv"
DEFAULT_POLICE = REPO_ROOT / "data" / "processed" / "police_context_lima.csv"
DEFAULT_MPFN = REPO_ROOT / "data" / "processed" / "mpfn_delitos_lima.csv"
DEFAULT_INEI_SERIES = REPO_ROOT / "data" / "processed" / "inei_series_lima.csv"
DEFAULT_OUT = REPO_ROOT / "frontend" / "public" / "data"

# Contexto por distrito (población + comisarías) y series de contexto (INEI/MPFN).
CONTEXT_COLUMNS = [
    "ubigeo",
    "district",
    "population",
    "popYear",
    "stationsCount",
    "serviciosOk2022",
    "infraOk2022",
]
SERIES_COLUMNS = ["category", "dimension", "year", "value", "unit"]


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
    callao_path: Path | None = None,
) -> tuple[list[tuple[str, dict]], dict]:
    """Normaliza ambas fuentes, deduplica por ID y devuelve filas + reporte."""
    combined: dict[str, dict] = {}
    report: dict = {"inputs": {}, "sources": {}, "errors": []}

    entries = [
        ("legacy", legacy_path, LEGACY_SOURCE),
        ("inei", incidents_path, None),
    ]
    if callao_path is not None:
        entries.append(("callao", callao_path, None))

    for label, path, forced_source in entries:
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
                _source_name(payload),
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


def load_context(
    population_path: Path | None,
    police_path: Path | None,
) -> tuple[list[list], dict]:
    """Contexto por distrito: población proyectada (último año) + oferta policial."""
    errors: list[str] = []
    population: dict[str, dict] = {}
    pop_year: int | None = None

    if population_path and population_path.exists():
        frame = pd.read_csv(population_path, dtype=str, encoding="utf-8-sig")
        frame["year"] = pd.to_numeric(frame["year"], errors="coerce")
        frame["population"] = pd.to_numeric(frame["population"], errors="coerce")
        frame = frame.dropna(subset=["year", "population"])
        if not frame.empty:
            pop_year = int(frame["year"].max())
            for raw in frame[frame["year"] == pop_year].to_dict("records"):
                ubigeo = str(raw["ubigeo"]).strip().zfill(6)
                population[ubigeo] = {
                    "district": str(raw.get("district") or "").strip().upper(),
                    "population": int(raw["population"]),
                }
    else:
        errors.append("falta population_lima.csv")

    police: dict[str, dict] = {}
    if police_path and police_path.exists():
        frame = pd.read_csv(police_path, dtype=str, encoding="utf-8-sig")
        for raw in frame.to_dict("records"):
            ubigeo = str(raw["ubigeo"]).strip().zfill(6)
            police[ubigeo] = {
                "district": str(raw.get("district") or "").strip().upper(),
                "stationsCount": int_or_none(raw.get("stations_count")) or 0,
                "serviciosOk2022": int_or_none(raw.get("servicios_ok_2022")) or 0,
                "infraOk2022": int_or_none(raw.get("infra_ok_2022")) or 0,
            }
    else:
        errors.append("falta police_context_lima.csv")

    rows: list[list] = []
    for ubigeo in sorted(set(population) | set(police)):
        pop = population.get(ubigeo, {})
        pol = police.get(ubigeo, {})
        rows.append(
            [
                ubigeo,
                pol.get("district") or pop.get("district") or None,
                pop.get("population"),
                pop_year,
                pol.get("stationsCount", 0),
                pol.get("serviciosOk2022", 0),
                pol.get("infraOk2022", 0),
            ]
        )
    report = {
        "rows": len(rows),
        "popYear": pop_year,
        "districts_with_population": len(population),
        "districts_with_police": len(police),
        "errors": errors,
    }
    return rows, report


def load_series(mpfn_path: Path | None, inei_path: Path | None) -> tuple[list[list], dict]:
    """Series de contexto: INEI (Lima Metropolitana) y MPFN (por distrito fiscal)."""
    rows: list[list] = []
    errors: list[str] = []

    if inei_path and inei_path.exists():
        frame = pd.read_csv(inei_path, dtype=str, encoding="utf-8-sig")
        for raw in frame.to_dict("records"):
            year = int_or_none(raw.get("year"))
            value = raw.get("value")
            try:
                number = round(float(value), 4)
            except (TypeError, ValueError):
                continue
            if year is None:
                continue
            rows.append(["inei", str(raw.get("serie") or ""), year, number, str(raw.get("unit") or "")])
    else:
        errors.append("falta inei_series_lima.csv")

    if mpfn_path and mpfn_path.exists():
        frame = pd.read_csv(mpfn_path, dtype=str, encoding="utf-8-sig")
        frame["year"] = pd.to_numeric(frame["year"], errors="coerce")
        frame["cantidad"] = pd.to_numeric(frame["cantidad"], errors="coerce")
        frame = frame.dropna(subset=["year", "cantidad"])
        grouped = frame.groupby(["year", "distrito_fiscal"], as_index=False)["cantidad"].sum()
        for raw in grouped.to_dict("records"):
            rows.append(["mpfn", str(raw["distrito_fiscal"]), int(raw["year"]), int(raw["cantidad"]), "casos"])
    else:
        errors.append("falta mpfn_delitos_lima.csv")

    rows.sort(key=lambda row: (row[0], row[1], row[2]))
    return rows, {"rows": len(rows), "errors": errors}


def payload_from_firestore(data: dict) -> dict | None:
    """Convierte un documento de `crime_incidents` al payload normalizado del exportador."""
    crime_type = str(data.get("crime_type") or "").strip()
    district = str(data.get("district") or "").strip()
    if not crime_type or not district:
        return None
    try:
        latitude = float(data.get("latitude"))
        longitude = float(data.get("longitude"))
    except (TypeError, ValueError):
        return None

    payload: dict = {
        "crime_type": crime_type.lower(),
        "district": district.upper(),
        "latitude": latitude,
        "longitude": longitude,
    }
    if data.get("occurred_year") is not None:
        payload["occurred_year"] = data["occurred_year"]
    if data.get("severity_level"):
        payload["severity_level"] = str(data["severity_level"]).strip().lower()
    if data.get("risk_level"):
        payload["risk_level"] = str(data["risk_level"]).strip().lower()
    for key in ("hour", "historical_frequency"):
        if data.get(key) is not None:
            payload[key] = data[key]
    if isinstance(data.get("day_of_week"), str):
        payload["day_of_week"] = data["day_of_week"].strip().lower()

    source = data.get("source")
    if isinstance(source, str) and source.strip():
        payload["source"] = source.strip()
    else:
        payload["source"] = "inei" if data.get("occurred_year") is not None else LEGACY_SOURCE
    # Esquema v2 en Firestore: completa hora/día/frecuencia/riesgo derivados.
    if payload.get("occurred_year") is not None:
        complete_arcgis_fields(payload)
    return payload


def load_from_firestore() -> tuple[list[tuple[str, dict]], list[list], dict, dict]:
    """Lee `crime_incidents` y `crime_stats_monthly` con el Admin SDK.

    Consume lecturas (una por documento) una sola vez; el frontend no vuelve a
    tocar Firestore. Útil tras importar datos desde `/datos`.
    """
    from firebase_admin import firestore as admin_firestore
    from firebase_admin import initialize_app

    try:
        initialize_app()
    except ValueError:
        pass  # ya inicializado en el proceso
    db = admin_firestore.client()

    combined: dict[str, dict] = {}
    skipped = 0
    for doc in db.collection("crime_incidents").stream():
        payload = payload_from_firestore(doc.to_dict() or {})
        if payload is None:
            skipped += 1
            continue
        combined[doc.id] = payload
    rows = sorted(combined.items(), key=lambda item: item[0])

    monthly_rows: list[list] = []
    monthly_errors: list[str] = []
    monthly_total = 0
    for doc in db.collection("crime_stats_monthly").stream():
        monthly_total += 1
        data = doc.to_dict() or {}
        try:
            year = int(data["year"])
            month = int(data["month"])
            total = int(data.get("total") or 0)
            ubigeo = str(data.get("ubigeo") or "").strip().zfill(6)
            district = str(data.get("district") or "").strip().upper()
            modalidad = data.get("por_modalidad") or {}
            counts = [max(0, int(modalidad.get(modality) or 0)) for modality in MODALITIES]
        except (KeyError, TypeError, ValueError) as exc:
            monthly_errors.append(f"{doc.id}: {exc}")
            continue
        monthly_rows.append([year, month, ubigeo, district, total, counts])
    monthly_rows.sort(key=lambda row: (row[0], row[1], row[2]))

    sources: dict[str, int] = {}
    for _doc_id, payload in rows:
        source = _source_name(payload)
        sources[source] = sources.get(source, 0) + 1

    dataset_report = {
        "inputs": {"firestore": "crime_incidents"},
        "sources": {
            "firestore": {
                "schema": "mixto (v2 + legacy)",
                "raw_rows": len(rows) + skipped,
                "valid_rows": len(rows),
                "added_rows": len(rows),
                "duplicates_or_invalid": skipped,
                "errors": 0,
            }
        },
        "errors": [],
        "source_counts": sources,
    }
    monthly_report = {
        "input": "crime_stats_monthly",
        "raw_rows": monthly_total,
        "valid_rows": len(monthly_rows),
        "errors": monthly_errors,
    }
    return rows, monthly_rows, dataset_report, monthly_report


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
    context_payload: dict,
    series_payload: dict,
    dataset_report: dict,
    monthly_report: dict,
    context_report: dict,
    series_report: dict,
    generated_at: str,
) -> dict:
    files_dir = out_dir / "files"
    files_dir.mkdir(parents=True, exist_ok=True)

    # Elimina versiones anteriores para no acumular archivos con hash.
    for base in (
        "incidents-map",
        "incidents-analysis",
        "crime-monthly",
        "predict-stats",
        "district-context",
        "context-series",
    ):
        for old in files_dir.glob(f"{base}.*.json"):
            old.unlink()

    files = {
        "map": _write_data_file(files_dir, "incidents-map", map_payload),
        "analysis": _write_data_file(files_dir, "incidents-analysis", analysis_payload),
        "monthly": _write_data_file(files_dir, "crime-monthly", monthly_payload),
        "predict": _write_data_file(files_dir, "predict-stats", predict_payload),
        "context": _write_data_file(files_dir, "district-context", context_payload),
        "series": _write_data_file(files_dir, "context-series", series_payload),
    }

    counts = {
        "incidents": len(map_payload["points"]),
        "mapPoints": len(map_payload["points"]),
        "analysisRows": len(analysis_payload["incidents"]),
        "monthlyRows": len(monthly_payload["rows"]),
        "contextRows": len(context_payload["rows"]),
        "seriesRows": len(series_payload["rows"]),
        "sources": {},
    }
    for point in map_payload["points"]:
        source = point[6] or "desconocida"
        counts["sources"][source] = counts["sources"].get(source, 0) + 1

    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": generated_at,
        "dataset": "INEI DataCrime 2021-2024 + puntos 2022 + Callao georreferenciado (IDs deterministas, sin duplicados)",
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
        "context": context_report,
        "series": series_report,
        "valid": {
            "incidents": counts["incidents"],
            "monthly": counts["monthlyRows"],
            "context": counts["contextRows"],
            "series": counts["seriesRows"],
        },
        "errors": (
            dataset_report["errors"]
            + monthly_report["errors"]
            + context_report.get("errors", [])
            + series_report.get("errors", [])
        ),
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
        "context": ("rows", manifest.get("counts", {}).get("contextRows")),
        "series": ("rows", manifest.get("counts", {}).get("seriesRows")),
    }
    for key in ("map", "analysis", "monthly", "predict", "context", "series"):
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
    parser.add_argument("--callao", type=Path, default=DEFAULT_CALLAO)
    parser.add_argument("--monthly", type=Path, default=DEFAULT_MONTHLY)
    parser.add_argument("--population", type=Path, default=DEFAULT_POPULATION)
    parser.add_argument("--police", type=Path, default=DEFAULT_POLICE)
    parser.add_argument("--mpfn", type=Path, default=DEFAULT_MPFN)
    parser.add_argument("--inei-series", type=Path, default=DEFAULT_INEI_SERIES)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--from-firestore",
        action="store_true",
        help="Lee `crime_incidents` y `crime_stats_monthly` con el Admin SDK (tras importar en /datos).",
    )
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

    generated_at = datetime.now(timezone.utc).isoformat()
    if args.from_firestore:
        rows, monthly_rows, dataset_report, monthly_report = load_from_firestore()
    else:
        for path in (args.legacy, args.incidents, args.monthly):
            if not path.exists():
                print(f"No existe el CSV: {path}", file=sys.stderr)
                return 1
        callao = args.callao.resolve() if args.callao and args.callao.exists() else None
        rows, dataset_report = load_incidents(args.legacy.resolve(), args.incidents.resolve(), callao)
        monthly_rows, monthly_result = load_monthly(args.monthly.resolve())
        monthly_report = {**monthly_result["report"], "errors": monthly_result["errors"]}

    context_rows, context_report = load_context(
        args.population.resolve() if args.population and args.population.exists() else None,
        args.police.resolve() if args.police and args.police.exists() else None,
    )
    series_rows, series_report = load_series(
        args.mpfn.resolve() if args.mpfn and args.mpfn.exists() else None,
        args.inei_series.resolve() if args.inei_series and args.inei_series.exists() else None,
    )

    map_payload = {
        "schemaVersion": SCHEMA_VERSION,
        "columns": MAP_COLUMNS,
        "points": build_map_rows(rows),
    }
    analysis_payload = {
        "schemaVersion": SCHEMA_VERSION,
        "columns": ANALYSIS_COLUMNS,
        "incidents": build_analysis_rows(rows),
    }
    monthly_payload = {
        "schemaVersion": SCHEMA_VERSION,
        "columns": MONTHLY_COLUMNS,
        "modalities": MODALITIES,
        "rows": monthly_rows,
    }
    predict_payload = {
        "schemaVersion": SCHEMA_VERSION,
        **build_predict_stats(rows),
    }
    context_payload = {
        "schemaVersion": SCHEMA_VERSION,
        "columns": CONTEXT_COLUMNS,
        "rows": context_rows,
    }
    series_payload = {
        "schemaVersion": SCHEMA_VERSION,
        "columns": SERIES_COLUMNS,
        "rows": series_rows,
    }

    manifest = write_outputs(
        out_dir,
        map_payload=map_payload,
        analysis_payload=analysis_payload,
        monthly_payload=monthly_payload,
        predict_payload=predict_payload,
        context_payload=context_payload,
        series_payload=series_payload,
        dataset_report=dataset_report,
        monthly_report=monthly_report,
        context_report=context_report,
        series_report=series_report,
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
    if dataset_report["errors"] or monthly_report["errors"]:
        print(f"  avisos: {len(dataset_report['errors']) + len(monthly_report['errors'])} fila(s)")
    print(f"  reporte: {out_dir / 'export_report.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
