# Model Card — Clasificador de modalidad delictiva (Lima Metropolitana)

**Fecha:** 2026-10-16 · **Estado:** modelo offline de la Fase 3 (aún no conectado a la API/UI) ·
**Artefacto:** `models/processed/crime_modality_model.joblib` (reproducible; ver §8)

---

## 1. Qué es y qué no es

**Es:** un clasificador supervisado que estima, dado un *contexto espacial* (distrito y
coordenadas), cuál es la **modalidad delictiva observada más probable** entre 15 categorías
(robo agravado, hurto, estafa, homicidio por PAF, microcomercialización de drogas, …), a partir
de denuncias reales registradas por el INEI (2021–2024).

**No es:** una medición del riesgo real de una zona, ni una probabilidad de victimización, ni una
herramienta para evaluar personas, viviendas o barrios. Tampoco sirve para comparar "peligrosidad"
entre distritos: los registros policiales dependen del subregistro de denuncias, de la densidad
de comisarías y de la actividad policial, no solo de la delincuencia.

**Relación con lo desplegado en la app:** la pantalla *Predicción* del frontend usa una heurística
en el navegador (`frontend/src/ml/localPredict.ts`) y las Cloud Functions conservan la tarea
heredada (`risk_level` derivado por reglas del tipo de delito, ver §7). Este model card documenta
el modelo nuevo del pipeline offline; su conexión a la API y la UI es trabajo de la Fase 4.

## 2. Datos

| Aspecto | Detalle |
|---|---|
| Fuente | MapServer público del INEI DataCrime (`arcgis3.inei.gob.pe`, capas "Modalidad de delito YYYY") |
| Años | 2021, 2022, 2023, 2024 (la fuente no publica fecha del hecho; la resolución temporal real es el año) |
| Muestreo | Ventanas aleatorias con semilla sobre el total disponible de cada combinación (año, modalidad); máximo 120 filas por combinación |
| Tamaño final | 5 977 filas · 49 distritos (Lima Metropolitana + Callao) · 15 modalidades |
| Cobertura por año | 2021: 1 584 · 2022: 1 594 · 2023: 1 158 · 2024: 1 641 |
| Deduplicación | 401 duplicados retirados (clave: id de denuncia o tupla geográfica) |
| Filtro de ámbito | 262 filas descartadas: la fuente mezcla nombres de distrito de otras provincias con coordenadas limeñas y ubigeos incoherentes; se conservan filas con ubigeo 1501/0701 o con nombre canónico, y el nombre se normaliza al más frecuente por ubigeo |
| Reporte completo | `data/processed/quality_report.json` |

**Limitaciones de los datos:** subregistro de denuncias (cifra negra), posible doble conteo
residual, muestreo por ventanas (no es un censo), geocodificación y etiquetas de la fuente con
inconsistencias (mitigadas, no eliminadas), ausencia de hora/día y de población como denominador.

## 3. Variable objetivo y etiqueta declarada

- **Objetivo del modelo:** `crime_type` (modalidad observada, tal como la reporta la fuente,
  normalizada). Es una variable **real**, no derivada por reglas.
- **`severity_level` (baja/media/alta)** es una **taxonomía declarada** en
  `data/taxonomy/crime_taxonomy.json` (con justificación por modalidad). Se usa como atributo
  descriptivo, **no como etiqueta de entrenamiento**, precisamente para evitar la circularidad
  de la tarea heredada (donde `risk_level` se calculaba a partir de `crime_type`).

## 4. Modelo

- `Pipeline` de scikit-learn: `OneHotEncoder(handle_unknown="ignore")` para `district` +
  `passthrough` numérico para `latitude`/`longitude`, y `RandomForestClassifier`
  (`n_estimators=250`, `max_depth=20`, `class_weight="balanced"`, `random_state=42`).
- Entrenamiento reproducible: `python scripts/pipeline/train.py --split <régimen>`
  (semilla 42, `test_size=0.25`, scikit-learn 1.7.0; ver `environment` en los JSON de métricas).

## 5. Evaluación (medida, no estimada)

Tres regímenes de partición (los resultados salen de `models/reports/metrics_*.json`, ejecución
del 2026-10-16):

| Régimen | Train | Test | Accuracy | F1 macro | Baseline (clase mayoritaria) | Interpretación |
|---|---:|---:|---:|---:|---:|---|
| Aleatorio estratificado | 4 482 | 1 495 | **0.213** | 0.202 | 0.078 | Aprende señal real: 2.7× el baseline |
| Temporal (2021–23 → 2024) | 4 336 | 1 641 | **0.149** | 0.145 | 0.073 | Generaliza al año siguiente: 2.0× el baseline |
| Geográfico (distritos no vistos) | 4 411 | 1 566 | **0.097** | 0.061 | 0.102 | **No supera el baseline** |

Matriz de confusión, métricas por clase e importancias están en los JSON citados. Hallazgos:

- `latitude` y `longitude` concentran ~91 % de la importancia; los indicadores de distrito apenas
  aportan (≤0.8 % cada uno).
- En la partición geográfica el modelo falla en clases frecuentes (`robo`, `homicidio calificado`
  con recall ≈ 0): **la componente principal del aprendizaje es la memorización del distrito**,
  que no generaliza a zonas nuevas.
- La caída temporal (~30 % respecto al split aleatorio) sugiere deriva entre años (cambios de
  registro y de patrones).
- Clases con mejor recall (aleatorio): `robo` 0.31, `homicidio por paf` 0.29,
  `asalto y robo de vehículos` 0.26. Peores: `robo frustrado` 0.05 (soporte bajo), `estafa` 0.17.

## 6. Uso responsable

- Presentar siempre el resultado como **composición relativa esperada de modalidades**, nunca como
  "nivel de peligro" de un barrio o de sus habitantes.
- No usar para decisiones de vivienda, seguros, crédito, vigilancia individual ni asignación de
  patrullaje sin revisión humana y estudios complementarios.
- Acompañar las visualizaciones con el tamaño de muestra, intervalo de confianza o nota de
  incertidumbre, y con el aviso de sesgo de denuncia.
- Evitar estética alarmista (rojo = peligro) aplicada a heurísticas o a modelos con accuracy ~0.2.

## 7. Relación con el modelo heredado

El pipeline de las Cloud Functions (`functions/crime_ml/pipeline.py`) sigue soportando la tarea
heredada con `FEATURES`/`TARGET` por defecto, cuyas etiquetas eran una función determinista de
`crime_type` (circularidad detectada en la auditoría). Ese camino queda como compatibilidad
histórica; **este model card y el pipeline offline son la referencia metodológica del proyecto**.
Desde la Fase 4, el clasificador de modalidad se sirve a través de `predict_crime` (top-5 con
probabilidad) y la pestaña «Modelo de modalidad» de la UI; que funcione en la nube depende del
despliegue (ver `docs/DEPLOY.md`).

## 8. Reproducibilidad

```bash
python scripts/pipeline/ingest_inei.py --years 2021 2022 2023 2024
python scripts/pipeline/train.py --split random
python scripts/pipeline/train.py --split temporal
python scripts/pipeline/train.py --split district
```

Cada JSON de métricas incluye fecha, hash SHA-256 del dataset, versiones de Python/pandas/
scikit-learn y la configuración del split. El dataset completo (`data/processed/incidents_lima.csv`)
es regenerable y no se versiona; sí se versionan la muestra de 500 filas, el reporte de calidad y
las métricas. Pruebas automáticas del pipeline: `python -m pytest functions/tests`.

## 9. Próximos pasos

1. Añadir denominadores (población, área, comercios) para estimar incidencia relativa en lugar de
   composición, y validar la geocodificación de la fuente.
2. Incorporar más señales espaciales (grillas, uso de suelo, avenidas) para mejorar la
   generalización geográfica antes de cualquier uso territorial.
3. Conectar el modelo a `predict_crime` (Fase 4) con contrato validado y mostrar probabilidades
   calibradas, no solo la clase.
4. Reentrenar periódicamente y registrar la deriva temporal observada en el split 2021–23 → 2024.
