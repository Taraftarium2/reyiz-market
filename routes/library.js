const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/auth/login');
    try {
        const libraryRes = await db.query(
            'SELECT ul.*, g.title, g.cover_image, g.genre, g.developer FROM user_library ul JOIN games g ON ul.game_id = g.id WHERE ul.user_id = $1 ORDER BY ul.acquired_at DESC',
            [req.user.id]
        );
        res.render('library', { libraryItems: libraryRes.rows });
    } catch (err) {
        console.error('[Library Route Error]', err);
        res.render('library', { libraryItems: [] });
    }
});

module.exports = router;
