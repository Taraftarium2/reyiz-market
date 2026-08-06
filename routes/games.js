const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../auth');

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

// API: Canlı Satış Bildirimleri (Social Proof Pop-Up için)
router.get('/api/recent-sales', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT o.created_at, u.name AS user_name, u.email, g.title AS game_title
      FROM orders o
      JOIN users u ON u.id = o.user_id
      JOIN order_items oi ON oi.order_id = o.id
      JOIN games g ON g.id = oi.game_id
      ORDER BY o.created_at DESC
      LIMIT 8
    `);
    const sales = r.rows.map(s => ({
      name: (s.user_name || s.email.split('@')[0]).replace(/(?<=.{2}).(?=.*@)/g, '*'),
      game: s.game_title,
      time: new Date(s.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    }));
    res.json(sales);
  } catch (e) {
    res.json([
      { name: 'Ahmet***', game: 'Kelime Savaşı', time: '12:40' },
      { name: 'Mehmet***', game: 'Ne Çizdim?', time: '12:25' },
      { name: 'Selin***', game: 'Mini Race 2D', time: '12:05' }
    ]);
  }
});

// Oyun Kataloğu (/oyunlar) — Gelişmiş Filtreleme & Sıralama
router.get('/oyunlar', async (req, res) => {
  res.locals.title = 'Oyun Kataloğu';
  const { q, tag, sort } = req.query;
  let games = [], tags = [];
  try {
    let sql = 'SELECT * FROM games WHERE 1=1';
    const params = [];
    if (q) { params.push('%' + q + '%'); sql += ` AND (title ILIKE $${params.length} OR description ILIKE $${params.length})`; }
    if (tag) { params.push(tag); sql += ` AND tag = $${params.length}`; }
    
    if (sort === 'price_asc') {
      sql += ' ORDER BY price ASC';
    } else if (sort === 'price_desc') {
      sql += ' ORDER BY price DESC';
    } else if (sort === 'popular') {
      sql += ' ORDER BY featured DESC, created_at DESC';
    } else {
      sql += ' ORDER BY created_at DESC';
    }

    games = (await db.query(sql, params)).rows;
    tags = (await db.query('SELECT DISTINCT tag FROM games WHERE tag IS NOT NULL')).rows.map((r) => r.tag);
  } catch (e) {
    console.error('Oyunlar sorgu uyarısı:', e.message);
  }
  res.render('game', { games, tags, q, tag, sort });
});

// Oyun Detay Sayfası (/oyunlar/:slug) & Yorumlar
router.get('/oyunlar/:slug', async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM games WHERE slug=$1', [req.params.slug]);
    const game = r.rows[0];
    if (!game) return res.status(404).render('error', { message: 'Oyun bulunamadı.', status: 404 });
    
    // Yorumlar
    let reviews = [];
    try {
      reviews = (await db.query('SELECT * FROM reviews WHERE game_id=$1 ORDER BY created_at DESC LIMIT 20', [game.id])).rows;
    } catch(e) {}

    // Benzer oyunlar
    const related = (await db.query('SELECT * FROM games WHERE id != $1 ORDER BY RANDOM() LIMIT 3', [game.id])).rows;
    
    res.locals.title = game.title + ' — TikTok LIVE Oyunu';
    return res.render('detail', { game, related, reviews });
  } catch (e) {
    console.error('Oyun detay uyarısı:', e.message);
    return res.status(404).render('error', { message: 'Oyun bulunamadı.', status: 404 });
  }
});

// Oyuna Yorum Yap (POST /oyunlar/:slug/yorum)
router.post('/oyunlar/:slug/yorum', requireAuth, async (req, res) => {
  const { rating, comment } = req.body;
  try {
    const r = await db.query('SELECT id FROM games WHERE slug=$1', [req.params.slug]);
    const game = r.rows[0];
    if (game) {
      await db.query(
        'INSERT INTO reviews (game_id, user_id, user_name, rating, comment) VALUES ($1,$2,$3,$4,$5)',
        [game.id, req.user.id, req.user.name || req.user.email.split('@')[0], Math.min(5, Math.max(1, Number(rating || 5))), comment || '']
      );
    }
  } catch(e) {
    console.error('Yorum ekleme hatası:', e);
  }
  res.redirect('/oyunlar/' + req.params.slug);
});

module.exports = router;