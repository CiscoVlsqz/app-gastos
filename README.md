# Gastos Fran & Marti

App simple para cargar gastos compartidos desde el celular. El backend es Google Apps Script +
Google Sheets (sin costo), y el front-end es una PWA que se sube a un hosting estático gratis
(Cloudflare Pages o Netlify).

## Arquitectura

- **Backend** (Apps Script sobre el Sheet): guarda/lee movimientos. Expone un único endpoint
  POST `/exec` que recibe `{ fn, args }` y responde JSON. Es lo único que sigue en Google.
- **Front-end** (carpeta `dist/`, generada por `web/build.py`): HTML/CSS/JS estático que le pega
  al `/exec` por `fetch()`. Se sube a Cloudflare/Netlify y se agrega al inicio del iPhone.

## Archivos

- `Code.gs` — backend: guarda/lee movimientos en el Sheet + dispatcher `rpcDispatch`.
- `Index.html` / `Stylesheet.html` / `Script.html` — front-end (3 pantallas: Cargar, Historial,
  Resumen). Los `<?!= include(...) ?>` son de Apps Script; el build los resuelve inline.
- `web/` — plantillas de la PWA: `manifest.webmanifest`, `sw.js`, iconos, y `build.py`.
- `dist/` — salida del build, lista para subir. Se regenera; no se edita a mano.
- `preview/` — para probar la app en la compu con datos de prueba (`mock-api.js`).

## Desplegar el backend (Apps Script)

1. Planilla nueva en [sheets.google.com](https://sheets.google.com), p. ej. **"Gastos Fran & Marti"**.
2. **Extensiones → Apps Script**.
3. Pegá el contenido de [`Code.gs`](Code.gs) en el `Code.gs` del editor.
4. Selector de funciones → **`setup`** → **Ejecutar** ▶️ (la primera vez autorizás permisos).
   Crea las hojas `Movimientos`, `Config` y `Resumen`.
5. **Implementar → Nueva implementación**:
   - Tipo: **Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquiera** (tiene que decir *Cualquiera*, no "Cualquiera con
     cuenta de Google" — si no, el `fetch()` sin login no funciona).
   - **Implementar** y copiá la URL `.../exec`.

> Ya no hace falta crear archivos HTML en Apps Script: el front vive en el hosting estático.

### Cuando cambies `Code.gs` más adelante

Pegá la versión nueva en el editor y **Implementar → Gestionar implementaciones → editar (lápiz)
→ Versión: Nueva versión → Implementar**. Así la URL `/exec` **no cambia**.

## Desplegar / actualizar el front-end (PWA)

1. Guardá la URL `/exec` en `web/api-url.txt` (una sola vez).
2. Generá `dist/`:

   ```
   python web/build.py
   ```

   (o `python web/build.py https://script.google.com/macros/s/XXXXX/exec` sin guardar el txt).

3. Subí la carpeta `dist/`:
   - **Netlify**: arrastrá `dist/` a [app.netlify.com/drop](https://app.netlify.com/drop). La
     primera vez te da un nombre al azar; en *Site settings → Change site name* le ponés uno fijo.
   - **Cloudflare Pages**: *Create a project → Direct Upload*, subís `dist/`.

   Cada vez que cambies el front, corré el build y volvé a subir `dist/` **al mismo sitio** (así
   la URL no cambia). El `sw.js` lleva un número de versión nuevo en cada build, así que la PWA
   instalada se actualiza sola al abrirla con conexión.

4. Pasale la URL del sitio (`https://xxx.netlify.app`) a Marti.

## Agregar el ícono al inicio del iPhone (los dos)

1. Abrí la URL del sitio en **Safari** (tiene que ser Safari para el "Agregar a inicio").
2. Botón de compartir → **Agregar a pantalla de inicio**.

Queda como una app a pantalla completa, con ícono propio, y anda offline para ver lo último
cargado (para guardar un gasto nuevo sí necesita conexión).

## Si quieren agregar o cambiar una categoría más adelante

Dos formas, ambas terminan en la misma hoja **Config**:

- Desde la app: ícono **⚙️** en el encabezado → agregar, renombrar/cambiar ícono o borrar una
  categoría. Si la renombran, los gastos ya cargados con el nombre viejo se actualizan solos.
- A mano en la planilla: hoja **Config**, agregan/editan una fila (columna A = nombre, columna B
  = emoji del ícono).

El desplegable de categorías al cargar un gasto ordena automáticamente las más usadas primero,
según el historial de Movimientos.

## Editar o borrar un gasto ya cargado

Tocá el gasto en **Historial** — se abre el mismo formulario de Cargar, precargado, con un botón
**Borrar**. Al guardar, actualiza esa misma fila en Movimientos (la busca por su ID interno).

## Modo oscuro

Ícono **🌙/☀️** en el encabezado. Arranca según la preferencia del sistema la primera vez, y
después queda guardado en el navegador de cada uno.

## Qué NO incluye esta v1 (a propósito)

- Ingresos mensuales.
- El detalle de ahorro en dólares / deuda con Gus que ya llevás en `PAGO DEP.xlsx` — eso sigue
  aparte, esta app es solo para los gastos del día a día.
- Métodos de pago / cuotas (eso lo miran directo en el home banking).
