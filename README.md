# Grinstagram

**Grinstagram** este o rețea de socializare în stil Instagram, full-stack, care rulează local pe calculatorul tău. Îți faci cont, postezi poze, dai like, comentezi și urmărești alți utilizatori — totul dintr-o aplicație web pe care o pornești cu o singură comandă.

> Proiect educativ. Nu este afiliat cu Instagram / Meta.

## Funcții

- Înregistrare & autentificare (parole criptate cu bcrypt, sesiune pe cookie JWT)
- Postări cu imagini + descriere (upload de pe disc)
- Feed personalizat (postările tale + ale celor pe care îi urmărești)
- Explore (toate postările recente, în grilă)
- Like / unlike
- Comentarii
- Follow / unfollow
- Profiluri cu avatar, bio, nume, statistici (postări / urmăritori / urmărești)
- Căutare de utilizatori
- Design responsive, în stilul Instagram

## Tehnologii

| Strat        | Tehnologie                         |
| ------------ | ---------------------------------- |
| Backend      | Node.js + Express                  |
| Bază de date | SQLite (`better-sqlite3`)          |
| Auth         | JWT + bcryptjs                     |
| Upload       | multer (imagini salvate pe disc)   |
| Frontend     | HTML + CSS + JavaScript (fără build)|

## Cum rulezi (Windows / macOS / Linux)

Ai nevoie de [Node.js](https://nodejs.org) (versiunea 18 sau mai nouă; testat pe 22).

```bash
# 1. Instaleaza dependintele
npm install

# 2. Porneste aplicatia
npm start
```

Apoi deschide în browser: **http://localhost:3000**

> Pe Windows: deschide **PowerShell** sau **Command Prompt** în folderul proiectului (sau rulează `cd calea\catre\grinstagram`) și apoi comenzile de mai sus.

Pentru dezvoltare, cu restart automat la modificări:

```bash
npm run dev
```

## Structura proiectului

```
grinstagram/
├── server/
│   ├── index.js      # Serverul Express + toate rutele API
│   └── db.js         # SQLite: conexiune + schema
├── public/
│   ├── index.html    # Shell-ul aplicatiei
│   ├── css/style.css # Stiluri (temă în stil Instagram)
│   └── js/app.js     # Logica frontend (SPA vanilla JS)
├── uploads/          # Imaginile incarcate (ignorate de git)
├── data/             # Baza de date SQLite (creata automat, ignorata de git)
└── package.json
```

## Configurare (opțional)

Variabile de mediu:

- `PORT` — portul serverului (implicit `3000`)
- `JWT_SECRET` — secretul pentru token-uri. Dacă nu este setat, se generează unul nou la fiecare pornire (adică sesiunile se invalidează la restart). Setează-l ca sesiunile să rămână valide:

```bash
# Windows PowerShell
$env:JWT_SECRET="un-secret-lung-si-aleator"; npm start

# macOS / Linux
JWT_SECRET="un-secret-lung-si-aleator" npm start
```

## API (pe scurt)

| Metodă | Rută                              | Descriere                         |
| ------ | --------------------------------- | --------------------------------- |
| POST   | `/api/auth/register`              | Cont nou                          |
| POST   | `/api/auth/login`                 | Autentificare                     |
| POST   | `/api/auth/logout`                | Delogare                          |
| GET    | `/api/auth/me`                    | Utilizatorul curent               |
| GET    | `/api/feed`                       | Feed-ul personalizat              |
| GET    | `/api/explore`                    | Toate postările recente           |
| POST   | `/api/posts`                      | Postare nouă (multipart: `image`) |
| GET    | `/api/posts/:id`                  | O postare + comentariile          |
| DELETE | `/api/posts/:id`                  | Șterge postarea proprie           |
| POST   | `/api/posts/:id/like`             | Like / unlike (toggle)            |
| POST   | `/api/posts/:id/comments`         | Adaugă comentariu                 |
| GET    | `/api/users?q=`                   | Caută utilizatori                 |
| GET    | `/api/users/:username`            | Profil + postări                  |
| POST   | `/api/users/:username/follow`     | Follow / unfollow (toggle)        |
| PUT    | `/api/profile`                    | Actualizează profilul             |

## Licență

MIT © Monescu Teodor
