require('dotenv').config();
require('express-async-errors'); // async route hatalarını otomatik olarak hata yakalayıcıya yönlendirir
const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const db = require('./db');
const { getUser } = require('./auth');
const { STORAGE_DIR } = require('./storage');

const app = express();
app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Sağlık kontrolü (Railway / uptime monitor)
app.get('/health', async (req, res) => {
  try { await db.query('SELECT 1'); res.send('ok'); }
  catch (e) { res.status(503).send('db error'); }
});

// storage klasörünün var olduğundan emin ol
const targetStorageDir = (STORAGE_DIR && String(STORAGE_DIR).trim() !== '') ? STORAGE_DIR : path.join(__dirname, 'storage');
if (!fs.existsSync(targetStorageDir)) {
  try { fs.mkdirSync(targetStorageDir, { recursive: true }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
}
try { fs.writeFileSync(path.join(targetStorageDir, '.gitkeep'), ''); } catch (e) {}

// Tüm istekler için ortak veriler (kullanıcı, sepet sayısı, başlık)
app.use((req, res, next) => {
  res.locals.user = getUser(req);
  let cart = [];
  try { cart = req.cookies.cart ? JSON.parse(req.cookies.cart) : []; } catch (e) {}
  res.locals.cartCount = cart.length;
  res.locals.title = 'Reyiz Market';
  next();
});

// Rate limiting: giriş/kayıt ve indirme
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: 'Çok fazla deneme. Lütfen biraz bekleyin.' });
app.use('/giris', authLimiter);
app.use('/kayit', authLimiter);

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/games'));
app.use('/', require('./routes/checkout'));
app.use('/', require('./routes/library'));
app.use('/', require('./routes/orders'));
app.use('/admin', require('./routes/admin'));

app.use((req, res) => res.status(404).render('error', { message: 'Sayfa bulunamadı.', status: 404 }));

// Global hata yakalayıcı — uygulama çökmesin, temiz hata sayfası göstersin
app.use((err, req, res, next) => {
  console.error('❌ Hata:', err);
  res.status(500).render('error', { message: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.', status: 500 });
});

// Beklenmedik çökmelere karşı koruma (Node çökmesin)
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('⚡ Reyiz Market çalışıyor → http://localhost:' + PORT));