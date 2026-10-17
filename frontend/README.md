# Frontend — Riskmap (React + TypeScript + Vite)

SPA del panel de **predicción de riesgo criminal (Lima)**. Para la guía completa del proyecto
(arquitectura, Cloud Functions, Firestore y despliegue) consulta el
[`README.md` de la raíz](../README.md).

## Stack

React 19 · TypeScript · Vite · Tailwind CSS 4 · React Router 7 · Firebase JS SDK 11 (Auth + Firestore)
· Leaflet / react-leaflet · @react-google-maps/api · xlsx · jsPDF · lucide-react.

## Puesta en marcha

```bash
npm ci                     # Instala dependencias

# Configura Firebase (una de las dos opciones):
cp .env.example .env.local                                   # Opción A: VITE_FIREBASE_*
cp public/firebase-config.example.json public/firebase-config.json   # Opción B: JSON

npm run dev                # http://localhost:5173
```

Sin `VITE_FIREBASE_*` ni `public/firebase-config.json` el login falla: el SDK necesita la
configuración de la **app web** (Consola Firebase). El **UID de usuario no la sustituye**.

Crea un usuario en **Authentication** (correo/contraseña) y úsalo en `/login`.

## Scripts

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Servidor de desarrollo con HMR. |
| `npm run build` | Compila a `dist/` (`tsc -b && vite build`). |
| `npm run preview` | Sirve localmente el build de producción. |
| `npm run lint` | ESLint. |

## Rutas

`/login` · `/` (Resumen) · `/analisis` · `/prediccion` · `/mapa`; solo admin: `/datos` (Importar datos) y `/usuarios`.

## Sistema de diseño

Rediseño «centro de operaciones» (tema oscuro por defecto + tema claro con toggle):

- **Tokens semánticos** en `src/index.css` (`surface-*`, `content-*`, `line-*`, `accent-*`, `risk-*`).
  Los componentes usan SIEMPRE tokens, nunca colores de paleta directa.
- **Tema**: `src/context/ThemeContext.tsx` (persistencia en `localStorage` con la clave
  `riskmap:theme`, sin flash al cargar).
- **Kit UI**: `src/components/ui/` (Button, Card, Badge, Input/Label/Select/Textarea, Modal,
  Toast, Skeleton, EmptyState, StatCard, ThemeToggle).
- Documentación completa del sistema: [`docs/design/DESIGN.md`](../docs/design/DESIGN.md).

## Notas

- La **Predicción** se resuelve en el cliente (`src/ml/localPredict.ts`): consulta Firestore y,
  si no hay datos, aplica una heurística. Las Cloud Functions con el modelo Random Forest son
  opcionales (requieren plan Blaze para desplegarse).
- El mapa usa **Google Maps** si defines `VITE_GOOGLE_MAPS_API_KEY` / `mapsApiKey`; si no, usa
  **Leaflet** (sin API key).
- En Windows, si PowerShell bloquea `npm`, usa `npm.cmd` o consulta §10 del README raíz.
