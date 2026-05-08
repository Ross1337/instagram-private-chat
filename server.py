"""Backend FastAPI : REST pour conversations + WebSocket pour push de nouveaux messages.

Le polling tourne toutes les ~15s (jitter aléatoire pour éviter les patterns trop nets).
Quand un thread bouge, on push un event aux clients WebSocket connectés.
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ig_client import IGClient

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("instabox.server")

POLL_INTERVAL_BASE = 15  # secondes
POLL_JITTER = 8  # +/- jitter aléatoire

ig = IGClient()
clients: set[WebSocket] = set()
last_seen: dict[str, str] = {}  # thread_id -> last_message_id


async def broadcast(event: dict) -> None:
    if not clients:
        return
    payload = json.dumps(event)
    dead = []
    for ws in clients:
        try:
            await ws.send_text(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


async def poll_loop() -> None:
    """Boucle de polling. Appelle list_threads et push les diffs."""
    log.info("Démarrage poll loop (intervalle ~%ss)", POLL_INTERVAL_BASE)
    while True:
        try:
            threads = await asyncio.to_thread(ig.list_threads, 20)
            new_events: list[dict] = []
            for t in threads:
                last_msg = t.get("last_message")
                if not last_msg:
                    continue
                tid = t["id"]
                last_id = last_msg["id"]
                if last_seen.get(tid) != last_id:
                    is_new = tid in last_seen  # premier passage = pas un "nouveau"
                    last_seen[tid] = last_id
                    if is_new:
                        new_events.append({"type": "thread_update", "thread": t})
            if new_events:
                log.info("%d nouveaux events", len(new_events))
                for ev in new_events:
                    await broadcast(ev)
        except Exception as e:
            log.exception("Erreur dans poll_loop: %s", e)
        wait = POLL_INTERVAL_BASE + random.randint(-POLL_JITTER, POLL_JITTER)
        await asyncio.sleep(max(5, wait))


@asynccontextmanager
async def lifespan(app: FastAPI):
    ig.load_session()
    task = asyncio.create_task(poll_loop())
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan)


class SendBody(BaseModel):
    text: str


@app.get("/api/threads")
async def get_threads():
    return await asyncio.to_thread(ig.list_threads, 20)


@app.get("/api/threads/{thread_id}")
async def get_thread(thread_id: str):
    try:
        return await asyncio.to_thread(ig.get_thread, thread_id, 50)
    except Exception as e:
        raise HTTPException(404, str(e))


@app.post("/api/threads/{thread_id}/send")
async def send_message(thread_id: str, body: SendBody):
    if not body.text.strip():
        raise HTTPException(400, "Message vide")
    return await asyncio.to_thread(ig.send_message, thread_id, body.text)


@app.post("/api/threads/{thread_id}/seen")
async def mark_seen(thread_id: str):
    await asyncio.to_thread(ig.mark_seen, thread_id)
    return {"ok": True}


@app.websocket("/ws")
async def ws(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    try:
        while True:
            await ws.receive_text()  # keep-alive (on ignore le contenu)
    except WebSocketDisconnect:
        clients.discard(ws)


# Static frontend
WEB_DIR = Path(__file__).parent / "web"
app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


@app.get("/")
async def index():
    return FileResponse(WEB_DIR / "index.html")
