#!/usr/bin/env python3
"""Rewindex Dashboard — lightweight local web UI.

HTTP routing only. All data access goes through data.py.
No sqlite3 import here — ever.
"""

import os
import time
import socket
from pathlib import Path
from flask import Flask, render_template, jsonify, request, Response, stream_with_context
from rewindex_web import data

PORT = int(os.getenv("REWINDEX_WEB_PORT", 9009))

EVENTS_FILE = Path.home() / ".rewindex" / "events.jsonl"

app = Flask(__name__, template_folder="templates", static_folder="static")


@app.route("/")
def index():
    return render_template("index.html")


# ── Read endpoints ──

@app.route("/api/projects")
def api_projects():
    return jsonify(data.discover_projects())


@app.route("/api/sessions/<project>")
def api_sessions(project):
    limit = request.args.get("limit", 50, type=int)
    offset = request.args.get("offset", 0, type=int)
    return jsonify(data.get_sessions(project, limit, offset))


@app.route("/api/sessions/<project>/<int:uid>")
def api_session_detail(project, uid):
    result = data.get_session_detail(project, uid)
    if not result:
        return jsonify({"error": "Session not found"}), 404
    return jsonify(result)


@app.route("/api/files/<project>")
def api_files(project):
    return jsonify(data.get_files(project))


@app.route("/api/files/<project>/<file_id>")
def api_file_detail(project, file_id):
    result = data.get_file_detail(project, file_id)
    if not result:
        return jsonify({"error": "File not found"}), 404
    return jsonify(result)


@app.route("/api/diff/<project>/<file_id>")
def api_diff(project, file_id):
    v_from = request.args.get("vfrom")
    v_to = request.args.get("vto")
    return jsonify(data.get_diff(project, file_id, v_from, v_to))


@app.route("/api/richdiff/<project>/<file_id>/<int:version>")
def api_rich_diff(project, file_id, version):
    result = data.get_rich_diff(project, file_id, version)
    if not result:
        return jsonify({"error": "Could not generate diff"}), 404
    return jsonify(result)


@app.route("/api/status")
def api_status():
    return jsonify(data.get_daemon_status())


@app.route("/api/config")
def api_config():
    return jsonify(data.get_config())


@app.route("/api/license")
def api_license():
    return jsonify(data.get_license_info())


# ── Write / action endpoints ──

@app.route("/api/rewind", methods=["POST"])
def api_rewind():
    body = request.json or {}
    project = body.get("project")
    target = body.get("target")
    if not project or not target:
        return jsonify({"error": "Missing project or target"}), 400
    return jsonify(data.execute_rewind(project, target))


@app.route("/api/snap", methods=["POST"])
def api_snap():
    body = request.json or {}
    project = body.get("project")
    message = body.get("message", "")
    if not project:
        return jsonify({"error": "Missing project"}), 400
    return jsonify(data.execute_snap(project, message))


@app.route("/api/note", methods=["POST"])
def api_note():
    body = request.json or {}
    project = body.get("project")
    target = body.get("target")
    message = body.get("message", "")
    if not project or not target:
        return jsonify({"error": "Missing project or target"}), 400
    return jsonify(data.execute_note(project, target, message))


@app.route("/api/license/activate", methods=["POST"])
def api_activate():
    body = request.json or {}
    key = body.get("key", "")
    if not key:
        return jsonify({"error": "Missing license key"}), 400
    return jsonify(data.activate_license(key))


@app.route("/api/daemon/<action>", methods=["POST"])
def api_daemon(action):
    return jsonify(data.daemon_control(action))


@app.route("/api/version-check")
def api_version_check():
    return jsonify(data.check_versions())


@app.route("/api/update", methods=["POST"])
def api_update():
    body = request.json or {}
    pkg = body.get("package", "")
    return jsonify(data.run_pip_upgrade(pkg))


@app.route("/api/events")
def api_events():
    since = request.args.get("since", 0, type=float)
    return jsonify(data.get_events(since))


@app.route("/api/stream")
def api_stream():
    def generate():
        pos = EVENTS_FILE.stat().st_size if EVENTS_FILE.exists() else 0
        yield "data: {\"event\": \"connected\"}\n\n"
        while True:
            try:
                if EVENTS_FILE.exists():
                    with open(EVENTS_FILE) as f:
                        f.seek(pos)
                        lines = f.readlines()
                        pos = f.tell()
                    for line in lines:
                        line = line.strip()
                        if line:
                            yield f"data: {line}\n\n"
            except Exception:
                pass
            time.sleep(0.5)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _get_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "localhost"


def main():
    ip = _get_ip()
    print("\n  Rewindex Web")
    print(f"  http://{ip}:{PORT}\n")
    app.run(host="0.0.0.0", port=PORT, debug=False)


if __name__ == "__main__":
    main()
