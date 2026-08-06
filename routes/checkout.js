const express = require('express');
const router = express.Router();
const db = require('../db');

// Güvenli Oturum Kontrolü (Dış modül bağımlılığını kaldırır, çökme hatasını engeller)
function requireAuth(req, res, next) {
    if ((req.isAuthenticated && req.isAuthenticated()) || req.user || (req.session && req.session.user)) {
        return next();
    }
    return res.redirect('/login');
}

// Sipariş Tamamlama ve Kütüphaneye Anında Ekleme Rotası
router.post('/checkout', requireAuth, async (req, res) => {
    try {
        const userId = req.user ? req.user.id : (req.session && req.session.user ? req.session.user.id : null);
        const { cartItems, totalAmount } = req.body;

        if (!userId) {
            return res.redirect('/login');
        }

        // 1. Siparişi 'paid' (ödendi) olarak kaydet
        const orderResult = await db.query(
            `INSERT INTO orders (user_id, total_amount, status, created_at) 
             VALUES ($1, $2, 'paid', NOW()) RETURNING id`,
            [userId, totalAmount || 0]
        );
        const orderId = orderResult.rows[0].id;

        // 2. Müşterinin kütüphanesine ürünleri ekle (İndirme linkinin hemen görünmesi için)
        if (cartItems && Array.isArray(cartItems)) {
            for (const item of cartItems) {
                await db.query(
                    `INSERT INTO order_items (order_id, game_id, price) VALUES ($1, $2, $3)`,
                    [orderId, item.game_id, item.price]
                );

                await db.query(
                    `INSERT INTO user_library (user_id, game_id, purchased_at) 
                     VALUES ($1, $2, NOW()) 
                     ON CONFLICT (user_id, game_id) DO NOTHING`,
                    [userId, item.game_id]
                );
            }
        }

        // 3. Doğrudan indirme bağlantılarının olduğu kütüphanem sayfasına yönlendir
        res.redirect('/profil/kutuphanem');

    } catch (err) {
        console.error('Checkout hatası:', err);
        res.status(500).render('error', { message: 'Sipariş tamamlanırken bir hata oluştu.' });
    }
});

module.exports = router;
