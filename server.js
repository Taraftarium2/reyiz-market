require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const { getUser } = require('./auth');
const { STORAGE_DIR } = require('./storage');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// storage klasörünün var olduğundan emin ol
fs.mkdirSync(STORAGE_DIR, { recursive: true });
fs.writeFileSync(path.join(STORAGE_DIR, '.gitkeep'), '');

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
app.use('/admin', require('./routes/admin'));

app.use((req, res) => res.status(404).render('error', { message: 'Sayfa bulunamadı.', status: 404 }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('⚡ Reyiz Market çalışıyor → http://localhost:' + PORT));