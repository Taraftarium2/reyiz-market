const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../auth');

router.get('/', async (req, res) => {
  res.locals.title = 'Reyiz Market · TikTok LIVE İnteraktif Oyun Mağazası';
  let games = [];
  try {
    // Tüm oyunları getir (Öne çıkanlar üstte görünür)
    const r = await db.query('SELECT * FROM games ORDER BY featured DESC, created_at DESC LIMIT 20');
    games = r.rows;
  } catch (e) {
    console.error('Anasayfa sorgu uyarısı:', e.message);
  }
  res.render('index', { games, featured: games });
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

// Oyun Detay Sayfası
router.get('/oyunlar/:slug', async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM games WHERE slug = $1', [req.params.slug]);
    const game = r.rows[0];
    if (!game) return res.status(404).render('error', { message: 'Oyun bulunamadı.', status: 404 });
    res.locals.title = game.title;
    
    // Yorumları çek
    let reviews = [];
    try {
      reviews = (await db.query(`
        SELECT rev.*, u.name AS user_name, u.email
        FROM reviews rev JOIN users u ON u.id = rev.user_id
        WHERE rev.game_id = $1 ORDER BY rev.created_at DESC
      `, [game.id])).rows;
    } catch(e) {}

    res.render('detail', { game, reviews });
  } catch (e) {
    console.error('Oyun detay hatası:', e);
    res.status(500).render('error', { message: 'Bir hata oluştu.', status: 500 });
  }
});

// Yorum Ekle
router.post('/oyunlar/:slug/yorum', requireAuth, async (req, res) => {
  const { rating, comment } = req.body;
  try {
    const g = (await db.query('SELECT id FROM games WHERE slug = $1', [req.params.slug])).rows[0];
    if (g && comment) {
      await db.query(
        'INSERT INTO reviews (user_id, game_id, rating, comment) VALUES ($1, $2, $3, $4)',
        [req.user.id, g.id, Number(rating || 5), comment.trim()]
      );
    }
  } catch (e) {
    console.error('Yorum ekleme hatası:', e);
  }
  res.redirect('/oyunlar/' + req.params.slug);
});

// Tüm Oyunlar Mağazası (/oyunlar)
router.get('/oyunlar', async (req, res) => {
  res.locals.title = 'Tüm İnteraktif Oyunlar';
  const { q, sort } = req.query;
  try {
    let sql = 'SELECT * FROM games WHERE 1=1';
    const params = [];
    if (q) {
      params.push(`%${q}%`);
      sql += ` AND (LOWER(title) LIKE LOWER($${params.length}) OR LOWER(description) LIKE LOWER($${params.length}) OR LOWER(tag) LIKE LOWER($${params.length}))`;
    }

    if (sort === 'price_asc') sql += ' ORDER BY price ASC';
    else if (sort === 'price_desc') sql += ' ORDER BY price DESC';
    else if (sort === 'popular') sql += ' ORDER BY featured DESC, price DESC';
    else sql += ' ORDER BY created_at DESC';

    const games = (await db.query(sql, params)).rows;
    res.render('game', { games, query: q, sort });
  } catch (e) {
    console.error('Mağaza sorgu hatası:', e);
    res.render('game', { games: [], query: q, sort });
  }
});

module.exports = router;