"""Cache SQLite des threads et messages.

Pattern stale-while-revalidate :
- Lectures synchrones renvoient le cache instantanement (si present)
- Refresh en background ecrit les nouveaux messages et push via WS
- Le poll_loop ecrit aussi au passage (write-through)
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path

DB_PATH = Path(__file__).parent / ".cache.db"

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _get() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(str(DB_PATH), check_same_thread=False, isolation_level=None)
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA synchronous=NORMAL")
        _conn.executescript("""
            CREATE TABLE IF NOT EXISTS messages (
              thread_id TEXT NOT NULL,
              id TEXT NOT NULL,
              payload TEXT NOT NULL,
              ts TEXT NOT NULL,
              PRIMARY KEY (thread_id, id)
            );
            CREATE INDEX IF NOT EXISTS idx_msgs_thread_ts ON messages(thread_id, ts DESC);
            CREATE TABLE IF NOT EXISTS threads (
              id TEXT PRIMARY KEY,
              payload TEXT NOT NULL,
              last_message_id TEXT,
              updated_at INTEGER NOT NULL
            );
        """)
    return _conn


def get_thread_payload(thread_id: str) -> dict | None:
    """Renvoie {users, title, messages} si on a au moins UN message en cache.
    Sinon None — la meta seule (sans messages) compte comme cache miss."""
    with _lock:
        c = _get()
        msgs = c.execute(
            "SELECT payload FROM messages WHERE thread_id=? ORDER BY ts DESC LIMIT 200",
            (thread_id,),
        ).fetchall()
        if not msgs:
            return None
        row = c.execute("SELECT payload FROM threads WHERE id=?", (thread_id,)).fetchone()
        thread = json.loads(row[0]) if row else {"id": thread_id, "users": [], "title": None}
        thread["messages"] = [json.loads(r[0]) for r in msgs]
        return thread


def upsert_thread(thread_id: str, summary: dict) -> None:
    """Ecrit la meta thread complete (users, title, last_message preview, etc).
    Le payload est servi tel quel par /api/threads."""
    with _lock:
        last_id = (summary.get("last_message") or {}).get("id")
        meta = {k: summary.get(k) for k in (
            "users", "title", "last_activity_at", "unread", "last_message"
        )}
        meta["id"] = thread_id
        _get().execute(
            "INSERT OR REPLACE INTO threads(id, payload, last_message_id, updated_at) VALUES (?, ?, ?, ?)",
            (thread_id, json.dumps(meta, default=str), last_id, int(time.time())),
        )


def list_threads_cached(limit: int = 20) -> list[dict]:
    """Renvoie les threads en cache, ordonnes par last_activity_at (le plus recent en premier)."""
    with _lock:
        rows = _get().execute(
            "SELECT payload FROM threads ORDER BY updated_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [json.loads(r[0]) for r in rows]


def upsert_messages(thread_id: str, messages: list[dict]) -> list[dict]:
    """Ecrit les messages, retourne ceux qui etaient nouveaux (pas deja en cache)."""
    if not messages:
        return []
    new_msgs: list[dict] = []
    with _lock:
        c = _get()
        existing = {
            r[0] for r in c.execute(
                f"SELECT id FROM messages WHERE thread_id=? AND id IN ({','.join('?'*len(messages))})",
                (thread_id, *[m["id"] for m in messages]),
            )
        }
        rows = []
        for m in messages:
            if m["id"] not in existing:
                new_msgs.append(m)
            rows.append((thread_id, m["id"], json.dumps(m, default=str), str(m.get("timestamp", ""))))
        c.executemany(
            "INSERT OR REPLACE INTO messages(thread_id, id, payload, ts) VALUES (?, ?, ?, ?)",
            rows,
        )
    return new_msgs


def known_message_ids(thread_id: str, limit: int = 100) -> set[str]:
    with _lock:
        rows = _get().execute(
            "SELECT id FROM messages WHERE thread_id=? ORDER BY ts DESC LIMIT ?",
            (thread_id, limit),
        ).fetchall()
    return {r[0] for r in rows}


def has_thread(thread_id: str) -> bool:
    with _lock:
        return _get().execute(
            "SELECT 1 FROM threads WHERE id=? LIMIT 1", (thread_id,)
        ).fetchone() is not None
