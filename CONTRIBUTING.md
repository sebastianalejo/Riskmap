# Contribuir a Riskmap

Gracias por el interés. Este documento resume el flujo de trabajo y la verificación
esperada antes de subir cambios.

## Requisitos

- Node.js 22+ y npm (frontend y scripts de datos).
- Python 3.11+ (el servicio de predicción, el proceso de datos, pruebas).
- Java 17+ (solo para los emuladores de Firebase).
- Firebase CLI (`npm i -g firebase-tools`).

## Puesta en marcha

```bash
# Frontend
cd frontend
npm ci
cp .env.example .env.local        # o usa public/firebase-config.json (no versionado)

# Funciones (incluye pruebas)
python -m venv functions/venv
functions/venv/Scripts/pip install -r functions/requirements-dev.txt   # Windows
# source functions/venv/bin/activate && pip install -r functions/requirements-dev.txt  # Linux/macOS
```

## Verificación antes de un PR

| Qué | Comando |
|---|---|
| Lint del frontend | `cd frontend && npm run lint` |
| Pruebas del frontend | `cd frontend && npm test` |
| Compilación del frontend | `cd frontend && npm run build` |
| Pruebas de la API y del ML | `python -m pytest functions/tests tests/pipeline -q` |
| Ingesta de la serie mensual de denuncias oficiales | `python scripts/pipeline/ingest_sidpol.py --refresh --upload` |
| Subida de incidentes sin duplicados (detecta esquema clásico o v2) | `python scripts/pipeline/upload_incidents.py --verify` |
| Rellenado del origen (`source`) en documentos antiguos | `python scripts/pipeline/upload_incidents.py --backfill-source modalidad --verify` |
| Puntos de datos oficiales adicionales (esquema clásico) | `python scripts/pipeline/ingest_inei_legacy.py --year 2022` |
| Mapa de distritos por color (GeoJSON) | `python scripts/pipeline/build_geo.py` |
| Reglas de la base de datos (emulador) | `firebase emulators:exec --only firestore --project demo-riskmap "node tests/firestore/firestore.rules.test.mjs"` |
| API de punta a punta (emuladores) | `firebase emulators:exec --only auth,firestore,functions --project demo-riskmap "python tests/functions/e2e_functions.py"` |
| Proceso de datos y ML | `python scripts/pipeline/ingest_inei.py` · `python scripts/pipeline/train.py --split temporal` |

La CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) ejecuta lint, pruebas de Vitest,
compilación, pytest y las pruebas de reglas en cada push/PR.

## Convenciones

- **Commits** en español, en imperativo y con contexto: `Fase N: <resultado>` o
  `<área>: <cambio>`. Un commit por unidad de trabajo verificable.
- **Secretos**: nunca subir `functions/.env`, `frontend/.env.local`,
  `frontend/public/firebase-config.json` ni claves de servicio. La apiKey web de Firebase
  es pública pero debe restringirse por dominio en la consola.
- **Permisos**: las reglas de la base de datos exigen permiso de administrador para escribir; las pruebas
  de reglas son la fuente de verdad del comportamiento esperado.
- **Modelos y datos**: el conjunto de datos completo y los modelos entrenados no se versionan
  (ver `data/README.md`); se regeneran con `scripts/pipeline/`. Los cambios de esquema o de
  etiqueta deben reflejarse en `MODEL_CARD.md`.
- **Documentación**: si cambias contratos de la API, actualiza `README.md` (§7) y
  `docs/DEPLOY.md`; si cambias el diseño visual, `docs/design/DESIGN.md`.
