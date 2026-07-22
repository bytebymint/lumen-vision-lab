from __future__ import annotations

import sqlite3

from flask import current_app, g


SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TEXT,
    goal_minutes INTEGER NOT NULL,
    camera_label TEXT NOT NULL DEFAULT 'Private camera',
    calibration_quality REAL NOT NULL DEFAULT 0,
    average_focus REAL,
    focused_seconds INTEGER NOT NULL DEFAULT 0,
    distracted_seconds INTEGER NOT NULL DEFAULT 0,
    break_seconds INTEGER NOT NULL DEFAULT 0,
    interruptions INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    elapsed_seconds INTEGER NOT NULL,
    focus_score REAL NOT NULL,
    confidence REAL NOT NULL,
    state TEXT NOT NULL,
    gaze_score REAL NOT NULL,
    head_score REAL NOT NULL,
    posture_score REAL NOT NULL,
    presence_score REAL NOT NULL,
    fatigue_score REAL NOT NULL,
    phone_score REAL NOT NULL DEFAULT 100,
    FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_samples_session_elapsed
ON samples(session_id, elapsed_seconds);
"""


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(current_app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
        g.db.execute("PRAGMA journal_mode = WAL")
    return g.db


def close_db(_error=None) -> None:
    database = g.pop("db", None)
    if database is not None:
        database.close()


def init_db() -> None:
    database = get_db()
    database.executescript(SCHEMA)
    columns = {row[1] for row in database.execute("PRAGMA table_info(samples)").fetchall()}
    if "phone_score" not in columns:
        database.execute("ALTER TABLE samples ADD COLUMN phone_score REAL NOT NULL DEFAULT 100")
    database.commit()


def init_app(app: Flask) -> None:
    app.teardown_appcontext(close_db)
    with app.app_context():
        init_db()
