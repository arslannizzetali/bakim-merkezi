# BakımEvi — Bakım Merkezi Yönetim Sistemi

**Yaşlı ve engelli bakım merkezleri için hasta takibi ve şifreli evrak yönetimi.**

🇬🇧 [English README](README.md)

<!-- TODO(izzet): docs/screenshots/ klasörüne ekran görüntüleri ekle (yalnızca seed verisiyle). -->

## Neden bu proje?

Yaşlı ve engelli bireylere hizmet veren bakım merkezlerinde günlük iş (verilen ilaç, vital bulgular, olaylar, hastaya ait evraklar) hâlâ büyük ölçüde kâğıt üzerinde tutuluyor. Bu durumda kimin ne yaptığını izlemek zorlaşıyor; hassas sağlık evrakları da klasörlerde ve paylaşılan sürücülerde kalıyor.

BakımEvi bakım personeline günlük hasta güncellemelerini girip evrakları saklayabileceği tek bir yer sunar. Rol bazlı erişim, hassas verilerin şifrelenmesi ve kimin neyi görüntülediğini ya da değiştirdiğini kaydeden bir denetim kaydı içerir.

Proje bir bakım merkezinin talebi ve ihtiyaçları üzerine tasarlanıp geliştirilmiştir.

<!-- TODO(izzet): teslimattan sonra kullanıcı sayısı, hasta sayısı ve kullanım süresini ekle. -->

## Özellikler

- **Hasta kayıtları** — kayıt, arama ve filtreleme (durum, bakım türü, mobilite, giriş tarihi), oda numarasıyla hızlı erişim
- **Günlük güncellemeler** — ilaç, bakım, gözlem, vital bulgular, durum değişikliği ve olay/kaza kayıtları; ruh hali takibi ve acil işareti
- **Evrak yönetimi** — PDF, JPEG, PNG, WEBP, DOCX ve XLSX yükleme, önceliklendirme:

  | Öncelik | Anlam | Kural |
  | --- | --- | --- |
  | `RED` | Kritik | Hiçbir rol tarafından silinemez |
  | `YELLOW` | Yarı önemli | Admin silebilir; varsayılan 90 gün sonra otomatik silinir |
  | `GREEN` | Standart | Admin silebilir; varsayılan 30 gün sonra otomatik silinir |

- **Admin paneli** — çalışan yönetimi, tüm hastalar ve güncellemeler, son/acil güncellemeler, denetim kaydı, saklama politikası ayarları
- **Çok kiracılı (multi-tenant) dağıtım** — tek bir script her kurum için ayrı veritabanı, Redis index'i, depolama bucket'ı, container'lar ve HTTPS alt alan adı oluşturur

Yetki matrisi, güvenlik tasarımı, mimari ve teknoloji seçimleri için [İngilizce README](README.md) bölümlerine bakın; her yetki satırı bir entegrasyon testiyle korunur.

## Kurulum

**Gereksinimler:** Node.js 22, Corepack, Docker.

```bash
corepack enable
corepack pnpm install
corepack pnpm generate:secrets   # JWT ve şifreleme anahtarlarını .env'e yazar

docker compose up -d             # PostgreSQL, Redis, MinIO

corepack pnpm db:generate
corepack pnpm db:migrate         # prisma migrate dev
corepack pnpm db:seed            # yalnızca geliştirme verisi
corepack pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:3001 — hazır olma kontrolü `/health`, canlılık kontrolü `/health/live`
- MinIO konsolu: http://localhost:9001

**Geliştirme seed kullanıcıları** `pnpm db:seed` ile oluşturulur. Şifreleri `.env` içindeki `SEED_ADMIN_PASSWORD` ve `SEED_EMPLOYEE_PASSWORD` değişkenlerinden okunur; boşsa rastgele şifre üretilip terminale bir kez yazdırılır. Seed, `NODE_ENV=production` ortamında çalışmayı reddeder.

## Testler

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
RUN_INTEGRATION=true corepack pnpm --filter @bakimevi/api test   # seed'lenmiş test DB, Redis ve MinIO gerekir
```

## Bilinen sınırlamalar ve yol haritası

- Klinik alanlar (tanı, alerjiler, ilaçlar, güncelleme notları) erişim kontrolü ve veritabanı/disk güvenliğiyle korunur, ancak sütun düzeyinde şifrelenmez.
- Denetim kaydının değiştirilemezliği uygulama kodunda sağlanır; veritabanı düzeyinde koruma planlanıyor.
- Next.js 14 ve Multer 1.x'teki bazı güvenlik açıkları yalnızca yeni ana sürümlerde düzeltildi; Next.js 15 ve Multer 2'ye geçiş planlanıyor.
- `MASTER_ENCRYPTION_KEY` için anahtar rotasyonu aracı henüz yok.

## Geliştirme geçmişi

Proje önce yerelde geliştirildi, bu repoya sonradan toplu olarak aktarıldı; commit geçmişinin kısa olmasının nedeni budur. Şifreleme tasarımı [`docs/ENCRYPTION.md`](docs/ENCRYPTION.md) dosyasında anlatılır.

## Yapay zekâ destekli geliştirme

<!-- TODO(izzet): hangi AI araçlarını, hangi aşamalarda kullandığını ve neleri kendin tasarladığını yaz. -->

Kökteki ve `apps/`, `research/`, `security/`, `tests/`, `src/ui/` altındaki `AGENTS.md` dosyaları, yapay zekâ kod ajanları için yazılmış talimat dosyalarıdır.

## Lisans

Tüm hakları saklıdır. Kaynak kod portföy amacıyla yayınlanmıştır.

## İletişim

İzzet Ali Arslan — [GitHub](https://github.com/arslannizzetali)
