# 🎴 KABOO - Kurulum ve Deploy Rehberi

## 📋 Gereksinimler
- **Node.js** (v18+) → https://nodejs.org
- **Git** → https://git-scm.com
- **Google hesabı** (Firebase için)
- **GitHub hesabı** (Vercel deploy için)

---

## 🔥 ADIM 1: Firebase Kurulumu (5 dakika)

### 1.1 Firebase Console'a git
👉 https://console.firebase.google.com

### 1.2 Yeni proje oluştur
- **"Add project"** tıkla
- Proje adı: `kaboo-game` (veya istediğin bir isim)
- Google Analytics: İstemiyorsan kapat (oyun için gerekli değil)
- **"Create project"** tıkla

### 1.3 Realtime Database oluştur
- Sol menüden **"Build" → "Realtime Database"** tıkla
- **"Create Database"** tıkla
- Konum: **europe-west1** (Türkiye'ye yakın) seç
- **"Start in test mode"** seç (sonra güvenlik kuralı ekleyeceğiz)
- **"Enable"** tıkla

### 1.4 Web uygulaması ekle
- Proje ayarlarında (⚙️ ikonu) → **"General"** sekmesi
- Aşağıda **"Your apps"** bölümünde **"</>"** (Web) ikonuna tıkla
- App nickname: `kaboo-web`
- **"Register app"** tıkla
- Firebase config bilgileri gösterilecek — bunları kopyala:

```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "kaboo-game-xxxxx.firebaseapp.com",
  databaseURL: "https://kaboo-game-xxxxx-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "kaboo-game-xxxxx",
  storageBucket: "kaboo-game-xxxxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

### 1.5 Config'i projeye ekle
`src/firebase.js` dosyasını aç ve **"YOUR_..."** yazan yerleri kendi bilgilerinle değiştir.

### 1.6 Güvenlik kurallarını ayarla
Firebase Console → Realtime Database → **"Rules"** sekmesi:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

**"Publish"** tıkla.

---

## 💻 ADIM 2: Projeyi Bilgisayarına Kur (3 dakika)

```bash
# 1. Proje klasörünü oluştur (dosyaları indirdiysen bu adımı atla)
mkdir kaboo-web
cd kaboo-web

# 2. Bağımlılıkları yükle
npm install

# 3. Yerelde test et
npm run dev
```

Tarayıcıda `http://localhost:5173` açılacak — oyunu test et!

---

## 🚀 ADIM 3: GitHub'a Yükle (2 dakika)

```bash
# 1. Git başlat
git init
git add .
git commit -m "🎴 Kaboo game initial commit"

# 2. GitHub'da yeni repo oluştur
# → https://github.com/new
# → Repo adı: kaboo-game
# → Public veya Private seç
# → "Create repository" tıkla

# 3. Remote ekle ve push et
git remote add origin https://github.com/SENIN_KULLANICIN/kaboo-game.git
git branch -M main
git push -u origin main
```

---

## 🌐 ADIM 4: Vercel'e Deploy Et (3 dakika)

### 4.1 Vercel'e git
👉 https://vercel.com → **"Sign up"** (GitHub ile giriş yap)

### 4.2 Projeyi import et
- **"Add New..." → "Project"** tıkla
- GitHub reponuzu seç: `kaboo-game`
- Framework: **Vite** otomatik algılanacak
- **"Deploy"** tıkla

### 4.3 Bitti! 🎉
Vercel sana bir URL verecek, örneğin:
```
https://kaboo-game.vercel.app
```

Bu URL'yi arkadaşlarınla paylaşabilirsin!

---

## 📲 WhatsApp ile Davet

Oyunda **"📲 Davet Et"** butonuna basınca otomatik olarak:
- WhatsApp açılır
- Oda kodu + oyun linki hazır mesaj olarak gelir
- Arkadaşın linke tıklayınca direkt oyuna girer!

Mesaj şöyle görünür:
```
🎴 KABOO oynayalım! Oda kodum: ABC12

👉 Katıl: https://kaboo-game.vercel.app?room=ABC12
```

---

## 🔧 Sorun Giderme

### "Firebase bağlantı hatası"
- `src/firebase.js` içindeki config bilgilerini kontrol et
- `databaseURL` doğru bölgeyi göstermeli (europe-west1)

### "Vercel build hatası"
- `npm run build` yerelde çalıştırıp hata var mı kontrol et
- Node.js v18+ olduğundan emin ol

### "Oyuncu göremiyorum"
- İki taraf da aynı oda kodunu kullandığından emin ol
- Firebase Realtime Database → Data sekmesinde veri var mı kontrol et

---

## 📝 Notlar
- Firebase ücretsiz plan: 1GB veri, 10GB/ay transfer (oyun için fazlasıyla yeterli)
- Vercel ücretsiz plan: Sınırsız deploy, özel domain desteği
- İstersen Vercel'de özel domain bağlayabilirsin (kaboo.com gibi)
