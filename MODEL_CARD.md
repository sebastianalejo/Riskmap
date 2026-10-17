# Model Card — Clasificador de modalidad delictiva (Lima Metropolitana)

**Fecha:** 2026-10-16 · **Estado:** modelo offline de la Fase 3 (aún no conectado a la API/UI) ·
**Artefacto:** `models/processed/crime_modality_model.joblib` (reproducible; ver §8)

---

## 1. Qué es y qué no es

**Es:** un clasificador supervisado que estima, dado un *contexto espacial* (distrito y
coordenadas), cuál es la **modalidad delictiva observada más probable** entre 15 categorías
(robo agravado, hurto, estafa, homicidio por PAF, microcomercialización de drogas, …), a partir
de denuncias reales de los datos oficiales (2021–2025).

**No es:** una medición del riesgo real de una zona, ni una probabilidad de victimización, ni una
herramienta para evaluar personas, viviendas o barrios. Tampoco sirve para comparar "peligrosidad"
entre distritos: los registros policiales dependen del subregistro de denuncias, de la densidad
de comisarías y de la actividad policial, no solo de la delincuencia.

**Relación con lo desplegado en la app:** la pantalla *Predicción* es **una sola pestaña y 100 %
local** (`frontend/src/ml/localPredict.ts`): estima el nivel de riesgo con una **estimación aproximada ponderada**
y muestra las «modalidades más probables» como **composición histórica del distrito** (la proporción
habitual en los datos publicados). No sirve el clasificador de este model card: exponerlo en la UI requeriría
desplegar `predict_crime` con el plan Blaze (opcional). Este model card documenta el clasificador
entrenado sin conexión; su servicio en la nube es trabajo de la Fase 4.

## 2. Datos

| Aspecto | Detalle |
|---|---|
| Fuente | Servidor de mapas público de DataCrime (`arcgis3.inei.gob.pe`, capas "Modalidad de delito YYYY") |
| Años | 2021, 2022, 2023, 2024 (la fuente no publica fecha del hecho; la resolución temporal real es el año) |
| Muestreo | Ventanas aleatorias con semilla sobre el total disponible de cada combinación (año, modalidad); máximo 120 filas por combinación |
| Tamaño final | 5 977 filas · 49 distritos (Lima Metropolitana + Callao) · 15 modalidades |
| Cobertura por año | 2021: 1 584 · 2022: 1 594 · 2023: 1 158 · 2024: 1 641 |
| Deduplicación | 401 duplicados retirados (clave: identificador de denuncia o combinación de coordenadas) |
| Filtro de ámbito | 262 filas descartadas: la fuente mezcla nombres de distrito de otras provincias con coordenadas limeñas y ubigeos incoherentes; se conservan filas con ubigeo 1501/0701 o con nombre oficial, y el nombre se normaliza al más frecuente por ubigeo |
| Reporte completo | `data/processed/quality_report.json` |

**Fuente complementaria (Oleada 1):** serie mensual de denuncias oficiales por distrito y modalidad
(2018–hoy) guardada en la base de datos, usada para la **tendencia real** del panel y el PDF. No es
una variable del modelo todavía (ver `data/README.md`).

**Esquema unificado en la app:** además del esquema clásico, los incidentes conviven con los
puntos de datos oficiales 2021-2025 (año, severidad, macro-categoría y fuente «inei»). Ambas
fuentes exponen las mismas columnas: a los puntos oficiales se les derivan **hora, día y frecuencia
histórica** (ver `scripts/pipeline/derive.py`) porque la fuente no las publica; el nivel de riesgo sale
de la severidad declarada de la taxonomía. La hora y el día derivados y la frecuencia (media de
denuncias oficiales) son **estimaciones, no mediciones**. El mapa colorea todos los puntos por riesgo
(los puntos oficiales llevan un borde azul), y se puede filtrar por año, tipo, distrito, hora y fuente.
Siguen sin ser variables del modelo.

**Limitaciones de los datos:** subregistro de denuncias (cifra negra), posible doble conteo
residual, muestreo por ventanas (no es un censo), geocodificación y etiquetas de la fuente con
inconsistencias (mitigadas, no eliminadas), ausencia de hora/día y de población como denominador.

## 3. Variable objetivo y etiqueta declarada

- **Objetivo del modelo:** el tipo de delito (modalidad observada, tal como la reporta la fuente,
  normalizada). Es una variable **real**, no derivada por reglas.
- **El nivel de severidad (baja/media/alta)** es una **taxonomía declarada** en
  `data/taxonomy/crime_taxonomy.json` (con justificación por modalidad). Se usa como atributo
  descriptivo, **no como etiqueta de entrenamiento**, precisamente para evitar la circularidad
  de la tarea heredada (donde el nivel de riesgo se calculaba a partir del tipo de delito).

## 4. Modelo

- `Pipeline` de scikit-learn: `OneHotEncoder(handle_unknown="ignore")` para `district` +
  `passthrough` numérico para `latitude`/`longitude`, y `RandomForestClassifier`
  (`n_estimators=250`, `max_depth=20`, `class_weight="balanced"`, `random_state=42`).
- Entrenamiento reproducible: `python scripts/pipeline/train.py --split <régimen>`
  (semilla 42, `test_size=0.25`, scikit-learn 1.7.0; ver `environment` en los JSON de métricas).

## 5. Evaluación (medida, no estimada)

Tres regímenes de partición (los resultados salen de `models/reports/metrics_*.json`, ejecución
del 2026-10-16):

| Régimen | Entrenamiento | Prueba | Exactitud | F1 macro | Referencia (clase más frecuente) | Interpretación |
|---|---:|---:|---:|---:|---:|---|
| Aleatorio estratificado | 4 482 | 1 495 | **0.213** | 0.202 | 0.078 | Aprende señal real: 2.7× la referencia |
| Temporal (2021–23 → 2024) | 4 336 | 1 641 | **0.149** | 0.145 | 0.073 | Generaliza al año siguiente: 2.0× la referencia |
| Geográfico (distritos no vistos) | 4 411 | 1 566 | **0.097** | 0.061 | 0.102 | **No supera la referencia** |

Matriz de confusión, métricas por clase e importancias están en los JSON citados. Hallazgos:

- La latitud y la longitud concentran ~91 % de la importancia; los indicadores de distrito apenas
  aportan (≤0.8 % cada uno).
- En la partición geográfica el modelo falla en clases frecuentes (`robo`, `homicidio calificado`,
  con muy pocos aciertos): **la componente principal del aprendizaje es la memorización del distrito**,
  que no generaliza a zonas nuevas.
- La caída temporal (~30 % respecto a la partición aleatoria) sugiere deriva entre años (cambios de
  registro y de patrones).
- Clases mejor detectadas (partición aleatoria): `robo` 0.31, `homicidio por paf` 0.29,
  `asalto y robo de vehículos` 0.26. Peores: `robo frustrado` 0.05 (pocos ejemplos), `estafa` 0.17.

## 6. Uso responsable

- Presentar siempre el resultado como **composición relativa esperada de modalidades**, nunca como
  "nivel de peligro" de un barrio o de sus habitantes.
- No usar para decisiones de vivienda, seguros, crédito, vigilancia individual ni asignación de
  patrullaje sin revisión humana y estudios complementarios.
- Acompañar las visualizaciones con el tamaño de muestra, intervalo de confianza o nota de
  incertidumbre, y con el aviso de sesgo de denuncia.
- Evitar estética alarmista (rojo = peligro) aplicada a estimaciones aproximadas o a modelos con exactitud ~0.2.

## 7. Relación con el modelo heredado

El proceso del servicio de predicción (`functions/crime_ml/pipeline.py`) sigue soportando la tarea
heredada con `FEATURES`/`TARGET` por defecto, cuyas etiquetas eran una función determinista del
tipo de delito (circularidad detectada en la auditoría). Ese camino queda como compatibilidad
histórica; **este model card y el proceso de datos offline son la referencia metodológica del proyecto**.
Desde la Fase 4, el clasificador de modalidad se sirve a través de `predict_crime` (las 5 clases más
probables) y la pestaña «Modelo de modalidad» de la UI; que funcione en la nube depende del
despliegue (ver `docs/DEPLOY.md`).

## 8. Reproducibilidad

```bash
python scripts/pipeline/ingest_inei.py --years 2021 2022 2023 2024 2025
python scripts/pipeline/train.py --split random
python scripts/pipeline/train.py --split temporal
python scripts/pipeline/train.py --split district
```

Cada JSON de métricas incluye fecha, hash SHA-256 de los datos, versiones de Python/pandas/
scikit-learn y la configuración de la partición. Los datos completos (`data/processed/incidents_lima.csv`)
son regenerables y no se versionan; sí se versionan la muestra de 500 filas, el reporte de calidad y
las métricas. Pruebas automáticas del proceso de datos: `python -m pytest functions/tests`.

## 9. Próximos pasos

1. Añadir denominadores (población, área, comercios) para estimar incidencia relativa en lugar de
   composición, y validar la geocodificación de la fuente.
2. Incorporar más señales espaciales (grillas, uso de suelo, avenidas) para mejorar la
   generalización geográfica antes de cualquier uso territorial.
3. Conectar el modelo a `predict_crime` (Fase 4) con contrato validado y mostrar probabilidades
   calibradas, no solo la clase.
4. Reentrenar periódicamente y registrar la deriva temporal observada en la partición 2021–23 → 2024.
