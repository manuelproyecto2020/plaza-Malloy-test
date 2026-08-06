# Plaza Malloy Arena · Landing de eventos

Sitio de **tres eventos** para Plaza Malloy Arena (Ferris, TX), construido con un
**molde compartido**: un solo componente de landing (`EventLanding`) + un archivo
de configuración por evento. Los cambios de diseño o de lógica se aplican a los
tres eventos a la vez; los cambios de contenido de un evento son independientes.

Stack: **React 19 + Vite + Tailwind CSS** (frontend) y **Node/Express + MongoDB +
Stripe + Nodemailer** (backend), igual que la web de Gomez Arena.

---

## 1. Los tres eventos

| Evento | Ruta | Fecha | Gold (1 a 14) | Silver (15 a 54) |
|---|---|---|---|---|
| Rienda Real y Pócima Norteña | `/rienda-real` | Sáb 22 Ago 2026 | $300 | $200 |
| Los Dos de Tamaulipas | `/los-dos-de-tamaulipas` | Sáb 29 Ago 2026 | $500 | $400 |
| El Fantasma | `/el-fantasma` | Sáb 12 Sep 2026 | $600 | $500 |

Las 54 mesas se venden (Gold 1 a 14, Silver 15 a 54). Cada mesa incluye 4 asientos.

---

## 2. Estructura del proyecto

```
public/
  logo.png            preview.mp4
  eventos/            flyers y mapas de mesas de cada evento
  arena/              arena-1.jpg ... arena-8.jpg (galería del recinto)
src/
  data/
    mesas.js          layout fijo de mesas (Gold 1-14 / Silver 15-54)
    venue.js          nombre, dirección, contacto y textos "About Us"
  eventos/
    index.js          registro central de eventos
    los-dos-de-tamaulipas.js / el-fantasma.js / rienda-real.js
  components/         Navbar, Hero, VideoPreview, EventsSection, AboutSection,
                     Gallery, Footer, WhatsAppButton, ReservationModal
  EventLanding.jsx    monta una página de evento (estado de reservas + pago)
  AdminDashboard.jsx  panel interno para bloquear/liberar mesas
  Success.jsx         confirmación tras el pago
  App.jsx             rutas
server.js             backend (API + webhook Stripe + emails + admin)
```

Rutas: `/` (evento por defecto), `/rienda-real`, `/los-dos-de-tamaulipas`,
`/el-fantasma`, `/success`, `/admin-kirk`.

---

## 3. Arrancar en local

Requisitos: Node 18+ y una base MongoDB (Atlas sirve).

```bash
npm install
cp .env.example .env        # rellena los valores (ver sección 6)

# Terminal 1 · backend
npm start                   # http://localhost:4000

# Terminal 2 · frontend
npm run dev                 # http://localhost:5173
```

En local, el frontend habla con el backend en `http://localhost:4000` por defecto.

---

## 4. Despliegue

### Frontend (Vercel), un despliegue por evento desde el MISMO repo

Cada evento tendrá su propio dominio. Creas **un proyecto de Vercel por dominio**,
todos apuntando a este mismo repositorio, y cambias solo las variables de entorno:

| Variable | Ejemplo | Para qué |
|---|---|---|
| `VITE_EVENT_SLUG` | `los-dos-de-tamaulipas` | Qué evento se abre en la raíz `/` de ese dominio |
| `VITE_API_URL` | `https://tu-backend.up.railway.app` | URL del backend en Railway |
| `VITE_STRIPE_PK` | `pk_live_...` | Clave pública de Stripe (al final) |

Así, `dominio-tamaulipas.com` abre el Evento 1, `dominio-fantasma.com` el Evento 2,
etc. Y dentro de cualquier dominio siguen existiendo las rutas de los otros
eventos (opción C). El `vercel.json` ya reescribe todo a `index.html` para que las
rutas funcionen.

### Backend (Railway), Node + MongoDB

Sube este mismo repo a Railway (usa el `Procfile`: `web: node server.js`) y define
las variables de la sección 6. Configura el **webhook de Stripe** apuntando a
`https://tu-backend.up.railway.app/webhook` (evento `checkout.session.completed`).

---

## 5. Stripe (se configura AL FINAL)

Ahora mismo los precios están como **placeholders** (`PENDING_*`) y el botón de pago
avisa que "el pago aún no está disponible". Para activarlo:

1. En Stripe, crea un **Producto con su Precio** por cada combinación evento + categoría
   (6 precios en total) y copia cada `price_...`.
2. Pega esos IDs en **dos sitios**:
   - `src/eventos/*.js` → campo `stripePriceIds`
   - `server.js` → objeto `STRIPE_PRICES` (el servidor decide el precio, es lo que
     de verdad se cobra).
3. Define `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` y `VITE_STRIPE_PK`.

El backend valida el precio por su cuenta y evita doble venta de una misma mesa.

---

## 6. Variables de entorno (backend, `.env`)

```
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
MONGO_URI=mongodb+srv://...
EMAIL_USER=gomezwwarena@gmail.com
EMAIL_PASSWORD=contraseña_de_aplicacion_de_gmail
NOTIFY_EMAIL=gomezwwarena@gmail.com
ADMIN_SECRET=Kirk2026
FRONTEND_URL=https://tu-dominio.com   # opcional; el front ya envía su origin
```

---

## 7. Bloquear mesas manualmente (dos formas)

- **Panel `/admin-kirk`** (contraseña `Kirk2026`): eliges el evento y haces clic en
  una mesa para bloquearla o liberarla. El panel no deja liberar mesas compradas por
  un cliente real.
- **En el código** (bloqueo permanente): en `src/eventos/<evento>.js`, dentro de
  `bloqueosManuales`, por ejemplo `"MesaGold": ["3","7"]` bloquea esas mesas para
  siempre en ese evento.

---

## 8. Editar contenido rápido

- **Precios / fechas / nombre de un evento** → `src/eventos/<evento>.js`
- **Dirección, contacto, textos About Us, aforo** → `src/data/venue.js`
- **Fotos del recinto** → reemplaza los archivos en `public/arena/` con el mismo nombre
- **Flyer o mapa de un evento** → reemplaza en `public/eventos/` con el mismo nombre
- **Agregar un 4.º evento** → crea `src/eventos/nuevo.js`, impórtalo en
  `src/eventos/index.js` y añádelo al array `EVENTOS`. Nada más.

---

## Notas

- El **aforo "5,000+"** de la sección About Us es un valor de ejemplo editable en
  `src/data/venue.js`; ajústalo cuando tengamos la cifra oficial.
- El video de preview se comprimió a ~2.7 MB (720p, sin audio) para que cargue
  rápido en móvil. El original queda como respaldo.
- Interfaz en español; solo se mantienen en inglés las etiquetas "UPCOMING EVENTS",
  "ABOUT US" y "EXCLUSIVE SUITE GALLERY".
