const jwt = require('jsonwebtoken');
const db = require('./db');

const SECRET = process.env.JWT_SECRET || 'degistir-bu-anahtari';

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, SECRET, { expiresIn: '7d' });
}

function getUser(req) {
  const t = req && req.cookies ? req.cookies.token : null;
  if (!t) return null;
  try { return jwt.verify(t, SECRET); } catch (e) { return null; }
}

function requireAuth(req, res, next) {
  const u = getUser(req);
  if (!u) return res.redirect('/giris');
  req.user = u;
  next();
}

async function requireAdmin(req, res, next) {
  const u = getUser(req);
  if (!u) return res.redirect('/giris');
  try {
    const dbUser = (await db.query('SELECT id, email, role FROM users WHERE id=$1', [u.id])).rows[0];
    if (dbUser && dbUser.role === 'admin') {
      req.user = dbUser;
      return next();
    }
  } catch (e) {
    if (u.role === 'admin') {
      req.user = u;
      return next();
    }
  }
  return res.status(403).render('error', { message: 'Yetkisiz erişim. Admin yetkiniz bulunmuyor.', status: 403 });
}

module.exports = { signToken, getUser, requireAuth, requireAdmin };