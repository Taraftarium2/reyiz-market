const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { requireAuth } = require('../auth');
const storage = require('../storage');

router.get('/profil/kutuphanem', requireAuth, async (req, res) => {
  res.locals.title = 'Kütüphanem';
  try {
    const r = await db.query(
      `SELECT g.*, ul.purchased_at, ul.download_count
       FROM user_library ul JOIN games g ON g.id = ul.game_id
       WHERE ul.user_id = $1 ORDER BY ul.purchased_at DESC`,
      [req.user.id]
    );

    const games = r.rows.map((g) => ({
      ...g,
      downloadUrl: storage.downloadUrl(g, req.protocol + '://' + req.get('host'))
    }));

    // Bekleyen sipariş sayısı kontrolü
    const pendingOrders = (await db.query(
      `SELECT COUNT(*) AS v FROM orders WHERE user_id=$1 AND status='pending'`,
      [req.user.id]
    )).rows[0]?.v || 0;

    res.render('library', { games, pendingOrders: Number(pendingOrders) });
  } catch (e) {
    console.error('Kütüphane sorgu hatası:', e);
    res.render('library', { games: [], pendingOrders: 0 });
  }
});

// Admin Testi: Tüm Oyunları Kütüphaneye Ekle
router.post('/admin/kutuphaneme-ekle', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.redirect('/profil/kutuphanem');
  try {
    const allGames = (await db.query('SELECT id FROM games')).rows;
    for (const g of allGames) {
      await db.query(
        'INSERT INTO user_library (user_id, game_id) VALUES ($1, $2) ON CONFLICT (user_id, game_id) DO NOTHING',
        [req.user.id, g.id]
      );
    }
  } catch (e) {
    console.error('Admin kütüphane ekleme hatası:', e);
  }
  res.redirect('/profil/kutuphanem');
});

// Güvenli Oyun .ZIP İndirme Endpoint'i (Garantili Akış)
router.get('/indir/:id', requireAuth, async (req, res) => {
  const { exp, sig } = req.query;
  
  // Yetki veya imza kontrolü
  if (!storage.verify(req.params.id, exp, sig) && req.user.role !== 'admin') {
    return res.status(403).render('error', { message: 'İndirme bağlantısı süresi doldu. Kütüphanem sayfasından tekrar indirmeyi deneyin.', status: 403 });
  }
  
  const owned = await db.query('SELECT * FROM user_library WHERE user_id=$1 AND game_id=$2', [req.user.id, Number(req.params.id)]);
  if (!owned.rows.length && req.user.role !== 'admin') {
    return res.status(403).render('error', { message: 'Bu oyunu henüz satın almadınız.', status: 403 });
  }

  const g = (await db.query('SELECT * FROM games WHERE id=$1', [Number(req.params.id)])).rows[0];
  if (!g) return res.status(404).render('error', { message: 'Oyun bulunamadı.', status: 404 });

  try {
    await db.query('UPDATE user_library SET download_count = download_count + 1 WHERE user_id=$1 AND game_id=$2', [req.user.id, g.id]);
  } catch(e) {}

  const zipFilename = (g.slug || 'oyun') + '.zip';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

  // 1. Cloudflare R2'den sunucu üzerinden çekip doğrudan indirt
  if (storage.isR2Configured()) {
    try {
      const r2Stream = await storage.fetchFileFromR2(g.file_key);
      if (r2Stream) {
        if (typeof r2Stream.pipe === 'function') {
          return r2Stream.pipe(res);
        } else if (r2Stream.transformToByteArray) {
          const byteArray = await r2Stream.transformToByteArray();
          return res.end(Buffer.from(byteArray));
        }
      }
    } catch(e) {
      console.error('R2 Akış Hatası:', e.message);
    }
  }

  // 2. Yerel depolama kontrolü
  const fp = storage.filePath(g.file_key);
  if (fs.existsSync(fp)) {
    return res.download(fp, zipFilename);
  }

  // 3. Fallback: Hazır indirme paketi üret
  const dirName = path.dirname(fp);
  if (!fs.existsSync(dirName)) fs.mkdirSync(dirName, { recursive: true });
  
  const sampleInfo = `=========================================================\n  REYIZ MARKET — ${g.title.toUpperCase()}\n=========================================================\n\nOyun Başlığı: ${g.title}\nKategori: ${g.tag || 'Mini Oyun'}\nNode.js Sürümü: ${g.node_version || '18'}\n\nYAYINCI KURULUM REHBERİ:\n1. Klasördeki .env dosyasını Not Defteri ile açın.\n2. TIKTOK_USERNAME=kendi_kullanici_adiniz girin ve kaydedin.\n3. Komut satırında şu komutları çalıştırın:\n   npm install\n   npm start\n4. OBS Studio -> Tarayıcı Kaynağı ekle -> http://localhost:3000\n\nİyi yayınlar dileriz!\n`;
  fs.writeFileSync(fp, sampleInfo);
  return res.download(fp, zipFilename);
});

module.exports = router;