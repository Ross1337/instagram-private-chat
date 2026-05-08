# CLAUDE.md — Instabox

> Lecture obligatoire avant de toucher au code. Ce fichier capture le contexte, les contraintes et les pièges de ce projet.

## 1. Quoi / Pour qui

**Instabox** est un client de messagerie **Instagram DM uniquement**, à usage **strictement personnel** (un seul utilisateur, son propre compte). Le but : avoir une boîte de réception fluide, sans feed / Reels / Explore, accessible depuis l'iPhone en PWA.

L'utilisateur est **Ross** ([@ross_xau](https://instagram.com/ross_xau) sur Instagram). Préférence : **réponses concises, en français**, action plutôt que longues explications.

## 2. Pourquoi ce design (et pas autre chose)

- **API officielle Instagram** = fermée aux comptes perso. Réservée aux Business/Creator + nécessite une Page Facebook + App Review Meta. Hors scope.
- **Wrap d'Instagram dans une webview / iframe** = bloqué par X-Frame-Options + ToS + rejet App Store (règle 4.2).
- **Extension navigateur "DM only"** = ne marche que sur desktop, pas sur iPhone.
- **Reverse engineering de l'API privée mobile** via [instagrapi](https://github.com/subzeroid/instagrapi) = la seule voie qui donne un vrai client multi-plateforme. Contraire aux ToS Meta, mais acceptable pour usage perso conscient du risque.
- **Headless browser (Playwright)** = alternative envisagée, écartée car détection bot plus agressive en 2026 (TLS fingerprinting, etc.) et plus lourd.

## 3. Architecture

```
iPhone (Safari → PWA "Ajouter à l'écran d'accueil")
   │
   │ HTTP/WebSocket via réseau local OU Tailscale
   ▼
Machine maison (toujours allumée)
   ├── uvicorn server:app  (FastAPI, port 8000)
   │     ├── REST   /api/threads, /api/threads/{id}, send, seen
   │     ├── WS     /ws  (push events au frontend)
   │     └── Static /static/, /  (sert web/index.html)
   │
   └── ig_client.py (wrapper instagrapi)
         ├── Session persistée → session.json (gitignored)
         ├── delay_range = [1, 3] entre actions
         └── Polling list_threads() toutes les ~15s ± jitter 8s
```

**Pas de DB.** Juste `session.json` sur disque pour les cookies/headers signés. Pas d'auth sur FastAPI : on assume LAN ou Tailscale (jamais exposé sur Internet).

## 4. Fichiers — rôle de chacun

| Fichier | Rôle |
|---|---|
| `ig_client.py` | Wrapper autour d'instagrapi : login (password ou sessionid), load_session paresseux, retry sur `PleaseWaitFewMinutes`, sérialisation des threads/messages en dicts JSON-friendly. |
| `login.py` | Login interactif username + password (+ challenge si demandé). Mot de passe **jamais persisté**. |
| `login_session.py` | Login en réutilisant le cookie `sessionid` du navigateur. **Préféré** : pas de mot de passe, évite les challenges anti-bot. |
| `server.py` | FastAPI : endpoints REST + WebSocket + boucle de polling asyncio. Lifespan = `ig.load_session()` au démarrage + tâche poll en arrière-plan. |
| `web/index.html` | Frontend vanilla-JS, ~200 lignes. Dark mode iOS-like. Vue liste + vue conversation + composer. WebSocket pour push temps-réel. |
| `web/manifest.json` | PWA manifest minimal pour "Ajouter à l'écran d'accueil" iOS. |
| `requirements.txt` | `instagrapi`, `fastapi`, `uvicorn[standard]`, `python-dotenv`. |
| `.env.example` | Variables optionnelles : `IG_USERNAME`, `IG_SESSIONID`, `SESSION_FILE`. |

## 5. Setup local (ta machine maison)

```bash
git clone https://github.com/Ross1337/instagram-private-chat.git
cd instagram-private-chat
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate      # macOS/Linux
pip install -r requirements.txt
```

### Login (une seule fois)

**Méthode recommandée — par sessionid :**

1. Sur Firefox/Chrome déjà connecté à instagram.com : F12 → *Storage*/*Application* → *Cookies* → `https://www.instagram.com` → copier la valeur de `sessionid`.
2. `python login_session.py` → coller à l'invite (entrée masquée).
3. `session.json` est créé.

**Alternative — par mot de passe :**

`python login.py` (demande username + password + 2FA si nécessaire).

### Lancer le serveur

```bash
uvicorn server:app --host 0.0.0.0 --port 8000
```

Puis depuis l'iPhone : Safari → `http://<ip-machine>:8000` ou `http://<tailscale-host>:8000` → bouton Partage → *Ajouter à l'écran d'accueil*.

## 6. Contraintes non-négociables

1. **IP résidentielle obligatoire.** Un serveur datacenter (AWS, OVH, Hetzner, DigitalOcean…) déclenche `PleaseWaitFewMinutes` après 1-2 appels. Le projet **doit** tourner sur la machine maison de Ross, sur son Wi-Fi normal — la même IP qu'il utilise pour Instagram naturellement.
2. **Pas de stockage de mot de passe.** Le mot de passe ne doit jamais toucher le disque ni les logs. Seul le `session.json` (cookies signés instagrapi) est persisté.
3. **Pas de multi-user.** Un seul `session.json`, un seul utilisateur. Toute archi multi-user = scope creep, rejeter.
4. **Pas d'exposition Internet sans auth.** Le serveur n'a pas d'authentification. LAN ou Tailscale uniquement. Si on devait l'exposer, ajouter un middleware `Authorization: Bearer ...` avec un token random au boot — mais à éviter par défaut.
5. **Délais conservateurs.** `delay_range = [1, 3]` côté instagrapi. Polling `15s ± 8s`. Ne pas baisser sans réfléchir aux conséquences anti-bot.
6. **Limites de débit comportementales.** L'utilisateur ne devrait pas envoyer plus de ~60-100 messages/h via l'app (limite Instagram informelle). Pas de quota côté serveur pour l'instant, mais surveiller `feedback_required`.

## 7. Erreurs typiques d'instagrapi et leur sens

| Exception | Sens | Action |
|---|---|---|
| `PleaseWaitFewMinutes` | Rate limit ou IP suspecte | `_retry()` fait déjà du backoff. Si récurrent : pause 24h. |
| `LoginRequired` | Session expirée ou invalidée | Relancer `login_session.py`. |
| `ChallengeRequired` | Anti-bot challenge (mail/SMS) | Au login : `login.py` gère le code. En cours d'usage : compte probablement flagué, pause longue. |
| `feedback_required` | Action interprétée comme spam | Stop tout pendant 24-48h sur ce compte. |
| `TwoFactorRequired` | 2FA activé | `login.py` demandera le code. |

## 8. Ce qui est **délibérément simple / absent**

À ne pas "améliorer" sans demande explicite :

- Pas de base de données (session.json suffit)
- Pas d'auth FastAPI
- Pas de tests automatisés
- Pas de CI/CD
- Pas de Docker (on tourne en local sur la machine maison)
- Pas de gestion de plusieurs comptes
- Pas de notifications push iOS encore (PWA standalone le permettrait via `Notification` API depuis iOS 16.4+ — TODO connu)
- Pas de support des médias (photos/vidéos) ni dans la lecture ni dans l'envoi
- Pas de recherche dans les conversations
- Pas d'indicateur "en train d'écrire" / "vu"

Si Ross demande explicitement une de ces features, OK. Sinon ne pas anticiper.

## 9. Bonnes pratiques de modification

- **Ne pas tester depuis cet environnement Claude / un serveur cloud.** Les tests d'intégration réels ne marchent que sur la machine maison de Ross. En dev distant, on peut juste vérifier que le code compile, que les imports passent, que les types sont OK.
- **Pour ajouter un endpoint REST :** wrapper d'abord la méthode dans `ig_client.py` avec `_retry()`, puis exposer dans `server.py` via `asyncio.to_thread()` (instagrapi est synchrone, FastAPI est async).
- **Pour modifier le polling :** garder un jitter aléatoire et un minimum de 5-10s. Polling agressif = ban.
- **Avant de commit du code IG :** vérifier que `session.json` est bien gitignored (`git check-ignore session.json` doit retourner le path).

## 10. État actuel et historique

- **Premier scaffold** créé via Claude Code dans `C:\Users\Administrateur\Desktop\Claude\instabox` (Windows Server, IP datacenter — pas la machine cible).
- **Login par sessionid validé** : `cl.login_by_sessionid(...)` a renvoyé `200` sur `users/{id}/info`, session.json créé.
- **Rate limit hit immédiatement** sur le 2e appel (`accounts/current_user`) → confirmation que cet env n'est pas le bon. À reproduire sur machine maison.
- **Repo GitHub** : https://github.com/Ross1337/instagram-private-chat (public, branche `main`).
- **Compte testé** : `@ross_xau` (compte réel de Ross — un compte de test serait plus prudent pour la phase de mise au point).

## 11. TODO connus (par ordre de priorité)

1. Tester sur la machine maison de Ross (validation IP résidentielle).
2. Détecter "moi" via `cl.user_id` pour styler correctement les bulles dans `web/index.html` (actuellement la heuristique ne marche pas et tous les messages s'affichent comme "them").
3. Avatars : récupérer `profile_pic_url` côté `users[]` et le rendre dans `.avatar`.
4. Push notifications iOS via PWA (iOS 16.4+, requires HTTPS — donc Tailscale Funnel ou reverse proxy).
5. Support photos/vidéos (réception au minimum).
6. Quota côté serveur pour limiter automatiquement le débit d'envoi.
7. Recherche full-text dans les conversations.

## 12. Sécurité — rappels

- `session.json` = équivalent d'un mot de passe. Backup possible mais privé.
- Le `sessionid` initial de Ross est apparu dans l'historique de chat Claude lors du setup → à révoquer côté Instagram (Settings → Sécurité → Déconnecter de toutes les sessions) une fois la session.json stable et de toute façon par hygiène.
- Ne **jamais** logger le contenu de `session.json`, des cookies, ou du sessionid. Si besoin de debug, masquer (`***`).
- Ne **jamais** committer `session.json` ni `.env`. `.gitignore` les couvre — vérifier avant tout commit.
