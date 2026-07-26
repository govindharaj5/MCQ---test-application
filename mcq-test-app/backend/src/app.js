// ============================================================================
// Express application setup
// ============================================================================
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const authRoutes = require('./routes/authRoutes');
const testRoutes = require('./routes/testRoutes');
const publicRoutes = require('./routes/publicRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const { requireAdmin } = require('./middleware/auth');
const { publicLimiter } = require('./middleware/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const FRONTEND_DIR = path.join(__dirname, '..', '..', 'frontend');

function createApp() {
  const app = express();

  // Security headers. CSP is relaxed for 'unsafe-inline' styles/scripts because
  // this project intentionally ships as plain, build-step-free HTML/CSS/JS
  // (inline <script type="module"> tags and small inline style attributes are
  // used in a few places). Tighten this if you introduce a bundler/nonce setup.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
        },
      },
    }),
  );
  app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
  app.use(express.json({ limit: '1mb' }));

  // ---- API routes ----
  app.use('/api/auth', authRoutes);
  app.use('/api/tests', requireAdmin, testRoutes);
  app.use('/api/dashboard', requireAdmin, dashboardRoutes);
  app.use('/api/public', publicLimiter, publicRoutes);

  app.get('/api/health', (req, res) => res.json({ success: true, message: 'OK' }));

  // ---- Static frontend ----
  app.use(express.static(FRONTEND_DIR));

  // Friendly public test link: /test/:id -> student entry page.
  // The client reads the ID back out of window.location.pathname.
  app.get('/test/:id', (req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'student', 'entry.html'));
  });

  // Unmatched /api/* routes -> JSON 404. Everything else -> fall through to index.
  app.use('/api', notFoundHandler);
  app.get('*', (req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
