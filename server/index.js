require('dotenv').config();

const { authLimiter, apiLimiter } = require('./middleware/rateLimiter');
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { initRealtime } = require('./services/realtime');

const authRoutes = require('./routes/auth');
const reportRoutes = require('./routes/reports');
const pollRoutes = require('./routes/polls');
const adminRoutes = require('./routes/admin');
const responseRoutes = require('./routes/responses');
let dashboardRoutes;
try {
  dashboardRoutes = require('./routes/dashboard');
} catch (e) {
  console.warn('dashboard routes not loaded', e.message);
}

const app = express();
const server = http.createServer(app);

initRealtime(server);

const isProd = process.env.NODE_ENV === 'production';

const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  process.env.FRONTEND_URL,
  process.env.CORS_ORIGIN,
  process.env.CLIENT_URL,
].filter(Boolean);

if (process.env.CORS_ORIGIN && process.env.CORS_ORIGIN.includes(',')) {
  process.env.CORS_ORIGIN.split(',').forEach((o) => {
    const trimmed = o.trim();
    if (trimmed && !allowedOrigins.includes(trimmed)) allowedOrigins.push(trimmed);
  });
}

app.use('/api/', apiLimiter);
app.use('/api/auth', authLimiter);
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || isProd) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));

// Optional report evidence images
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir, { maxAge: isProd ? '7d' : 0 }));

if (isProd) app.set('trust proxy', 1);

app.use('/api/auth', authRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/polls', pollRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/responses', responseRoutes);
if (dashboardRoutes) app.use('/api/dashboard', dashboardRoutes);

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, env: process.env.NODE_ENV || 'development', time: new Date().toISOString() })
);
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const publicDirCandidates = [
  path.join(__dirname, 'public'),
  path.join(__dirname, '../client/dist'),
];
const publicDir = publicDirCandidates.find((d) => fs.existsSync(path.join(d, 'index.html')));

if (publicDir) {
  app.use(express.static(publicDir, { maxAge: isProd ? '1d' : 0, index: false }));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
  console.log(`Serving frontend from ${publicDir}`);
}

if (isProd) {
  const weak = ['dev_secret_change_me', 'dev_refresh_secret', 'WeaponX', 'changeme', 'secret'];
  const jwt = process.env.JWT_SECRET || '';
  const refresh = process.env.REFRESH_SECRET || '';
  if (weak.includes(jwt) || weak.includes(refresh) || jwt.length < 24 || refresh.length < 24) {
    console.warn('WARNING: JWT_SECRET / REFRESH_SECRET look weak or default. Set strong secrets before public traffic.');
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});
