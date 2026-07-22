from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from flask import Blueprint, abort, jsonify, render_template, request

from .db import get_db


bp = Blueprint("main", __name__)
ALLOWED_STATES = {"focused", "drifting", "distracted", "phone", "away", "uncertain", "break"}
METRIC_FIELDS = (
    "focus_score",
    "confidence",
    "gaze_score",
    "head_score",
    "posture_score",
    "presence_score",
    "fatigue_score",
)


def _number(value: Any, field: str, low: float = 0, high: float = 100) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        abort(400, description=f"{field} must be a number")
    if not low <= float(value) <= high:
        abort(400, description=f"{field} must be between {low} and {high}")
    return round(float(value), 3)


def _session_or_404(session_id: int):
    row = get_db().execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
    if row is None:
        abort(404, description="Session not found")
    return row


@bp.get("/")
def index():
    return render_template("index.html")


@bp.get("/focus")
def focus_monitor():
    return render_template("focus.html")


@bp.get("/fingers")
def finger_numbers():
    return render_template("fingers.html")


@bp.get("/emotion")
def expression_age():
    return render_template("emotion.html")


@bp.get("/canvas")
def air_canvas():
    return render_template("air_canvas.html")


@bp.get("/api/health")
def health():
    return jsonify(status="ok", service="Lumen Focus")


@bp.post("/api/sessions")
def create_session():
    payload = request.get_json(silent=True) or {}
    goal = payload.get("goal_minutes", 50)
    if isinstance(goal, bool) or not isinstance(goal, int) or not 5 <= goal <= 240:
        abort(400, description="goal_minutes must be an integer between 5 and 240")
    camera_label = str(payload.get("camera_label", "Private camera")).strip()[:120]
    quality = _number(payload.get("calibration_quality", 0), "calibration_quality")
    database = get_db()
    cursor = database.execute(
        "INSERT INTO sessions (goal_minutes, camera_label, calibration_quality) VALUES (?, ?, ?)",
        (goal, camera_label or "Private camera", quality),
    )
    database.commit()
    return jsonify(id=cursor.lastrowid, started_at=datetime.now(timezone.utc).isoformat()), 201


@bp.post("/api/sessions/<int:session_id>/samples")
def add_samples(session_id: int):
    session = _session_or_404(session_id)
    if session["ended_at"] is not None:
        abort(409, description="Session has already ended")
    payload = request.get_json(silent=True) or {}
    samples = payload.get("samples")
    if not isinstance(samples, list) or not 1 <= len(samples) <= 60:
        abort(400, description="samples must contain between 1 and 60 items")

    rows = []
    for sample in samples:
        if not isinstance(sample, dict):
            abort(400, description="each sample must be an object")
        elapsed = sample.get("elapsed_seconds")
        if isinstance(elapsed, bool) or not isinstance(elapsed, int) or elapsed < 0:
            abort(400, description="elapsed_seconds must be a non-negative integer")
        state = str(sample.get("state", "uncertain"))
        if state not in ALLOWED_STATES:
            abort(400, description="invalid sample state")
        metrics = [_number(sample.get(field), field) for field in METRIC_FIELDS]
        phone_score = _number(sample.get("phone_score", 100), "phone_score")
        rows.append((session_id, elapsed, metrics[0], metrics[1], state, *metrics[2:], phone_score))

    database = get_db()
    database.executemany(
        """
        INSERT INTO samples (
            session_id, elapsed_seconds, focus_score, confidence, state,
            gaze_score, head_score, posture_score, presence_score, fatigue_score, phone_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    database.commit()
    return jsonify(saved=len(rows)), 201


@bp.patch("/api/sessions/<int:session_id>")
def finish_session(session_id: int):
    _session_or_404(session_id)
    payload = request.get_json(silent=True) or {}
    average_focus = _number(payload.get("average_focus", 0), "average_focus")
    integer_fields = ("focused_seconds", "distracted_seconds", "break_seconds", "interruptions")
    values = []
    for field in integer_fields:
        value = payload.get(field, 0)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            abort(400, description=f"{field} must be a non-negative integer")
        values.append(value)

    database = get_db()
    database.execute(
        """
        UPDATE sessions SET ended_at = CURRENT_TIMESTAMP, average_focus = ?,
            focused_seconds = ?, distracted_seconds = ?, break_seconds = ?, interruptions = ?
        WHERE id = ?
        """,
        (average_focus, *values, session_id),
    )
    database.commit()
    return jsonify(status="completed")


@bp.get("/api/sessions/<int:session_id>")
def session_summary(session_id: int):
    session = _session_or_404(session_id)
    samples = get_db().execute(
        """
        SELECT elapsed_seconds, focus_score, confidence, state, gaze_score,
               head_score, posture_score, presence_score, fatigue_score, phone_score
        FROM samples WHERE session_id = ? ORDER BY elapsed_seconds
        """,
        (session_id,),
    ).fetchall()
    return jsonify(session=dict(session), samples=[dict(row) for row in samples])


@bp.errorhandler(400)
@bp.errorhandler(404)
@bp.errorhandler(409)
def api_error(error):
    if request.path.startswith("/api/"):
        return jsonify(error=error.description), error.code
    return error
