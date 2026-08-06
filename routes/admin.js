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
  const games = (await db.query('SELECT * FROM games ORDER BY created_at DESC')).rows;
  const orders = (await db.query('SELECT o.*, u.email FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 50')).rows;
  res.render('admin', { games, orders });
});

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

router.post('/oyun/:id/sil', requireAdmin, async (req, res) => {
  await db.query('DELETE FROM games WHERE id=$1', [Number(req.params.id)]);
  res.redirect('/admin');
});

module.exports = router;