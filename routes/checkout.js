// routes/checkout.js - Sipariş verildiği an çalışan blok

// 1. Siparişi veritabanına 'paid' (ödendi) durumuyla kaydedin
const orderResult = await db.query(
    `INSERT INTO orders (user_id, total_amount, status, created_at) 
     VALUES ($1, $2, 'paid', NOW()) RETURNING id`,
    [req.user.id, totalAmount]
);
const orderId = orderResult.rows[0].id;

// 2. Sepetteki ürünleri ANINDA kütüphaneye ekleyin
for (const item of cartItems) {
    // Sipariş detay kaydı
    await db.query(
        `INSERT INTO order_items (order_id, game_id, price) VALUES ($1, $2, $3)`,
        [orderId, item.game_id, item.price]
    );

    // Kütüphaneye anında ekleme (İndirme linkinin hemen çıkması için)
    await db.query(
        `INSERT INTO user_library (user_id, game_id, purchased_at) 
         VALUES ($1, $2, NOW()) 
         ON CONFLICT (user_id, game_id) DO NOTHING`,
        [req.user.id, item.game_id]
    );
}

// 3. Müşteriyi doğrudan indirme butonlarının olduğu kütüphanem sayfasına yönlendirin
res.redirect('/profil/kutuphanem');
