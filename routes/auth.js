const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAuth } = require('../auth');

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 7 * 24 * 3600 * 1000
};

router.get('/kayit', (req, res) => { res.locals.title = 'Kayıt Ol'; res.render('register'); });
router.get('/giris', (req, res) => { res.locals.title = 'Giriş Yap'; res.render('login'); });

router.post('/kayit', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!email || !password || typeof password !== 'string' || password.length < 6) {
      return res.render('register', { error: 'Geçerli bir e-posta ve en az 6 karakterli şifre girin.' });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    if (!cleanEmail.includes('@')) {
      return res.render('register', { error: 'Geçerli bir e-posta adresi girin.' });
    }
    
    // E-posta zaten kayıtlı mı kontrol et
    const existing = await db.query('SELECT id FROM users WHERE LOWER(email)=$1', [cleanEmail]);
    if (existing.rows && existing.rows.length > 0) {
      return res.render('register', { error: 'Bu e-posta adresi zaten kayıtlı. Giriş yapabilirsiniz.' });
    }

    const cleanName = (name && String(name).trim()) || cleanEmail.split('@')[0];
    const hash = await bcrypt.hash(password, 10);
    
    const r = await db.query(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,$3,$4) RETURNING id, email, role',
      [cleanEmail, hash, cleanName, 'user']
    );
    const user = r.rows[0];
    res.cookie('token', signToken(user), COOKIE_OPTS);
    return res.redirect('/profil/kutuphanem');
  } catch (e) {
    console.error('Kayıt olma hatası:', e);
    return res.render('register', { error: 'Kayıt olunurken bir hata oluştu: ' + e.message });
  }
});

router.post('/giris', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.render('login', { error: 'E-posta ve şifre giriniz.' });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const r = await db.query('SELECT * FROM users WHERE LOWER(email)=$1', [cleanEmail]);
    const user = r.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.render('login', { error: 'E-posta veya şifre hatalı.' });
    }
    res.cookie('token', signToken(user), COOKIE_OPTS);
    return res.redirect(user.role === 'admin' ? '/admin' : '/profil/kutuphanem');
  } catch (e) {
    console.error('Giriş hatası:', e);
    return res.render('login', { error: 'Giriş yapılırken bir hata oluştu: ' + e.message });
  }
});

router.get('/cikis', (req, res) => { res.clearCookie('token', { path: '/' }); res.redirect('/'); });

router.get('/profil', requireAuth, async (req, res) => {
  res.locals.title = 'Profil';
  try {
    const r = await db.query('SELECT email, name, role, created_at FROM users WHERE id=$1', [req.user.id]);
    res.render('profile', { info: r.rows[0] });
  } catch (e) {
    res.redirect('/');
  }
});

module.exports = router;