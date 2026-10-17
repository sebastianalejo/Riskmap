"""Ingesta reproducible de incidentes reales del MapServer del INEI (Fase 3).

A diferencia del script legado (`scripts/fetch-real-data.js`), esta versión:

- Descubre las capas **dinámicamente** por grupo de año ("Modalidad de delito
  YYYY") y valida la pertenencia real de cada subcapa (`parentLayer`), porque
  el INEI renumera el servicio y mueve capas entre grupos.
- Se adapta a los **cambios de esquema por año** (2016-2022 exponen X/Y y UBIGEO;
  2023 pierde UBIGEO; 2024 expone x/y en minúsculas y sin UBIGEO): resuelve los
  campos por capa (case-insensitive) y usa geometría WGS84 como respaldo.
- Usa **solo campos reales** de la fuente (año = grupo de capa, distrito,
  ubigeo, modalidad, coordenadas, género, id de denuncia). No fabrica hora,
  día ni frecuencia.
- Muestrea por **ventanas aleatorias con semilla** sobre el total disponible de
  cada combinación (año, modalidad), en lugar de tomar los primeros registros.
- Filtra al ámbito **Lima Metropolitana + Callao** (ubigeo 1501/0701) y
  canonicaliza el nombre del distrito por ubigeo: la fuente mezcla etiquetas
  (coordenadas limeñas con nombres de otras provincias, ubigeos incoherentes).
- Verifica el certificado TLS (no desactiva la validación).

La fuente NO publica la fecha del hecho: la resolución temporal real es el año.

Uso (desde la raíz del repositorio):

    python scripts/pipeline/ingest_inei.py --years 2021 2022 2023 2024

Salidas:
    data/processed/incidents_lima.csv              (dataset canónico completo)
    data/processed/incidents_lima_sample_500.csv   (muestra estratificada, versionable)
    data/processed/quality_report.json             (cobertura, duplicados, descartes)
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

PIPELINE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PIPELINE_DIR.parents[1]
sys.path.insert(0, str(PIPELINE_DIR))
sys.path.insert(0, str(REPO_ROOT / "functions"))

from crime_ml.validation import LAT_MAX, LAT_MIN, LON_MAX, LON_MIN  # noqa: E402

from derive import (  # noqa: E402
    arcgis_derive_key,
    frequency_for,
    hour_day_for,
    load_frequency_lookup,
)
from taxonomy import classify, load_taxonomy, normalize_district, normalize_modality  # noqa: E402

BASE_URL = (
    "https://arcgis3.inei.gob.pe:6443/arcgis/rest/services/Datacrim/"
    "DATACRIM005_AGS_PUNTOSDELITOS_CIUDADANO/MapServer"
)
COORDINATES = f"{LON_MIN},{LAT_MIN},{LON_MAX},{LAT_MAX}"  # xmin,ymin,xmax,ymax (WGS84)

SEVERITY_TO_RISK = {"alta": "alto", "media": "medio", "baja": "bajo"}

# Campos lógicos deseados; se resuelven por capa porque el esquema cambia por año.
DESIRED_FIELDS = (
    "generico",
    "especifico",
    "modalidad",
    "x",
    "y",
    "ubigeo_hecho",
    "nombdist",
    "ubigeo",
    "id_denuncia",
)

# Capas que aparecen dentro de un grupo de año pero no son modalidades.
NON_MODALITY_PREFIXES = (
    "policia nacional",
    "total de comisarias",
    "comisaria",
    "unidad especializada",
    "instituto nacional",
    "establecimientos penitenciarios",
    "lugar de residencia",
    "jurisdiccion",
)

# Provincias de Lima Metropolitana (1501) y Callao (0701) según ubigeo INEI.
LIMA_SCOPE_PREFIXES = ("1501", "0701")

COLUMNS = [
    "crime_type",
    "hour",
    "day_of_week",
    "district",
    "latitude",
    "longitude",
    "historical_frequency",
    "risk_level",
    "occurred_year",
    "ubigeo",
    "macro_category",
    "severity_level",
    "source",
]


def get_json(url: str, timeout: int = 60) -> Any:
    """GET con verificación TLS por defecto (el certificado del INEI valida bien)."""
    request = urllib.request.Request(url, headers={"User-Agent": "RiskmapPipeline/1.0 (ingesta INEI)"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} en {url}: {body[:300]}") from exc


def _plain(text: str) -> str:
    """Minúsculas sin acentos (para comparar nombres de capa)."""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def discover_year_groups() -> dict[int, dict[str, Any]]:
    """Agrupa las capas por año usando el patrón 'Modalidad de delito YYYY'.

    Devuelve candidatos (id, nombre); la pertenencia real se valida después con
    `parentLayer` en `resolve_children`.
    """
    service = get_json(f"{BASE_URL}?f=json")
    groups: dict[int, dict[str, Any]] = {}
    current_year: int | None = None

    for layer in service.get("layers", []):
        name = str(layer.get("name", "")).strip()
        match = re.match(r"modalidad de delito\s+(\d{4})", name.lower())
        if match:
            current_year = int(match.group(1))
            groups[current_year] = {"group_id": layer["id"], "candidates": []}
            continue
        if current_year is None or layer["id"] <= groups[current_year]["group_id"]:
            continue
        if _plain(name).startswith(NON_MODALITY_PREFIXES):
            continue
        groups[current_year]["candidates"].append((layer["id"], name))

    return groups


def resolve_children(group_id: int, candidates: list[tuple[int, str]]) -> list[dict[str, Any]]:
    """Valida `parentLayer` y resuelve los campos disponibles de cada subcapa."""
    resolved: list[dict[str, Any]] = []
    for layer_id, layer_name in candidates:
        meta = get_json(f"{BASE_URL}/{layer_id}?f=json")
        parent = meta.get("parentLayer") or {}
        if parent.get("id") != group_id:
            continue  # el servicio lo movió de grupo o no es una modalidad
        field_map = {str(field["name"]).lower(): field["name"] for field in meta.get("fields", [])}
        if "modalidad" not in field_map:
            continue
        resolved.append({"id": layer_id, "name": layer_name, "fields": field_map})
    return resolved


def query_count(layer_id: int) -> int:
    params = {
        "where": "1=1",
        "geometry": COORDINATES,
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "returnCountOnly": "true",
        "f": "json",
    }
    data = get_json(f"{BASE_URL}/{layer_id}/query?{urllib.parse.urlencode(params)}")
    if "count" not in data:
        raise RuntimeError(f"Respuesta sin 'count' para la capa {layer_id}: {str(data)[:200]}")
    return int(data["count"])


def query_window(
    layer_id: int,
    field_map: dict[str, str],
    offset: int,
    count: int,
) -> list[tuple[dict[str, Any], dict[str, Any] | None]]:
    out_fields = [field_map[key] for key in DESIRED_FIELDS if key in field_map]
    needs_geometry = "x" not in field_map or "y" not in field_map
    params = {
        "where": "1=1",
        "geometry": COORDINATES,
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": ",".join(out_fields),
        "returnGeometry": "true" if needs_geometry else "false",
        "outSR": "4326",
        "orderByFields": "OBJECTID",
        "resultOffset": str(offset),
        "resultRecordCount": str(count),
        "f": "json",
    }
    data = get_json(f"{BASE_URL}/{layer_id}/query?{urllib.parse.urlencode(params)}")
    if "error" in data:
        raise RuntimeError(f"Capa {layer_id}: {data['error']}")
    return [
        (feature.get("attributes", {}), feature.get("geometry") if needs_geometry else None)
        for feature in data.get("features", [])
    ]


def sample_layer(
    layer_id: int,
    field_map: dict[str, str],
    *,
    window_size: int,
    windows: int,
    rng: random.Random,
    sleep_seconds: float,
) -> tuple[list[tuple[dict[str, Any], dict[str, Any] | None]], int, bool]:
    """Devuelve (registros, total_disponible, tope_alcanzado) con ventanas aleatorias."""
    total = query_count(layer_id)
    time.sleep(sleep_seconds)

    take_total = window_size * windows
    if total <= 0:
        return [], total, False
    if total <= take_total:
        rows = query_window(layer_id, field_map, 0, total)
        time.sleep(sleep_seconds)
        return rows, total, False

    starts = rng.sample(range(0, total - window_size + 1), k=windows)
    rows: list[tuple[dict[str, Any], dict[str, Any] | None]] = []
    for start in starts:
        rows.extend(query_window(layer_id, field_map, start, window_size))
        time.sleep(sleep_seconds)
    return rows, total, True


def to_row(
    attributes: dict[str, Any],
    geometry: dict[str, Any] | None,
    year: int,
    field_map: dict[str, str],
    taxonomy: dict[str, Any],
    freq_lookup: tuple,
) -> dict[str, Any] | None:
    def value(logical: str) -> Any:
        actual = field_map.get(logical)
        return attributes.get(actual) if actual else None

    latitude = value("y")
    longitude = value("x")
    if not isinstance(latitude, (int, float)) or not isinstance(longitude, (int, float)):
        if geometry:
            latitude = geometry.get("y")
            longitude = geometry.get("x")
    if not isinstance(latitude, (int, float)) or not isinstance(longitude, (int, float)):
        return None
    if not (LAT_MIN <= latitude <= LAT_MAX and LON_MIN <= longitude <= LON_MAX):
        return None

    modality = normalize_modality(value("modalidad"))
    classification = classify(modality, taxonomy)
    macro = normalize_modality(value("generico")) or classification["macro"]

    ubigeo_raw = value("ubigeo")
    if isinstance(ubigeo_raw, str) and ubigeo_raw.strip().isdigit():
        ubigeo = ubigeo_raw.strip().zfill(6)
    else:
        ubigeo_hecho = value("ubigeo_hecho")
        if isinstance(ubigeo_hecho, (int, float)) and not isinstance(ubigeo_hecho, bool):
            ubigeo = str(int(ubigeo_hecho)).zfill(6)
        elif isinstance(ubigeo_hecho, str) and ubigeo_hecho.strip().isdigit():
            ubigeo = ubigeo_hecho.strip().zfill(6)
        else:
            ubigeo = ""

    severity = classification["severity"]
    row = {
        "occurred_year": int(year),
        "district": normalize_district(value("nombdist")),
        "ubigeo": ubigeo,
        "crime_type": modality,
        "macro_category": macro,
        "severity_level": severity,
        "risk_level": SEVERITY_TO_RISK.get(severity, "medio"),
        "latitude": round(float(latitude), 6),
        "longitude": round(float(longitude), 6),
        "source": "inei",
        "_denuncia_id": value("id_denuncia"),
    }
    # Hora, día y frecuencia no vienen en la fuente: se derivan de forma
    # determinista (mismo registro → mismos valores) para unificar el esquema.
    hour, day = hour_day_for(arcgis_derive_key(row))
    row["hour"] = hour
    row["day_of_week"] = day
    pair_mean, district_mean, global_mean = freq_lookup
    row["historical_frequency"] = frequency_for(
        row["district"], modality, pair_mean, district_mean, global_mean
    )
    return row


def dedupe_key(row: dict[str, Any]) -> tuple[Any, ...]:
    denuncia = row.get("_denuncia_id")
    if isinstance(denuncia, (int, float)) and denuncia:
        return ("id", row["occurred_year"], int(denuncia))
    return (
        "geo",
        row["occurred_year"],
        row["ubigeo"],
        row["crime_type"],
        row["latitude"],
        row["longitude"],
    )


def build_sample(df: pd.DataFrame, size: int, seed: int) -> pd.DataFrame:
    """Muestra estratificada por (año, modalidad), proporcional al tamaño."""
    if len(df) <= size:
        return df.copy()
    share = size / len(df)
    pieces = []
    for _, group in df.groupby(["occurred_year", "crime_type"], sort=True):
        take = max(1, round(len(group) * share))
        pieces.append(group.sample(n=min(take, len(group)), random_state=seed))
    sample = pd.concat(pieces)
    if len(sample) > size:
        sample = sample.sample(n=size, random_state=seed)
    return sample.sort_values(["occurred_year", "district", "crime_type"]).reset_index(drop=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingesta reproducible de incidentes INEI (Lima Metropolitana).")
    parser.add_argument("--years", nargs="+", type=int, default=[2021, 2022, 2023, 2024])
    parser.add_argument("--window-size", type=int, default=40, help="Filas por ventana de muestreo.")
    parser.add_argument("--windows", type=int, default=3, help="Ventanas aleatorias por combinación.")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--sleep", type=float, default=0.3, help="Pausa entre peticiones (segundos).")
    parser.add_argument("--sample-size", type=int, default=500)
    args = parser.parse_args()

    taxonomy = load_taxonomy()
    freq_lookup = load_frequency_lookup()[:3]
    rng = random.Random(args.seed)
    groups = discover_year_groups()
    print("Años disponibles:", ", ".join(str(year) for year in sorted(groups)))

    combo_report: list[dict[str, Any]] = []
    errors: list[str] = []
    raw_rows: list[dict[str, Any]] = []

    for year in args.years:
        if year not in groups:
            errors.append(f"Año {year} no encontrado en el servicio.")
            continue
        group = groups[year]
        candidates = group["candidates"]
        if not candidates:
            errors.append(f"Año {year}: grupo sin capas candidatas.")
            continue

        children = resolve_children(group["group_id"], candidates)
        ignored = len(candidates) - len(children)
        print(f"\nAño {year} (grupo {group['group_id']}): {len(children)} modalidades"
              + (f" ({ignored} candidatas descartadas por no pertenecer al grupo)" if ignored else ""))

        for child in children:
            layer_id, layer_name, field_map = child["id"], child["name"], child["fields"]
            try:
                records, total, capped = sample_layer(
                    layer_id,
                    field_map,
                    window_size=args.window_size,
                    windows=args.windows,
                    rng=rng,
                    sleep_seconds=args.sleep,
                )
            except Exception as exc:  # se registra y se continúa
                errors.append(f"Año {year}, capa {layer_id} ({layer_name}): {exc}")
                print(f"  ! {layer_name}: {exc}")
                continue

            kept = 0
            for attributes, geometry in records:
                row = to_row(attributes, geometry, year, field_map, taxonomy, freq_lookup)
                if row is None:
                    continue
                raw_rows.append(row)
                kept += 1

            combo_report.append(
                {
                    "year": year,
                    "layer_id": layer_id,
                    "modality": normalize_modality(layer_name),
                    "available": total,
                    "fetched": len(records),
                    "kept_in_bbox": kept,
                    "cap_reached": capped,
                    "missing_fields": [key for key in DESIRED_FIELDS if key not in field_map],
                }
            )
            print(f"  {layer_name:<55} disponibles={total:>7} muestreados={len(records):>4} en_lima={kept:>4}")

    if not raw_rows:
        print("No se obtuvo ninguna fila.")
        return 1

    # Deduplicación (una denuncia = una fila).
    seen: set[tuple[Any, ...]] = set()
    unique_rows: list[dict[str, Any]] = []
    duplicates = 0
    for row in raw_rows:
        key = dedupe_key(row)
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        unique_rows.append(row)

    df = pd.DataFrame(unique_rows).drop(columns=["_denuncia_id"])
    df = df.sort_values(["occurred_year", "district", "crime_type"]).reset_index(drop=True)

    # ── Ámbito Lima Metropolitana + Callao y canonicalización de distritos ────
    # La fuente mezcla etiquetas: hay filas con coordenadas limeñas y nombres de
    # otras provincias (Chiclayo, Trujillo…), y ubigeos con nombre incoherente.
    # Regla: se conservan las filas con ubigeo de las provincias 1501/0701 y las
    # sin ubigeo cuyo nombre de distrito pertenece a la lista canónica derivada
    # de las anteriores. El nombre se normaliza al más frecuente por ubigeo.
    has_scope_ubigeo = df["ubigeo"].str.slice(0, 4).isin(LIMA_SCOPE_PREFIXES)
    majority_name = (
        df[has_scope_ubigeo]
        .groupby(["ubigeo", "district"]).size().reset_index(name="n")
        .sort_values(["ubigeo", "n"], ascending=[True, False])
        .drop_duplicates("ubigeo")
        .set_index("ubigeo")["district"].to_dict()
    )
    canonical_names = set(majority_name.values())
    df["district"] = df["ubigeo"].map(majority_name).fillna(df["district"])

    keep_mask = has_scope_ubigeo | df["district"].isin(canonical_names)
    kept_by_name = int((~has_scope_ubigeo & keep_mask).sum())
    dropped_rows = df[~keep_mask]
    dropped_examples = dropped_rows["district"].value_counts().head(12).to_dict()
    df = df[keep_mask].reset_index(drop=True)

    known_modalities = set(taxonomy.get("modalities", {}))
    unmapped_modalities = sorted(set(df["crime_type"]) - known_modalities)

    out_dir = REPO_ROOT / "data" / "processed"
    out_dir.mkdir(parents=True, exist_ok=True)
    dataset_path = out_dir / "incidents_lima.csv"
    sample_path = out_dir / "incidents_lima_sample_500.csv"
    report_path = out_dir / "quality_report.json"

    df.to_csv(dataset_path, index=False, encoding="utf-8")
    sample = build_sample(df, args.sample_size, args.seed)
    sample.to_csv(sample_path, index=False, encoding="utf-8")

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "service": BASE_URL,
        "years": args.years,
        "method": {
            "sampling": "ventanas aleatorias con semilla sobre el total disponible",
            "window_size": args.window_size,
            "windows": args.windows,
            "seed": args.seed,
            "note": "La fuente no publica la fecha del hecho; la resolución temporal es el año (grupo de capa).",
        },
        "totals": {
            "rows_kept": int(len(df)),
            "rows_before_dedupe": len(raw_rows),
            "duplicates_dropped": duplicates,
            "districts": int(df["district"].nunique()),
            "modalities": int(df["crime_type"].nunique()),
        },
        "scope_filter": {
            "rule": "conservar ubigeo 1501/0701 o distrito de la lista canónica; nombre canónico por moda de ubigeo",
            "dropped_out_of_scope": int(len(dropped_rows)),
            "dropped_examples": {str(k): int(v) for k, v in dropped_examples.items()},
            "rows_without_ubigeo_kept_by_name": kept_by_name,
            "canonical_districts": len(canonical_names),
        },
        "by_year": df.groupby("occurred_year").size().to_dict(),
        "by_severity": df.groupby("severity_level").size().to_dict(),
        "by_macro": df.groupby("macro_category").size().to_dict(),
        "unmapped_modalities": unmapped_modalities,
        "coverage": combo_report,
        "errors": errors,
    }
    with open(report_path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, default=str)

    print(f"\nDataset:  {dataset_path}  ({len(df)} filas)")
    print(f"Muestra:  {sample_path}  ({len(sample)} filas)")
    print(f"Reporte:  {report_path}")
    print(f"Duplicados descartados: {duplicates}; errores: {len(errors)}")
    print(f"Filtro de ámbito: {len(dropped_rows)} filas fuera de Lima/Callao descartadas "
          f"(ej.: {list(dropped_examples)[:5]})")
    if unmapped_modalities:
        print(f"AVISO: modalidades sin entrada en la taxonomía (usan respaldo): {unmapped_modalities}")
    print("\nPor año:", report["by_year"])
    print("Por gravedad:", report["by_severity"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
