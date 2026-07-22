from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from focus_monitor import create_app


class FocusMonitorApiTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        database = str(Path(self.tempdir.name) / "test.db")
        self.app = create_app({"TESTING": True, "DATABASE": database})
        self.client = self.app.test_client()

    def tearDown(self):
        self.tempdir.cleanup()

    def test_health_and_security_headers(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["status"], "ok")
        self.assertIn("camera=(self)", response.headers["Permissions-Policy"])
        self.assertIn("default-src 'self'", response.headers["Content-Security-Policy"])

    def test_all_vision_pages_render(self):
        for path, heading in (("/", "What should the camera"), ("/focus", "Stay with the"), ("/fingers", "Show a number"), ("/emotion", "Read visible expression"), ("/canvas", "Draw in the air")):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIn(heading, response.get_data(as_text=True))

    def test_complete_session_flow(self):
        created = self.client.post(
            "/api/sessions",
            json={"goal_minutes": 50, "camera_label": "Desk camera", "calibration_quality": 92},
        )
        self.assertEqual(created.status_code, 201)
        session_id = created.json["id"]
        sample = {
            "elapsed_seconds": 1,
            "focus_score": 88,
            "confidence": 91,
            "state": "focused",
            "gaze_score": 86,
            "head_score": 90,
            "posture_score": 80,
            "presence_score": 100,
            "fatigue_score": 95,
        }
        saved = self.client.post(f"/api/sessions/{session_id}/samples", json={"samples": [sample]})
        self.assertEqual(saved.status_code, 201)
        finished = self.client.patch(
            f"/api/sessions/{session_id}",
            json={
                "average_focus": 88,
                "focused_seconds": 1,
                "distracted_seconds": 0,
                "break_seconds": 0,
                "interruptions": 0,
            },
        )
        self.assertEqual(finished.status_code, 200)
        summary = self.client.get(f"/api/sessions/{session_id}")
        self.assertEqual(summary.json["samples"][0]["state"], "focused")
        self.assertEqual(summary.json["session"]["average_focus"], 88)

    def test_rejects_bad_metrics(self):
        session_id = self.client.post("/api/sessions", json={"goal_minutes": 25}).json["id"]
        response = self.client.post(
            f"/api/sessions/{session_id}/samples",
            json={"samples": [{"elapsed_seconds": 0, "state": "focused", "focus_score": 101}]},
        )
        self.assertEqual(response.status_code, 400)

    def test_phone_distraction_sample_is_persisted(self):
        session_id = self.client.post("/api/sessions", json={"goal_minutes": 25}).json["id"]
        sample = {
            "elapsed_seconds": 4,
            "focus_score": 16,
            "confidence": 89,
            "state": "phone",
            "gaze_score": 22,
            "head_score": 31,
            "posture_score": 81,
            "presence_score": 100,
            "fatigue_score": 94,
            "phone_score": 4,
        }
        saved = self.client.post(f"/api/sessions/{session_id}/samples", json={"samples": [sample]})
        self.assertEqual(saved.status_code, 201)
        summary = self.client.get(f"/api/sessions/{session_id}")
        self.assertEqual(summary.json["samples"][0]["state"], "phone")
        self.assertEqual(summary.json["samples"][0]["phone_score"], 4)


if __name__ == "__main__":
    unittest.main()
