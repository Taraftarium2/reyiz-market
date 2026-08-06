require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const passport = require('./auth');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Railway / Reverse Proxy HTTPS desteği için
app.set('trust proxy', 1);

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session ayarları
app.use(session({
    secret: process.env.SESSION_SECRET || 'reyiz-market-super-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 saat
    }
}));

// Passport başlatma
app.use(passport.initialize());
app.use(passport.session());

// Şablonlar için global değişkenler
app.use((req, res, next) => {
    res.locals.user = req.user || null;
    res.locals.cart = req.session.cart || [];
    next();
});

// Health check endpoint (Railway için)
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date() });
});

// Rotalar
const authRoutes = require('./routes/auth');
const gamesRoutes = require('./routes/games');
const checkoutRoutes = require('./routes/checkout');
const ordersRoutes = require('./routes/orders');
const libraryRoutes = require('./routes/library');
const adminRoutes = require('./routes/admin');

app.use('/auth', authRoutes);
app.use('/games', gamesRoutes);
app.use('/checkout', checkoutRoutes);
app.use('/orders', ordersRoutes);
app.use('/library', libraryRoutes);
app.use('/admin', adminRoutes);

// Anasayfa
app.get('/', async (req, res) => {
    try {
        let featuredGames = [];
        let latestGames = [];
        
        if (process.env.DATABASE_URL) {
            const featuredRes = await db.query('SELECT * FROM games WHERE is_featured = true LIMIT 6');
            const latestRes = await db.query('SELECT * FROM games ORDER BY created_at DESC LIMIT 8');
            featuredGames = featuredRes.rows;
            latestGames = latestRes.rows;
        }

        res.render('index', { featuredGames, latestGames });
    } catch (err) {
        console.error('[Anasayfa Hatası]', err);
        res.render('index', { featuredGames: [], latestGames: [] });
    }
});

// 404 Sayfası
app.use((req, res) => {
    res.status(404).render('error', { message: 'Aradığınız sayfa bulunamadı.' });
});

// Sunucuyu başlatma
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`[Reyiz Market] Sunucu ${PORT} portunda 0.0.0.0 adresi üzerinde aktif!`);
    
    // Veritabanı tablolarını doğrulama ve ilklendirme
    await db.initDb();
});
