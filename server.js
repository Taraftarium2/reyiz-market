require('dotenv').config();
require('express-async-errors'); // async route hatalarını otomatik olarak hata yakalayıcıya yönlendirir
const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const db = require('./db');
const { getUser } = require('./auth');
const { STORAGE_DIR, isR2Configured } = require('./storage');

const app = express();
app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Railway / reverse-proxy arkasında doğru client IP için (rate-limit ve iyzico için gerekli)
app.set('trust proxy', 1);

// Temel güvenlik başlıkları (helmet'in hafif hali)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  const csp = [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "script-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);
  next();
});

app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Sağlık kontrolü (Railway / uptime monitor)
app.get('/health', async (req, res) => {
  try { await db.query('SELECT 1'); res.send('ok'); }
  catch (e) { res.status(503).send('db error'); }
});

// SEO: robots.txt
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send("User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /profil\nSitemap: https://reyizmarket.click/sitemap.xml");
});

// SEO: sitemap.xml (Google Indexing Standard)
app.get('/sitemap.xml', async (req, res) => {
  res.type('application/xml');
  try {
    const games = (await db.query('SELECT slug, created_at FROM games')).rows;
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n';
    xml += '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n';
    xml += '  <url><loc>https://reyizmarket.click/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n';
    xml += '  <url><loc>https://reyizmarket.click/oyunlar</loc><changefreq>daily</changefreq><priority>0.9</priority></url>\n';
    xml += '  <url><loc>https://reyizmarket.click/rehber</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>\n';
    games.forEach(g => {
      xml += `  <url><loc>https://reyizmarket.click/oyunlar/${g.slug}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>\n`;
    });
    xml += '</urlset>';
    res.send(xml);
  } catch (e) {
    res.send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://reyizmarket.click/</loc></url></urlset>');
  }
});

// storage klasörünün var olduğundan emin ol
const targetStorageDir = (STORAGE_DIR && String(STORAGE_DIR).trim() !== '') ? STORAGE_DIR : path.join(__dirname, 'storage');
if (!fs.existsSync(targetStorageDir)) {
  try { fs.mkdirSync(targetStorageDir, { recursive: true }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
}
try { fs.writeFileSync(path.join(targetStorageDir, '.gitkeep'), ''); } catch (e) {}

// Otomatik veritabanı kurulumu ve Admin hesabı garantisi
(async function initDatabase() {
  try {
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await db.query(schemaSql);
    await db.query('ALTER TABLE games ADD COLUMN IF NOT EXISTS external_buy_url TEXT');
    await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code TEXT');
    await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) DEFAULT 0');

    // Örnek indirim kuponu kontrolü
    const existingCoupon = await db.query("SELECT id FROM coupons WHERE code='TIKTOK20'");
    if (!existingCoupon.rows.length) {
      await db.query("INSERT INTO coupons (code, discount_percent, active) VALUES ('TIKTOK20', 20, true)");
      console.log('✅ Varsayılan kupon eklendi: TIKTOK20 (%20 İndirim)');
    }
    
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@reyizmarket.click';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(adminPass, 10);
    
    const existing = await db.query('SELECT id FROM users WHERE email=$1', [adminEmail]);
    if (!existing.rows.length) {
      await db.query('INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,$3,$4)',
        [adminEmail, hash, 'Admin', 'admin']);
      console.log('✅ Admin hesabı sıfırdan oluşturuldu:', adminEmail);
    } else {
      await db.query('UPDATE users SET password_hash=$1, role=$2 WHERE email=$3',
        [hash, 'admin', adminEmail]);
      console.log('✅ Admin hesabı şifre ve yetkisi güncellendi:', adminEmail);
    }
  } catch (err) {
    console.error('⚠️ DB otomatik kurulum uyarısı:', err.message);
  }
})();

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

app.use((req, res) => {
  res.status(404);
  if (req.accepts('json') && (req.path.startsWith('/api') || req.xhr)) {
    return res.json({ error: 'Sayfa bulunamadı.', status: 404 });
  }
  res.locals.title = 'Sayfa Bulunamadı';
  res.render('error', { message: 'Sayfa bulunamadı.', status: 404 });
});

// Global hata yakalayıcı — uygulama çökmesin, temiz hata sayfası göstersin
app.use((err, req, res, next) => {
  const status = err.status || 500;
  console.error('❌ Hata (' + status + '):', err.message);
  if (status === 404) {
    res.locals.title = 'Sayfa Bulunamadı';
    return res.status(404).render('error', { message: 'Sayfa bulunamadı.', status: 404 });
  }
  if (req.accepts('json') && (req.path.startsWith('/api') || req.xhr)) {
    return res.status(status).json({ error: 'Beklenmeyen bir hata oluştu.', status });
  }
  res.locals.title = 'Bir Hata Oluştu';
  res.status(status).render('error', { message: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.', status });
});

// Beklenmedik çökmelere karşı koruma (Node çökmesin)
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const r2msg = isR2Configured() ? '✅ Cloudflare R2 aktif (bucket: ' + (process.env.R2_BUCKET || '') + ')' : '⚠️ R2 YAPILANDIRILMADI — dosyalar sadece geçici local storage\'de saklanacak. Railway "Variables" bölümüne R2_* ekle.';
  console.log('⚡ Reyiz Market çalışıyor → http://localhost:' + PORT);
  console.log(r2msg);
  console.log('📂 STORAGE_DIR:', STORAGE_DIR);
});