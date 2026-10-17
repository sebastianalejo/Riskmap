# Riskmap — Predicción de riesgo criminal (Lima Metropolitana)

Aplicación web para **visualizar incidentes de delitos**, **importar datasets** y **estimar el nivel de riesgo criminal** (`bajo` / `medio` / `alto`) en los distritos de Lima y Callao.

El proyecto es un **monorepo** con dos piezas:

- **`frontend/`** — SPA en React + Vite desplegada en **Firebase Hosting**.
- **`functions/`** — API opcional en **Cloud Functions (Python)** con un modelo **Random Forest** de scikit-learn.

Todo el estado compartido vive en **Firestore** (base de datos NoSQL de Firebase), y la autenticación se hace con **Firebase Authentication** (correo y contraseña).

---

## 1. Stack de tecnologías

### Frontend (`frontend/`)

| Tecnología | Uso en el proyecto |
|------------|--------------------|
| **React 19** | UI por componentes. |
| **TypeScript** | Tipado estático de todo el frontend. |
| **Vite** | Servidor de desarrollo y build (`tsc -b && vite build`). |
| **Tailwind CSS 4** (plugin `@tailwindcss/vite`) | Estilos utilitarios. |
| **React Router 7** | Rutas: `/login`, `/` (resumen), `/analisis` (analista), `/prediccion`, `/mapa`; solo admin: `/datos` (importar datos) y `/usuarios`. |
| **Firebase JS SDK 11** | `Auth` (login), `Firestore` (lectura/escritura de incidentes). |
| **Leaflet + react-leaflet** | Mapa de riesgo por defecto (no requiere API key). |
| **@react-google-maps/api** | Mapa alternativo si se define una Google Maps API key. |
| **lucide-react** | Iconografía. |
| **xlsx (SheetJS)** | Importación de archivos `.xlsx`, `.xls` y `.csv`. |
| **jsPDF** | Exportación de reportes en PDF. |
| **Recharts 3** | Gráficos del módulo Análisis (barras horizontales, apiladas al 100 % y ranking). |
| **PapaParse** | Serialización CSV de la exportación del módulo Análisis. |

### Backend / datos

| Tecnología | Uso en el proyecto |
|------------|--------------------|
| **Firebase Hosting** | Sirve el SPA compilado desde `frontend/dist`. |
| **Cloud Firestore** | Colecciones `crime_incidents` (datos) y `ml_model_parts` (modelo troceado). |
| **Firebase Authentication** | Login con correo y contraseña (ID tokens para la API). |
| **Cloud Functions Gen 2 (Python)** | API HTTP: predecir, entrenar, importar y hacer de proxy hacia INEI DataCrime. |
| **firebase-functions / firebase-admin** | Runtime y acceso administrativo a Firestore. |
| **scikit-learn** | `RandomForestClassifier` dentro de un `Pipeline` (OneHotEncoder + RandomForest). |
| **pandas / numpy / joblib** | Manipulación de datos y serialización del modelo (`.joblib`). |
| **Firebase CLI** | Despliegue de Hosting, Firestore y Functions. |

### Scripts de datos (`scripts/`)

| Script | Qué hace |
|--------|----------|
| `node scripts/generate-csv.js` | [LEGACY] Genera un dataset **sintético** de 1 900 filas (`crime_incidents_lima_1900.csv`). |
| `node scripts/fetch-real-data.js` | [LEGACY] Descarga 1 000 puntos del grupo INEI 2022 (IDs corregidos en la Fase 3). Ubicación/distrito son reales; `hour`, `day_of_week`, `historical_frequency` y `risk_level` se derivan por reglas (ver §12). |
| `python scripts/pipeline/ingest_inei.py` | **Pipeline reproducible (Fase 3, recomendado)**: descarga real 2021–2024 con descubrimiento dinámico de capas, filtro Lima/Callao y reporte de calidad → `data/processed/`. |
| `python scripts/pipeline/train.py --split temporal` | Entrena el clasificador de modalidad (splits `random`/`temporal`/`district`) y guarda métricas en `models/reports/`. Ver [`MODEL_CARD.md`](MODEL_CARD.md). |
| `python scripts/pipeline/ingest_sidpol.py --refresh --upload` | **Serie mensual real (Oleada 1)**: denuncias SIDPOL/MININTER por distrito y modalidad (2018–hoy) → `crime_stats_monthly` en Firestore (ID determinista, sin duplicados). |
| `python scripts/pipeline/upload_incidents.py --replace --verify` | Sube incidentes del CSV con **ID determinista por contenido** (reimportar no duplica; fusiona filas repetidas). |

---

## 2. Arquitectura

```
┌────────────────────────────┐        ┌──────────────────────────────┐
│   Navegador (React SPA)     │        │  Firebase Cloud Functions     │
│  React + Vite + Tailwind    │        │  (Python, Gen 2, opcional)    │
│                             │        │                               │
│  Auth (login)  ─────────────┼───────▶│  predict_crime                │
│  Firestore (lectura) ───────┼───┐    │  train_model                  │
│  localPredict (heurística)  │   │    │  import_incidents / _csv      │
│  Mapa Leaflet / Google Maps │   │    │  inei_datacrim_aggregate      │
│  Importar CSV/Excel (xlsx)  │   │    │  inei_arcgis_points           │
└────────────────────────────┘   │    └───────────────┬───────────────┘
                                  │                    │ Admin SDK
                                  ▼                    ▼
                         ┌──────────────────────────────────────┐
                         │             Firestore                 │
                         │  crime_incidents   (delitos)          │
                         │  ml_model_parts    (modelo .joblib)   │
                         └──────────────────────────────────────┘
```

**Nota importante:** la pantalla **Predicción** tiene dos modos: **Modelo de modalidad** (llama a
`predict_crime` y muestra las top-5 modalidades con probabilidad — requiere Cloud Functions
desplegadas) y **Estimación local** (`frontend/src/ml/localPredict.ts`: consulta Firestore y
aplica una heurística de respaldo). Las Cloud Functions necesitan plan **Blaze**; sin ellas, la
app sigue funcionando para login, mapa, importación de datos y estimación local.

---

## 3. Estructura del repositorio

```
Tesis-main/
├── frontend/                      # Aplicación React + Vite
│   ├── public/
│   │   ├── firebase-config.example.json   # Plantilla de configuración web
│   │   └── firebase-config.json           # Config real local (ignorada por git desde la Fase 1;
│   │                                      #  antes estaba versionada → conviene rotar la apiKey)
│   ├── src/
│   │   ├── api/client.ts          # Cliente fetch con ID token de Firebase
│   │   ├── components/            # AppShell, ProtectedRoute, mapa, PDF, gráficos
│   │   ├── config/api.ts          # Mapeo ruta → nombre de Cloud Function
│   │   ├── context/AuthContext.tsx# Estado de sesión (Firebase Auth)
│   │   ├── data/sampleIncidents.ts# 38 distritos, 10 tipos de delito, generador
│   │   ├── firebase/client.ts     # Inicialización del SDK (env o JSON)
│   │   ├── hooks/                 # Lectura de incidentes (mapa y análisis) y serie SIDPOL
│   │   ├── ml/localPredict.ts     # Predicción local (Firestore + heurística)
│   │   ├── pages/                 # Login, Home, Análisis, Predict, Map, Data, Users
│   │   └── utils/                 # Errores de Auth, serie mensual, IDs estables, análisis
│   ├── .env.example
│   └── package.json
├── functions/                     # Cloud Functions (Python)
│   ├── main.py                    # Endpoints HTTP
│   ├── crime_ml/pipeline.py       # Pipeline scikit-learn (FEATURES / TARGET)
│   ├── crime_ml/validation.py     # Validación de payloads de la API (Fase 1)
│   ├── tests/                     # Pruebas pytest de validation.py
│   └── requirements.txt
├── scripts/                       # Generación / descarga de datasets
├── tests/firestore/               # Pruebas de firestore.rules con el emulador
├── data/raw/                      # Datos crudos (INEI DataCrime, top10)
├── crime_incidents_lima_real_1000.csv   # Dataset real de ejemplo
├── firebase.json                  # Hosting (frontend/dist), Firestore, Functions
├── firestore.rules                # Reglas de seguridad
├── firestore.indexes.json         # Índices compuestos
└── .firebaserc                    # Proyecto Firebase por defecto (riskmap-2fb0f)
```

---

## 4. Requisitos previos

- **Node.js 20+** (recomendado 22) y **npm**.
- **Python 3.11+** (solo si vas a trabajar con `functions/`).
- **Firebase CLI**: `npm install -g firebase-tools` (solo para desplegar o emular).
- **Cuenta Google** con un proyecto Firebase.
  - **Plan Spark** (gratis): Hosting + Firestore + Auth.
  - **Plan Blaze** (pago por uso): necesario para **desplegar Cloud Functions**.

> En Windows, si `npm` o `firebase` fallan por **política de ejecución de PowerShell**, usa `npm.cmd` /
> `firebase.cmd`, o ejecuta una vez: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (ver §10).

---

## 5. Puesta en marcha en local (frontend)

### 5.1 Instalar dependencias

```bash
cd frontend
npm ci          # o: npm install
```

### 5.2 Configurar el SDK de Firebase (elige una opción)

El frontend necesita el objeto `firebaseConfig` de la **app web** del proyecto (Consola Firebase →
Configuración del proyecto → tus apps → app web). El **UID de usuario no sustituye** esta configuración.

**Opción A — variables de entorno Vite**

```bash
cd frontend
cp .env.example .env.local
# Rellena VITE_FIREBASE_* y, opcionalmente, VITE_FIREBASE_FUNCTIONS_ORIGIN
```

**Opción B — JSON en `public/` (sin prefijo `VITE_`, útil para Hosting)**

```bash
cd frontend/public
cp firebase-config.example.json firebase-config.json
# Pega aquí el firebaseConfig real. Opcionales: functionsOrigin y mapsApiKey
```

- Si omites `functionsOrigin`, se deriva `https://us-central1-<projectId>.cloudfunctions.net`.
- Si defines `mapsApiKey`, el mapa usa **Google Maps**; si no, usa **Leaflet**.

> `frontend/public/firebase-config.json` está en `.gitignore` desde la Fase 1 (antes estaba
> versionado en el repositorio). Contiene la apiKey web del proyecto: es un identificador público
> de Firebase, pero conviene restringirla por dominio (HTTP referrers) en la consola y no volver
> a subirla a Git.

### 5.3 Crear usuarios para iniciar sesión

En la Consola Firebase → **Authentication** → activa **Correo electrónico/Contraseña** y crea el
primer usuario (administrador). Ese usuario necesita el claim `admin` (ver §9.1) para poder crear
más cuentas y ver las existentes desde la app en la sección **Usuarios** (`/usuarios`), que llama a
las Cloud Functions `create_user` (nombre, correo y contraseña temporal) y `list_users` (rol,
estado y actividad de cada cuenta). No hay registro público: todas las cuentas las crea un
administrador. Esas credenciales son las que se usan en `/login`.

### 5.4 Levantar el servidor de desarrollo

```bash
cd frontend
npm run dev
```

Abre **http://localhost:5173** (Vite cambia a `5174`, `5175`… si el puerto está ocupado).
Inicia sesión y navega por **Resumen**, **Análisis**, **Predicción** y **Mapa de riesgo**.
Las cuentas con claim `admin` ven además la sección **Administración** (**Importar datos** y
**Usuarios** para crear nuevas cuentas).

### 5.5 Otros comandos del frontend

```bash
npm run build     # Compila a frontend/dist (tsc + vite build)
npm run preview   # Sirve el build de producción localmente
npm run lint      # ESLint
```

---

## 6. Cargar datos

La app lee/escribe la colección **`crime_incidents`** de Firestore. Puedes poblarla de dos formas:

**a) Desde la interfaz** — página **Importar datos** (sección **Administración**, visible solo para
cuentas con el claim **`admin`**, §9.1): sube un `.xlsx`, `.xls` o `.csv`, o pega un array JSON.
Columnas obligatorias:

```
crime_type, hour, day_of_week, district, latitude, longitude, historical_frequency, risk_level
```

donde `risk_level` ∈ `bajo | medio | alto`.

**b) Con los scripts** (genera/descarga el CSV y luego súbelo desde la interfaz):

```bash
# Dataset sintético (1 900 filas)
node scripts/generate-csv.js

# Dataset real del INEI DataCrime (1 000 filas, requiere internet)
node scripts/fetch-real-data.js
```

### 6.1 Pipeline reproducible (Fase 3, recomendado)

Ingesta real + entrenamiento, sin fabricar campos y con validación temporal y geográfica:

```bash
python scripts/pipeline/ingest_inei.py --years 2021 2022 2023 2024
python scripts/pipeline/train.py --split random
python scripts/pipeline/train.py --split temporal
python scripts/pipeline/train.py --split district

# Serie mensual real (SIDPOL/MININTER) para la tendencia del panel (Oleada 1):
python scripts/pipeline/ingest_sidpol.py --refresh --upload

# Incidentes desde el CSV con IDs deterministas (idempotente, sin duplicados):
python scripts/pipeline/upload_incidents.py --replace --verify
```

Salidas: `data/processed/incidents_lima.csv` (no versionado, regenerable), muestra versionable de
500 filas, `data/processed/quality_report.json` y métricas por régimen en `models/reports/`.
Documentación: [`data/README.md`](data/README.md) y [`MODEL_CARD.md`](MODEL_CARD.md).

> Hallazgos de la auditoría que explican este diseño: la fuente **no publica la fecha del hecho**
> (solo el año, por grupo de capas), sus **IDs de capa cambian** (el script legado descargaba 2021
> etiquetado como 2022) y sus **etiquetas de distrito/ubigeo son inconsistentes** (la ingesta
> filtra al ámbito Lima/Callao y canonicaliza por ubigeo).

---

## 7. Cloud Functions (API de Machine Learning) — opcional

Lógica en `functions/crime_ml/` (`pipeline.py` de ML, `validation.py` de payloads, `artifacts.py` del
almacén versionado) y endpoints en `functions/main.py`.
Todas las rutas (salvo `prediction_health`) exigen `Authorization: Bearer <Firebase ID token>`
(verificado con `check_revoked`).

| Función | Método | Qué hace |
|---------|--------|----------|
| `prediction_health` | GET | Estado del modelo publicado: run, target, features y si es cargable (público). |
| `predict_crime` | POST | Predicción con el modelo publicado: **top-5 clases con probabilidad** (modelo de modalidad: `district`, `latitude`, `longitude`). Requiere sesión. |
| `train_model` | POST | Entrena con Firestore o con `dataset` inline y una `task` opcional (`features`, `target`, `split` random/temporal/district). Guarda el `.joblib` **versionado por run** con swap atómico. Requiere claim `admin`. |
| `publish_model` | POST | Publica un `.joblib` entrenado offline (ver `scripts/publish_model.py`). Requiere claim `admin`. |
| `import_incidents` | POST | Inserta filas (`rows`) validadas por fila. Requiere claim `admin`. |
| `import_csv_dataset` | POST | Importa CSV (`csv_text`) validado por fila. Requiere claim `admin`. |
| `create_user` | POST | Crea una cuenta de Firebase Auth (`email`, `password`, `displayName`). Requiere claim `admin`. |
| `list_users` | GET | Lista cuentas con rol (claim `admin`), estado, último acceso y fecha de creación. Requiere claim `admin`. |
| `inei_datacrim_aggregate` / `inei_arcgis_points` | GET | Proxies del INEI (series anuales y puntos ArcGIS). |

Configuración por entorno en `functions/.env` (no versionado): `CORS_ORIGINS` (**define tus
dominios en producción**; el valor por defecto solo permite localhost), `ENFORCE_APP_CHECK`,
`INCIDENTS_COLLECTION`, `ML_PARTS_COLLECTION`. Guía completa para un proyecto nuevo:
[`docs/DEPLOY.md`](docs/DEPLOY.md).

---

## 8. Despliegue (Firebase)

```bash
cd frontend && npm run build && cd ..
firebase login
firebase use --add                 # tu proyecto nuevo (reemplaza el anterior en .firebaserc)
```

> Guía paso a paso para un proyecto nuevo (Blaze, CORS, App Check, claim admin y publicación
> del modelo): [`docs/DEPLOY.md`](docs/DEPLOY.md).

**Solo web + reglas de Firestore (sin Blaze):**

```bash
firebase deploy --only hosting,firestore
```

Sirve el SPA (`frontend/dist`) y aplica `firestore.rules`, pero **no habrá API** de Functions.

**Despliegue completo (requiere Blaze):**

```bash
firebase deploy --only hosting,functions,firestore
```

> La Fase 2 añadió a `firebase.json` el bloque `functions` (`source: functions`, runtime
> `python311`) y el puerto del emulador de Functions (5001), de modo que el CLI ya encuentra la
> configuración. El despliegue sigue requiriendo plan **Blaze**.

> **¿Por qué aparece el error de Blaze?** Al desplegar Functions, Google usa **Cloud Build** y
> **Artifact Registry**, que solo se pueden activar con el plan **Blaze** (pago por uso). No es un
> fallo del proyecto. Con Blaze, activa un **presupuesto/alertas** en Google Cloud: en proyectos
> pequeños suele costar 0 € o muy poco. Si no quieres Blaze, usa el despliegue sin Functions.

Evita ejecutar `firebase init` de nuevo en la raíz con una carpeta de salida incorrecta: el Hosting
debe apuntar a **`frontend/dist`** (ya está configurado en `firebase.json`).

---

## 9. Firestore

| Colección | Uso | Acceso |
|-----------|-----|--------|
| `crime_incidents` | Filas de delitos (campos del modelo ML). | Lectura: usuarios autenticados. Crear/actualizar/borrar: solo cuentas con claim `admin`, con validación de esquema en las reglas (Fase 1). Reimportar no duplica (ID determinista). |
| `crime_stats_monthly` | Serie mensual real SIDPOL/MININTER por distrito y año-mes (2018–hoy) con mapa `por_modalidad`; ID `AAAA-MM-UBIGEO`. | Lectura: usuarios autenticados. Escritura: solo el pipeline offline (Admin SDK). |
| `ml_model_parts` | Modelo `.joblib` **versionado por run**: puntero `_meta`, metadatos en `ml_model_parts/<run>` y trozos en `ml_model_parts/<run>/chunks/<i>`; candado `_training_lock` para entrenamientos concurrentes. | Solo Admin SDK (Cloud Functions). |

Reglas: [`firestore.rules`](firestore.rules) · Índices: [`firestore.indexes.json`](firestore.indexes.json).
El modelo ML espera las variables `FEATURES` y el objetivo `TARGET` definidos en
[`functions/crime_ml/pipeline.py`](functions/crime_ml/pipeline.py).

### 9.1 Permisos de administrador (claim `admin`)

Desde la Fase 1, las reglas exigen el claim `admin` para escribir o borrar en `crime_incidents`.
Para asignarlo a tu cuenta:

```bash
# Requiere credenciales de administrador de Google Cloud:
#   gcloud auth application-default login   (o GOOGLE_APPLICATION_CREDENTIALS=clave-servicio.json)
pip install -r functions/requirements.txt   # si aún no tienes firebase-admin
python scripts/set-admin-claim.py tu-correo@ejemplo.com
```

El claim viaja en el ID token: **cierra sesión y vuelve a entrar** en la web para que surta efecto.
Para revocarlo: `python scripts/set-admin-claim.py tu-correo@ejemplo.com --revoke`.

### 9.2 Pruebas de reglas con el emulador

```bash
cd tests/firestore
npm install
cd ../..
firebase emulators:exec --only firestore --project demo-riskmap "node tests/firestore/firestore.rules.test.mjs"
```

No toca ningún proyecto real (usa el id `demo-riskmap` contra el emulador local; requiere Java).

### 9.3 Pruebas end-to-end de la API (emuladores)

```bash
firebase emulators:exec --only auth,firestore,functions --project demo-riskmap "python tests/functions/e2e_functions.py"
```

Levanta auth + firestore + functions y verifica CORS, permisos admin, entrenamiento inline,
publicación de artefactos, predicción con probabilidades, importaciones validadas, creación de
cuentas (solo admin), health y `check_revoked` de punta a punta (requiere Java y las dependencias
de `functions/` instaladas en `functions/venv`; si el puerto 8080 queda ocupado por el emulador
anterior, ciérralo antes).

---

## 10. Notas para Windows

Si PowerShell bloquea `npm` o `firebase` (`...npm.ps1 no se puede cargar porque la ejecución de
scripts está deshabilitada`), tienes dos opciones:

- Usar las variantes `.cmd`: `npm.cmd run dev`, `npx.cmd ...`, `firebase.cmd deploy`.
- Habilitar scripts firmados para tu usuario:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

---

## 11. Solución de problemas

| Síntoma | Causa / solución |
|---------|------------------|
| El **login falla** en Hosting | Falta `firebase-config.json` o las `VITE_FIREBASE_*` en el build. Reconfigura (§5.2), `npm run build` y vuelve a desplegar. |
| *"Firebase no está configurado"* | No hay `apiKey`: revisa `.env.local` o `frontend/public/firebase-config.json`. |
| **Error de plan Blaze** al desplegar | Despliega `--only hosting,firestore`, o activa Blaze para Functions (§8). |
| El **mapa sale vacío** | No hay datos en `crime_incidents`. Impórtalos desde **Importar datos** (§6). |
| **Permiso denegado** al importar/borrar | Tu cuenta no tiene el claim `admin` (§9.1), o el token es antiguo: cierra sesión y vuelve a entrar. |
| `npm`/`firebase` no ejecutan en PowerShell | Ver §10 (política de ejecución). |
| Puerto 5173 ocupado | Vite usa el siguiente puerto libre; revisa la URL que imprime en consola. |

---

## 12. Limitaciones conocidas (datos y modelo)

- **El modelo de la Fase 3 ya está conectado a la API** (`predict_crime` devuelve las top-5
  modalidades con probabilidad y la pestaña «Modelo de modalidad» de *Predicción* lo consume;
  requiere Cloud Functions desplegadas). La **estimación local** sigue disponible como respaldo
  heurístico. Métricas y limitaciones medidas: [`MODEL_CARD.md`](MODEL_CARD.md).
- **La fuente de puntos no publica la fecha del hecho** (en `crime_incidents` la resolución
  temporal es el año, del grupo de capas). La **tendencia del mapa y del PDF ya no simula fechas**:
  usa la serie mensual real SIDPOL/MININTER (`crime_stats_monthly`: distrito, mes y modalidad,
  2018–hoy), actualizable con `python scripts/pipeline/ingest_sidpol.py --refresh --upload`.
- **La fuente mezcla etiquetas** (nombres de distrito de otras provincias con coordenadas limeñas,
  ubigeos incoherentes con el nombre): la ingesta filtra al ámbito Lima/Callao (ubigeo 1501/0701)
  y canonicaliza el nombre por ubigeo; en el muestreo 2021–2024 se descartaron 262 filas fuera de
  ámbito (ver `data/processed/quality_report.json`).
- **Generalización geográfica limitada (medida):** con distritos no vistos, el clasificador de
  modalidad no supera el baseline (accuracy 0.097 vs 0.102); no debe presentarse como predictor
  generalizable de zonas nuevas.
- **Sesgos de fuente:** los registros policiales reflejan denuncias (subregistro y sesgo
  territorial); las predicciones deben presentarse con cautela y nunca como verdades absolutas
  sobre una zona (ver §6 de [`MODEL_CARD.md`](MODEL_CARD.md)).

## 13. Calidad y verificación

| Capa | Herramienta | Comando | Estado |
|---|---|---|---|
| API + ML + pipeline (Python) | pytest · **71 pruebas** | `python -m pytest functions/tests tests/pipeline -q` | ✅ |
| API end-to-end | emuladores auth+firestore+functions · **17 comprobaciones** | `firebase emulators:exec --only auth,firestore,functions --project demo-riskmap "python tests/functions/e2e_functions.py"` | ✅ |
| Reglas de Firestore | emulador · **16 pruebas** | `firebase emulators:exec --only firestore --project demo-riskmap "node tests/firestore/firestore.rules.test.mjs"` | ✅ |
| Frontend | Vitest · **35 pruebas** | `cd frontend && npm test` | ✅ |
| Lint y build | ESLint 9 + tsc + Vite | `cd frontend && npm run lint && npm run build` | ✅ |
| Integración continua | GitHub Actions | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) en cada push/PR | configurado |

Guía de contribución: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## 14. Enlaces rápidos

- Frontend: [`frontend/`](frontend/) · Config de ejemplo: [`frontend/.env.example`](frontend/.env.example)
- Cloud Functions: [`functions/main.py`](functions/main.py) · Pipeline ML: [`functions/crime_ml/pipeline.py`](functions/crime_ml/pipeline.py) · Validación: [`functions/crime_ml/validation.py`](functions/crime_ml/validation.py)
- Datos y ML (Fase 3): [`scripts/pipeline/`](scripts/pipeline/) · [`data/README.md`](data/README.md) · [`MODEL_CARD.md`](MODEL_CARD.md) · métricas en [`models/reports/`](models/reports/) · taxonomía en [`data/taxonomy/`](data/taxonomy/)
- Pruebas: [`functions/tests/`](functions/tests/) (pytest) · [`tests/firestore/`](tests/firestore/) (reglas con emulador) · [`tests/functions/`](tests/functions/) (e2e de la API con emuladores)
- Despliegue: [`docs/DEPLOY.md`](docs/DEPLOY.md) · Publicación de modelos: [`scripts/publish_model.py`](scripts/publish_model.py)
- Reglas Firestore: [`firestore.rules`](firestore.rules)
- Config Firebase: [`firebase.json`](firebase.json) · Proyecto: [`.firebaserc`](.firebaserc)
- Calidad: [`CONTRIBUTING.md`](CONTRIBUTING.md) · CI: [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
