const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { requireAdmin } = require('../auth');
const storage = require('../storage');

// Dosyalar bellekte tutulur; ardından storage.uploadFile ile R2'ye (veya local diske) yazılır.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // en fazla 500 MB
  fileFilter: (req, file, cb) => {
    const ok = path.extname(file.originalname || '').toLowerCase() === '.zip';
    if (!ok) return cb(new Error('Sadece .zip dosyası yükleyebilirsiniz.'));
    cb(null, true);
  }
});

// Güvenli dosya anahtarı: games/<slug>-<zaman>.zip
function makeKey(slug, original) {
  const base = String(slug || 'oyun')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'oyun';
  const ext = (path.extname(original || '') || '.zip').toLowerCase();
  return `games/${base}-${Date.now()}${ext}`;
}

router.get('/', requireAdmin, async (req, res) => {
  res.locals.title = 'Admin Panel';
  const games = (await db.query('SELECT * FROM games ORDER BY created_at DESC')).rows;
  const orders = (await db.query('SELECT o.*, u.email FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 50')).rows;
  const counts = {
    games: games.length,
    orders: (await db.query('SELECT COUNT(*) c FROM orders')).rows[0].c,
    users: (await db.query('SELECT COUNT(*) c FROM users')).rows[0].c,
    revenue: (await db.query("SELECT COALESCE(SUM(total_amount),0) s FROM orders WHERE status='paid'")).rows[0].s
  };

  // Depolama bilgisi
  let storageInfo = { mode: storage.s3 ? 'Cloudflare R2' : 'Local (uygulama diski)', files: 0, size: 0 };
  if (storage.s3) {
    const r = await db.query('SELECT COUNT(DISTINCT file_key) c FROM games');
    storageInfo.files = Number(r.rows[0].c);
  } else {
    try {
      const files = fs.readdirSync(storage.STORAGE_DIR);
      storageInfo.files = files.filter((f) => f !== '.gitkeep').length;
      storageInfo.size = files.reduce((s, f) => {
        try { return s + fs.statSync(path.join(storage.STORAGE_DIR, f)).size; } catch (e) { return s; }
      }, 0);
    } catch (e) {}
  }

  res.render('admin', { games, orders, counts, storageInfo });
});

// Yeni oyun ekle — zip R2'ye (veya local diske) yüklenir
router.post('/oyun', requireAdmin, upload.single('file'), async (req, res) => {
  const { title, slug, description, price, cover_image_url, node_version, tag, featured, features, requirements, instructions, demo_url, screenshots } = req.body;
  const finalSlug = (slug || title || 'oyun').toLowerCase().replace(/\s+/g, '-');
  let file_key = (req.body.file_key || '').trim();
  if (req.file) {
    file_key = makeKey(finalSlug, req.file.originalname);
    await storage.uploadFile(req.file.buffer, file_key, 'application/zip');
  }
  if (!file_key) file_key = 'games/placeholder-' + Date.now() + '.zip';
  await db.query(
    `INSERT INTO games (title,slug,description,price,cover_image_url,file_key,node_version,tag,featured,features,requirements,instructions,demo_url,screenshots)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [title, finalSlug, description, price, cover_image_url || '', file_key, node_version || '18', tag || 'Mini Oyun', featured ? true : false, features || '', requirements || '', instructions || '', demo_url || '', screenshots || '']
  );
  res.redirect('/admin');
});

// Düzenleme sayfası
router.get('/oyun/:id/duzenle', requireAdmin, async (req, res) => {
  res.locals.title = 'Oyun Düzenle';
  const game = (await db.query('SELECT * FROM games WHERE id=$1', [Number(req.params.id)])).rows[0];
  if (!game) return res.redirect('/admin');
  res.render('admin-edit', { game });
});

// Oyun güncelle — yeni zip seçildiyse yükle, eskisini depodan sil
router.post('/oyun/:id', requireAdmin, upload.single('file'), async (req, res) => {
  const id = Number(req.params.id);
  const { title, slug, description, price, cover_image_url, node_version, tag, featured, features, requirements, instructions, demo_url, screenshots } = req.body;
  const old = (await db.query('SELECT * FROM games WHERE id=$1', [id])).rows[0];
  if (!old) return res.redirect('/admin');
  const finalSlug = (slug || title || old.slug).toLowerCase().replace(/\s+/g, '-');
  let newFileKey = null;
  if (req.file) {
    newFileKey = makeKey(finalSlug, req.file.originalname);
    await storage.uploadFile(req.file.buffer, newFileKey, 'application/zip');
  }
  let sql = 'UPDATE games SET title=$1,slug=$2,description=$3,price=$4,cover_image_url=$5,node_version=$6,tag=$7,featured=$8,features=$9,requirements=$10,instructions=$11,demo_url=$12,screenshots=$13';
  const params = [title, finalSlug, description, price, cover_image_url, node_version, tag, featured ? true : false, features || '', requirements || '', instructions || '', demo_url || '', screenshots || ''];
  if (newFileKey) { sql += ',file_key=$' + (params.length + 1); params.push(newFileKey); }
  sql += ' WHERE id=$' + (params.length + 1);
  params.push(id);
  await db.query(sql, params);
  if (newFileKey && old.file_key && old.file_key !== newFileKey) await storage.deleteFile(old.file_key);
  res.redirect('/admin');
});

// Oyun sil — dosyayı da depodan temizle
router.post('/oyun/:id/sil', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const g = (await db.query('SELECT * FROM games WHERE id=$1', [id])).rows[0];
  await db.query('DELETE FROM games WHERE id=$1', [id]);
  if (g && g.file_key) await storage.deleteFile(g.file_key);
  res.redirect('/admin');
});

module.exports = router;
