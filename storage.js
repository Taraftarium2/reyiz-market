// Sipariş onaylandığında çalışacak fonksiyon
async function approveOrderAndAddToLibrary(orderId) {
    try {
        // 1. Siparişe ait oyunları ve kullanıcıyı getir
        const items = await db.query(
            `SELECT oi.game_id, o.user_id 
             FROM order_items oi 
             JOIN orders o ON o.id = oi.order_id 
             WHERE o.id = $1`,
            [orderId]
        );

        // 2. Müşterinin kütüphanesine ekle (Tekrarlayan kayıtları engellemek için ON CONFLICT)
        for (const item of items.rows) {
            await db.query(
                `INSERT INTO user_library (user_id, game_id, purchased_at)
                 VALUES ($1, $2, NOW())
                 ON CONFLICT (user_id, game_id) DO NOTHING`,
                [item.user_id, item.game_id]
            );
        }
    } catch (err) {
        console.error('Kütüphaneye ekleme hatası:', err);
    }
}
