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
