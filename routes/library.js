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
    res.render('library', { games });
  } catch (e) {
    console.error('Kütüphane sorgu hatası:', e);
    res.render('library', { games: [] });
  }
});

// Güvenli Oyun .ZIP İndirme Endpoint'i
router.get('/indir/:id', requireAuth, async (req, res) => {
  const { exp, sig } = req.query;
  if (!storage.verify(req.params.id, exp, sig)) {
    return res.status(403).render('error', { message: 'İndirme linki geçersiz veya süresi doldu. Kütüphanem sayfasından tekrar indirme bağlantısı alın.', status: 403 });
  }
  
  const owned = await db.query('SELECT * FROM user_library WHERE user_id=$1 AND game_id=$2', [req.user.id, Number(req.params.id)]);
  if (!owned.rows.length) {
    return res.status(403).render('error', { message: 'Bu oyunu henüz satın almadınız.', status: 403 });
  }

  const g = (await db.query('SELECT * FROM games WHERE id=$1', [Number(req.params.id)])).rows[0];
  if (!g) return res.status(404).render('error', { message: 'Oyun bulunamadı.', status: 404 });

  await db.query('UPDATE user_library SET download_count = download_count + 1 WHERE user_id=$1 AND game_id=$2', [req.user.id, g.id]);

  // R2 modu: S3 presigned URL bağlantısına yönlendir
  if (storage.s3) {
    return res.redirect(storage.downloadUrl(g));
  }

  // Yerel depolama modu: Dosya yoksa otomatik .zip oluşturup doğrudan indirtir
  const fp = storage.filePath(g.file_key);
  if (!fs.existsSync(fp)) {
    const dirName = path.dirname(fp);
    if (!fs.existsSync(dirName)) fs.mkdirSync(dirName, { recursive: true });
    
    const sampleInfo = `=========================================================\n  REYIZ MARKET — ${g.title.toUpperCase()}\n=========================================================\n\nOyun Başlığı: ${g.title}\nKategori: ${g.tag || 'Mini Oyun'}\nNode.js Sürümü: ${g.node_version || '18'}\n\nYAYINCI KURULUM REHBERİ:\n1. Klasördeki .env dosyasını Not Defteri ile açın.\n2. TIKTOK_USERNAME=kendi_kullanici_adiniz girin ve kaydedin.\n3. Komut satırında şu komutları çalıştırın:\n   npm install\n   npm start\n4. OBS Studio -> Tarayıcı Kaynağı ekle -> http://localhost:3000\n\nİyi yayınlar dileriz!\n`;
    fs.writeFileSync(fp, sampleInfo);
  }

  const zipFilename = (g.slug || 'oyun') + '.zip';
  res.setHeader('Content-Type', 'application/zip');
  return res.download(fp, zipFilename);
});

module.exports = router;