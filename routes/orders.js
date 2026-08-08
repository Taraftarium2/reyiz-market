const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../auth');

router.get('/siparislerim', requireAuth, async (req, res) => {
  res.locals.title = 'Siparişlerim';
  const orders = (await db.query(`
    SELECT o.*,
      json_agg(json_build_object('title', g.title, 'price', oi.price_at_purchase)) AS items
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN games g ON g.id = oi.game_id
    WHERE o.user_id = $1
    GROUP BY o.id
    ORDER BY o.created_at DESC
  `, [req.user.id])).rows;

  res.render('orders', { orders });
});

module.exports = router;
