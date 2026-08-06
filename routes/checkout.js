const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middlewares/auth');

// Siparişi Tamamlama Rotası (async fonksiyon eklendi)
router.post('/checkout', requireAuth, async (req, res) => {
    try {
        const { cartItems, totalAmount } = req.body;

        // 1. Siparişi veritabanına 'paid' (ödendi) olarak ekle
        const orderResult = await db.query(
            `INSERT INTO orders (user_id, total_amount, status, created_at) 
             VALUES ($1, $2, 'paid', NOW()) RETURNING id`,
            [req.user.id, totalAmount || 0]
        );
        const orderId = orderResult.rows[0].id;

        // 2. Ürünleri kütüphaneye anında ekle
        if (cartItems && Array.isArray(cartItems)) {
            for (const item of cartItems) {
                // Sipariş detay kaydı
                await db.query(
                    `INSERT INTO order_items (order_id, game_id, price) VALUES ($1, $2, $3)`,
                    [orderId, item.game_id, item.price]
                );

                // Müşterinin kütüphanesine indirme linki çıkması için ekleme
                await db.query(
                    `INSERT INTO user_library (user_id, game_id, purchased_at) 
                     VALUES ($1, $2, NOW()) 
                     ON CONFLICT (user_id, game_id) DO NOTHING`,
                    [req.user.id, item.game_id]
                );
            }
        }

        // 3. Müşteriyi indirme linkinin olacağı kütüphane sayfasına yönlendir
        res.redirect('/profil/kutuphanem');

    } catch (err) {
        console.error('Checkout hatası:', err);
        res.status(500).render('error', { message: 'Sipariş tamamlanırken bir hata oluştu.' });
    }
});

module.exports = router;
