const express = require('express');
const router = express.Router();
const db = require('../db');

// Oyun Kataloğu
router.get('/', async (req, res) => {
    try {
        const { search, genre, sort } = req.query;
        let query = 'SELECT * FROM games WHERE 1=1';
        const params = [];

        if (search) {
            params.push(`%${search}%`);
            query += ` AND (title ILIKE $${params.length} OR description ILIKE $${params.length})`;
        }

        if (genre) {
            params.push(genre);
            query += ` AND genre = $${params.length}`;
        }

        if (sort === 'price_asc') {
            query += ' ORDER BY COALESCE(discount_price, price) ASC';
        } else if (sort === 'price_desc') {
            query += ' ORDER BY COALESCE(discount_price, price) DESC';
        } else {
            query += ' ORDER BY created_at DESC';
        }

        const gamesRes = await db.query(query, params);
        const genresRes = await db.query('SELECT DISTINCT genre FROM games WHERE genre IS NOT NULL');

        res.render('games', {
            games: gamesRes.rows,
            genres: genresRes.rows.map(r => r.genre),
            currentSearch: search || '',
            currentGenre: genre || '',
            currentSort: sort || ''
        });
    } catch (err) {
        console.error('[Games Route Error]', err);
        res.render('games', { games: [], genres: [], currentSearch: '', currentGenre: '', currentSort: '' });
    }
});

// Oyun Detay Sayfası
router.get('/:slug', async (req, res) => {
    try {
        const gameRes = await db.query('SELECT * FROM games WHERE slug = $1', [req.params.slug]);
        if (gameRes.rows.length === 0) {
            return res.status(404).render('error', { message: 'Oyun bulunamadı.' });
        }
        res.render('detail', { game: gameRes.rows[0] });
    } catch (err) {
        console.error('[Game Detail Error]', err);
        res.status(500).render('error', { message: 'Sunucu hatası.' });
    }
});

module.exports = router;
