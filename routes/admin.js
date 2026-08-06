const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { requireAdmin } = require('../auth');
const storage = require('../storage');

const upload = multer({
  storage: multer.diskStorage({
    destination: storage.STORAGE_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.zip';
      cb(null, 'game_' + Date.now() + ext);
    }
  })
});

// ── Admin Ana Sayfa & Dashboard ──────────────────────────────────────
router.get('/', requireAdmin, async (req, res) => {
  res.locals.title = 'Admin Panel';
  let games = [], orders = [], users = [];
  let stats = { totalRevenue: 0, pendingCount: 0, totalUsers: 0, totalOrders: 0 };

  try {
    games = (await db.query('SELECT * FROM games ORDER BY created_at DESC')).rows;
    orders = (await db.query(`
      SELECT o.*, u.email, u.name AS user_name,
        json_agg(json_build_object('title', g.title, 'price', oi.price_at_purchase)) AS items
      FROM orders o
      JOIN users u ON u.id = o.user_id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN games g ON g.id = oi.game_id
      GROUP BY o.id, u.email, u.name
      ORDER BY o.created_at DESC
      LIMIT 100
    `)).rows;

    users = (await db.query('SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC LIMIT 50')).rows;
    let coupons = [];
    try { coupons = (await db.query('SELECT * FROM coupons ORDER BY created_at DESC')).rows; } catch(e) {}

    const rRev = await db.query(`SELECT COALESCE(SUM(total_amount),0) AS v FROM orders WHERE status='paid'`);
    stats.totalRevenue = rRev.rows[0]?.v || 0;
    const rPend = await db.query(`SELECT COUNT(*) AS v FROM orders WHERE status='pending'`);
    stats.pendingCount = rPend.rows[0]?.v || 0;
    const rUsers = await db.query(`SELECT COUNT(*) AS v FROM users WHERE role='user'`);
    stats.totalUsers = rUsers.rows[0]?.v || 0;
    const rOrd = await db.query(`SELECT COUNT(*) AS v FROM orders`);
    stats.totalOrders = rOrd.rows[0]?.v || 0;

    res.render('admin', { games, orders, users, coupons, stats });
    return;
  } catch (err) {
    console.error('⚠️ Admin paneli sorgu uyarısı:', err.message);
  }

  res.render('admin', { games: [], orders: [], users: [], coupons: [], stats });
});

// ── Kupon Ekle ───────────────────────────────────────────────────────
router.post('/kupon', requireAdmin, async (req, res) => {
  const { code, discount_percent, discount_amount } = req.body;
  if (!code) return res.redirect('/admin');
  try {
    const cleanCode = code.trim().toUpperCase();
    await db.query(
      'INSERT INTO coupons (code, discount_percent, discount_amount, active) VALUES ($1,$2,$3,true) ON CONFLICT (code) DO NOTHING',
      [cleanCode, Number(discount_percent || 0), Number(discount_amount || 0)]
    );
  } catch (e) {
    console.error('Kupon ekleme hatası:', e);
  }
  res.redirect('/admin');
});

// ── Kupon Sil ────────────────────────────────────────────────────────
router.post('/kupon/:id/sil', requireAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM coupons WHERE id=$1', [Number(req.params.id)]);
  } catch (e) {
    console.error('Kupon silme hatası:', e);
  }
  res.redirect('/admin');
});

// ── Oyun Ekle ──────────────────────────────────────────────────────
router.post('/oyun', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    const { title, slug, description, price, cover_image_url, node_version, tag, featured, external_buy_url } = req.body;
    const file_key = req.file ? req.file.filename : (req.body.file_key || 'placeholder.txt');
    const autoSlug = (slug && slug.trim()) ? slug.trim().toLowerCase() : title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    
    await db.query(
      `INSERT INTO games (title,slug,description,price,cover_image_url,file_key,node_version,tag,featured,external_buy_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [title, autoSlug, description || '', price || 0, cover_image_url || '', file_key, node_version || '18', tag || 'Mini Oyun', featured ? true : false, external_buy_url || '']
    );
  } catch (e) {
    console.error('Oyun ekleme hatası:', e);
  }
  res.redirect('/admin');
});

// ── Oyun Düzenle (POST /admin/oyun/:id/duzenle) ────────────────────
router.post('/oyun/:id/duzenle', requireAdmin, upload.single('file'), async (req, res) => {
  const id = Number(req.params.id);
  const { title, slug, description, price, cover_image_url, node_version, tag, featured, external_buy_url } = req.body;
  const file_key = req.file ? req.file.filename : undefined;

  try {
    let sql = 'UPDATE games SET title=$1, slug=$2, description=$3, price=$4, cover_image_url=$5, node_version=$6, tag=$7, featured=$8, external_buy_url=$9';
    const params = [title, slug, description, price, cover_image_url, node_version || '18', tag || 'Mini Oyun', featured ? true : false, external_buy_url || ''];
    
    if (file_key) {
      sql += ', file_key=$' + (params.length + 1);
      params.push(file_key);
    }
    
    sql += ' WHERE id=$' + (params.length + 1);
    params.push(id);
    await db.query(sql, params);
  } catch (e) {
    console.error('Oyun güncelleme hatası:', e);
  }
  res.redirect('/admin');
});

// ── Oyun Sil (Güvenli CASCADE silme) ────────────────────────────────
router.post('/oyun/:id/sil', requireAdmin, async (req, res) => {
  const gameId = Number(req.params.id);
  const cli = await db.connect();
  try {
    await cli.query('BEGIN');
    // İlişkili tabloları temizle (Foreign key hatası almamak için)
    await cli.query('DELETE FROM user_library WHERE game_id=$1', [gameId]);
    await cli.query('DELETE FROM order_items WHERE game_id=$1', [gameId]);
    await cli.query('DELETE FROM games WHERE id=$1', [gameId]);
    await cli.query('COMMIT');
  } catch (e) {
    await cli.query('ROLLBACK');
    console.error('Oyun silme hatası:', e);
  } finally {
    cli.release();
  }
  res.redirect('/admin');
});

// ── Sipariş Onayla ─────────────────────────────────────────────────
router.post('/siparis/:id/onayla', requireAdmin, async (req, res) => {
  const orderId = Number(req.params.id);
  const cli = await db.connect();
  try {
    await cli.query('BEGIN');
    await cli.query(`UPDATE orders SET status='paid' WHERE id=$1`, [orderId]);
    
    // Siparişin kullanıcı id'sini al
    const orderRes = await cli.query(`SELECT user_id FROM orders WHERE id=$1`, [orderId]);
    const userId = orderRes.rows[0]?.user_id;

    if (userId) {
      // Siparişe ait tüm oyun id'lerini al ve kütüphaneye ekle
      const itemsRes = await cli.query(`SELECT game_id FROM order_items WHERE order_id=$1`, [orderId]);
      for (const item of itemsRes.rows) {
        await cli.query(
          `INSERT INTO user_library (user_id, game_id) VALUES ($1,$2) ON CONFLICT (user_id, game_id) DO NOTHING`,
          [userId, item.game_id]
        );
      }
    }
    await cli.query('COMMIT');
    console.log(`✅ Sipariş #${orderId} onaylandı ve user_library kütüphanesine eklendi.`);
  } catch (e) {
    await cli.query('ROLLBACK');
    console.error('Sipariş onay hatası:', e);
  } finally {
    cli.release();
  }
  res.redirect('/admin');
});

// ── Admin: Kullanıcıya Doğrudan Oyun Tanımla (E-posta ile) ───────────
router.post('/kullaniciya-oyun-ekle', requireAdmin, async (req, res) => {
  const { email, game_id } = req.body;
  if (!email || !game_id) return res.redirect('/admin');
  try {
    const cleanEmail = String(email).trim().toLowerCase();
    const userRes = await db.query('SELECT id FROM users WHERE LOWER(email)=$1', [cleanEmail]);
    const user = userRes.rows[0];
    if (user) {
      await db.query(
        'INSERT INTO user_library (user_id, game_id) VALUES ($1,$2) ON CONFLICT (user_id, game_id) DO NOTHING',
        [user.id, Number(game_id)]
      );
      console.log(`✅ ${cleanEmail} kullanıcısına ${game_id} nolu oyun kütüphaneye doğrudan tanımlandı.`);
    }
  } catch (e) {
    console.error('Doğrudan oyun tanımlama hatası:', e);
  }
  res.redirect('/admin');
});

// ── Sipariş İptal Et ───────────────────────────────────────────────
router.post('/siparis/:id/iptal', requireAdmin, async (req, res) => {
  try {
    await db.query(`UPDATE orders SET status='cancelled' WHERE id=$1`, [Number(req.params.id)]);
  } catch (e) {
    console.error('Sipariş iptal hatası:', e);
  }
  res.redirect('/admin');
});

// ── Sipariş Sil ───────────────────────────────────────────────────
router.post('/siparis/:id/sil', requireAdmin, async (req, res) => {
  const orderId = Number(req.params.id);
  const cli = await db.connect();
  try {
    await cli.query('BEGIN');
    await cli.query('DELETE FROM order_items WHERE order_id=$1', [orderId]);
    await cli.query('DELETE FROM orders WHERE id=$1', [orderId]);
    await cli.query('COMMIT');
  } catch (e) {
    await cli.query('ROLLBACK');
    console.error('Sipariş silme hatası:', e);
  } finally {
    cli.release();
  }
  res.redirect('/admin');
});

// ── Kullanıcı Rol Değiştir (Admin Yetkisi Ver / Al) ─────────────────
router.post('/kullanici/:id/rol', requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const { role } = req.body;
  try {
    const newRole = role === 'admin' ? 'admin' : 'user';
    await db.query('UPDATE users SET role=$1 WHERE id=$2', [newRole, userId]);
  } catch (e) {
    console.error('Kullanıcı rol güncelleme hatası:', e);
  }
  res.redirect('/admin');
});

module.exports = router;