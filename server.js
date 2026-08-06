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
app.set('views', path.join(__dirname, 'views'))
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Sağlık kontrolü (Railway / uptime monitor)
app.get('/health', async (req, res) => {
  try { await db.query('SELECT 1'); res.send('ok'); }
  catch (e) { res.status(503).send('db error: ' + e.message); }
});

// R2 + Library sağlık kontrolü (debug için)
app.get('/health/r2', async (req, res) => {
  try {
    const storage = require('./storage');
    const status = storage.getR2ConfigStatus ? storage.getR2ConfigStatus() : { configured: storage.isR2Configured() };
    let test = null;
    if (storage.testR2Connection) {
      test = await storage.testR2Connection();
    }
    // DB library sağlık
    let libCheck = null;
    try {
      const c = await db.query('SELECT COUNT(*) AS v FROM user_library');
      libCheck = `user_library: ${c.rows[0].v} kayıt`;
    } catch(e) { libCheck = 'hata: ' + e.message; }
    res.json({ r2Status: status, r2Test: test, storageDir: STORAGE_DIR, exists: fs.existsSync(STORAGE_DIR), libCheck, paymentMode: process.env.PAYMENT_MODE || 'manual' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
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
  try { fs.mkdirSync(targetStorageDir, { recursive: true }); console.log('📁 Storage klasörü oluşturuldu:', targetStorageDir); } catch (e) { if (e.code !== 'EEXIST') throw e; }
}
try { fs.writeFileSync(path.join(targetStorageDir, '.gitkeep'), ''); } catch (e) {}

// R2 durumunu başlangıçta logla
try {
  const storage = require('./storage');
  const s = storage.getR2ConfigStatus ? storage.getR2ConfigStatus() : { configured: storage.isR2Configured() };
  console.log('🔧 R2 Durumu (başlangıç):', JSON.stringify(s));
  console.log('🔧 PAYMENT_MODE:', process.env.PAYMENT_MODE || 'manual (varsayılan)');
  if (!s.configured) {
    console.warn('⚠️ UYARI: R2 yapılandırılmadı! Dosyalar sadece yerel diskte saklanacak. Railway/Render gibi ephemeral diskte dosyalar restart sonrası kaybolabilir.');
    console.warn('   Çözüm: Railway dashboard > Variables > R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET ekleyin.');
  }
} catch(e) {}

// Otomatik veritabanı kurulumu ve Admin hesabı garantisi
(async function initDatabase() {
  try {
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await db.query(schemaSql);
    console.log('✅ schema.sql uygulandı');
    await db.query('ALTER TABLE games ADD COLUMN IF NOT EXISTS external_buy_url TEXT');
    await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code TEXT');
    await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) DEFAULT 0');
    // Eksik olabilecek kolonlar için ek ALTER (idempotent)
    await db.query('ALTER TABLE games ADD COLUMN IF NOT EXISTS file_key TEXT');
    await db.query('ALTER TABLE user_library ADD COLUMN IF NOT EXISTS download_count INT DEFAULT 0');

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

    // Library sağlık kontrolü: pending ama paid olmalı olan sipariş var mı?
    try {
      const pend = (await db.query(`SELECT COUNT(*) AS v FROM orders WHERE status='pending'`)).rows[0].v;
      if (Number(pend) > 0) console.log(`ℹ️ ${pend} adet bekleyen sipariş var - admin onayı bekleniyor`);
    } catch(e) {}
  } catch (err) {
    console.error('⚠️ DB otomatik kurulum uyarısı:', err.message, err.stack?.slice(0, 500));
  }
})();

// Tüm istekler için ortak veriler (kullanıcı, sepet sayısı, başlık)
app.use((req, res, next) => {
  res.locals.user = getUser(req);
  let cart = [];
  try { cart = req.cookies.cart ? JSON.parse(req.cookies.cart) : []; } catch (e) {}
  res.locals.cartCount = Array.isArray(cart) ? cart.length : 0;
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
  console.error('❌ Hata:', err.message, err.stack?.slice(0, 800));
  res.status(500).render('error', { message: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.', status: 500 });
});

// Beklenmedik çökmelere karşı koruma (Node çökmesin)
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err?.message || err));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err?.message || err));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('⚡ Reyiz Market çalışıyor → http://localhost:' + PORT));
