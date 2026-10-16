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
| **React Router 7** | Rutas: `/login`, `/` (resumen), `/prediccion`, `/mapa`, `/datos`. |
| **Firebase JS SDK 11** | `Auth` (login), `Firestore` (lectura/escritura de incidentes). |
| **Leaflet + react-leaflet** | Mapa de riesgo por defecto (no requiere API key). |
| **@react-google-maps/api** | Mapa alternativo si se define una Google Maps API key. |
| **lucide-react** | Iconografía. |
| **xlsx (SheetJS)** | Importación de archivos `.xlsx`, `.xls` y `.csv`. |
| **jsPDF** | Exportación de reportes en PDF. |

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
| `node scripts/generate-csv.js` | Genera un dataset **sintético** de 1 900 filas (`crime_incidents_lima_1900.csv`). |
| `node scripts/fetch-real-data.js` | Descarga 1 000 puntos reales (2022) del MapServer del INEI DataCrime a `crime_incidents_lima_real_1000.csv`. **Matiz verificado:** ubicación y distrito son reales; `hour`, `day_of_week`, `historical_frequency` y `risk_level` se derivan con reglas del propio script (ver §12). |

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

**Nota importante:** la pantalla **Predicción** del frontend resuelve el resultado en el navegador
(`frontend/src/ml/localPredict.ts`): consulta Firestore y, si no hay datos, usa una heurística.
Las **Cloud Functions** contienen el modelo ML real (Random Forest), pero son **opcionales** y
necesitan plan **Blaze** para desplegarse. Sin Functions, la app sigue funcionando para
login, mapa, importación de datos y predicción heurística.

Además, hoy **ninguna pantalla llama a las Cloud Functions**: `frontend/src/api/client.ts` y
`frontend/src/config/api.ts` quedaron sin uso (conectarlas a la UI es trabajo de la Fase 4).
La predicción es siempre `localPredict`, no el Random Forest.

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
│   │   ├── hooks/                 # Lectura de incidentes para el mapa
│   │   ├── ml/localPredict.ts     # Predicción local (Firestore + heurística)
│   │   ├── pages/                 # Login, Home, Predict, Map, Data
│   │   └── utils/                 # Errores de Auth, fechas, datos de gráficos
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

### 5.3 Crear un usuario para iniciar sesión

En la Consola Firebase → **Authentication** → activa **Correo electrónico/Contraseña** y crea un
usuario (o usa el que ya tengas). Esas credenciales son las que se usan en `/login`.

### 5.4 Levantar el servidor de desarrollo

```bash
cd frontend
npm run dev
```

Abre **http://localhost:5173** (Vite cambia a `5174`, `5175`… si el puerto está ocupado).
Inicia sesión y navega por **Resumen**, **Predicción**, **Mapa de riesgo** e **Importar datos**.

### 5.5 Otros comandos del frontend

```bash
npm run build     # Compila a frontend/dist (tsc + vite build)
npm run preview   # Sirve el build de producción localmente
npm run lint      # ESLint
```

---

## 6. Cargar datos

La app lee/escribe la colección **`crime_incidents`** de Firestore. Puedes poblarla de dos formas:

**a) Desde la interfaz** — página **Importar datos**: sube un `.xlsx`, `.xls` o `.csv`, o pega un
array JSON. Requiere una cuenta con el claim **`admin`** (§9.1); el resto de cuentas ven la página
en modo lectura. Columnas obligatorias:

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

---

## 7. Cloud Functions (API de Machine Learning) — opcional

Lógica en `functions/crime_ml/pipeline.py` y endpoints en `functions/main.py`.
Todas las rutas (salvo `prediction_health`) exigen `Authorization: Bearer <Firebase ID token>`.

| Función | Método | Qué hace |
|---------|--------|----------|
| `prediction_health` | GET | Estado del modelo almacenado en Firestore. |
| `predict_crime` | POST | Predice riesgo con el Random Forest entrenado. |
| `train_model` | POST | Entrena con Firestore o con `dataset` inline; guarda el `.joblib` **versionado por run** con swap atómico (evita artefactos mezclados). Requiere claim `admin`. |
| `import_incidents` | POST | Inserta filas (`rows`) en `crime_incidents` (validadas por fila). Requiere claim `admin`. |
| `import_csv_dataset` | POST | Importa CSV (`csv_text`) a `crime_incidents` (validadas por fila). Requiere claim `admin`. |
| `inei_datacrim_aggregate` | GET | Proxy de series anuales del INEI (evita CORS). |
| `inei_arcgis_points` | GET | Proxy de puntos de delitos del MapServer del INEI (ArcGIS). |

Para trabajar con ellas necesitas el plan **Blaze** (Cloud Build + Artifact Registry) y desplegarlas
(§8). El frontend actual no consume ninguna de estas rutas y, desde la Fase 2, `train_model`,
`import_incidents` e `import_csv_dataset` exigen además el claim **`admin`** (el resto de endpoints
solo pide sesión). `firebase.json` ya tiene configurados los emuladores de Firestore y Functions.

---

## 8. Despliegue (Firebase)

```bash
cd frontend && npm run build && cd ..
firebase login
firebase use riskmap-2fb0f        # o: firebase use --add  (tu propio proyecto)
```

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
| `crime_incidents` | Filas de delitos (campos del modelo ML). | Lectura: usuarios autenticados. Crear/actualizar/borrar: solo cuentas con claim `admin`, con validación de esquema en las reglas (Fase 1). |
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

- **El objetivo es una etiqueta construida, no un riesgo medido.** En `scripts/fetch-real-data.js`
  `risk_level` se deriva por reglas del tipo de delito, y `historical_frequency` de una tabla por
  distrito ajustada por ese nivel. El Random Forest aprende esa regla: sus métricas no deben
  interpretarse como capacidad predictiva del riesgo real.
- **Parte del dataset "real" es sintética:** la ubicación y el distrito provienen del MapServer del
  INEI, pero hora, día, frecuencia y `risk_level` se generan por reglas; además el esquema no guarda
  la fecha del incidente.
- **La tendencia del mapa y del PDF usa fechas simuladas** (`frontend/src/utils/simulateDates.ts`);
  la UI y el PDF lo advierten explícitamente. Una serie temporal real requiere añadir la fecha al
  esquema (Fase 3).
- **Sesgos de fuente:** los registros policiales reflejan denuncias (subregistro y sesgo territorial);
  las predicciones deben presentarse con cautela y nunca como verdades absolutas sobre una zona.

## 13. Enlaces rápidos

- Frontend: [`frontend/`](frontend/) · Config de ejemplo: [`frontend/.env.example`](frontend/.env.example)
- Cloud Functions: [`functions/main.py`](functions/main.py) · Pipeline ML: [`functions/crime_ml/pipeline.py`](functions/crime_ml/pipeline.py) · Validación: [`functions/crime_ml/validation.py`](functions/crime_ml/validation.py)
- Pruebas: [`functions/tests/`](functions/tests/) (pytest) · [`tests/firestore/`](tests/firestore/) (reglas con emulador)
- Reglas Firestore: [`firestore.rules`](firestore.rules)
- Config Firebase: [`firebase.json`](firebase.json) · Proyecto: [`.firebaserc`](.firebaserc)
