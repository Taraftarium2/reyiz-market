const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../auth');

function readCart(req) { try { return JSON.parse(req.cookies.cart || '[]'); } catch (e) { return []; } }
function writeCart(res, ids) { res.cookie('cart', JSON.stringify(ids), { maxAge: 7 * 24 * 3600 * 1000 }); }

function readCoupon(req) { try { return JSON.parse(req.cookies.coupon || 'null'); } catch (e) { return null; } }
function writeCoupon(res, coupon) { res.cookie('coupon', JSON.stringify(coupon), { maxAge: 7 * 24 * 3600 * 1000 }); }
function clearCoupon(res) { res.clearCookie('coupon'); }

function calculateCartTotals(items, coupon) {
  const subtotal = items.reduce((s, g) => s + Number(g.price), 0);
  let discount = 0;
  if (coupon && subtotal > 0) {
    if (coupon.discount_percent > 0) {
      discount = (subtotal * coupon.discount_percent) / 100;
    } else if (coupon.discount_amount > 0) {
      discount = Number(coupon.discount_amount);
    }
    if (discount > subtotal) discount = subtotal;
  }
  const total = Math.max(0, subtotal - discount);
  return { subtotal, discount, total };
}

router.post('/sepet/ekle', (req, res) => {
  const id = Number(req.body.game_id);
  const ids = readCart(req);
  if (!ids.includes(id)) ids.push(id);
  writeCart(res, ids);
  
  if (req.xhr || (req.headers['accept'] && req.headers['accept'].includes('json')) || req.headers['x-requested-with'] === 'XMLHttpRequest') {
    return res.json({ success: true, count: ids.length, addedId: id });
  }
  res.redirect(req.get('referer') || '/oyunlar');
});

router.get('/sepet', async (req, res) => {
  res.locals.title = 'Sepet';
  const ids = readCart(req);
  const coupon = readCoupon(req);
  let items = [];
  if (ids.length) {
    const r = await db.query('SELECT * FROM games WHERE id = ANY($1)', [ids]);
    items = r.rows;
  }
  const { subtotal, discount, total } = calculateCartTotals(items, coupon);
  const couponError = req.query.couponError || null;
  res.render('cart', { items, subtotal, discount, total, coupon, couponError });
});

// Kupon Kodu Uygula
router.post('/sepet/kupon', async (req, res) => {
  const code = (req.body.code || '').trim().toUpperCase();
  if (!code) return res.redirect('/sepet');
  try {
    const r = await db.query('SELECT * FROM coupons WHERE UPPER(code)=$1 AND active=true', [code]);
    const coupon = r.rows[0];
    if (!coupon) {
      return res.redirect('/sepet?couponError=' + encodeURIComponent('Geçersiz veya süresi dolmuş kupon kodu.'));
    }
    writeCoupon(res, { code: coupon.code, discount_percent: coupon.discount_percent, discount_amount: coupon.discount_amount });
    res.redirect('/sepet');
  } catch (e) {
    res.redirect('/sepet');
  }
});

// Kupon Kodu Kaldır
router.post('/sepet/kupon/kaldir', (req, res) => {
  clearCoupon(res);
  res.redirect('/sepet');
});

router.post('/sepet/sil/:id', (req, res) => {
  const ids = readCart(req).filter((i) => i !== Number(req.params.id));
  writeCart(res, ids);
  res.redirect('/sepet');
});

router.get('/odeme', requireAuth, async (req, res) => {
  res.locals.title = 'Ödeme';
  const ids = readCart(req);
  const coupon = readCoupon(req);
  let items = [];
  if (ids.length) {
    const r = await db.query('SELECT * FROM games WHERE id = ANY($1)', [ids]);
    items = r.rows;
  }
  const { subtotal, discount, total } = calculateCartTotals(items, coupon);
  res.render('checkout', { items, subtotal, discount, total, coupon });
});

router.post('/odeme', requireAuth, async (req, res) => {
  const ids = readCart(req);
  if (!ids.length) return res.redirect('/sepet');
  const coupon = readCoupon(req);
  const games = (await db.query('SELECT * FROM games WHERE id = ANY($1)', [ids])).rows;
  const { subtotal, discount, total } = calculateCartTotals(games, coupon);
  const mode = process.env.PAYMENT_MODE || 'manual';

  // Hediye kontrolü (Başkasına Oyun Al)
  let targetUserId = req.user.id;
  const giftEmail = (req.body.gift_email || '').trim().toLowerCase();
  if (giftEmail && giftEmail.includes('@')) {
    try {
      const uRes = await db.query('SELECT id FROM users WHERE LOWER(email)=$1', [giftEmail]);
      if (uRes.rows[0]) targetUserId = uRes.rows[0].id;
    } catch(e) {}
  }

  if (mode === 'iyzico') {
    const pay = await initIyzico(games, total, req.body, req);
    if (!pay.success) return res.render('checkout', { items: games, subtotal, discount, total, coupon, error: pay.error });
    return res.redirect(pay.url);
  }

  if (mode === 'mock') {
    await finalizeOrder(targetUserId, games, total, 'mock', 'mock_' + Date.now());
    writeCart(res, []);
    clearCoupon(res);
    return res.redirect('/odeme/basarili');
  }

  // manual modu (varsayılan)
  const ref = 'RM-' + Date.now().toString(36).toUpperCase();
  const orderId = await createPendingOrder(targetUserId, games, total, 'manual', ref);
  writeCart(res, []);
  clearCoupon(res);
  res.redirect('/odeme/beklemede/' + orderId);
});

// Ödeme bekleme / IBAN bilgisi sayfası
router.get('/odeme/beklemede/:id', requireAuth, async (req, res) => {
  res.locals.title = 'Ödeme Bekleniyor';
  const orderId = Number(req.params.id);
  const o = (await db.query(
    `SELECT o.*, u.email FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = $1 AND o.user_id = $2`,
    [orderId, req.user.id]
  )).rows[0];
  if (!o) return res.redirect('/siparislerim');

  const items = (await db.query(
    `SELECT g.title, oi.price_at_purchase FROM order_items oi JOIN games g ON g.id = oi.game_id WHERE oi.order_id = $1`,
    [orderId]
  )).rows;

  res.render('pending', {
    order: o,
    items,
    iban: process.env.BANK_IBAN || '',
    bankName: process.env.BANK_NAME || '',
    bankOwner: process.env.BANK_OWNER || '',
  });
});

// Ödemeyi Yaptım Bildirimi (Admin Bildir)
router.post('/odeme/beklemede/:id/bildir', requireAuth, async (req, res) => {
  const orderId = Number(req.params.id);
  try {
    await db.query(`UPDATE orders SET payment_provider='manual_notified' WHERE id=$1 AND user_id=$2 AND status='pending'`, [orderId, req.user.id]);
  } catch (e) {
    console.error('Ödeme bildirim hatası:', e);
  }
  res.redirect('/odeme/beklemede/' + orderId);
});

// Admin / Test Hızlı Sipariş Onaylama Endpoint'i
router.post('/odeme/beklemede/:id/hizli-onay', requireAuth, async (req, res) => {
  const orderId = Number(req.params.id);
  const cli = await db.connect();
  try {
    await cli.query('BEGIN');
    await cli.query(`UPDATE orders SET status='paid' WHERE id=$1`, [orderId]);
    const oRes = await cli.query(`SELECT user_id FROM orders WHERE id=$1`, [orderId]);
    const userId = oRes.rows[0]?.user_id;

    if (userId) {
      const itemsRes = await cli.query(`SELECT game_id FROM order_items WHERE order_id=$1`, [orderId]);
      for (const item of itemsRes.rows) {
        await cli.query(
          `INSERT INTO user_library (user_id, game_id) VALUES ($1,$2) ON CONFLICT (user_id, game_id) DO NOTHING`,
          [userId, item.game_id]
        );
      }
    }
    await cli.query('COMMIT');
  } catch (e) {
    await cli.query('ROLLBACK');
    console.error('Hızlı onay hatası:', e);
  } finally {
    cli.release();
  }
  res.redirect('/profil/kutuphanem');
});

router.get('/odeme/basarili', requireAuth, (req, res) => { res.locals.title = 'Sipariş Onayı'; res.render('success'); });

// iyzico ödeme sayfasından geri dönüş
router.get('/odeme/sonuc', requireAuth, async (req, res) => {
  const token = req.query.token;
  if (!token) return res.redirect('/sepet');
  const detail = await queryIyzico(token);
  const ok = detail && (detail.paymentStatus === 'SUCCESS' || detail.status === 'success');
  if (ok) {
    const ids = readCart(req);
    const games = (await db.query('SELECT * FROM games WHERE id = ANY($1)', [ids])).rows;
    const total = games.reduce((s, g) => s + Number(g.price), 0);
    await finalizeOrder(req.user.id, games, total, 'iyzico', token);
    writeCart(res, []);
    return res.redirect('/odeme/basarili');
  }
  res.render('error', { message: 'Ödeme tamamlanamadı.', status: 400 });
});

// Pending sipariş oluştur — user_library'e EKLEME YAPMA
async function createPendingOrder(userId, games, total, provider, ref) {
  const cli = await db.connect();
  try {
    await cli.query('BEGIN');
    const o = await cli.query(
      'INSERT INTO orders (user_id, total_amount, status, payment_provider, payment_ref) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [userId, total, 'pending', provider, ref]
    );
    const orderId = o.rows[0].id;
    for (const g of games) {
      await cli.query('INSERT INTO order_items (order_id, game_id, price_at_purchase) VALUES ($1,$2,$3)', [orderId, g.id, g.price]);
    }
    await cli.query('COMMIT');
    return orderId;
  } catch (e) {
    await cli.query('ROLLBACK');
    throw e;
  } finally {
    cli.release();
  }
}

// Paid sipariş — user_library'e EKLE (admin onayı veya iyzico başarısı için)
async function finalizeOrder(userId, games, total, provider, ref) {
  const cli = await db.connect();
  try {
    await cli.query('BEGIN');
    const o = await cli.query(
      'INSERT INTO orders (user_id, total_amount, status, payment_provider, payment_ref) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [userId, total, 'paid', provider, ref]
    );
    const orderId = o.rows[0].id;
    for (const g of games) {
      await cli.query('INSERT INTO order_items (order_id, game_id, price_at_purchase) VALUES ($1,$2,$3)', [orderId, g.id, g.price]);
      await cli.query('INSERT INTO user_library (user_id, game_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, g.id]);
    }
    await cli.query('COMMIT');
  } catch (e) {
    await cli.query('ROLLBACK');
    throw e;
  } finally {
    cli.release();
  }
}

// ── iyzico yardımcıları (TEST modu) ──────────────────────────────
// Not: Canlıya geçerken gerçek API anahtarlarını gir ve iyzico webhook
// doğrulamasını ekle (ödemeyi yalnızca sunucu tarafı webhook ile onayla).

async function initIyzico(games, total, body, req) {
  try {
    const apiKey = process.env.IYZICO_API_KEY;
    const secret = process.env.IYZICO_SECRET_KEY;
    const base = process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com';
    const basketItems = games.map((g) => ({
      id: String(g.id), name: g.title, category1: 'Games',
      price: Number(g.price).toFixed(2), itemType: 'VIRTUAL'
    }));
    const payload = {
      locale: 'tr', conversationId: 'conv_' + Date.now(),
      price: total.toFixed(2), paidPrice: total.toFixed(2), currency: 'TRY',
      basketId: 'sep_' + Date.now(), paymentGroup: 'PRODUCT',
      callbackUrl: req.protocol + '://' + req.get('host') + '/odeme/sonuc',
      buyer: {
        id: String(req.user.id), name: body.name || 'Reyiz', surname: body.surname || 'Kullanıcı',
        email: req.user.email, gsmNumber: body.phone || '+905000000000',
        registrationAddress: 'Istanbul, TR', city: 'Istanbul', country: 'TR',
        identityNumber: '11111111111', ip: req.ip
      },
      shippingAddress: { contactName: (body.name || 'Reyiz') + ' ' + (body.surname || ''), city: 'Istanbul', country: 'TR', address: 'Istanbul, TR', zipCode: '34000' },
      billingAddress: { contactName: (body.name || 'Reyiz') + ' ' + (body.surname || ''), city: 'Istanbul', country: 'TR', address: 'Istanbul, TR', zipCode: '34000' },
      basketItems
    };
    const r = await fetch(base + '/payment/checkoutform/initialize/auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(apiKey + ':' + secret).toString('base64'),
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    if (data.status === 'success' && data.paymentPageUrl) return { success: true, url: data.paymentPageUrl };
    return { success: false, error: data.errorMessage || 'iyzico başlatılamadı' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function queryIyzico(token) {
  try {
    const apiKey = process.env.IYZICO_API_KEY;
    const secret = process.env.IYZICO_SECRET_KEY;
    const base = process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com';
    const payload = { token, locale: 'tr', conversationId: 'conv_' + Date.now() };
    const r = await fetch(base + '/payment/iyzilink/checkoutform/auth/ecom/detail', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(apiKey + ':' + secret).toString('base64'),
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    return await r.json();
  } catch (e) {
    return null;
  }
}

module.exports = router;