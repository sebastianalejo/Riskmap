# Datos del proyecto

## Estructura

```
data/
├── taxonomy/
│   └── crime_taxonomy.json        # Taxonomía declarada: modalidad → gravedad + macro (Fase 3)
├── processed/                     # Generado por el pipeline (Fase 3)
│   ├── incidents_lima.csv         # Dataset canónico completo (NO versionado; regenerable)
│   ├── incidents_lima_sample_500.csv  # Muestra estratificada de 500 filas (versionada)
│   └── quality_report.json        # Cobertura del muestreo, deduplicación, filtros y avisos
└── raw/                           # Descargas puntuales del INEI DataCrime (heredado)
```

## Fuente

- **INEI DataCrime — MapServer ArcGIS**: `arcgis3.inei.gob.pe` (capas "Modalidad de delito YYYY").
- La fuente **no publica la fecha del hecho**; la resolución temporal real es el **año** (grupo de
  capas). Tampoco publica hora ni día. Por eso el pipeline **no fabrica** esas columnas.

## Dataset canónico (`incidents_lima.csv`)

| Columna | Tipo | Descripción |
|---|---|---|
| `occurred_year` | int | Año del registro (grupo de capas INEI) |
| `district` | str | Distrito canónico (mayúsculas), normalizado por ubigeo |
| `ubigeo` | str(6) | Código ubigeo (puede venir vacío en algunas capas; **leer como texto**: conserva ceros a la izquierda, p. ej. Callao `070101`) |
| `crime_type` | str | Modalidad normalizada (minúsculas, 15 clases) |
| `macro_category` | str | Macro categoría del campo `GENERICO` de la fuente |
| `severity_level` | str | `baja` / `media` / `alta` — **declarada** en la taxonomía, no observada |
| `latitude`, `longitude` | float | Coordenadas WGS84 del punto (denuncia geocodificada) |

Cobertura del muestreo 2021–2024: **5 977 filas**, 49 distritos, 15 modalidades
(2021: 1 584 · 2022: 1 594 · 2023: 1 158 · 2024: 1 641). Detalles completos en
`quality_report.json`.

## Regenerar

Desde la raíz del repositorio:

```bash
python scripts/pipeline/ingest_inei.py --years 2021 2022 2023 2024
```

El script descubre las capas dinámicamente (los IDs cambian con el tiempo), resuelve los campos
por capa (el esquema varía por año), muestrea por ventanas aleatorias con semilla, deduplica,
filtra al ámbito Lima Metropolitana + Callao (ubigeo `1501`/`0701`) y canonicaliza el nombre del
distrito. Requiere pandas y conexión a internet; verifica el certificado TLS.

## Hallazgos de calidad (ver `quality_report.json`)

- **Etiquetas inconsistentes en la fuente:** existen filas con coordenadas limeñas y nombres de
  distrito de otras provincias (Chiclayo, Trujillo…), y ubigeos incoherentes con el nombre
  (p. ej. `150113` con "CHILCA"). El pipeline las filtra o canonicaliza; se descartaron 262 filas
  fuera de ámbito en el muestreo 2021–2024.
- **Cambios de esquema por año:** 2016–2022 exponen `X`/`Y` y `UBIGEO`; 2023 pierde `UBIGEO`;
  2024 usa `x`/`y` en minúsculas y `ubigeo_hecho` (además, los valores de ubigeo son texto).
- **Duplicados:** 401 filas retiradas por id de denuncia o coincidencia geográfica.
- **El script legado `scripts/fetch-real-data.js`** descargaba el grupo 107-121 rotulado como
  "2022", que en realidad es **2021** (corregido en la Fase 3; los IDs de 2022 son 123-137).

## Notas de uso

- Leer el CSV con `dtype={"ubigeo": str}` para conservar los ceros a la izquierda.
- `incidents_lima.csv` no se versiona (regenerable); la muestra de 500 filas sí, para demos y
  pruebas sin red.
- Los datos son denuncias públicas del INEI: no contienen información personal, pero describen
  lugares concretos; evitar publicaciones que estigmaticen zonas (ver `MODEL_CARD.md` §6).

## Serie mensual SIDPOL (Oleada 1)

Segunda fuente, independiente de los puntos del INEI:

- **Origen**: MININTER — "Denuncias policiales registradas a nivel nacional" (SIDPOL), Portal de
  Datos Abiertos. Columnas reales: año, mes, departamento, provincia, **distrito**, ubigeo,
  **modalidad** y cantidad.
- **Cobertura descargada**: 2018 – hoy (la fuente se actualiza mensualmente), filtrada a Lima
  Metropolitana y Callao.
- **Salidas**: `data/processed/sidpol_monthly_lima.csv` (aplanado, versionable) y
  `data/processed/sidpol_quality_report.json`. El crudo (26 MB) va a `data/raw/sidpol/`
  (no versionado).

```bash
python scripts/pipeline/ingest_sidpol.py --refresh --upload
```

- **Diseño anti-duplicados**: un documento por `(año, mes, ubigeo)` en la colección
  `crime_stats_monthly` con **ID determinista `AAAA-MM-UBIGEO`** y escritura `set()` (upsert).
  Re-ejecutar la ingesta sobreescribe los mismos documentos; verificado: 5 141 documentos tras
  dos ejecuciones consecutivas.
- **Uso en la app**: tarjeta "Tendencia mensual" en Resumen y Mapa (barras apiladas por
  modalidad, filtro por distrito y periodo) y sección de tendencia del PDF.
- **Limitación**: son denuncias registradas (subregistro y sesgo territorial), no victimización
  real; y al ser agregado distrito-mes no incluye hora ni día.

## Incidentes idempotentes (sin duplicados)

`crime_incidents` usa **ID determinista por contenido** (FNV-1a 64 sobre la fila normalizada,
`inc_<hex>`) tanto en la interfaz (`frontend/src/utils/stableId.ts`) como en el pipeline
(`scripts/pipeline/upload_incidents.py`), con pruebas de paridad en JS y Python. Reimportar el
mismo archivo actualiza los mismos documentos; la migración inicial fusionó 1 fila duplicada del
CSV (1 000 filas → 999 documentos).

## Puntos INEI adicionales (Fase A)

```bash
python scripts/pipeline/ingest_inei_legacy.py --year 2022 --per-modality 320
python scripts/pipeline/upload_incidents.py --csv data/raw/inei/points_2022_legacy.csv --verify
```

- Descarga ~4 100 puntos reales del grupo 2022 (capas 123-137, descubiertas dinámicamente) con el
  **esquema clásico** de 8 columnas, filtrando por ubigeo (1501/0701) y nombre canónico.
- `hour` y `day_of_week` se derivan **determinísticamente del ID de denuncia** (mismo punto →
  mismos valores → la subida es idempotente); `historical_frequency` usa la **media mensual real de
  SIDPOL** del distrito y modalidad (no tablas inventadas); `risk_level` es la severidad declarada.
- Estado de la colección: **5 179 documentos** (999 previos + 4 180 únicos; 41 filas con contenido
  duplicado se fusionaron solas).
- Cupo: el plan gratuito permite 20 000 escrituras/día; no conviene encadenar muchas migraciones
  el mismo día (la re-verificación puede devolver `429`).

## Capa coroplética por distrito (Fase B)

```bash
python scripts/pipeline/build_geo.py
```

- Genera `frontend/public/geo/lima_distritos.geojson` (50 distritos, ~35 KB): fuente nacional
  simplificada + **parche vía Nominatim (OSM/ODbL)** para los 3 distritos ausentes (La Punta,
  Mi Perú y Santa Anita — este último tenía geometría nula en la fuente; SMP sí venía, es 150135).
- En el mapa: selector **«Puntos | Distritos»**. La coropleta usa `crime_stats_monthly` dentro del
  periodo elegido, con leyenda, tooltip por distrito (total + modalidad dominante) y aviso de
  que son valores absolutos.
- **Pendiente (requiere aprobación de fuente)**: población distrital para tasas por 100 000 hab.
  No existe dataset en el portal de datos abiertos; la vía es el XLSX de proyecciones del INEI o
  el Censo 2017. Documentar como aproximación si se usa el censo.

## Esquema v2: puntos INEI 2021-2024 (con año y severidad)

```bash
python scripts/pipeline/upload_incidents.py --csv data/processed/incidents_lima.csv --verify
```

- `upload_incidents.py` **detecta el esquema** del CSV: si trae `occurred_year` y `severity_level`
  usa el esquema v2 (núcleo `crime_type`, `district`, `latitude`, `longitude` + `occurred_year`,
  `severity_level`, `macro_category` y `source="inei"`); si no, el clásico de 8 columnas.
- IDs deterministas propios (`arc_<hex>`, FNV-1a 64 sobre las 8 claves v2): reimportar **no
  duplica**. La app colorea por severidad (alta→alto, media→medio, baja→bajo), habilita el
  **filtro por año** y muestra el año en los popups.
- Las reglas de Firestore siguen exigiendo el esquema clásico para escrituras **desde el
  navegador**; los documentos v2 los escribe el pipeline con el Admin SDK y no pasan por reglas
  (la lectura sí está cubierta por `isSignedIn`).

### Publicación de datos (JSON) y consultas del mapa

- El frontend **ya no consulta `crime_incidents`** para el mapa/análisis/resumen: el pipeline
  publica `frontend/public/data/*.json` con IDs deterministas (sin duplicados) y el navegador
  filtra en memoria. Esto elimina el tope de 10 000 por consulta y las 50 000 lecturas/día del
  plan Spark.
- Fuentes publicadas: `data/raw/inei/points_2022_legacy.csv` (fuente `modalidad`) y
  `data/processed/incidents_lima.csv` (esquema v2, fuente `inei`). El exportador deduplica por
  contenido; el detalle de filas leídas/válidas queda en `frontend/public/data/export_report.json`.
- Regenerar y desplegar:

  ```bash
  python scripts/pipeline/export_web_data.py
  cd frontend && npm run build && cd ..
  firebase deploy --only hosting
  ```

  `python scripts/pipeline/export_web_data.py --check` valida el manifest y los archivos
  (también se ejecuta en CI).
- Firestore sigue siendo el **borrador** de importación (`/datos`): lo importado ahí no aparece
  en la app hasta publicar el dataset.

### Estado de las cargas pendientes (cupo diario agotado)

```bash
# 1) backfill de fuente (una vez)   2) subida v2
python scripts/pipeline/upload_incidents.py --backfill-source modalidad --verify
python scripts/pipeline/upload_incidents.py --csv data/processed/incidents_lima.csv --verify
```

Ambos son **idempotentes** y pueden repetirse sin riesgo. Se pospusieron porque el plan gratuito
agota sus cuotas diarias (20 000 escrituras / 50 000 lecturas); hasta entonces la app funciona
igual: sin backfill, la opción «Modalidad» del filtro aparece vacía y el filtro por año no se
muestra (no hay documentos con `occurred_year`).
- **Estado de la subida**: pendiente del reinicio del cupo diario del plan gratuito
  (20 000 escrituras y 50 000 lecturas por día; hoy se consumieron con las migraciones).
  Ejecutar el comando tras la medianoche del Pacífico; es idempotente y puede repetirse sin riesgo.
  Mientras tanto, la app funciona igual: el filtro por año simplemente no aparece hasta que
  existan documentos con `occurred_year`.
