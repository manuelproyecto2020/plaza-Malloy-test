import 'dotenv/config';
import express from 'express';
import Stripe from 'stripe';
import cors from 'cors';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();

// ─── Correo (confirmaciones y avisos) ────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

// ─── Nombres visibles de los eventos (eventId → nombre) ──────────
const EVENT_NAMES = {
  '22-ago-2026': 'Rienda Real y Pócima Norteña',
  '29-ago-2026': 'Los Dos de Tamaulipas',
  '12-sep-2026': 'El Fantasma',
};
const getEventName = (id) => EVENT_NAMES[id] || id;

// ─── PRECIOS POR EVENTO (Stripe Price IDs) ───────────────────────
// Se configuran AL FINAL con los IDs reales de Stripe. El servidor decide
// el precio a partir de eventId + categoría (no confía en el cliente).
const STRIPE_PRICES = {
  '22-ago-2026': { MesaGold: 'PENDING_GOLD_22AGO', MesaSilver: 'PENDING_SILVER_22AGO' }, // $300 / $200
  '29-ago-2026': { MesaGold: 'PENDING_GOLD_29AGO', MesaSilver: 'PENDING_SILVER_29AGO' }, // $500 / $400
  '12-sep-2026': { MesaGold: 'PENDING_GOLD_12SEP', MesaSilver: 'PENDING_SILVER_12SEP' }, // $600 / $500
};

// ─── Base de datos ───────────────────────────────────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Conectado a MongoDB'))
  .catch((err) => console.error('❌ Error DB:', err));

// Cada mesa se guarda con su número, evento y categoría (índice único).
const TableSchema = new mongoose.Schema({
  numero: { type: String, required: true },
  eventId: { type: String, required: true },
  category: { type: String, required: true },
  estado: { type: String, default: 'disponible', enum: ['disponible', 'bloqueada'] },
  fechaVenta: { type: Date, default: Date.now },
  clientEmail: { type: String, default: null },
});
TableSchema.index({ numero: 1, eventId: 1, category: 1 }, { unique: true });
const Table = mongoose.model('Table', TableSchema);

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ============================================
// 🪝 WEBHOOK DE STRIPE (marca la mesa como vendida al confirmarse el pago)
// ============================================
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`❌ Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const itemNumber = session.metadata?.numero;
    const eventId = session.metadata?.eventId;
    const category = session.metadata?.category;
    const customerEmail = session.customer_details?.email;
    const customerName = session.customer_details?.name || 'No proporcionado';
    const eventName = getEventName(eventId);

    if (!itemNumber || !eventId || !category) {
      console.error(`🚨 Faltan datos en metadata: numero=${itemNumber}, eventId=${eventId}, category=${category}`);
      return res.send();
    }

    try {
      await Table.findOneAndUpdate(
        { numero: itemNumber.toString(), eventId, category },
        { numero: itemNumber.toString(), eventId, category, estado: 'bloqueada', clientEmail: customerEmail, fechaVenta: new Date() },
        { upsert: true, new: true }
      );

      // Correo al cliente
      if (customerEmail) {
        transporter.sendMail(
          {
            from: process.env.EMAIL_USER,
            to: customerEmail,
            subject: '✅ Reserva Confirmada · Plaza Malloy Arena',
            html: `
              <div style="font-family: sans-serif; padding: 20px; background-color: #000; color: #fff; border: 1px solid #d97706; border-radius: 10px;">
                <h1 style="color: #d97706;">¡RESERVA CONFIRMADA!</h1>
                <p style="font-size: 16px;">Tu Mesa VIP número <strong style="font-size: 20px;">#${itemNumber}</strong> ya está reservada.</p>
                <p><strong>Categoría:</strong> ${category}</p>
                <p><strong>Evento:</strong> ${eventName}</p>
                <p><strong>Recinto:</strong> Plaza Malloy Arena, 2141 Malloy Bridge Rd, Ferris, TX 75125</p>
                <p>Presenta este correo al llegar para tu acceso exclusivo.</p>
              </div>
            `,
          },
          (err) => (err ? console.error('❌ Error email cliente:', err) : console.log(`📧 Email enviado a ${customerEmail}`))
        );
      }

      // Aviso al organizador
      const notifyTo = process.env.NOTIFY_EMAIL || process.env.EMAIL_USER;
      if (notifyTo) {
        transporter.sendMail(
          {
            from: process.env.EMAIL_USER,
            to: notifyTo,
            subject: `🎟️ Nueva reserva: ${eventName} · Mesa #${itemNumber}`,
            html: `
              <div style="font-family: sans-serif; padding: 20px; border: 1px solid #d97706; border-radius: 10px; max-width: 500px;">
                <h2 style="color: #d97706; margin-top: 0;">Nueva reserva confirmada</h2>
                <p><strong>Evento:</strong> ${eventName}</p>
                <p><strong>Mesa número:</strong> #${itemNumber}</p>
                <p><strong>Categoría:</strong> ${category}</p>
                <hr style="border: none; border-top: 1px solid #eee;">
                <p><strong>Nombre del cliente:</strong> ${customerName}</p>
                <p><strong>Correo del cliente:</strong> ${customerEmail || 'No proporcionado'}</p>
                <p style="color: #888; font-size: 12px;"><strong>Fecha de compra:</strong> ${new Date().toLocaleString('es-MX')}</p>
              </div>
            `,
          },
          (err) => (err ? console.error('❌ Error aviso organizador:', err) : console.log(`📧 Aviso enviado a ${notifyTo}`))
        );
      }
    } catch (error) {
      console.error('🚨 Error al guardar en DB:', error);
    }
  }
  res.send();
});

app.use(express.json());

// ============================================
// ⚡ API pública
// ============================================

// Mesas ocupadas de un evento (el front la consulta cada 3s)
app.get('/api/occupied', async (req, res) => {
  try {
    const { eventId } = req.query;
    if (!eventId) return res.status(400).json({ error: 'Falta eventId' });

    const ocupadas = await Table.find({ eventId, estado: 'bloqueada' });
    res.json({
      mesas: ocupadas.map((t) => ({ numero: t.numero, category: t.category })),
      eventId,
    });
  } catch (error) {
    res.status(500).json({ mesas: [], error: error.message });
  }
});

// Crea la sesión de pago de Stripe
app.post('/create-checkout-session', async (req, res) => {
  const { isTable, eventId, category, tableNumber, origin } = req.body;

  // Dominio del frontend para las URLs de retorno (cada evento en el suyo).
  // Usa el origin que envía el cliente; si no, la variable de entorno.
  const CLIENT_URL =
    (typeof origin === 'string' && origin.startsWith('http') ? origin : null) ||
    process.env.FRONTEND_URL ||
    'http://localhost:5173';

  try {
    if (!eventId) return res.status(400).json({ error: 'eventId es requerido' });
    if (!isTable) return res.status(400).json({ error: 'Solo se venden mesas' });
    if (!category) return res.status(400).json({ error: 'Falta la categoría' });
    if (!tableNumber) return res.status(400).json({ error: 'Falta el número de mesa' });

    // El precio lo decide el SERVIDOR según evento + categoría
    const finalPriceId = STRIPE_PRICES[eventId]?.[category];
    if (!finalPriceId || finalPriceId.startsWith('PENDING')) {
      return res.status(400).json({ error: 'Precio no configurado para esta mesa (Stripe pendiente)' });
    }

    // Evita doble venta de la misma mesa
    const conflicto = await Table.findOne({ numero: tableNumber.toString(), eventId, category, estado: 'bloqueada' });
    if (conflicto) return res.status(409).json({ error: `Mesa #${tableNumber} ya reservada` });

    const successUrl = `${CLIENT_URL}/success?eventId=${eventId}&number=${tableNumber}&cat=${encodeURIComponent(category)}`;

    const session = await stripe.checkout.sessions.create({
      line_items: [{ price: finalPriceId.trim(), quantity: 1 }],
      mode: 'payment',
      allow_promotion_codes: true,
      success_url: successUrl,
      cancel_url: `${CLIENT_URL}/`,
      metadata: {
        numero: tableNumber.toString(),
        isTable: 'true',
        eventId,
        category,
      },
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('🚨 Error Stripe:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 🔐 ZONA ADMIN (bloquear / liberar mesas a mano)
// ============================================
app.post('/api/admin/toggle', async (req, res) => {
  const { adminKey, numero, eventId, category } = req.body;
  const SECRET = process.env.ADMIN_SECRET || 'Kirk2026';

  if (adminKey !== SECRET) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }
  if (!numero || !eventId || !category) {
    return res.status(400).json({ error: 'Faltan datos (numero, eventId, category)' });
  }

  try {
    const query = { numero: numero.toString(), eventId, category };
    const item = await Table.findOne(query);

    if (item) {
      // Protección: no borrar mesas compradas por un cliente real
      if (item.clientEmail && !item.clientEmail.includes('admin')) {
        return res.status(400).json({
          error: `⚠️ Esta mesa la compró un cliente real (${item.clientEmail}). No se puede liberar desde aquí.`,
        });
      }
      await Table.findOneAndDelete(query);
      return res.json({ status: 'disponible', message: 'Mesa liberada correctamente' });
    } else {
      await Table.create({ ...query, estado: 'bloqueada', clientEmail: 'admin-manual-block', fechaVenta: new Date() });
      return res.json({ status: 'bloqueada', message: 'Mesa bloqueada correctamente' });
    }
  } catch (error) {
    console.error('❌ Error en admin toggle:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
