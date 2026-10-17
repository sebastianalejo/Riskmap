"""Genera el GeoJSON de distritos de Lima Metropolitana + Callao (Fase B).

Fuente principal: `peru_distrital_simple.geojson` (repositorio público
juaneladio/peru-geojson). Esa fuente **no incluye 3 distritos** (San Martín de
Porres, La Punta y Mi Perú, por geometrías nulas/ausentes), así que se completan
con un **parche vía Nominatim (OpenStreetMap, licencia ODbL)** — una consulta por
distrito, con User-Agent identificado y pausa de 1.1 s (política de uso).

Salida (versionada, servida por Hosting):
    frontend/public/geo/lima_distritos.geojson

Uso:
    python scripts/pipeline/build_geo.py
"""

from __future__ import annotations

import json
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PIPELINE_DIR.parents[1]
SOURCE_URL = "https://raw.githubusercontent.com/juaneladio/peru-geojson/master/peru_distrital_simple.geojson"
SOURCE_PATH = REPO_ROOT / "data" / "raw" / "geo" / "peru_distrital_simple.geojson"
SIDPOL_CSV = REPO_ROOT / "data" / "processed" / "sidpol_monthly_lima.csv"
OUTPUT_PATH = REPO_ROOT / "frontend" / "public" / "geo" / "lima_distritos.geojson"
SCOPE_PREFIXES = ("1501", "0701")
PRECISION = 5
NOMINATIM = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "RiskmapTesis/1.0 (proyecto academico; contacto: alejovaldez2004@gmail.com)"


def download_source(dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(
        SOURCE_URL,
        headers={"User-Agent": "Mozilla/5.0 (RiskmapPipeline/1.0)"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        dest.write_bytes(response.read())


def round_coordinates(value, precision: int = PRECISION):
    """Redondea recursivamente coordenadas [lon, lat, ...]."""
    if isinstance(value, (int, float)):
        return round(float(value), precision)
    if isinstance(value, list):
        return [round_coordinates(item, precision) for item in value]
    return value


def _title(name: str) -> str:
    return " ".join(word.capitalize() for word in str(name).split())


def expected_districts() -> tuple[dict[str, str], dict[str, str]]:
    """ubigeo → nombre canónico (mayoría) y ubigeo → provincia (desde SIDPOL).

    El origen tiene pares ubigeo/nombre incoherentes en una minoría de filas,
    así que se usa el nombre más frecuente por ubigeo.
    """
    import pandas as pd

    frame = pd.read_csv(SIDPOL_CSV, dtype={"ubigeo": str})
    frame = frame.assign(ubigeo=frame["ubigeo"].str.zfill(6))
    names: dict[str, str] = {}
    provinces: dict[str, str] = {}
    for ubigeo, group in frame.groupby("ubigeo"):
        counts = group["district"].value_counts()
        names[str(ubigeo)] = str(counts.index[0])
        provinces[str(ubigeo)] = str(group["province"].value_counts().index[0])
    return names, provinces


def nominatim_polygon(query: str) -> dict | None:
    params = urllib.parse.urlencode(
        {"q": query, "format": "json", "polygon_geojson": "1", "limit": "1"}
    )
    request = urllib.request.Request(f"{NOMINATIM}?{params}", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception as exc:  # pragma: no cover - red/estado del servicio
        print(f"  ! Nominatim falló para '{query}': {exc}", file=sys.stderr)
        return None
    if not data:
        return None
    item = data[0]
    # La API de Nominatim usa `class` (el cliente Python lo expone como category).
    kind = item.get("class") or item.get("category") or ""
    if kind != "boundary" or item.get("type") != "administrative":
        print(f"  ! '{query}' devolvió class={kind} type={item.get('type')}", file=sys.stderr)
        return None
    geometry = item.get("geojson") or {}
    if geometry.get("type") not in ("Polygon", "MultiPolygon"):
        return None
    coordinates = geometry.get("coordinates") or []
    flat = json.dumps(coordinates)
    # Validación de ámbito: el polígono debe caer en el bbox de Lima/Callao.
    if not any(marker in flat for marker in ('-12.', '-11.', '-77.', '-76.')):
        print(f"  ! '{query}' fuera del ámbito de Lima/Callao", file=sys.stderr)
        return None
    return geometry


def main() -> int:
    if not SOURCE_PATH.exists():
        print(f"Descargando {SOURCE_URL} ...")
        download_source(SOURCE_PATH)

    data = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))
    features: list[dict] = []

    for feature in data["features"]:
        properties = feature.get("properties", {})
        ubigeo = str(properties.get("IDDIST", "")).strip()
        if not ubigeo.startswith(SCOPE_PREFIXES):
            continue
        geometry = feature.get("geometry")
        if not geometry:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "ubigeo": ubigeo,
                    "district": str(properties.get("NOMBDIST", "")).strip(),
                },
                "geometry": {
                    "type": geometry["type"],
                    "coordinates": round_coordinates(geometry.get("coordinates", [])),
                },
            }
        )

    # ── Parche de distritos ausentes vía Nominatim (OSM/ODbL) ──────────────
    expected, provinces = expected_districts()
    present = {item["properties"]["ubigeo"] for item in features}
    missing = sorted(set(expected) - present)
    patched: list[str] = []
    for ubigeo in missing:
        district = _title(expected[ubigeo])
        province = _title(provinces.get(ubigeo, "Lima"))
        query = f"{district}, {province}, Peru"
        print(f"  Parche Nominatim: {ubigeo} {query} ...")
        geometry = nominatim_polygon(query)
        time.sleep(1.1)  # política de uso de Nominatim
        if not geometry:
            print(f"  ! Sin polígono para {ubigeo} ({district})", file=sys.stderr)
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {"ubigeo": ubigeo, "district": expected[ubigeo], "patch": "osm-nominatim"},
                "geometry": {
                    "type": geometry["type"],
                    "coordinates": round_coordinates(geometry.get("coordinates", [])),
                },
            }
        )
        patched.append(f"{ubigeo} ({district})")

    features.sort(key=lambda item: item["properties"]["ubigeo"])
    collection = {
        "type": "FeatureCollection",
        "metadata": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "sources": [
                SOURCE_URL,
                "https://www.openstreetmap.org (Nominatim, ODbL) para distritos con parche",
            ],
            "scope": "Lima Metropolitana + Callao (ubigeo 1501/0701)",
            "features": len(features),
            "precision": PRECISION,
            "patched": patched,
        },
        "features": features,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(collection, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    size_kb = OUTPUT_PATH.stat().st_size / 1024
    print(f"Distritos: {len(features)} (esperados {len(expected)}; parche OSM: {len(patched)})")
    for item in patched:
        print(f"  · parcheado: {item}")
    print(f"Salida: {OUTPUT_PATH}  ({size_kb:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

