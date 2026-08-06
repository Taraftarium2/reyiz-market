const express = require('express');
const router = express.Router();
const passport = require('../auth');
const bcrypt = require('bcryptjs');
const db = require('../db');

// Giriş Sayfası
router.get('/login', (req, res) => {
    if (req.isAuthenticated()) return res.redirect('/');
    res.render('login', { error: null, registered: req.query.registered === 'true' });
});

// Giriş İşlemi
router.post('/login', (req, res, next) => {
    passport.authenticate('local', (err, user, info) => {
        if (err) return next(err);
        if (!user) {
            return res.render('login', { error: info ? info.message : 'Giriş başarısız.', registered: false });
        }
        req.logIn(user, (err) => {
            if (err) return next(err);
            return res.redirect('/');
        });
    })(req, res, next);
});

// Kayıt Sayfası
router.get('/register', (req, res) => {
    if (req.isAuthenticated()) return res.redirect('/');
    res.render('register', { error: null });
});

// Kayıt İşlemi
router.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        if (!username || !email || !password) {
            return res.render('register', { error: 'Lütfen tüm alanları doldurun.' });
        }

        const existingUser = await db.query('SELECT * FROM users WHERE email = $1 OR username = $2', [email.toLowerCase(), username]);
        if (existingUser.rows.length > 0) {
            return res.render('register', { error: 'Bu kullanıcı adı veya e-posta zaten kullanımda.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query(
            'INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4)',
            [username, email.toLowerCase(), hashedPassword, 'user']
        );

        res.redirect('/auth/login?registered=true');
    } catch (err) {
        console.error('[Kayıt Hatası]', err);
        res.render('register', { error: 'Kayıt oluşturulurken bir sunucu hatası oluştu.' });
    }
});

// Çıkış Yap
router.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.redirect('/');
    });
});

// Profil Sayfası
router.get('/profile', (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/auth/login');
    res.render('profile', { user: req.user });
});

module.exports = router;
