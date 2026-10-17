"""Extractor de puntos INEI 2022 con el esquema clásico (Fase A, puente).

Objetivo: llenar el mapa con más puntos reales (~4-5 mil) **sin cambiar el esquema**
de `crime_incidents`. A diferencia del script legado (`fetch-real-data.js`):

- Descubre capas dinámicamente y valida pertenencia (`parentLayer`) — los IDs del
  servicio cambian con el tiempo (el script original descargaba 2021 etiquetado
  como 2022).
- `hour` y `day_of_week` se derivan **determinísticamente del ID de denuncia**
  (mismo punto → mismos valores en cualquier ejecución) para que la subida sea
  idempotente (el ID de documento es el hash del contenido).
- `historical_frequency` se calcula con la **serie mensual real SIDPOL/MININTER**
  (media de los últimos 24 meses del distrito y modalidad), no con tablas
  inventadas. Requiere haber ejecutado `ingest_sidpol.py` antes.
- `risk_level` es la **severidad declarada** de la taxonomía (alta→alto,
  media→medio, baja→bajo): es una etiqueta, no una medición (ver MODEL_CARD).

Uso (desde la raíz del repositorio):

    python scripts/pipeline/ingest_inei_legacy.py --year 2022 --per-modality 320

Salidas:
    data/raw/inei/points_<año>_legacy.csv        (esquema clásico de 8 columnas)
    data/processed/inei_legacy_report.json

Después: `python scripts/pipeline/upload_incidents.py --csv <csv> --verify`
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

PIPELINE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PIPELINE_DIR.parents[1]
sys.path.insert(0, str(PIPELINE_DIR))
sys.path.insert(0, str(REPO_ROOT / "functions"))

from ingest_inei import (  # noqa: E402
    discover_year_groups,
    resolve_children,
    sample_layer,
)
from taxonomy import classify, load_taxonomy, normalize_district, normalize_modality  # noqa: E402

SEVERITY_TO_RISK = {"alta": "alto", "media": "medio", "baja": "bajo"}
DEFAULT_HOURS = [20, 21, 22, 23, 20, 21, 22, 7, 8, 20, 21, 23, 22, 20, 0, 21, 22, 23, 19, 20]
DEFAULT_DAYS = ["viernes", "sábado", "viernes", "domingo", "jueves", "sábado", "viernes", "lunes"]
SIDPOL_CSV = REPO_ROOT / "data" / "processed" / "sidpol_monthly_lima.csv"
SCOPE_PREFIXES = ("1501", "0701")
CSV_COLUMNS = [
    "crime_type",
    "hour",
    "day_of_week",
    "district",
    "latitude",
    "longitude",
    "historical_frequency",
    "risk_level",
]


def _plain(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", str(text).strip().lower())
    return " ".join("".join(ch for ch in decomposed if not unicodedata.combining(ch)).split())


def sidpol_modality_key(crime_type: str) -> str:
    """Mapea la modalidad de la taxonomía a una modalidad de la serie SIDPOL."""
    value = _plain(crime_type)
    if "robo" in value:
        return "robo"
    if "hurto" in value:
        return "hurto"
    if "estafa" in value or "defraud" in value:
        return "estafa"
    if "extorsion" in value:
        return "extorsion"
    if "secuestro" in value:
        return "secuestro"
    return "otros"


def load_frequency_lookup() -> tuple[dict[tuple[str, str], float], dict[str, float], float, dict[str, str]]:
    """Media mensual real (últimos 24 meses) por (distrito, modalidad), por distrito,
    y el mapa ubigeo→distrito canónico (nombres consistentes con SIDPOL)."""
    if not SIDPOL_CSV.exists():
        raise SystemExit(
            "Falta data/processed/sidpol_monthly_lima.csv. "
            "Ejecuta primero: python scripts/pipeline/ingest_sidpol.py"
        )
    frame = pd.read_csv(SIDPOL_CSV, dtype={"ubigeo": str})
    frame["period"] = frame["year"] * 100 + frame["month"]
    last_two = sorted(frame["period"].unique())[-24:]
    frame = frame[frame["period"].isin(last_two)]

    pairs: dict[tuple[str, str], float] = {}
    districts: dict[str, float] = {}
    ubigeo_names: dict[str, str] = {}
    for _, row in frame.iterrows():
        district = str(row["district"])
        ubigeo = str(row["ubigeo"]).zfill(6)
        ubigeo_names.setdefault(ubigeo, district)
        for modality in ("robo", "hurto", "estafa", "extorsion", "secuestro", "violencia_mujer", "otros"):
            count = float(row.get(modality, 0) or 0)
            key = (district, modality)
            pairs[key] = pairs.get(key, 0.0) + count
        districts[district] = districts.get(district, 0.0) + float(row.get("total", 0) or 0)

    months = max(1, len(last_two))
    pair_mean = {key: value / months for key, value in pairs.items()}
    district_mean = {key: value / months for key, value in districts.items()}
    global_mean = sum(district_mean.values()) / max(1, len(district_mean)) if district_mean else 100.0
    return pair_mean, district_mean, global_mean, ubigeo_names


def frequency_for(district: str, crime_type: str, pair_mean, district_mean, global_mean) -> int:
    value = pair_mean.get((district, sidpol_modality_key(crime_type)))
    if value is None:
        value = district_mean.get(district)
    if value is None or value <= 0:
        value = global_mean
    return max(1, int(round(value)))


def hour_day_for(denuncia_id: int, modality_key: str) -> tuple[int, str]:
    """Hora y día deterministas a partir del ID de denuncia (idempotencia)."""
    hour = DEFAULT_HOURS[denuncia_id % len(DEFAULT_HOURS)]
    day = DEFAULT_DAYS[(denuncia_id + 7) % len(DEFAULT_DAYS)]
    return hour, day


def main() -> int:
    parser = argparse.ArgumentParser(description="Puntos INEI con esquema clásico (puente Fase A).")
    parser.add_argument("--year", type=int, default=2022)
    parser.add_argument("--per-modality", type=int, default=320, help="Puntos objetivo por modalidad.")
    parser.add_argument("--window-size", type=int, default=50)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--sleep", type=float, default=0.25)
    args = parser.parse_args()

    taxonomy = load_taxonomy()
    pair_mean, district_mean, global_mean, ubigeo_names = load_frequency_lookup()
    canonical_districts = set(ubigeo_names.values())
    rng = random.Random(args.seed)

    groups = discover_year_groups()
    if args.year not in groups:
        raise SystemExit(f"Año {args.year} no disponible en el servicio INEI.")
    group = groups[args.year]
    children = resolve_children(group["group_id"], group["candidates"])
    print(f"Año {args.year}: {len(children)} modalidades resueltas")

    seen_denuncias: set[int] = set()
    rows: list[dict] = []
    per_layer: list[dict] = []

    windows = max(1, -(-args.per_modality // args.window_size))  # ceil

    for child in children:
        records, total, _capped = sample_layer(
            child["id"],
            child["fields"],
            window_size=args.window_size,
            windows=windows,
            rng=rng,
            sleep_seconds=args.sleep,
        )

        kept = 0
        for attributes, geometry in records:
            field_map = child["fields"]

            def value(logical: str, attrs=attributes, mapping=field_map):
                actual = mapping.get(logical)
                return attrs.get(actual) if actual else None

            latitude = value("y")
            longitude = value("x")
            if not isinstance(latitude, (int, float)) or not isinstance(longitude, (int, float)):
                if geometry:
                    latitude = geometry.get("y")
                    longitude = geometry.get("x")
            if not isinstance(latitude, (int, float)) or not isinstance(longitude, (int, float)):
                continue

            denuncia = value("id_denuncia")
            denuncia_id = int(denuncia) if isinstance(denuncia, (int, float)) and denuncia else 0
            if denuncia_id and denuncia_id in seen_denuncias:
                continue

            # Filtro de ámbito por ubigeo (1501/0701) y nombre canónico (consistente con SIDPOL).
            ubigeo_raw = value("ubigeo")
            if isinstance(ubigeo_raw, str) and ubigeo_raw.strip().isdigit():
                ubigeo = ubigeo_raw.strip().zfill(6)
            else:
                ubigeo_hecho = value("ubigeo_hecho")
                ubigeo = ""
                if isinstance(ubigeo_hecho, (int, float)) and not isinstance(ubigeo_hecho, bool):
                    ubigeo = str(int(ubigeo_hecho)).zfill(6)
                elif isinstance(ubigeo_hecho, str) and ubigeo_hecho.strip().isdigit():
                    ubigeo = ubigeo_hecho.strip().zfill(6)
            if not ubigeo.startswith(SCOPE_PREFIXES):
                continue
            district = ubigeo_names.get(ubigeo, normalize_district(value("nombdist")))
            if district not in canonical_districts:
                continue

            modality = normalize_modality(value("modalidad") or child["name"])
            severity = classify(modality, taxonomy)["severity"]
            hour, day = hour_day_for(denuncia_id or len(rows) + 1, modality)
            frequency = frequency_for(district, modality, pair_mean, district_mean, global_mean)

            rows.append(
                {
                    "crime_type": modality,
                    "hour": hour,
                    "day_of_week": day,
                    "district": district,
                    "latitude": round(float(latitude), 6),
                    "longitude": round(float(longitude), 6),
                    "historical_frequency": frequency,
                    "risk_level": SEVERITY_TO_RISK.get(severity, "medio"),
                    "_denuncia_id": denuncia_id,
                }
            )
            if denuncia_id:
                seen_denuncias.add(denuncia_id)
            kept += 1

        per_layer.append({"layer": child["name"], "available": total, "kept": kept})
        print(f"  {child['name']:<55} disponibles={total:>7} muestreados={kept:>4}")

    if not rows:
        raise SystemExit("No se obtuvo ningún punto.")

    frame = pd.DataFrame(rows)
    duplicates = int(frame.duplicated(subset=["_denuncia_id"]).sum())
    frame = frame.drop(columns=["_denuncia_id"]).reset_index(drop=True)

    out_dir = REPO_ROOT / "data" / "raw" / "inei"
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / f"points_{args.year}_legacy.csv"
    frame.to_csv(csv_path, index=False, columns=CSV_COLUMNS, encoding="utf-8")

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "year": args.year,
        "rows": int(len(frame)),
        "duplicates_dropped": duplicates,
        "districts": int(frame["district"].nunique()),
        "risk_distribution": frame["risk_level"].value_counts().to_dict(),
        "per_layer": per_layer,
        "frequency_source": "media mensual SIDPOL/MININTER (últimos 24 meses)",
        "note": "hour/day deterministas por ID de denuncia; risk_level = severidad declarada (taxonomía).",
    }
    report_path = REPO_ROOT / "data" / "processed" / "inei_legacy_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\nCSV:     {csv_path}  ({len(frame)} puntos)")
    print(f"Reporte: {report_path}")
    print(f"Distritos: {report['districts']} · riesgo: {report['risk_distribution']}")
    print("\nSube con: python scripts/pipeline/upload_incidents.py --csv "
          f"\"{csv_path}\" --verify")
    return 0


if __name__ == "__main__":
    sys.exit(main())
