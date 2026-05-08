"""Login interactif. À lancer une seule fois (ou si la session expire).

Le mot de passe n'est PAS stocké. Seule la session signée est persistée
dans session.json (cookies + headers).
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
    username = os.getenv("IG_USERNAME") or input("Instagram username: ").strip()
    if not username:
        print("Username vide.", file=sys.stderr)
        return 1

    password = getpass.getpass(f"Password pour {username} (jamais stocké): ")
    if not password:
        print("Password vide.", file=sys.stderr)
        return 1

    client = IGClient()
    try:
        client.login_with_password(username, password)
    except Exception as e:
        # Challenge / 2FA : demander le code et retenter
        if "challenge" in str(e).lower() or "two_factor" in str(e).lower() or "verification" in str(e).lower():
            code = input("Code de vérification reçu (mail/SMS/authenticator): ").strip()
            client.login_with_password(username, password, verification_code=code)
        else:
            raise

    print("\n[OK] Login OK. Session sauvegardee. Tu peux maintenant lancer server.py.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
