const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const dbUrl = process.env.DATABASE_URL || '';
const isInternalRailway = dbUrl.includes('railway.internal');

const pool = new Pool({
    connectionString: dbUrl || undefined,
    ssl: (process.env.NODE_ENV === 'production' && !isInternalRailway && dbUrl)
        ? { rejectUnauthorized: false }
        : false
});

pool.on('connect', () => {
    console.log('[DB] PostgreSQL veritabanına bağlantı kuruldu.');
});

pool.on('error', (err) => {
    console.error('[DB Error] Beklenmeyen veritabanı hatası:', err.message);
});

// Otomatik tablo oluşturma ve başlangıç verisi (Self-Healing DB)
async function initDb() {
    if (!process.env.DATABASE_URL) {
        console.warn('[DB Warning] DATABASE_URL tanımlı değil! Veritabanı bağlantısı geçici olarak devre dışı.');
        return;
    }

    const schemaQuery = `
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            email VARCHAR(100) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            role VARCHAR(20) DEFAULT 'user',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS games (
            id SERIAL PRIMARY KEY,
            title VARCHAR(150) NOT NULL,
            slug VARCHAR(150) UNIQUE NOT NULL,
            description TEXT,
            price DECIMAL(10,2) NOT NULL,
            discount_price DECIMAL(10,2),
            cover_image VARCHAR(255),
            banner_image VARCHAR(255),
            developer VARCHAR(100),
            publisher VARCHAR(100),
            release_date DATE,
            genre VARCHAR(100),
            is_featured BOOLEAN DEFAULT false,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS game_keys (
            id SERIAL PRIMARY KEY,
            game_id INT REFERENCES games(id) ON DELETE CASCADE,
            license_key VARCHAR(100) UNIQUE NOT NULL,
            is_used BOOLEAN DEFAULT false,
            order_id INT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            user_id INT REFERENCES users(id) ON DELETE CASCADE,
            total_amount DECIMAL(10,2) NOT NULL,
            status VARCHAR(20) DEFAULT 'completed',
            payment_method VARCHAR(50) DEFAULT 'credit_card',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS order_items (
            id SERIAL PRIMARY KEY,
            order_id INT REFERENCES orders(id) ON DELETE CASCADE,
            game_id INT REFERENCES games(id) ON DELETE SET NULL,
            price DECIMAL(10,2) NOT NULL,
            license_key VARCHAR(100)
        );

        CREATE TABLE IF NOT EXISTS user_library (
            id SERIAL PRIMARY KEY,
            user_id INT REFERENCES users(id) ON DELETE CASCADE,
            game_id INT REFERENCES games(id) ON DELETE CASCADE,
            order_id INT REFERENCES orders(id) ON DELETE SET NULL,
            license_key VARCHAR(100),
            acquired_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, game_id)
        );
    `;

    try {
        await pool.query(schemaQuery);
        console.log('[DB Init] Tablolar doğrulandı / oluşturuldu.');

        // Varsayılan Admin Kullanıcısı Kontrolü
        const adminCheck = await pool.query("SELECT * FROM users WHERE role = 'admin'");
        if (adminCheck.rows.length === 0) {
            const adminPassHash = await bcrypt.hash('Admin123!', 10);
            await pool.query(
                "INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4)",
                ['admin', 'admin@reyizmarket.com', adminPassHash, 'admin']
            );
            console.log('[DB Init] Varsayılan Admin hesabı oluşturuldu (admin@reyizmarket.com / Admin123!)');
        }

        // Örnek Oyun Ekleme (Boşsa)
        const gameCheck = await pool.query("SELECT COUNT(*) FROM games");
        if (parseInt(gameCheck.rows[0].count) === 0) {
            await pool.query(`
                INSERT INTO games (title, slug, description, price, discount_price, cover_image, genre, is_featured)
                VALUES 
                ('Cyberpunk 2077', 'cyberpunk-2077', 'Geleceğin karanlık dünyasında geçen açık dünya aksiyon RPG oyunu.', 799.00, 399.50, 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=600&q=80', 'RPG', true),
                ('The Witcher 3: Wild Hunt', 'the-witcher-3', 'Efsanevi canavar avcısı Geralt ile destansı bir maceraya atılın.', 499.00, 199.00, 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=600&q=80', 'RPG', true),
                ('Red Dead Redemption 2', 'red-dead-redemption-2', 'Vahşi batının son günlerinde Arthur Morgan ve Van der Linde çetesinin hikayesi.', 1150.00, 575.00, 'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?auto=format&fit=crop&w=600&q=80', 'Aksiyon', true),
                ('EA SPORTS FC 24', 'ea-sports-fc-24', 'Dünyanın en popüler futbol oyunu deneyimi.', 1200.00, 899.00, 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=600&q=80', 'Spor', false);
            `);
            console.log('[DB Init] Örnek oyunlar eklendi.');
        }

    } catch (err) {
        console.error('[DB Init Error] Veritabanı başlatılırken hata oluştu:', err.message);
    }
}

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool,
    initDb
};
