"""DashboardHooks — rewindex.hooks plugin for rewindex-dashboard.

Writes events to ~/.rewindex/events.jsonl so the dashboard Flask app
can serve them via /api/events without polling the DB on every request.
"""

import json
import time
from pathlib import Path

EVENTS_FILE = Path.home() / ".rewindex" / "events.jsonl"


def _append(event: dict) -> None:
    EVENTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(EVENTS_FILE, "a") as f:
        f.write(json.dumps(event) + "\n")


class DashboardHooks:
    def on_snap(self, session_id: str, files: list[dict], note: str) -> None:
        _append({
            "event": "snap",
            "ts": time.time(),
            "session_id": session_id,
            "files": files,
            "note": note,
        })

    def on_rewind(self, target: str, files_restored: list[str]) -> None:
        _append({
            "event": "rewind",
            "ts": time.time(),
            "target": target,
            "files_restored": files_restored,
        })

    def on_project_change(self, event: str, project: dict) -> None:
        _append({
            "event": "project_change",
            "ts": time.time(),
            "action": event,
            "project": project,
        })
