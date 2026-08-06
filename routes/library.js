// routes/library.js - Kütüphane listeleme
router.get('/profil/kutuphanem', requireAuth, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT g.title, g.cover_image, g.file_key AS download_url, ul.purchased_at
             FROM user_library ul 
             JOIN games g ON g.id = ul.game_id
             WHERE ul.user_id = $1 
             ORDER BY ul.purchased_at DESC`,
            [req.user.id]
        );

        res.render('library', { games: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).render('error', { message: 'Kütüphane yüklenirken hata oluştu.' });
    }
});
