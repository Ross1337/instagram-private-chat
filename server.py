"""Backend FastAPI : REST + WebSocket pour Instabox.

Polling toutes les ~15s avec jitter. Quand un thread bouge, on fetch le detail
et on push les nouveaux messages individuellement aux clients WebSocket.
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import cache
from ig_client import IGClient

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("instabox.server")

POLL_INTERVAL_BASE = 15
POLL_JITTER = 8

ig = IGClient()
clients: set[WebSocket] = set()
last_seen_msg: dict[str, str] = {}  # thread_id -> last_message_id seen by poller


async def broadcast(event: dict) -> None:
    if not clients:
        return
    payload = json.dumps(event, default=str)
    dead = []
    for ws in clients:
        try:
            await ws.send_text(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


async def refresh_thread(tid: str, t_summary: dict | None = None) -> list[dict]:
    """Refetch un thread depuis IG, ecrit en cache, push les nouveaux via WS.
    Retourne la liste des nouveaux messages (vides si rien)."""
    try:
        detail = await asyncio.to_thread(ig.get_thread, tid, 50)
    except Exception as e:
        log.warning("refresh_thread(%s) KO: %s", tid, e)
        return []
    if t_summary:
        await asyncio.to_thread(cache.upsert_thread, tid, t_summary)
    new_msgs = await asyncio.to_thread(cache.upsert_messages, tid, detail.get("messages", []))
    for m in reversed(new_msgs):
        await broadcast({"type": "message_new", "thread_id": tid, "message": m, "thread": t_summary})
    return new_msgs


async def poll_loop() -> None:
    log.info("Demarrage poll loop (~%ss)", POLL_INTERVAL_BASE)
    while True:
        try:
            threads = await asyncio.to_thread(ig.list_threads, 20)
            for t in threads:
                last_msg = t.get("last_message")
                if not last_msg:
                    continue
                tid = t["id"]
                last_id = last_msg["id"]
                prev = last_seen_msg.get(tid)
                last_seen_msg[tid] = last_id
                # write-through cache de la meta thread
                await asyncio.to_thread(cache.upsert_thread, tid, t)
                if prev is None or prev == last_id:
                    continue
                # nouveau message detecte — fetch le thread + diff via cache
                await refresh_thread(tid, t)
        except Exception as e:
            log.exception("poll_loop: %s", e)
        wait = POLL_INTERVAL_BASE + random.randint(-POLL_JITTER, POLL_JITTER)
        await asyncio.sleep(max(5, wait))


@asynccontextmanager
async def lifespan(app: FastAPI):
    ig.load_session()
    # initialise last_seen_msg pour ne pas spammer au demarrage
    try:
        initial = await asyncio.to_thread(ig.list_threads, 20)
        for t in initial:
            if t.get("last_message"):
                last_seen_msg[t["id"]] = t["last_message"]["id"]
    except Exception as e:
        log.warning("Init last_seen_msg KO: %s", e)
    task = asyncio.create_task(poll_loop())
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan)


class SendBody(BaseModel):
    text: str
    reply_to_id: str | None = None
    reply_to_user_id: str | None = None
    reply_to_client_context: str | None = None
    reply_to_text: str | None = None
    reply_to_item_type: str | None = None


@app.get("/api/me")
async def get_me():
    return await asyncio.to_thread(ig.me)


async def refresh_threads_list():
    """Refetch la liste des threads, ecrit en cache, push les diffs via WS."""
    try:
        threads = await asyncio.to_thread(ig.list_threads, 20)
    except Exception as e:
        log.warning("refresh_threads_list KO: %s", e)
        return
    for t in threads:
        last_msg = t.get("last_message")
        if last_msg:
            tid = t["id"]
            prev = last_seen_msg.get(tid)
            last_seen_msg[tid] = last_msg["id"]
            await asyncio.to_thread(cache.upsert_thread, tid, t)
            if prev and prev != last_msg["id"]:
                # nouveau msg dans ce thread — fetch + push delta
                await refresh_thread(tid, t)
            else:
                # juste l'ordre/meta a potentiellement change
                await broadcast({"type": "thread_changed", "thread": t})
        else:
            await asyncio.to_thread(cache.upsert_thread, t["id"], t)


@app.get("/api/threads")
async def get_threads(fresh: int = 0):
    """Cache-first : sert les threads en cache instantanement + refresh background."""
    if not fresh:
        cached = await asyncio.to_thread(cache.list_threads_cached, 20)
        if cached:
            asyncio.create_task(refresh_threads_list())
            return cached
    # cold cache (ou fresh=1) : fetch synchrone
    threads = await asyncio.to_thread(ig.list_threads, 20)
    for t in threads:
        if t.get("last_message"):
            last_seen_msg[t["id"]] = t["last_message"]["id"]
        await asyncio.to_thread(cache.upsert_thread, t["id"], t)
    return threads


@app.get("/api/threads/{thread_id}")
async def get_thread(thread_id: str, fresh: int = 0):
    """Cache-first : renvoie le cache instantanement si dispo, et refresh en background.
    fresh=1 force un fetch synchrone."""
    cached = None if fresh else await asyncio.to_thread(cache.get_thread_payload, thread_id)
    if cached:
        # spawn un refresh background — le delta sera push via WS
        asyncio.create_task(refresh_thread(thread_id))
        return cached
    # pas en cache (ou fresh=1) — fetch synchrone
    try:
        detail = await asyncio.to_thread(ig.get_thread, thread_id, 50)
    except Exception as e:
        raise HTTPException(404, str(e))
    # populate cache pour les prochaines fois
    await asyncio.to_thread(cache.upsert_messages, thread_id, detail.get("messages", []))
    # upsert thread meta minimal
    summary = {
        "id": thread_id,
        "title": detail.get("title"),
        "users": detail.get("users", []),
        "last_message": (detail.get("messages") or [None])[0],
    }
    await asyncio.to_thread(cache.upsert_thread, thread_id, summary)
    return detail


async def _persist_sent(thread_id: str, msg: dict, fallback_text: str | None = None,
                        fallback_item_type: str | None = None,
                        fallback_reply: dict | None = None) -> dict:
    """Ecrit le message envoye dans le cache SQLite (write-through) pour que les
    refetch suivants voient le message — sinon flicker disparais/reapparais.
    instagrapi renvoie parfois des champs null (is_sent_by_viewer, user_id, text,
    item_type, reply), donc on injecte ce qu'on sait depuis la requete HTTP."""
    msg["is_sent_by_viewer"] = True
    if not msg.get("user_id"):
        try:
            msg["user_id"] = str(ig.cl.user_id)
        except Exception:
            pass
    if not msg.get("text") and fallback_text:
        msg["text"] = fallback_text
    if not msg.get("item_type") and fallback_item_type:
        msg["item_type"] = fallback_item_type
    if not msg.get("reply") and fallback_reply:
        msg["reply"] = fallback_reply
    await asyncio.to_thread(cache.upsert_messages, thread_id, [msg])
    if msg.get("id"):
        last_seen_msg[thread_id] = msg["id"]
    return msg


@app.post("/api/threads/{thread_id}/send")
async def send_message(thread_id: str, body: SendBody):
    if not body.text.strip():
        raise HTTPException(400, "Message vide")
    msg = await asyncio.to_thread(
        ig.send_message, thread_id, body.text,
        body.reply_to_id, body.reply_to_user_id, body.reply_to_client_context,
    )
    fallback_reply = None
    if body.reply_to_id:
        fallback_reply = {
            "id": body.reply_to_id,
            "text": body.reply_to_text or "",
            "item_type": body.reply_to_item_type or "text",
        }
    return await _persist_sent(
        thread_id, msg,
        fallback_text=body.text, fallback_item_type="text",
        fallback_reply=fallback_reply,
    )


@app.post("/api/threads/{thread_id}/send_photo")
async def send_photo(thread_id: str, file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Fichier non image")
    suffix = Path(file.filename or "img.jpg").suffix or ".jpg"
    tmp = Path(tempfile.mkstemp(suffix=suffix)[1])
    try:
        tmp.write_bytes(await file.read())
        msg = await asyncio.to_thread(ig.send_photo, thread_id, tmp)
        return await _persist_sent(thread_id, msg, fallback_item_type="media")
    finally:
        tmp.unlink(missing_ok=True)


@app.post("/api/threads/{thread_id}/send_voice")
async def send_voice(thread_id: str, file: UploadFile = File(...)):
    suffix = Path(file.filename or "audio.m4a").suffix or ".m4a"
    tmp = Path(tempfile.mkstemp(suffix=suffix)[1])
    try:
        tmp.write_bytes(await file.read())
        msg = await asyncio.to_thread(ig.send_voice, thread_id, tmp)
        return await _persist_sent(thread_id, msg, fallback_item_type="voice_media")
    except RuntimeError as e:
        raise HTTPException(501, f"Voice indisponible: {e}")
    finally:
        tmp.unlink(missing_ok=True)


@app.post("/api/threads/{thread_id}/seen")
async def mark_seen(thread_id: str):
    await asyncio.to_thread(ig.mark_seen, thread_id)
    return {"ok": True}


@app.post("/api/threads/{thread_id}/items/{message_id}/seen")
async def mark_item_seen(thread_id: str, message_id: str, is_visual: int = 0):
    """Marque un item precis comme vu cote IG.
    is_visual=1 → endpoint visual_threads (notif 'a vu ta photo ephemere').
    Sinon endpoint standard (double-tick lecture)."""
    try:
        await asyncio.to_thread(ig.mark_item_seen, thread_id, message_id, bool(is_visual))
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))


_ALLOWED_CDN_HOSTS = (
    "cdninstagram.com", "fbcdn.net", "fbsbx.com", "instagram.com",
)


@app.get("/api/proxy")
async def proxy(url: str):
    """Proxy CORS-friendly pour les CDN Meta (avatars, photos, videos, voice notes).
    Hostname-based whitelist : accepte tout sous-domaine des CDN Meta."""
    from urllib.parse import urlparse
    p = urlparse(url)
    if p.scheme != "https" or not any(
        p.hostname == h or (p.hostname or "").endswith("." + h)
        for h in _ALLOWED_CDN_HOSTS
    ):
        raise HTTPException(400, f"URL non autorisee: {p.hostname}")
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as cli:
            r = await cli.get(url)
        if r.status_code != 200:
            raise HTTPException(r.status_code, "Upstream KO")
        ct = r.headers.get("content-type", "application/octet-stream")
        return Response(content=r.content, media_type=ct, headers={"Cache-Control": "max-age=3600"})
    except httpx.HTTPError as e:
        raise HTTPException(502, str(e))


@app.websocket("/ws")
async def ws(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        clients.discard(ws)


DIST_DIR = Path(__file__).parent / "frontend" / "dist"
LEGACY_WEB_DIR = Path(__file__).parent / "web"


@app.get("/")
async def index():
    return FileResponse(DIST_DIR / "index.html")


@app.get("/legacy")
async def legacy_index():
    """Acces a l'ancienne UI vanilla pour comparison / fallback."""
    return FileResponse(LEGACY_WEB_DIR / "index.html")


# Static assets (assets/*, manifest.json, icons, etc.) — DOIT etre monte en dernier
# pour ne pas avaler les routes /api/* declarees plus haut.
app.mount("/", StaticFiles(directory=DIST_DIR, html=False), name="frontend")
