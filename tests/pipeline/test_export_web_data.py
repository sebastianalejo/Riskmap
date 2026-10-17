"""Pruebas del exportador de datos publicados (JSON estático para Hosting)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "pipeline"))
sys.path.insert(0, str(REPO_ROOT / "functions"))

from export_web_data import main, payload_from_firestore  # noqa: E402

LEGACY_CSV = (
    "crime_type,hour,day_of_week,district,latitude,longitude,historical_frequency,risk_level\n"
    "hurto,8,sábado,MIRAFLORES,-12.1219,-77.0297,140,bajo\n"
    "hurto,8,sábado,MIRAFLORES,-12.1219,-77.0297,140,bajo\n"  # duplicado por contenido
    "robo agravado,20,lunes,SAN MARTIN DE PORRES,-11.99769,-77.088301,1545,alto\n"
)

V2_CSV = (
    "occurred_year,district,ubigeo,crime_type,macro_category,severity_level,latitude,longitude\n"
    "2024,MIRAFLORES,150122,robo agravado,delitos contra el patrimonio,alta,-12.1219,-77.0297\n"
    "2023,COMAS,150110,hurto,delitos contra el patrimonio,media,-11.938,-77.052\n"
)

MONTHLY_CSV = (
    "year,month,ubigeo,district,province,department,total,estafa,extorsion,hurto,otros,robo,secuestro,violencia_mujer\n"
    "2024,1,150102,ANCON,LIMA,LIMA METROPOLITANA,176,1,0,34,49,14,0,78\n"
    "2024,2,150103,ATE,LIMA,LIMA METROPOLITANA,1255,12,2,212,340,158,1,530\n"
)


def _write_inputs(tmp_path: Path) -> tuple[Path, Path, Path]:
    legacy = tmp_path / "legacy.csv"
    incidents = tmp_path / "incidents.csv"
    monthly = tmp_path / "monthly.csv"
    legacy.write_text(LEGACY_CSV, encoding="utf-8")
    incidents.write_text(V2_CSV, encoding="utf-8")
    monthly.write_text(MONTHLY_CSV, encoding="utf-8")
    return legacy, incidents, monthly


def test_exporta_manifest_json_y_reporte(tmp_path):
    legacy, incidents, monthly = _write_inputs(tmp_path)
    out = tmp_path / "data"

    code = main(
        [
            "--legacy",
            str(legacy),
            "--incidents",
            str(incidents),
            "--monthly",
            str(monthly),
            "--out",
            str(out),
        ]
    )
    assert code == 0

    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["schemaVersion"] == 1
    # 2 legacy válidas (una duplicada) + 2 v2 = 4 incidentes publicados.
    assert manifest["counts"]["incidents"] == 4
    assert manifest["counts"]["sources"] == {"modalidad": 2, "inei": 2}
    assert manifest["counts"]["monthlyRows"] == 2

    for key, info in manifest["files"].items():
        assert (out / info["name"]).exists(), key
        assert info["bytes"] > 0

    map_payload = json.loads((out / manifest["files"]["map"]["name"]).read_text(encoding="utf-8"))
    assert map_payload["columns"][5] == "riskLevel"
    sources = {row[6] for row in map_payload["points"]}
    assert sources == {"inei", "modalidad"}
    inei = next(row for row in map_payload["points"] if row[6] == "inei" and row[4] == "robo agravado")
    assert inei[5] == "alto"  # severity_level "alta" → "alto"
    assert inei[7] == 2024

    analysis_payload = json.loads(
        (out / manifest["files"]["analysis"]["name"]).read_text(encoding="utf-8")
    )
    assert analysis_payload["columns"][3] == "year"
    assert any(row[3] == 2024 for row in analysis_payload["incidents"])

    monthly_payload = json.loads(
        (out / manifest["files"]["monthly"]["name"]).read_text(encoding="utf-8")
    )
    assert monthly_payload["modalities"][0] == "estafa"
    assert len(monthly_payload["rows"]) == 2

    report = json.loads((out / "export_report.json").read_text(encoding="utf-8"))
    assert report["valid"]["incidents"] == 4
    assert report["sources"]["legacy"]["duplicates_or_invalid"] == 1


def test_payload_from_firestore_normaliza_y_detecta_fuente():
    v2 = payload_from_firestore(
        {
            "crime_type": "Robo Agravado",
            "district": "miraflores",
            "latitude": -12.12,
            "longitude": -77.03,
            "occurred_year": 2024,
            "severity_level": "alta",
        }
    )
    assert v2 is not None
    assert v2["source"] == "inei"
    assert v2["crime_type"] == "robo agravado"
    assert v2["district"] == "MIRAFLORES"

    legacy = payload_from_firestore(
        {
            "crime_type": "hurto",
            "district": "comas",
            "latitude": -11.9,
            "longitude": -77.0,
            "hour": 8,
            "day_of_week": "Sábado",
            "historical_frequency": 120,
            "risk_level": "bajo",
        }
    )
    assert legacy is not None
    assert legacy["source"] == "modalidad"
    assert legacy["day_of_week"] == "sábado"

    assert payload_from_firestore({"crime_type": "", "district": "COMAS"}) is None


def test_check_valida_los_archivos_publicados(tmp_path):
    legacy, incidents, monthly = _write_inputs(tmp_path)
    out = tmp_path / "data"
    assert (
        main(
            [
                "--legacy",
                str(legacy),
                "--incidents",
                str(incidents),
                "--monthly",
                str(monthly),
                "--out",
                str(out),
            ]
        )
        == 0
    )

    assert main(["--check", "--out", str(out)]) == 0
    # Si falta un archivo, el chequeo debe fallar.
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    (out / manifest["files"]["map"]["name"]).unlink()
    assert main(["--check", "--out", str(out)]) == 1
