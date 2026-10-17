# Guía de despliegue (proyecto Firebase nuevo)

Runbook para desplegar Riskmap en un proyecto Firebase propio. La Fase 4 dejó
todo el backend y el frontend listos para producción; esta guía cubre solo la
puesta en marcha (nada de esto se ejecuta automáticamente).

> Estado actual del repo: `.firebaserc` apunta al proyecto anterior. Al crear tu
> proyecto, reemplázalo con `firebase use --add`.

## 0. Resumen

```
Crear proyecto → habilitar Auth → config web en frontend → claim admin →
desplegar reglas → desplegar Functions (con CORS) → entrenar y publicar modelo →
desplegar Hosting → verificar
```

## 1. Proyecto y plan

1. Crea el proyecto en <https://console.firebase.google.com> (p. ej. `riskmap-tu-nombre`).
2. **Firestore Database → crear base de datos** en modo producción (región `us-central1` o la
   más cercana). Necesario antes de desplegar reglas o Functions.
3. **Authentication → activar Correo electrónico/contraseña**. Crea el usuario administrador
   inicial desde la consola (no hay registro público: las demás cuentas se crean desde la app,
   sección **Usuarios**, con una cuenta que tenga el claim `admin`).
4. Acepta el plan **Blaze** (necesario para Functions) y configura una **alerta de presupuesto**
   en Google Cloud → Facturación → Presupuestos (p. ej. 5 USD).
5. Inicia sesión en el CLI **con la cuenta dueña del proyecto nuevo**. Si ya tienes otra cuenta
   logueada (p. ej. la del proyecto anterior), usa:

   ```bash
   firebase login:add        # añade la cuenta nueva sin cerrar la anterior
   firebase login:list       # verifica cuál está activa
   ```

6. En este repo: `firebase use --add` → elige el proyecto nuevo y ponle el alias `default`
   (así `firebase deploy` funciona sin `--project`). Esto actualiza `.firebaserc`: commitéalo.

## 2. Configuración web del frontend

Consola → Configuración del proyecto → tus apps → **app web** → `firebaseConfig`.
Copia `frontend/.env.example` a `frontend/.env.local` y rellena:

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
# Origen de Functions del proyecto nuevo:
VITE_FIREBASE_FUNCTIONS_ORIGIN=https://us-central1-TU_PROYECTO.cloudfunctions.net
# Opcional (App Check):
# VITE_FIREBASE_APPCHECK_SITE_KEY=...
# Opcional (Google Maps):
# VITE_GOOGLE_MAPS_API_KEY=...
```

Alternativa sin variables: `frontend/public/firebase-config.json` (está en `.gitignore`).
Restringe la apiKey web por dominio (HTTP referrers: todo `*.web.app`, `*.firebaseapp.com`
y `localhost`) y rota la clave antigua.

## 3. Claim admin (antes de las reglas)

Las reglas exigen el claim `admin` para escribir. Opción A (recomendada si tienes `gcloud`):

```bash
gcloud auth application-default login          # cuenta dueña del proyecto nuevo
python scripts/set-admin-claim.py tu-correo@ejemplo.com
firebase deploy --only firestore:rules
```

Opción B (sin `gcloud`): crea una **clave de cuenta de servicio** en Google Cloud → IAM →
Cuentas de servicio (rol `Firebase Admin SDK Administrator Service Agent`), guárdala fuera del
repo y usa:

```bash
# PowerShell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\ruta\fuera\del\repo\clave-servicio.json"
python scripts/set-admin-claim.py tu-correo@ejemplo.com
firebase deploy --only firestore:rules
```

> No subas la clave al repositorio. Bórrala cuando termines.

Cierra sesión y vuelve a entrar en la web para que el claim llegue al ID token.

## 4. Cloud Functions

Opciones de entorno (se leen de `functions/.env` en el deploy; ese archivo no se versiona —
hay una plantilla en `functions/.env.example`):

```bash
# functions/.env  ← copiar de functions/.env.example y completar con el proyecto nuevo
CORS_ORIGINS=https://TU_PROYECTO.web.app,https://TU_PROYECTO.firebaseapp.com,http://localhost:5173
# ENFORCE_APP_CHECK=true        # solo tras registrar App Check (paso 6)
# INCIDENTS_COLLECTION=crime_incidents
# ML_PARTS_COLLECTION=ml_model_parts
```

> **Importante:** el valor por defecto de `CORS_ORIGINS` solo permite desarrollo local.
> Si despliegas Functions sin definir tus dominios de Hosting aquí, el navegador bloqueará
> las llamadas a la API (la app mostrará el modo de estimación local).

```bash
firebase deploy --only functions
```

El runtime es `python311` (definido en `firebase.json`) y el CLI no sube `functions/venv/`
(está en `.gitignore`), por lo que el despliegue es ligero.

Endpoints expuestos (todos usan el ID token de Firebase; `train_model` y `publish_model`
requieren además el claim admin):

| Endpoint | Descripción |
|---|---|
| `GET prediction_health` | Estado del modelo publicado (público). |
| `POST predict_crime` | Top-5 de modalidades con probabilidad (modelo de la Fase 3). |
| `POST train_model` | Entrena en la nube (dataset inline o colección). Solo admin. |
| `POST publish_model` | Publica un `.joblib` del pipeline offline. Solo admin. |
| `POST import_incidents` / `import_csv_dataset` | Ingesta validada. Solo admin. |
| `POST create_user` | Crea cuentas de Firebase Auth (nombre, correo y contraseña temporal). Solo admin. |
| `GET list_users` | Lista cuentas con rol, estado y actividad. Solo admin. |
| `GET inei_datacrim_aggregate` / `inei_arcgis_points` | Proxies INEI (CORS). |

## 5. Modelo de predicción

Recomendado (pipeline offline de la Fase 3, artefacto con verificación local):

```bash
python scripts/pipeline/ingest_inei.py --years 2021 2022 2023 2024   # si no lo hiciste
python scripts/pipeline/train.py --split temporal
python scripts/publish_model.py ^
  --origin https://us-central1-TU_PROYECTO.cloudfunctions.net ^
  --api-key TU_WEB_API_KEY --email tu-correo@ejemplo.com --password "..." ^
  --artifact models/processed/crime_modality_model.joblib ^
  --metrics models/reports/metrics_temporal.json
```

Alternativa en la nube: `POST train_model` (solo admin) con `dataset` inline y
`task = {features, target, split}` (ver el GET del endpoint para el contrato).

Verificación: `GET .../prediction_health` debe devolver `status: "ok"` con `model_run`.

## 6. App Check (opcional, recomendado)

1. Consola → **App Check** → registra la app web con **reCAPTCHA v3** (obtén la site key).
2. Frontend: define `VITE_FIREBASE_APPCHECK_SITE_KEY` (o `appCheckSiteKey` en el JSON) y
   recompila.
3. `functions/.env`: añade `ENFORCE_APP_CHECK=true` y vuelve a desplegar Functions.
4. Verifica que un cliente sin token de App Check recibe 401 en los endpoints.

## 7. Hosting

Antes de compilar, publica el dataset estático (mapa, análisis, serie mensual y conteos de
predicción local); es lo que consumen esas pantallas en lugar de Firestore:

```bash
python scripts/pipeline/export_web_data.py
python scripts/pipeline/export_web_data.py --check   # valida manifest y archivos

cd frontend
npm run build
cd ..
firebase deploy --only hosting
```

> Si importaste datos desde `/datos` (Firestore), repite el export para que aparezcan en la app.

## 8. Verificación rápida (con un usuario autenticado)

```bash
# Estado del modelo (público)
curl https://us-central1-TU_PROYECTO.cloudfunctions.net/prediction_health

# Predicción (requiere ID token; el más simple es la propia web en /prediccion)
curl -X POST https://us-central1-TU_PROYECTO.cloudfunctions.net/predict_crime ^
  -H "Authorization: Bearer ID_TOKEN" -H "Content-Type: application/json" ^
  -d "{\"district\":\"LA VICTORIA\",\"latitude\":-12.071,\"longitude\":-77.02}"
```

En la web: pestaña **Predicción → Modelo de modalidad** (ranking con probabilidades) y
**Estimación local** como respaldo. La primera solo funciona con Functions desplegadas.

## 9. Ratios de seguridad ya activos (Fase 1–4)

- Reglas Firestore: lectura autenticada; escritura/borrado solo admin con validación de esquema.
- ID tokens verificados con `check_revoked=True`.
- CORS con allowlist (`CORS_ORIGINS`), sin comodín por defecto.
- Validación de payloads en todos los endpoints (tipos, rangos, tamaños).
- Artefacto ML versionado por run con swap atómico y candado de entrenamiento.
- Logs con `request_id`, estado y duración por petición (Cloud Logging).
