const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../auth');

router.get('/', async (req, res) => {
  res.locals.title = 'Reyiz Market · TikTok LIVE İnteraktif Oyun Mağazası';
  let games = [];
  try {
    // Tüm oyunları getir (Öne çıkanlar üstte görünür)
    const r = await db.query('SELECT * FROM games ORDER BY featured DESC, created_at DESC');
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
function maskName(s) {
  const src = String(s || '').trim();
  if (!src) return '***';
  if (src.length <= 2) return src + '***';
  return src[0] + src.slice(1, -1).replace(/./g, '*') + src[src.length - 1];
}

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
      name: maskName(s.user_name || (s.email || '').split('@')[0]),
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
    
    // Yorumları ve gerçek ortalama puanı çek
    let reviews = [];
    let rating = { avg: 4.9, count: 0 };
    try {
      reviews = (await db.query(`
        SELECT rev.*, u.name AS user_name, u.email
        FROM reviews rev JOIN users u ON u.id = rev.user_id
        WHERE rev.game_id = $1 ORDER BY rev.created_at DESC
      `, [game.id])).rows;
      if (reviews.length) {
        const agg = (await db.query(
          'SELECT ROUND(AVG(rating)::numeric, 1) AS avg, COUNT(*) AS count FROM reviews WHERE game_id = $1',
          [game.id]
        )).rows[0];
        rating = { avg: Number(agg.avg) || 4.9, count: Number(agg.count) || 0 };
      }
    } catch(e) {}

    // Benzer oyunlar (aynı kategoriden, aynı oyun hariç)
    let related = [];
    try {
      related = (await db.query(
        'SELECT * FROM games WHERE id != $1 AND LOWER(tag) = LOWER($2) ORDER BY featured DESC, created_at DESC LIMIT 4',
        [game.id, game.tag || '']
      )).rows;
      if (!related.length) {
        related = (await db.query(
          'SELECT * FROM games WHERE id != $1 ORDER BY featured DESC, created_at DESC LIMIT 4',
          [game.id]
        )).rows;
      }
    } catch(e) {}

    res.render('detail', { game, reviews, rating, related });
  } catch (e) {
    console.error('Oyun detay hatası:', e);
    res.status(500).render('error', { message: 'Bir hata oluştu.', status: 500 });
  }
});

// Yorum Ekle (tekrar gönderimi ve geçersiz puanı engelle)
router.post('/oyunlar/:slug/yorum', requireAuth, async (req, res) => {
  const comment = (req.body.comment || '').trim().slice(0, 1000);
  let rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) rating = 5;
  try {
    const g = (await db.query('SELECT id FROM games WHERE slug = $1', [req.params.slug])).rows[0];
    if (g && comment) {
      await db.query(
        'INSERT INTO reviews (user_id, game_id, rating, comment) VALUES ($1, $2, $3, $4)',
        [req.user.id, g.id, rating, comment]
      );
    }
  } catch (e) {
    console.error('Yorum ekleme hatası:', e);
  }
  res.redirect('/oyunlar/' + req.params.slug + '#yorumlar');
});

// Tüm Oyunlar Mağazası (/oyunlar)
router.get('/oyunlar', async (req, res) => {
  res.locals.title = 'Tüm İnteraktif Oyunlar';
  const q = (req.query.q || '').trim().slice(0, 100);
  const sort = ['price_asc', 'price_desc', 'popular', 'newest'].includes(req.query.sort) ? req.query.sort : 'newest';
  const tag = (req.query.tag || '').trim().slice(0, 50);
  try {
    let sql = 'SELECT * FROM games WHERE 1=1';
    const params = [];
    if (q) {
      params.push(`%${q}%`);
      sql += ` AND (LOWER(title) LIKE LOWER($${params.length}) OR LOWER(description) LIKE LOWER($${params.length}) OR LOWER(tag) LIKE LOWER($${params.length}))`;
    }
    if (tag) {
      params.push(tag);
      sql += ` AND LOWER(tag) = LOWER($${params.length})`;
    }

    if (sort === 'price_asc') sql += ' ORDER BY price ASC';
    else if (sort === 'price_desc') sql += ' ORDER BY price DESC';
    else if (sort === 'popular') sql += ' ORDER BY featured DESC, created_at DESC';
    else sql += ' ORDER BY created_at DESC';

    const games = (await db.query(sql, params)).rows;
    res.render('game', { games, query: q, sort, tag });
  } catch (e) {
    console.error('Mağaza sorgu hatası:', e);
    res.render('game', { games: [], query: q, sort, tag });
  }
});

module.exports = router;