"""Login via le cookie `sessionid` d'une session navigateur existante.

Évite mot de passe + 2FA + challenges anti-bot. À lancer une seule fois.

Source du cookie : F12 dans Firefox/Chrome sur instagram.com → Storage / Application
→ Cookies → instagram.com → ligne `sessionid` → copier `Value`.

Le sessionid est lu depuis :
  1. la variable d'env IG_SESSIONID si présente
  2. sinon, demandé via stdin (entrée masquée)

Le sessionid lui-même n'est PAS écrit dans session.json. Seuls les headers/cookies
internes signés par instagrapi sont persistés.
"""
from __future__ import annotations

import getpass
import logging
import os
import sys

from dotenv import load_dotenv

from ig_client import IGClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


def main() -> int:
    load_dotenv()
    sessionid = os.getenv("IG_SESSIONID")
    if not sessionid:
        sessionid = getpass.getpass("Colle ton sessionid (entrée masquée): ")
    if not sessionid.strip():
        print("sessionid vide.", file=sys.stderr)
        return 1

    client = IGClient()
    client.login_with_sessionid(sessionid)
    me = client.cl.account_info()
    print(f"\n[OK] Connecte en tant que @{me.username} (id {me.pk})")
    print("Session sauvegardee. Tu peux maintenant lancer server.py.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
