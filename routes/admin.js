const express = require('express');
const router = express.Router();
const db = require('../db');

// Admin Yetkisi Middleware
function isAdmin(req, res, next) {
    if (req.isAuthenticated() && req.user.role === 'admin') {
        return next();
    }
    res.status(403).render('error', { message: 'Erişim yetkiniz yok. Yalnızca yöneticiler girebilir.' });
}

router.use(isAdmin);

// Admin Dashboard
router.get('/', async (req, res) => {
    try {
        const gamesRes = await db.query('SELECT * FROM games ORDER BY created_at DESC');
        const ordersRes = await db.query('SELECT o.*, u.username FROM orders o JOIN users u ON o.user_id = u.id ORDER BY o.created_at DESC LIMIT 10');
        const stats = {
            totalGames: gamesRes.rows.length,
            totalOrders: ordersRes.rows.length
        };
        res.render('admin', { games: gamesRes.rows, recentOrders: ordersRes.rows, stats, error: null });
    } catch (err) {
        console.error('[Admin Route Error]', err);
        res.render('admin', { games: [], recentOrders: [], stats: { totalGames: 0, totalOrders: 0 }, error: 'Veri yükleme hatası.' });
    }
});

// Yeni Oyun Ekle
router.post('/games/add', async (req, res) => {
    try {
        const { title, description, price, discount_price, cover_image, genre, is_featured } = req.body;
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

        await db.query(
            'INSERT INTO games (title, slug, description, price, discount_price, cover_image, genre, is_featured) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [title, slug, description, price, discount_price || null, cover_image, genre, is_featured === 'on']
        );

        res.redirect('/admin');
    } catch (err) {
        console.error('[Admin Game Add Error]', err);
        res.redirect('/admin');
    }
});

// Oyun Sil
router.post('/games/delete/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM games WHERE id = $1', [req.params.id]);
        res.redirect('/admin');
    } catch (err) {
        console.error('[Admin Game Delete Error]', err);
        res.redirect('/admin');
    }
});

// Lisans Key Ekleme
router.post('/keys/add', async (req, res) => {
    try {
        const { game_id, license_key } = req.body;
        await db.query('INSERT INTO game_keys (game_id, license_key) VALUES ($1, $2)', [game_id, license_key.trim()]);
        res.redirect('/admin');
    } catch (err) {
        console.error('[Admin Key Add Error]', err);
        res.redirect('/admin');
    }
});

module.exports = router;
