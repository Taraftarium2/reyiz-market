const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/auth/login');
    try {
        const ordersRes = await db.query(
            'SELECT o.*, COUNT(oi.id) as item_count FROM orders o LEFT JOIN order_items oi ON o.id = oi.order_id WHERE o.user_id = $1 GROUP BY o.id ORDER BY o.created_at DESC',
            [req.user.id]
        );
        res.render('orders', { orders: ordersRes.rows });
    } catch (err) {
        console.error('[Orders Route Error]', err);
        res.render('orders', { orders: [] });
    }
});

module.exports = router;
