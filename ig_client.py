"""Wrapper autour d'instagrapi avec gestion de session, retry et délais humains."""
from __future__ import annotations

import logging
import os
import random
import time
from pathlib import Path
from typing import Any

from instagrapi import Client
from instagrapi.exceptions import (
    ChallengeRequired,
    LoginRequired,
    PleaseWaitFewMinutes,
)

log = logging.getLogger("instabox.ig")

SESSION_FILE = Path(os.getenv("SESSION_FILE", "session.json"))


class IGClient:
    def __init__(self, session_path: Path = SESSION_FILE):
        self.session_path = session_path
        self.cl = Client()
        self.cl.delay_range = [1, 3]

    def login_with_password(self, username: str, password: str, verification_code: str | None = None) -> None:
        """Login interactif. Persiste la session dans session.json."""
        if self.session_path.exists():
            log.info("Loading existing session from %s", self.session_path)
            self.cl.load_settings(self.session_path)
        try:
            self.cl.login(username, password, verification_code=verification_code or "")
        except ChallengeRequired:
            log.error("Challenge requis. Vérifie ton mail/sms et utilise le code.")
            raise
        self.cl.dump_settings(self.session_path)
        log.info("Session sauvegardée -> %s", self.session_path)

    def login_with_sessionid(self, sessionid: str) -> None:
        """Login en réutilisant le cookie sessionid d'une session navigateur existante."""
        sessionid = sessionid.strip()
        if not sessionid:
            raise ValueError("sessionid vide")
        # instagrapi accepte le format URL-décodé ; on décode au cas où
        if "%3A" in sessionid:
            from urllib.parse import unquote
            sessionid = unquote(sessionid)
        ok = self.cl.login_by_sessionid(sessionid)
        if not ok:
            raise RuntimeError("Login par sessionid a échoué (cookie invalide ou expiré)")
        self.cl.dump_settings(self.session_path)
        log.info("Session sauvegardée via sessionid -> %s", self.session_path)

    def load_session(self) -> None:
        """Charge la session depuis disque. Validation paresseuse : pas d'appel API
        ici pour éviter de gaspiller des requêtes (chaque appel à un endpoint privé
        peut déclencher PleaseWaitFewMinutes sur IP suspecte). La validité de la
        session sera testée lors du premier appel réel."""
        if not self.session_path.exists():
            raise FileNotFoundError(f"Pas de session à {self.session_path}. Lance d'abord login_session.py ou login.py")
        self.cl.load_settings(self.session_path)
        log.info("Session chargée (user_id=%s) — validation à la 1re requête", self.cl.user_id)

    def _retry(self, fn, *args, **kwargs) -> Any:
        for attempt in range(3):
            try:
                return fn(*args, **kwargs)
            except PleaseWaitFewMinutes:
                wait = 60 * (attempt + 1) + random.randint(5, 30)
                log.warning("Rate limited. Pause %ss", wait)
                time.sleep(wait)
            except Exception as e:
                log.exception("Erreur instagrapi: %s", e)
                raise
        raise RuntimeError("Trop de retries")

    def list_threads(self, amount: int = 20) -> list[dict]:
        threads = self._retry(self.cl.direct_threads, amount=amount)
        return [self._thread_summary(t) for t in threads]

    def get_thread(self, thread_id: str, amount: int = 30) -> dict:
        thread = self._retry(self.cl.direct_thread, int(thread_id), amount=amount)
        return self._thread_full(thread)

    def send_message(self, thread_id: str, text: str) -> dict:
        thread_id_int = int(thread_id)
        msg = self._retry(self.cl.direct_send, text, thread_ids=[thread_id_int])
        return {"id": str(msg.id), "text": msg.text, "timestamp": str(msg.timestamp)}

    def mark_seen(self, thread_id: str) -> None:
        self._retry(self.cl.direct_send_seen, int(thread_id))

    @staticmethod
    def _thread_summary(thread) -> dict:
        last = thread.messages[0] if thread.messages else None
        users = [{"username": u.username, "full_name": u.full_name, "pk": str(u.pk)} for u in thread.users]
        return {
            "id": str(thread.id),
            "title": thread.thread_title,
            "users": users,
            "unread": getattr(thread, "read_state", 0) > 0,
            "last_activity_at": str(thread.last_activity_at) if thread.last_activity_at else None,
            "last_message": (
                {
                    "id": str(last.id),
                    "text": last.text,
                    "user_id": str(last.user_id),
                    "timestamp": str(last.timestamp),
                }
                if last
                else None
            ),
        }

    @staticmethod
    def _thread_full(thread) -> dict:
        users = [{"username": u.username, "full_name": u.full_name, "pk": str(u.pk)} for u in thread.users]
        messages = [
            {
                "id": str(m.id),
                "text": m.text,
                "item_type": m.item_type,
                "user_id": str(m.user_id),
                "timestamp": str(m.timestamp),
            }
            for m in thread.messages
        ]
        return {
            "id": str(thread.id),
            "title": thread.thread_title,
            "users": users,
            "messages": messages,
        }
