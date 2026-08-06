# Reyiz Market — Kütüphane / İndirme & Cloudflare R2 Düzeltme Raporu

**Tarih:** 6 Ağustos 2026  
**Repo:** https://github.com/Taraftarium2/reyiz-market  
**Sorun:** İnsanlar alışveriş yapınca oyun `Kütüphanem` sayfasında görünmüyor, indirme bağlantısı oluşmuyor. Cloudflare R2 bağlı görünse de dosya indirilemiyor.

---

## 🔍 Tespit Edilen Kritik Hatalar (7 Adet)

### 1. `PAYMENT_MODE=manual` kalıcı pending döngüsü
- **Durum:** `.env` içinde `PAYMENT_MODE=manual` varsayılan. Bu modda `routes/checkout.js` siparişi **`pending`** olarak oluşturuyor ve **`user_library` tablosuna hiç eklemiyor**. Ekleme sadece admin `/admin/siparis/:id/onayla` ile yapılıyor.
- **Sonuç:** Admin onaylamadan kütüphane boş kalıyor. Kullanıcı “alışveriş yaptım ama kütüphane boş” sanıyor. `Cloudflare R2 bağlı ama yine olmadı` algısının asıl sebebi bu.
- **Çözüm:** Kod düzeltildi + `.env` açıklaması eklendi. Hızlı test için `PAYMENT_MODE=mock` yaparsan anında kütüphaneye eklenir (aşağıya bak).

### 2. `storage` bir dosya, klasör değil
- Repo içinde `storage` adında 1 byte'lık bir **dosya** vardı. `multer` buraya yazmaya çalışınca `EEXIST` / `ENOTDIR` hatası veriyordu, R2 kapalıysa yerel indirme tamamen çöküyordu.
- **Çözüm:** Dosya silindi, `storage/` klasörü + `.gitkeep` oluşturuldu. `.gitignore` eklendi.

### 3. `storage.js` S3 istemcisi sadece başlangıçta kuruluyordu
- `const s3 = isR2Configured() ? ... : null` modül yüklenirken bir kez çalışıyordu. `.env` sonradan değişse veya Railway Variables eksik olsa sonsuza kadar `null` kalıyordu. `uploadToR2()` sessizce `false` dönüyordu.
- **Çözüm:** Lazy `getS3Client()` eklendi. `isR2Configured()`, `getR2ConfigStatus()` ve `testR2Connection()` ile admin panelinden teşhis edilebilir hale geldi. `/health/r2` ve `/admin/test-r2` endpointleri eklendi.

### 4. `routes/checkout.js` — `createPendingOrder` ve `finalizeOrder` eksik kolonlar
- `orders.coupon_code / discount_amount` kolonları `schema.sql` ve `server.js` ALTER ile vardı ama `INSERT` sorguları onları hiç yazmıyordu. Kupon indirimi sipariş geçmişine düşmüyordu.
- `finalizeOrder` içinde `ON CONFLICT DO NOTHING` hedefsiz yazılmıştı. PostgreSQL'de `ON CONFLICT (user_id, game_id) DO NOTHING` olmalı, aksi halde bazı sürümlerde hata.
- **Çözüm:** Her iki fonksiyona `coupon_code`, `discount_amount` parametreleri eklendi, `ON CONFLICT (user_id, game_id)` düzeltildi. Detaylı log eklendi.

### 5. `routes/library.js` — İndirme akışı zayıf fallback
- R2'den stream gelmezse veya `Bucket` hatalıysa kullanıcıya **dummy .txt içeriğini .zip diye** gönderiyordu. Bu yüzden “R2 bağlı ama dosya sahte” görünüyordu.
- `storage.verify()` kontrolü ve sahiplik sorgusu dağınık, admin bypass mantığı hatalıydı.
- **Çözüm:** 
  - `verify()` + `owned` kontrolleri netleştirildi, hata mesajları Türkçe ve yönlendirici yapıldı (“Siparişin onaylanmasını bekleyin → /siparislerim”).
  - R2 stream için `pipe`, `transformToByteArray`, `transformToString` üçlü fallback eklendi.
  - Yerel dosya `stat.size > 0` kontrolü ile gerçek zip doğrulaması.
  - `Content-Disposition`, `Cache-Control` header düzeltmeleri.
  - Geçici paket sadece son çare, içeriğinde admin uyarısı var.

### 6. `routes/checkout.js` — `/hizli-onay` yetki zaafı ve admin onayı rollback
- `/odeme/beklemede/:id/hizli-onay` sadece `requireAuth` istiyordu, herhangi bir kullanıcı başkasının `orderId`'sini tahmin edip onaylayabilirdi.
- İşlem `BEGIN` içinde `UPDATE status='paid'` yapıp sonra `SELECT user_id` atıyordu — race condition.
- **Çözüm:** Sipariş sahibi veya `admin` kontrolü eklendi. `SELECT ... FOR UPDATE` ile kilitli okuma. `cancelled` sipariş onaylanamaz, `paid` ise idempotent tamamlar. Detaylı log.

### 7. `routes/admin.js` — Sipariş onayla transaction idempotent değil
- Aynı sipariş ikinci kez onaylanırsa veya `order_items` boşsa sessizce COMMIT ediyor, eksik kütüphane kalıyordu.
- R2 upload sonucu loglanmıyordu.
- **Çözüm:** `FOR UPDATE` kilit, `pending → paid` dışında `paid` için eksik kütüphane tamamlama, `cancelled` engeli. R2 upload başarı/hata logları. `.test-r2` endpoint. `getR2ConfigStatus` admin template'ine gönderiliyor.

### 8. `.env` dosyası repoda ve R2 anahtarları ifşa
- `.env` içinde gerçek `R2_ACCESS_KEY / SECRET_KEY` vardı ve `git ls-files` ile takibediyordu. Herkese açık repoda sızıntı.
- **Çözüm:** `.gitignore` oluşturuldu (`.env`, `node_modules`, `storage/*.zip`). **Acil:** Cloudflare dashboard > R2 > Manage API Tokens > bu tokeni sil ve yeni oluştur, Railway Variables'a ekle. Eski anahtarlar raporda sansürlenmiştir.

---

## ✅ Düzeltilen Dosyalar

| Dosya | Değişiklik |
|-------|------------|
| `storage.js` | Lazy S3 init, `getR2ConfigStatus()`, `testR2Connection()`, presigned URL, `filePath` traversal koruması |
| `routes/library.js` | İndirme proxy 3 aşamalı (R2 → yerel → geçici), verify düzeltmesi, download_count, net hata mesajları |
| `routes/checkout.js` | `createPendingOrder`/`finalizeOrder` kupon kolonları, `ON CONFLICT (user_id, game_id)`, hediye email log, `hizli-onay` yetki + `FOR UPDATE`, `/health/r2` uyumu |
| `routes/admin.js` | `onayla` idempotent `FOR UPDATE`, R2 upload log, `test-r2` endpoint, r2Status render |
| `server.js` | `STORAGE_DIR` oluşturma log, `/health/r2` endpoint, başlangıç R2/PAYMENT_MODE log, `schema.sql` ek ALTERler, `user` cartCount Array.isArray |
| `storage` | Dosya → klasör düzeltmesi |
| `.gitignore` | Yeni oluşturuldu |

**Git diff özeti:** `6 files changed, 870 insertions(+), 543 deletions(-)`

---

## 🚀 Nasıl Çalışmalı? (Doğru Akış)

### Manuel Havale (mevcut varsayılan)
1. Kullanıcı `Sepete Ekle → /sepet → /odeme → Siparişi Tamamla` der.
2. `createPendingOrder` ile `orders.status='pending'` + `order_items` oluşur, **kütüphaneye henüz eklenmez**.
3. Kullanıcı `/odeme/beklemede/:id` sayfasında IBAN görür, “Havaleyi Yaptım” der → `payment_provider='manual_notified'`.
4. **Admin** `/admin` → Siparişler → `✓ Onayla & Kütüphaneye Ekle` butonuna basar.
5. Transaction: `UPDATE orders SET status='paid'` + `INSERT INTO user_library ... ON CONFLICT (user_id, game_id) DO NOTHING` → kütüphaneye düşer.
6. Kullanıcı `/profil/kutuphanem` → `⬇ İndir (.zip)` butonu görünür → `/indir/:id?exp=&sig=` → **R2 proxy** → indirme.

### Anında Teslim (test / otomatik)
`.env` içinde:
```
PAYMENT_MODE=mock
```
Yaparsan adım 2’de `finalizeOrder` direkt `paid` + `user_library` ekler, kullanıcı anında `/odeme/basarili` → `/profil/kutuphanem` içinde indirme görür. **Canlıda manuel bırak, testte mock kullan.**

### Iyzico Kart (opsiyonel)
```
PAYMENT_MODE=iyzico
IYZICO_API_KEY=...
IYZICO_SECRET_KEY=...
```
Kart başarılı olunca `finalizeOrder` tetiklenir.

---

## 🔧 Kurulum / Test Adımları

### 1) Lokal test (mock mod)
```bash
git clone https://github.com/Taraftarium2/reyiz-market.git
cd reyiz-market
npm install
# .env dosyanı düzenle
cp .env.example .env
# .env içinde PAYMENT_MODE=mock yap (hızlı test)
npm run dev
# http://localhost:3000
# 1) Kaydol / giriş yap
# 2) Admin ile giriş → /admin → oyun ekle (zip yükle)
# 3) Normal kullanıcı ile sepete ekle → öde → /profil/kutuphanem → indir çalışmalı
```

### 2) Cloudflare R2 doğrulama
**Railway / Render dashboard > Variables** kısmına ekle ( `.env` dosyasına değil, dashboard'a! ):
```
R2_ENDPOINT=https://0a179ad52bdb43871f83b3cfb33c2049.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=... (yeni token)
R2_SECRET_ACCESS_KEY=... (yeni token)
R2_BUCKET_NAME=reyiz-market
R2_BUCKET=reyiz-market
```
Sonra:
```
GET /health/r2
GET /admin/test-r2   (admin giriş gerekli)
```
Yanıt `{"r2Status":{"configured":true}, "r2Test":{"ok":true}}` ise bağlantı sağlam.

**Admin panel → Yeni oyun ekle → .zip yükle** sonrası logda görmen gerekir:
```
✅ Dosya başarıyla Cloudflare R2 Bucket'ına aktarıldı: game_...zip (X MB)
```
Yoksa:
```
⚠️ R2 yapılandırılmadı: {"endpoint":false ...}
```

### 3) Manuel havale canlı test
```
PAYMENT_MODE=manual
BANK_IBAN=TR...
BANK_NAME=Ziraat
BANK_OWNER=Ad Soyad
```
- Kullanıcı sipariş oluştur → `/admin` → `⏳ Bekleyen` rozeti → `✓ Onayla` → kullanıcı kütüphanesinde belirir.

---

## 🛡️ Güvenlik ve Deploy Notları

1. **R2 anahtar sızdı:** Mevcut `R2_ACCESS_KEY=499f...` ve `R2_SECRET_KEY=21ba...` GitHub geçmişinde kaldı. `git history` temizlense bile Cloudflare tokeni **iptal et ve yenile**.
2. `.env` artık `.gitignore`'da. Bundan sonra `git add .env` yapılmayacak. Railway'de Variables kullan.
3. `PAYMENT_MODE` canlıda `manual` bırak, testte `mock`. `iyzico` için sandbox anahtarlarını ekle, prod'a geçerken webhook ekle (mevcut kodda `initIyzico` demo).
4. `storage/` klasörü Railway'de **ephemeral** — restart sonrası silinir. Bu yüzden **R2 zorunlu** canlıda. Yerel fallback sadece test.
5. Admin şifresini `ADMIN_PASSWORD` ile belirle, `admin123` bırakma.

---

## 📦 GitHub'a Yükleme

Düzeltilen dosyalar şu an `/home/user/reyiz-market` klasöründe hazır (commitlenmedi). Yüklemek için:

```bash
cd /home/user/reyiz-market
git status
git add storage.js routes/library.js routes/checkout.js routes/admin.js server.js .gitignore storage/.gitkeep
git commit -m "fix: kütüphane indirme + R2 proxy + pending onay akışı düzeltildi

- storage.js lazy S3, R2 teşhis, traversal koruması
- library.js 3 aşamalı indirme (R2→yerel→geçici) + verify düzeltme
- checkout.js kupon kolonları, hizli-onay yetki, FOR UPDATE
- admin.js idempotent onayla, R2 log, test-r2 endpoint
- server.js /health/r2, R2 log, storage klasör fix
- .gitignore eklendi, storage dosya→klasör"

git push origin main
# (GitHub token istenirse Taraftarium2 hesabıyla authenticate et)
```

Eğer push yetkin yoksa bu rapor ve düzeltilen dosyaları zip olarak indirip manuel yükleyebilirsin.

---

## 🧪 Ek Tanı Araçları

- `GET /health` → DB ok mu?
- `GET /health/r2` → R2 + storage + library sayımı (herkes görebilir, prod'da admin koruması eklemek istersen `requireAdmin` ekle)
- `GET /admin/test-r2` → Sadece admin, R2 ListObjectsV2 testi
- Loglar: `console.log('✅ Sipariş #...`)` tüm kritik adımlarda var, Railway logs'dan takip et.

---

## 💡 Son Söz

Sorunun kökü **“R2 değil, onay akışı”** idi. R2 doğru bağlı olsa bile `manual` modda admin onaylamadan kütüphane dolmuyor. Düzeltilen kodla:
- Admin onayı atomik ve idempotent,
- R2 proxy sağlam ve teşhis edilebilir,
- İndirme bağlantısı imzalı ve 24 saat geçerli,
- Yerel fallback sadece son çare.

İstersen bir sonraki adım olarak **otomatik “Havaleyi Yaptım → Discord webhook → Admin Telegram bildirimi”** de ekleyebilirim.

*Hazırlayan: Arena AI Agent — 6 Ağustos 2026*
