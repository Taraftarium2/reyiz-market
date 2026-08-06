const router = require('express').Router();
const db = require('../db');

router.get('/', async (req, res) => {
  res.locals.title = 'Reyiz Market · TikTok LIVE Oyunları';
  const featured = (await db.query('SELECT * FROM games WHERE featured ORDER BY created_at DESC LIMIT 4')).rows;
  const latest = (await db.query('SELECT * FROM games ORDER BY created_at DESC LIMIT 6')).rows;
  const tags = (await db.query('SELECT DISTINCT tag FROM games')).rows.map((r) => r.tag);
  res.render('index', { featured, latest, tags });
});

router.get('/oyunlar', async (req, res) => {
  res.locals.title = 'Oyun Kataloğu';
  const { q, tag } = req.query;
  let sql = 'SELECT * FROM games WHERE 1=1';
  const params = [];
  if (q) { params.push('%' + q + '%'); sql += ` AND (title ILIKE $${params.length} OR description ILIKE $${params.length})`; }
  if (tag) { params.push(tag); sql += ` AND tag = $${params.length}`; }
  sql += ' ORDER BY created_at DESC';
  const games = (await db.query(sql, params)).rows;
  const tags = (await db.query('SELECT DISTINCT tag FROM games')).rows.map((r) => r.tag);
  res.render('games', { games, tags, q, tag });
});

router.get('/oyunlar/:slug', async (req, res) => {
  const r = await db.query('SELECT * FROM games WHERE slug=$1', [req.params.slug]);
  const game = r.rows[0];
  if (!game) return res.status(404).render('error', { message: 'Oyun bulunamadı.', status: 404 });
  res.locals.title = game.title;
  res.render('game', { game });
});

module.exports = router;