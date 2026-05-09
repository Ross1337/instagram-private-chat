"""Wrapper autour d'instagrapi avec gestion de session, retry et delais humains."""
from __future__ import annotations

import logging
import os
import random
import subprocess
import tempfile
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
        self._me_cache: dict | None = None

    # ---------- auth ----------

    def login_with_password(self, username: str, password: str, verification_code: str | None = None) -> None:
        if self.session_path.exists():
            log.info("Loading existing session from %s", self.session_path)
            self.cl.load_settings(self.session_path)
        try:
            self.cl.login(username, password, verification_code=verification_code or "")
        except ChallengeRequired:
            log.error("Challenge requis. Verifie ton mail/sms et utilise le code.")
            raise
        self.cl.dump_settings(self.session_path)

    def login_with_sessionid(self, sessionid: str) -> None:
        sessionid = sessionid.strip()
        if not sessionid:
            raise ValueError("sessionid vide")
        if "%3A" in sessionid:
            from urllib.parse import unquote
            sessionid = unquote(sessionid)
        ok = self.cl.login_by_sessionid(sessionid)
        if not ok:
            raise RuntimeError("Login par sessionid a echoue")
        self.cl.dump_settings(self.session_path)

    def load_session(self) -> None:
        if not self.session_path.exists():
            raise FileNotFoundError(f"Pas de session a {self.session_path}. Lance login.py")
        self.cl.load_settings(self.session_path)
        log.info("Session chargee (user_id=%s)", self.cl.user_id)

    # ---------- retry helper ----------

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

    # ---------- me ----------

    def me(self) -> dict:
        if self._me_cache:
            return self._me_cache
        uid = self.cl.user_id
        out = {"pk": str(uid), "username": self.cl.username or "", "full_name": "", "profile_pic_url": None}
        try:
            info = self._retry(self.cl.user_info_v1, int(uid))
            out["username"] = info.username
            out["full_name"] = info.full_name
            out["profile_pic_url"] = str(info.profile_pic_url) if info.profile_pic_url else None
        except Exception as e:
            log.warning("me() user_info_v1 a plante (%s) — on garde un profil minimal", e)
        self._me_cache = out
        return out

    # ---------- threads ----------

    def list_threads(self, amount: int = 20) -> list[dict]:
        threads = self._retry(self.cl.direct_threads, amount=amount)
        return [self._thread_summary(t) for t in threads]

    def get_thread(self, thread_id: str, amount: int = 50) -> dict:
        thread = self._retry(self.cl.direct_thread, int(thread_id), amount=amount)
        return self._thread_full(thread)

    # ---------- send ----------

    def send_message(self, thread_id: str, text: str,
                     reply_to_id: str | None = None,
                     reply_to_user_id: str | None = None) -> dict:
        reply_msg = None
        if reply_to_id:
            from datetime import datetime
            from instagrapi.types import DirectMessage
            reply_msg = DirectMessage(
                id=str(reply_to_id),
                user_id=str(reply_to_user_id) if reply_to_user_id else "0",
                timestamp=datetime.now(),
                item_type="text",
            )
        msg = self._retry(
            self.cl.direct_send, text,
            thread_ids=[int(thread_id)],
            reply_to_message=reply_msg,
        )
        return self._msg_to_dict(msg)

    def send_photo(self, thread_id: str, file_path: Path) -> dict:
        msg = self._retry(self.cl.direct_send_photo, path=file_path, thread_ids=[int(thread_id)])
        return self._msg_to_dict(msg)

    def send_voice(self, thread_id: str, audio_path: Path) -> dict:
        """Envoie un message audio. instagrapi 2.5.13 n'a pas de send_voice natif :
        on enrobe l'audio dans un MP4 720x1280 (format Story-compliant) avec frame noire,
        puis on envoie via direct_send_video. Le destinataire verra une video courte."""
        try:
            from imageio_ffmpeg import get_ffmpeg_exe
            ffmpeg = get_ffmpeg_exe()
        except Exception as e:
            raise RuntimeError(f"ffmpeg indisponible: {e}")

        out = Path(tempfile.mkstemp(suffix=".mp4")[1])
        # 720x1280 (9:16 portrait) — format que l'endpoint configure_to_story accepte.
        # Padding 0.5s de silence en debut + audio + 0.5s pour assurer >= 1s de duree.
        cmd = [
            ffmpeg, "-y",
            "-f", "lavfi", "-i", "color=c=black:s=720x1280:r=30",
            "-i", str(audio_path),
            "-filter_complex",
            "[1:a]apad=pad_dur=0.5,adelay=500|500[a]",
            "-map", "0:v", "-map", "[a]",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast",
            "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
            "-shortest", "-movflags", "+faststart",
            str(out),
        ]
        proc = subprocess.run(cmd, capture_output=True)
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg echec: {proc.stderr.decode(errors='ignore')[:500]}")
        try:
            msg = self._retry(self.cl.direct_send_video, path=out, thread_ids=[int(thread_id)])
            return self._msg_to_dict(msg)
        finally:
            out.unlink(missing_ok=True)

    def mark_seen(self, thread_id: str) -> None:
        self._retry(self.cl.direct_send_seen, int(thread_id))

    # ---------- serialization ----------

    @staticmethod
    def _user_dict(u) -> dict:
        return {
            "username": u.username,
            "full_name": u.full_name,
            "pk": str(u.pk),
            "profile_pic_url": str(u.profile_pic_url) if getattr(u, "profile_pic_url", None) else None,
        }

    def _msg_to_dict(self, m) -> dict:
        user_id = str(m.user_id) if m.user_id else None
        # Si is_sent_by_viewer non fourni par IG : on deduit en comparant user_id
        # avec mon propre user_id (parfois plus fiable que le flag d'IG).
        is_mine = m.is_sent_by_viewer
        if is_mine is None:
            try:
                if user_id and str(self.cl.user_id) == user_id:
                    is_mine = True
                elif user_id:
                    is_mine = False
            except Exception:
                pass
        out: dict = {
            "id": str(m.id),
            "item_type": m.item_type,
            "user_id": user_id,
            "timestamp": str(m.timestamp),
            "is_sent_by_viewer": bool(is_mine) if is_mine is not None else None,
            "text": m.text,
        }
        if m.media:
            out["media"] = {
                "media_type": m.media.media_type,
                "thumbnail_url": str(m.media.thumbnail_url) if m.media.thumbnail_url else None,
                "video_url": str(m.media.video_url) if m.media.video_url else None,
                "audio_url": str(m.media.audio_url) if m.media.audio_url else None,
            }
        if m.visual_media:
            try:
                vm = m.visual_media
                content = getattr(vm, "media", None)
                image_url = None
                video_url = None
                if content is not None:
                    iv = getattr(content, "image_versions2", None)
                    if iv and getattr(iv, "candidates", None):
                        # Plus haute resolution = la 1ere candidate (IG les trie desc)
                        image_url = str(iv.candidates[0].url)
                    vv = getattr(content, "video_versions", None) or []
                    if vv:
                        video_url = str(vv[0].url)
                out["visual_media"] = {
                    "image_url": image_url,
                    "video_url": video_url,
                    "view_mode": getattr(vm, "view_mode", None),
                    "seen_count": getattr(vm, "seen_count", 0),
                }
            except Exception as e:
                log.warning("visual_media extract KO: %s", e)
        if m.animated_media:
            try:
                am = m.animated_media
                images = am.get("images", {}) if isinstance(am, dict) else {}
                fixed_h = images.get("fixed_height", {}) if isinstance(images, dict) else {}
                out["animated_media"] = {"url": fixed_h.get("url") or fixed_h.get("webp")}
            except Exception:
                pass
        if m.reactions:
            try:
                emojis = getattr(m.reactions, "emojis", []) or []
                out["reactions"] = [{"emoji": getattr(r, "emoji", None), "sender_id": str(getattr(r, "sender_id", ""))} for r in emojis]
            except Exception:
                pass
        if m.reply:
            try:
                out["reply"] = {"text": m.reply.text, "item_type": m.reply.item_type}
            except Exception:
                pass
        if m.clip:
            out["clip"] = {"id": str(m.clip.id) if m.clip.id else None}
        if m.media_share:
            out["media_share"] = {"id": str(m.media_share.id) if m.media_share.id else None}
        return out

    def _thread_summary(self, thread) -> dict:
        last = thread.messages[0] if thread.messages else None
        users = [self._user_dict(u) for u in thread.users]
        return {
            "id": str(thread.id),
            "title": thread.thread_title,
            "users": users,
            "unread": getattr(thread, "read_state", 0) > 0,
            "last_activity_at": str(thread.last_activity_at) if thread.last_activity_at else None,
            "last_message": self._msg_to_dict(last) if last else None,
        }

    def _thread_full(self, thread) -> dict:
        users = [self._user_dict(u) for u in thread.users]
        messages = [self._msg_to_dict(m) for m in thread.messages]
        return {
            "id": str(thread.id),
            "title": thread.thread_title,
            "users": users,
            "messages": messages,
        }
