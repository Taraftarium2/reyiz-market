const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAuth } = require('../auth');

router.get('/kayit', (req, res) => { res.locals.title = 'Kayıt Ol'; res.render('register'); });
router.get('/giris', (req, res) => { res.locals.title = 'Giriş Yap'; res.render('login'); });

router.post('/kayit', async (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !password || password.length < 6) {
    return res.render('register', { error: 'Geçerli bir e-posta ve en az 6 karakterli şifre girin.' });
  }
  const hash = await bcrypt.hash(password, 10);
  try {
    const r = await db.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1,$2,$3) RETURNING id, email, role',
      [email, hash, name || email.split('@')[0]]
    );
    const user = r.rows[0];
    res.cookie('token', signToken(user), { httpOnly: true, maxAge: 7 * 24 * 3600 * 1000 });
    res.redirect('/profil/kutuphanem');
  } catch (e) {
    if (e.code === '23505') return res.render('register', { error: 'Bu e-posta zaten kayıtlı.' });
    res.render('register', { error: 'Bir hata oluştu: ' + e.message });
  }
});

router.post('/giris', async (req, res) => {
  const { email, password } = req.body;
  const r = await db.query('SELECT * FROM users WHERE email=$1', [email]);
  const user = r.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.render('login', { error: 'E-posta veya şifre hatalı.' });
  }
  res.cookie('token', signToken(user), { httpOnly: true, maxAge: 7 * 24 * 3600 * 1000 });
  res.redirect('/profil/kutuphanem');
});

router.get('/cikis', (req, res) => { res.clearCookie('token'); res.redirect('/'); });

router.get('/profil', requireAuth, async (req, res) => {
  res.locals.title = 'Profil';
  const r = await db.query('SELECT email, name, role, created_at FROM users WHERE id=$1', [req.user.id]);
  res.render('profile', { info: r.rows[0] });
});

module.exports = router;