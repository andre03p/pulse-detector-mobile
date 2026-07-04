# HeartCheck – Aplicație mobilă pentru monitorizarea ritmului cardiac

Aplicație mobilă (Android) care măsoară ritmul cardiac (BPM) folosind camera și blițul
telefonului prin tehnica **fotopletismografiei (PPG)**: utilizatorul acoperă camera
și blițul cu degetul, iar aplicația analizează în timp real variațiile de lumină
absorbită pentru a estima ritmul cardiac. Măsurătorile pot fi etichetate, salvate, exportate și vizualizate ca istoric și statistici.

## 1. Adresa repository-ului

`https://github.com/andre03p/pulse-detector-mobile.git`

## 2. Livrabile

- Aplicația mobilă React Native (Expo), platformă Android.
- Cod sursă TypeScript:
  - `app/` – ecrane și navigație (Expo Router): autentificare, home, istoric,
    statistici, alarme, profil;
  - `components/` – componente UI (monitorul de puls, graficul de undă etc.);
  - `utils/heartRateDetection.ts` – algoritmii de estimare a pulsului;
  - `lib/` – integrarea Supabase (auth + interogări);
  - `context/AuthContext.tsx` – gestionarea sesiunii de utilizator.

## 3. Cerințe preliminare

| Componentă         | Versiune recomandată                              |
| ------------------ | ------------------------------------------------- |
| Node.js            | ≥ 20 LTS                                          |
| npm                | ≥ 10                                              |
| Expo CLI / EAS CLI | rulate prin `npx` (nu necesită instalare globală) |
| Cont Expo (EAS)    | necesar pentru build-uri în cloud                 |
| Cont Supabase      | necesar pentru backend (auth + DB)                |

## 4. Configurare (obligatorie înainte de compilare)

Aplicația citește configurarea Supabase din variabile de mediu. Fișierul `.env`
**nu este inclus în repository** și trebuie creat manual în project root.

```bash
# .env
EXPO_PUBLIC_SUPABASE_URL=https://<project_name>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<public-anon-key-supabase>
```

## 5. Pași de compilare

### 5.1. Clonare și instalare dependențe

```bash
git clone https://github.com/andre03p/pulse-detector-mobile.git
cd pulse-detector-mobile
npm install
```

### 5.2. Generarea build-ului nativ (APK Android)

Aplicația folosește module native (camera), deci build-ul se face cu **EAS Build**.
Profilurile sunt definite în `eas.json`.

Autentificare EAS (o singură dată):

```bash
npx eas login
```

**Build cu profilul `development`:**

```bash
npx eas build -p android --profile development
```

La final, EAS oferă un link sau un cod QR de unde se descarcă fișierul `.apk`. Acesta este un
_development client_: **nu conține** bundle-ul JavaScript împachetat, ci îl încarcă
la pornire de la serverul Metro (`npx expo start`) rulat pe laptop, telefonul fiind
pe **aceeași rețea Wi-Fi**.

> **Alternativ**, se poate genera și un **APK autonom** (rulează singur pe telefon,
> fără laptop și fără Wi-Fi comun) folosind profilul `production`:
>
> ```bash
> npx eas build -p android --profile production
> ```

## 6. Instalare și lansare a aplicației

Pași pentru APK-ul `development` (laptopul și telefonul pe aceeași rețea Wi-Fi):

1. Descărcați `.apk`-ul din linkul oferit de EAS și transferați-l pe telefonul
   Android (link, cablu USB, cloud etc.).
2. Pe telefon, permiteți instalarea din surse necunoscute și instalați APK-ul.
3. Porniți serverul de dezvoltare (Metro) pe laptop, în folderul proiectului:

   ```bash
   npx expo start --dev-client
   ```

4. Deschideți aplicația **HeartCheck** pe telefon — aceasta se conectează la serverul
   Metro și încarcă codul prin Wi-Fi.
5. La prima pornire acordați permisiunea de **cameră** (și opțional notificări).
6. Creați un cont / autentificați-vă, apoi apăsați **Start Measurement**, acoperiți
   camera și blițul cu degetul și mențineți mâna nemișcată până la finalizarea
   măsurătorii.

## 7. Structura proiectului

```
app/            Ecrane și navigație (Expo Router)
  (auth)/       Login, register, resetare parolă, verificare email
  (tabs)/       home, history, stats, alarms, profile
components/     Componente UI (HeartRateMonitor, PulseWave, grafice, footer)
context/        AuthContext (sesiune utilizator)
lib/            Client Supabase și interogări (măsurători, alarme, statistici)
utils/          Algoritmi detecție puls (FFT, autocorelație, SQI) și notificări
assets/         Imagini, iconițe, fonturi
eas.json        Profiluri de build EAS (development / preview / production)
app.json        Configurarea aplicației Expo (nume, permisiuni, plugin-uri)
```
