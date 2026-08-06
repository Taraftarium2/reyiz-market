// Ödeme başarılı → oyunlar ANINDA indirilebilir (başarı sayfasında linkler)
router.get('/odeme/basarili', requireAuth, async (req, res) => {
  res.locals.title = 'Sipariş Onayı';
  const orderId = Number(req.query.order || 0);
  const order = (await db.query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [orderId, req.user.id])).rows[0];
  const games = [];
  if (order) {
    const r = await db.query(
      'SELECT g.* FROM order_items oi JOIN games g ON g.id = oi.game_id WHERE oi.order_id=$1',
      [order.id]
    );
    const host = req.protocol + '://' + req.get('host');
    for (const g of r.rows) {
      games.push({ ...g, downloadUrl: await storage.downloadUrl(g, host) });
    }
  }
  res.render('success', { order, games });
});
