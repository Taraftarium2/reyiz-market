const express = require('express');
const router = express.Router();
const db = require('../db');

// Sepet Gösterimi
router.get('/cart', (req, res) => {
    const cart = req.session.cart || [];
    const total = cart.reduce((sum, item) => sum + (item.discount_price || item.price), 0);
    res.render('cart', { cart, total });
});

// Sepete Ekleme
router.post('/add-to-cart', async (req, res) => {
    try {
        const { game_id } = req.body;
        const gameRes = await db.query('SELECT * FROM games WHERE id = $1', [game_id]);
        
        if (gameRes.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'Oyun bulunamadı.' });
        }

        const game = gameRes.rows[0];
        if (!req.session.cart) {
            req.session.cart = [];
        }

        // Sepette var mı kontrolü
        if (!req.session.cart.some(item => item.id === game.id)) {
            req.session.cart.push({
                id: game.id,
                title: game.title,
                price: parseFloat(game.price),
                discount_price: game.discount_price ? parseFloat(game.discount_price) : null,
                cover_image: game.cover_image
            });
        }

        res.redirect('/checkout/cart');
    } catch (err) {
        console.error('[Add To Cart Error]', err);
        res.redirect('/games');
    }
});

// Sepetten Çıkarma
router.post('/remove', (req, res) => {
    const { game_id } = req.body;
    if (req.session.cart) {
        req.session.cart = req.session.cart.filter(item => item.id !== parseInt(game_id));
    }
    res.redirect('/checkout/cart');
});

// Ödeme Sayfası
router.get('/process', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/auth/login?redirect=/checkout/process');
    }
    const cart = req.session.cart || [];
    if (cart.length === 0) {
        return res.redirect('/checkout/cart');
    }
    const total = cart.reduce((sum, item) => sum + (item.discount_price || item.price), 0);
    res.render('checkout', { cart, total, error: null });
});

// Ödemeyi Tamamlama ve Lisans Anahtarı Atama
router.post('/complete', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/auth/login');
    }

    const cart = req.session.cart || [];
    if (cart.length === 0) {
        return res.redirect('/');
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const totalAmount = cart.reduce((sum, item) => sum + (item.discount_price || item.price), 0);

        // Sipariş Oluştur
        const orderRes = await client.query(
            'INSERT INTO orders (user_id, total_amount, status) VALUES ($1, $2, $3) RETURNING id',
            [req.user.id, totalAmount, 'completed']
        );
        const orderId = orderRes.rows[0].id;

        for (const item of cart) {
            // Kullanılmamış Key var mı bak
            const keyRes = await client.query(
                'SELECT * FROM game_keys WHERE game_id = $1 AND is_used = false LIMIT 1',
                [item.id]
            );

            let keyVal = 'RYZ-' + Math.random().toString(36).substring(2, 10).toUpperCase();

            if (keyRes.rows.length > 0) {
                keyVal = keyRes.rows[0].license_key;
                await client.query('UPDATE game_keys SET is_used = true, order_id = $1 WHERE id = $2', [orderId, keyRes.rows[0].id]);
            }

            // Sipariş Kalemi Ekle
            await client.query(
                'INSERT INTO order_items (order_id, game_id, price, license_key) VALUES ($1, $2, $3, $4)',
                [orderId, item.id, item.discount_price || item.price, keyVal]
            );

            // Kütüphaneye Ekle
            await client.query(
                'INSERT INTO user_library (user_id, game_id, order_id, license_key) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
                [req.user.id, item.id, orderId, keyVal]
            );
        }

        await client.query('COMMIT');
        req.session.cart = []; // Sepeti Temizle

        res.render('success', { orderId });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[Checkout Complete Error]', err);
        res.render('checkout', { cart, total: 0, error: 'İşlem gerçekleştirilemedi.' });
    } finally {
        client.release();
    }
});

module.exports = router;
