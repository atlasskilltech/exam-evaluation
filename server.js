require('dotenv').config();
const express      = require('express');
const mongoose     = require('mongoose');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const path         = require('path');

const app = express();

// ── Core Middleware ──────────────────────────────────────────
app.use(cors({
  origin: process.env.CLIENT_URL,
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// ── Static Files ─────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ───────────────────────────────────────────────
app.use('/api/auth',          require('./routes/authRoutes'));
app.use('/api/exams',         require('./routes/examRoutes'));
app.use('/api/subjects',      require('./routes/subjectRoutes'));
app.use('/api/upload',        require('./routes/uploadRoutes'));
app.use('/api/ai',            require('./routes/aiRoutes'));
app.use('/api/review',        require('./routes/reviewRoutes'));
app.use('/api/csv',           require('./routes/csvRoutes'));
app.use('/api/results',       require('./routes/resultRoutes'));
app.use('/api/analytics',     require('./routes/analyticsRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/faculty',       require('./routes/facultyRoutes'));

// ── 404 Handler ──────────────────────────────────────────────
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, message: 'API route not found' });
});

// ── SPA fallback (serve index.html for non-API routes) ───────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global Error Handler ─────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ── DB Connect & Start ───────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('[DB] MongoDB connected successfully');
    app.listen(process.env.PORT, () => {
      console.log(`[SERVER] Running on http://localhost:${process.env.PORT}`);
    });
  })
  .catch(err => {
    console.error('[DB] Connection failed:', err.message);
    process.exit(1);
  });
