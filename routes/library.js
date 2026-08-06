const router = require('express').Router();
const fs = require('fs');
const db = require('../db');
const { requireAuth } = require('../auth');
const storage = require('../storage');

router.get('/profil/kutuphanem', requireAuth, async (req, res) => {
  res.locals.title = 'Kütüphanem';
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
});

router.get('/indir/:id', requireAuth, async (req, res) => {
  const { exp, sig } = req.query;
  if (!storage.verify(req.params.id, exp, sig)) {
    return res.status(403).render('error', { message: 'İndirme linki geçersiz veya süresi doldu. Kütüphanemden tekrar indirin.', status: 403 });
  }
  const owned = await db.query('SELECT * FROM user_library WHERE user_id=$1 AND game_id=$2', [req.user.id, Number(req.params.id)]);
  if (!owned.rows.length) return res.status(403).render('error', { message: 'Bu oyunu satın almadınız.', status: 403 });

  const g = (await db.query('SELECT * FROM games WHERE id=$1', [Number(req.params.id)])).rows[0];
  await db.query('UPDATE user_library SET download_count = download_count + 1 WHERE user_id=$1 AND game_id=$2', [req.user.id, g.id]);

  // R2 modu: presigned linke yönlendir
  if (storage.s3) return res.redirect(storage.downloadUrl(g));

  // Local mod: dosyayı doğrulanmış istek üzerine akıt
  const fp = storage.filePath(g.file_key);
  if (!fs.existsSync(fp)) return res.status(404).render('error', { message: 'Dosya bulunamadı. Admin ile iletişime geçin.', status: 404 });
  res.download(fp, g.slug + '.zip');
});

module.exports = router;