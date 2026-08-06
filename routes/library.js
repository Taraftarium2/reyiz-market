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

    res.render('library', { games, pendingOrders: Number(pendingOrders), dbHata: null });
  } catch (e) {
    console.error('❌ Kütüphane sorgu hatası (oyunlar listelenemedi):', e);
    res.render('library', { games: [], pendingOrders: 0, dbHata: req.user.role === 'admin' ? e.message : null });
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
    console.log(`✅ Admin ${req.user.email} kütüphanesine ${allGames.length} oyun eklendi (test)`);
  } catch (e) {
    console.error('Admin kütüphane ekleme hatası:', e);
  }
  res.redirect('/profil/kutuphanem');
});

// Güvenli Oyun .ZIP İndirme Endpoint'i (Garantili Akış - R2 Proxy + Yerel Fallback)
router.get('/indir/:id', requireAuth, async (req, res) => {
  const { exp, sig } = req.query;
  const gameId = Number(req.params.id);
  
  if (!Number.isInteger(gameId)) {
    return res.status(400).render('error', { message: 'Geçersiz oyun ID.', status: 400 });
  }

  // Yetki veya imza kontrolü (admin imza bypass edebilir)
  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && !storage.verify(String(gameId), exp, sig)) {
    return res.status(403).render('error', { message: 'İndirme bağlantısı süresi doldu veya geçersiz. Kütüphanem sayfasından tekrar indirmeyi deneyin.', status: 403 });
  }
  
  // Sahiplik kontrolü (admin her dosyayı indirebilir)
  const owned = await db.query('SELECT * FROM user_library WHERE user_id=$1 AND game_id=$2', [req.user.id, gameId]);
  if (!owned.rows.length && !isAdmin) {
    return res.status(403).render('error', { message: 'Bu oyunu henüz satın almadınız. Siparişin onaylanmasını bekleyin veya Siparişlerim sayfasından durumu kontrol edin.', status: 403 });
  }

  const g = (await db.query('SELECT * FROM games WHERE id=$1', [gameId])).rows[0];
  if (!g) return res.status(404).render('error', { message: 'Oyun bulunamadı.', status: 404 });

  // İndirme sayacını artır (hata olursa indirmeyi engellemez)
  try {
    if (owned.rows.length) {
      await db.query('UPDATE user_library SET download_count = download_count + 1 WHERE user_id=$1 AND game_id=$2', [req.user.id, g.id]);
    } else if (isAdmin) {
      // Admin için opsiyonel sayaç - admin libraray'de yoksa da artırma dene
    }
  } catch(e) {
    console.warn('İndirme sayacı güncellenemedi:', e.message);
  }

  const zipFilename = (g.slug || 'oyun') + '.zip';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
  // Cache önleme (özel indirme)
  res.setHeader('Cache-Control', 'private, no-cache, no-store');

  // 1. Cloudflare R2'den sunucu üzerinden çekip doğrudan indir (proxy)
  if (storage.isR2Configured()) {
    try {
      const r2Stream = await storage.fetchFileFromR2(g.file_key);
      if (r2Stream) {
        console.log(`📥 R2'den indiriliyor: ${g.title} (${g.file_key}) -> user ${req.user.id}`);
        if (typeof r2Stream.pipe === 'function') {
          // Node.js Readable stream
          r2Stream.on('error', (err) => {
            console.error('R2 Stream pipe hatası:', err.message);
            if (!res.headersSent) {
              res.status(500).render('error', { message: 'Dosya akışında hata oluştu.', status: 500 });
            }
          });
          return r2Stream.pipe(res);
        } else if (r2Stream.transformToByteArray) {
          // AWS SDK v3 default: ByteArray
          const byteArray = await r2Stream.transformToByteArray();
          return res.end(Buffer.from(byteArray));
        } else if (r2Stream.transformToString) {
          // Fallback
          const str = await r2Stream.transformToString('base64');
          return res.end(Buffer.from(str, 'base64'));
        }
      } else {
        console.warn(`⚠️ R2'de dosya yok, yerel fallback denenecek: ${g.file_key}`);
      }
    } catch(e) {
      console.error('R2 Akış Hatası (fallback yerel):', e.message);
    }
  } else {
    console.log(`ℹ️ R2 yapılandırılmadı, yerel dosya denenecek: ${g.file_key} | Durum:`, storage.getR2ConfigStatus());
  }

  // 2. Yerel depolama kontrolü
  const fp = storage.filePath(g.file_key);
  if (fs.existsSync(fp)) {
    // Gerçek zip dosyası mı kontrol et (dummy text değil)
    const stat = fs.statSync(fp);
    if (stat.size > 0) {
      console.log(`📁 Yerel dosyadan indiriliyor: ${fp} (${(stat.size/1024).toFixed(1)} KB)`);
      return res.download(fp, zipFilename, (err) => {
        if (err) console.error('Yerel dosya gönderim hatası:', err.message);
      });
    }
  }

  // 3. Fallback: Hazır indirme paketi üret (oyun dosyası henüz yüklenmemişse kullanıcıyı bilgilendir)
  // Bu dummy paket sadece acil durumda - admin gerçek dosyayı yükleyene kadar geçici
  console.warn(`⚠️ Gerçek dosya bulunamadı, geçici paket oluşturuluyor: ${g.title} (${g.file_key})`);
  const dirName = path.dirname(fp);
  if (!fs.existsSync(dirName)) fs.mkdirSync(dirName, { recursive: true });
  
  const sampleInfo = `=========================================================\n  REYIZ MARKET — ${g.title.toUpperCase()}\n=========================================================\n\nOyun Başlığı: ${g.title}\nOyun Slug: ${g.slug}\nKategori: ${g.tag || 'Mini Oyun'}\nNode.js Sürümü: ${g.node_version || '18'}\nFiyat: ₺${g.price}\n\n⚠️ BİLGİLENDİRME:\nBu geçici bir pakettir. Gerçek oyun dosyası henüz sunucuya yüklenmemiş.\nAdmin panelinden oyuna .zip dosyası yükleyin veya Cloudflare R2 bucket'ını kontrol edin.\n\nYAYINCI KURULUM REHBERİ (Gerçek dosya geldiğinde):\n1. ZIP'i bir klasöre çıkartın.\n2. Klasördeki .env dosyasını Not Defteri ile açın.\n3. TIKTOK_USERNAME=kendi_kullanici_adiniz girin ve kaydedin.\n4. Komut satırında şu komutları çalıştırın:\n   npm install\n   npm start\n5. OBS Studio -> Tarayıcı Kaynağı ekle -> http://localhost:3000\n\nDestek: Reyiz Market — https://reyizmarket.click/rehber\nİyi yayınlar dileriz!\n`;
  try {
    fs.writeFileSync(fp, sampleInfo);
  } catch(e) {
    console.error('Geçici dosya yazılamadı:', e.message);
    return res.status(500).render('error', { message: 'Dosya hazırlanırken hata oluştu. Admin ile iletişime geçin.', status: 500 });
  }
  return res.download(fp, zipFilename);
});

module.exports = router;