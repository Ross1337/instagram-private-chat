# Instabox

Client perso minimal pour les DMs Instagram. Backend Python (instagrapi + FastAPI) tournant en local, frontend PWA accessible depuis l'iPhone via Tailscale ou réseau local.

> ⚠️ Usage strictement personnel, sur ton propre compte. instagrapi reverse-engineerise l'API mobile privée d'Instagram — c'est contraire aux ToS de Meta. Risque de ban réel : utilise un compte de test au début.

## Setup

```bash
cd instabox
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate      # mac/linux
pip install -r requirements.txt
cp .env.example .env             # facultatif, pour pré-remplir IG_USERNAME
```

## 1. Login (une seule fois)

Deux options :

### Option A — Login par cookie (recommandé)

Évite mot de passe + 2FA + challenge anti-bot, en réutilisant la session de ton navigateur :

1. Ouvre Firefox/Chrome sur https://www.instagram.com (déjà connecté)
2. F12 → onglet *Storage* (Firefox) ou *Application* (Chrome) → *Cookies* → `https://www.instagram.com`
3. Copie la valeur du cookie `sessionid`
4. Lance :

```bash
python login_session.py
# colle le sessionid à l'invite (entrée masquée)
```

Tu peux aussi mettre `IG_SESSIONID=...` dans `.env` (il est gitignored).

### Option B — Login par mot de passe

```bash
python login.py
```

- Demande username + password (mot de passe **non stocké**)
- Si Instagram demande un challenge / 2FA, le script te demande le code
- Plus risqué côté détection anti-bot

Dans les deux cas, `session.json` est créé. C'est ce fichier qui sera utilisé ensuite.

Si la session expire (au bout de plusieurs semaines/mois selon l'usage), relance le script de login.

## 2. Lancer le serveur

```bash
uvicorn server:app --host 0.0.0.0 --port 8000
```

- Serveur sur `http://localhost:8000`
- Polling toutes les ~15s avec jitter, push WebSocket aux clients connectés

## 3. Accès depuis l'iPhone

### Option A — réseau local
- Trouve l'IP de la machine : `ipconfig` (Windows) → IPv4 du Wi-Fi
- Sur l'iPhone, Safari → `http://<ip>:8000` → "Ajouter à l'écran d'accueil"

### Option B — Tailscale (recommandé)
- Installe Tailscale sur la machine et l'iPhone (même compte)
- Sur l'iPhone, Safari → `http://<tailscale-hostname>:8000` → "Ajouter à l'écran d'accueil"
- Marche aussi en 4G/5G

## Structure

```
instabox/
├── ig_client.py     # Wrapper instagrapi (session, retry, format)
├── login.py         # Login interactif → session.json
├── server.py        # FastAPI : REST + WebSocket + polling
├── web/
│   ├── index.html   # PWA frontend (vanilla JS)
│   └── manifest.json
├── requirements.txt
├── .env.example
└── .gitignore
```

## Endpoints API

- `GET  /api/threads` — liste des conversations (20 dernières)
- `GET  /api/threads/{id}` — détail conv avec 50 derniers messages
- `POST /api/threads/{id}/send` `{text}` — envoyer un message
- `POST /api/threads/{id}/seen` — marquer lu
- `WS   /ws` — push de nouveaux messages

## Bonnes pratiques anti-ban

- IP **résidentielle** (chez toi, pas un serveur datacenter) — c'est la vraie clé
- Délais entre actions : `delay_range = [1, 3]` déjà configuré
- Polling à 15s + jitter : pas plus rapide
- Pas plus de N envois/heure (Instagram limite vers 60-100/h selon le compte)
- En cas de `feedback_required` ou `please_wait_a_few_minutes` : pause 24h sur ce compte

## TODO / améliorations possibles

- Avatars (récupérer `profile_pic_url` côté `users[]`)
- Détection de "moi" via `cl.user_id` pour styler correctement les bulles
- Indicateur de frappe (websocket realtime, requiert plus de boulot)
- Push notifications iOS (PWA standalone permet `Notification` API depuis iOS 16.4+)
- Médias (photos/vidéos en réception et envoi)
- Recherche dans les conversations
