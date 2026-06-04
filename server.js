const express = require('express');
const fetch = require('node-fetch');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Configuración
const FLOW_API_KEY = process.env.FLOW_API_KEY || '1F116A19-C5A0-4EDE-AC86-76A0765L058C';
const FLOW_SECRET = process.env.FLOW_SECRET || '71620f26c763b7565f9afe89f2777872f44348eb';
const FLOW_API_URL = 'https://www.flow.cl/api';
const BASE_URL = process.env.BASE_URL || 'https://giramondo.onrender.com';
const NOTIFY_EMAIL = 'gmmatiasignacio@gmail.com';
const WHATSAPP = '+56996243833';

// Productos
const productos = {
  'mamma-1kg': { name: 'Lucaffè Mamma Lucia — Grano Entero 1kg', price: 32990 },
  'mamma-500g': { name: 'Lucaffè Mamma Lucia — Molido 500g', price: 16990 },
  'dusty-900g': { name: 'Dusty Caff Detergente 900g', price: 19990 }
};

// Función para firmar requests de Flow
function signParams(params) {
  const sorted = Object.keys(params).sort().reduce((acc, key) => {
    acc[key] = params[key];
    return acc;
  }, {});
  const toSign = Object.entries(sorted).map(([k, v]) => `${k}${v}`).join('');
  return crypto.createHmac('sha256', FLOW_SECRET).update(toSign).digest('hex');
}

// Crear orden en Flow
app.post('/api/crear-orden', async (req, res) => {
  try {
    const { items, nombre, email, telefono, direccion, comuna } = req.body;

    // Calcular total
    let total = 0;
    let detalle = '';
    items.forEach(item => {
      const prod = productos[item.id];
      if (prod) {
        total += prod.price * item.qty;
        detalle += `${item.qty}x ${prod.name}\n`;
      }
    });

    const commerceOrder = `GIR-${Date.now()}`;
    const subject = `Pedido Giramondo — ${nombre}`;

    const params = {
      apiKey: FLOW_API_KEY,
      amount: total,
      commerceOrder,
      currency: 'CLP',
      email,
      subject,
      urlConfirmation: `${BASE_URL}/api/confirmar-pago`,
      urlReturn: `${BASE_URL}/gracias?order=${commerceOrder}`,
      optional: JSON.stringify({ nombre, telefono, direccion, comuna, detalle })
    };

    params.s = signParams(params);

    const formData = new URLSearchParams(params);
    const response = await fetch(`${FLOW_API_URL}/payment/create`, {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (data.url && data.token) {
      res.json({ success: true, redirectUrl: `${data.url}?token=${data.token}` });
    } else {
      console.error('Flow error:', data);
      res.json({ success: false, error: data.message || 'Error al crear orden' });
    }
  } catch (err) {
    console.error('Error crear orden:', err);
    res.json({ success: false, error: 'Error del servidor' });
  }
});

// Confirmar pago (Flow llama a esta URL)
app.post('/api/confirmar-pago', async (req, res) => {
  try {
    const { token } = req.body;

    const params = { apiKey: FLOW_API_KEY, token };
    params.s = signParams(params);

    const response = await fetch(`${FLOW_API_URL}/payment/getStatus?${new URLSearchParams(params)}`);
    const pago = await response.json();

    if (pago.status === 2) { // Pagado
      const optional = JSON.parse(pago.optional || '{}');

      // Enviar email de notificación
      await enviarEmailNotificacion(pago, optional);
    }

    res.send('OK');
  } catch (err) {
    console.error('Error confirmar pago:', err);
    res.send('OK');
  }
});

// Enviar email de notificación
async function enviarEmailNotificacion(pago, datos) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: NOTIFY_EMAIL,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });

    const html = `
      <h2>🎉 Nuevo pedido confirmado — Giramondo</h2>
      <hr>
      <h3>Datos del pedido</h3>
      <p><strong>Orden:</strong> ${pago.commerceOrder}</p>
      <p><strong>Total pagado:</strong> $${parseInt(pago.amount).toLocaleString('es-CL')}</p>
      <p><strong>Fecha:</strong> ${new Date().toLocaleString('es-CL')}</p>
      <hr>
      <h3>Productos</h3>
      <pre>${datos.detalle || 'Sin detalle'}</pre>
      <hr>
      <h3>Datos del cliente</h3>
      <p><strong>Nombre:</strong> ${datos.nombre || pago.payerName}</p>
      <p><strong>Email:</strong> ${pago.payerEmail}</p>
      <p><strong>Teléfono:</strong> ${datos.telefono || 'No indicado'}</p>
      <p><strong>Dirección:</strong> ${datos.direccion || 'No indicada'}</p>
      <p><strong>Comuna:</strong> ${datos.comuna || 'No indicada'}</p>
      <hr>
      <p style="color:#888;">Giramondo — Te acercamos lo lejano</p>
    `;

    await transporter.sendMail({
      from: `Giramondo <${NOTIFY_EMAIL}>`,
      to: NOTIFY_EMAIL,
      subject: `🛒 Nuevo pedido #${pago.commerceOrder} — $${parseInt(pago.amount).toLocaleString('es-CL')}`,
      html
    });

    console.log('Email enviado OK');
  } catch (err) {
    console.error('Error email:', err);
  }
}

// Página principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Página de gracias
app.get('/gracias', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'gracias.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Giramondo corriendo en puerto ${PORT}`));
