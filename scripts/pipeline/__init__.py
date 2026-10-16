"""Pipeline offline de datos y ML (Fase 3).

Etapas (cada una con su comando, desde la raíz del repositorio):

1. `python scripts/pipeline/ingest_inei.py --years 2021 2022 2023 2024`
   Descarga incidentes reales del MapServer del INEI (descubrimiento dinámico
   de capas por año) y genera el dataset canónico `data/processed/incidents_lima.csv`
   + reporte de calidad.

2. `python scripts/pipeline/train.py --split temporal`
   Entrena el clasificador de modalidad con `crime_ml.pipeline`
   (splits aleatorio, temporal y geográfico) y guarda métricas en JSON.

Nota: no se usa `python -m scripts.pipeline.*` porque el nombre `scripts` puede
estar ocupado por un paquete de site-packages según el entorno.
"""
