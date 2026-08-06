const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'degistir-bu-anahtari';

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, SECRET, { expiresIn: '7d' });
}

function getUser(req) {
  const t = req.cookies.token;
  if (!t) return null;
  try { return jwt.verify(t, SECRET); } catch (e) { return null; }
}

function requireAuth(req, res, next) {
  const u = getUser(req);
  if (!u) return res.redirect('/giris');
  req.user = u;
  next();
}

function requireAdmin(req, res, next) {
  const u = getUser(req);
  if (!u) return res.redirect('/giris');
  if (u.role !== 'admin') return res.status(403).render('error', { message: 'Yetkisiz erişim.', status: 403 });
  req.user = u;
  next();
}

module.exports = { signToken, getUser, requireAuth, requireAdmin };