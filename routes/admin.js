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

router.get('/', requireAdmin, async (req, res) => {
  res.locals.title = 'Admin Panel';
  let games = [], orders = [];
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

    const rRev = await db.query(`SELECT COALESCE(SUM(total_amount),0) AS v FROM orders WHERE status='paid'`);
    stats.totalRevenue = rRev.rows[0]?.v || 0;
    const rPend = await db.query(`SELECT COUNT(*) AS v FROM orders WHERE status='pending'`);
    stats.pendingCount = rPend.rows[0]?.v || 0;
    const rUsers = await db.query(`SELECT COUNT(*) AS v FROM users WHERE role='user'`);
    stats.totalUsers = rUsers.rows[0]?.v || 0;
    const rOrd = await db.query(`SELECT COUNT(*) AS v FROM orders`);
    stats.totalOrders = rOrd.rows[0]?.v || 0;
  } catch (err) {
    console.error('⚠️ Admin paneli sorgu uyarısı:', err.message);
  }

  res.render('admin', { games, orders, stats });
});

// ── Oyun Ekle ──────────────────────────────────────────────────────
router.post('/oyun', requireAdmin, upload.single('file'), async (req, res) => {
  const { title, slug, description, price, cover_image_url, node_version, tag, featured } = req.body;
  const file_key = req.file ? req.file.filename : (req.body.file_key || 'placeholder.txt');
  await db.query(
    `INSERT INTO games (title,slug,description,price,cover_image_url,file_key,node_version,tag,featured)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [title, slug || title.toLowerCase().replace(/\s+/g, '-'), description, price, cover_image_url || '', file_key, node_version || '18', tag || 'Mini Oyun', featured ? true : false]
  );
  res.redirect('/admin');
});

// ── Oyun Güncelle ──────────────────────────────────────────────────
router.post('/oyun/:id', requireAdmin, upload.single('file'), async (req, res) => {
  const id = Number(req.params.id);
  const { title, slug, description, price, cover_image_url, node_version, tag, featured } = req.body;
  const file_key = req.file ? req.file.filename : undefined;
  let sql = 'UPDATE games SET title=$1,slug=$2,description=$3,price=$4,cover_image_url=$5,node_version=$6,tag=$7,featured=$8';
  const params = [title, slug, description, price, cover_image_url, node_version, tag, featured ? true : false];
  if (file_key) { sql += ',file_key=$' + (params.length + 1); params.push(file_key); }
  sql += ' WHERE id=$' + (params.length + 1);
  params.push(id);
  await db.query(sql, params);
  res.redirect('/admin');
});

// ── Oyun Sil ───────────────────────────────────────────────────────
router.post('/oyun/:id/sil', requireAdmin, async (req, res) => {
  await db.query('DELETE FROM games WHERE id=$1', [Number(req.params.id)]);
  res.redirect('/admin');
});

// ── Sipariş Onayla ─────────────────────────────────────────────────
// Siparişi paid yapar ve tüm ürünleri user_library'e ekler (transaction)
router.post('/siparis/:id/onayla', requireAdmin, async (req, res) => {
  const orderId = Number(req.params.id);
  const cli = await db.connect();
  try {
    await cli.query('BEGIN');

    // Siparişi paid yap
    await cli.query(`UPDATE orders SET status='paid' WHERE id=$1 AND status='pending'`, [orderId]);

    // Siparişe ait ürünleri bul
    const items = (await cli.query(
      `SELECT oi.game_id, o.user_id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.order_id = $1`,
      [orderId]
    )).rows;

    // user_library'e ekle
    for (const item of items) {
      await cli.query(
        `INSERT INTO user_library (user_id, game_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [item.user_id, item.game_id]
      );
    }

    await cli.query('COMMIT');
  } catch (e) {
    await cli.query('ROLLBACK');
    throw e;
  } finally {
    cli.release();
  }
  res.redirect('/admin');
});

// ── Sipariş İptal Et ───────────────────────────────────────────────
router.post('/siparis/:id/iptal', requireAdmin, async (req, res) => {
  await db.query(`UPDATE orders SET status='cancelled' WHERE id=$1`, [Number(req.params.id)]);
  res.redirect('/admin');
});

module.exports = router;