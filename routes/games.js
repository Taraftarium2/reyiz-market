const router = require('express').Router();
const db = require('../db');

router.get('/', async (req, res) => {
  res.locals.title = 'Reyiz Market · TikTok LIVE Oyunları';
  let featured = [], latest = [], tags = [];
  try {
    featured = (await db.query('SELECT * FROM games WHERE featured = true ORDER BY created_at DESC LIMIT 4')).rows;
    latest = (await db.query('SELECT * FROM games ORDER BY created_at DESC LIMIT 6')).rows;
    tags = (await db.query('SELECT DISTINCT tag FROM games WHERE tag IS NOT NULL')).rows.map((r) => r.tag);
  } catch (e) {
    console.error('Anasayfa sorgu uyarısı:', e.message);
  }
  res.render('index', { featured, latest, tags });
});

// Rehber Sayfası (/rehber)
router.get('/rehber', (req, res) => {
  res.locals.title = 'Yayıncı Kurulum Rehberi';
  res.render('guide');
});

// Oyun Kataloğu (/oyunlar)
router.get('/oyunlar', async (req, res) => {
  res.locals.title = 'Oyun Kataloğu';
  const { q, tag } = req.query;
  let games = [], tags = [];
  try {
    let sql = 'SELECT * FROM games WHERE 1=1';
    const params = [];
    if (q) { params.push('%' + q + '%'); sql += ` AND (title ILIKE $${params.length} OR description ILIKE $${params.length})`; }
    if (tag) { params.push(tag); sql += ` AND tag = $${params.length}`; }
    sql += ' ORDER BY created_at DESC';
    games = (await db.query(sql, params)).rows;
    tags = (await db.query('SELECT DISTINCT tag FROM games WHERE tag IS NOT NULL')).rows.map((r) => r.tag);
  } catch (e) {
    console.error('Oyunlar sorgu uyarısı:', e.message);
  }
  res.render('game', { games, tags, q, tag });
});

// Oyun Detay Sayfası (/oyunlar/:slug)
router.get('/oyunlar/:slug', async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM games WHERE slug=$1', [req.params.slug]);
    const game = r.rows[0];
    if (!game) return res.status(404).render('error', { message: 'Oyun bulunamadı.', status: 404 });
    
    // Benzer oyunlar
    const related = (await db.query('SELECT * FROM games WHERE id != $1 ORDER BY RANDOM() LIMIT 3', [game.id])).rows;
    
    res.locals.title = game.title + ' — TikTok LIVE Oyunu';
    return res.render('detail', { game, related });
  } catch (e) {
    console.error('Oyun detay uyarısı:', e.message);
    return res.status(404).render('error', { message: 'Oyun bulunamadı.', status: 404 });
  }
});

module.exports = router;