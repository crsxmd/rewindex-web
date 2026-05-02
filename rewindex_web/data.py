"""Data layer for Rewindex Dashboard.

All database access is encapsulated here. The UI layer (app.py) imports
functions from this module and receives plain dicts/lists — never DB objects.

Future: swap SQLite queries for HTTP API calls without touching the UI.
"""

import os
import re
import json
import gzip
import sqlite3
import difflib
import subprocess
import urllib.request
import urllib.error
from pathlib import Path

REWINDEX_DIR = Path.home() / ".rewindex"
CONFIG_FILE = REWINDEX_DIR / ".rewindex.config.yaml"
SNAPSHOTS_DIR = REWINDEX_DIR / "snapshots"


# ── Internal helpers ──

def _load_config():
    if not CONFIG_FILE.exists():
        return {}
    try:
        import yaml
        with open(CONFIG_FILE) as f:
            return yaml.safe_load(f) or {}
    except ImportError:
        return {}


def _find_db(project_name):
    base = SNAPSHOTS_DIR / project_name
    for name in ("rewindex.db", "db.sqlite"):
        path = base / name
        if path.exists() and path.stat().st_size > 0:
            return path
    return None


def _connect(project_name):
    db_path = _find_db(project_name)
    if not db_path:
        return None
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5)
    conn.row_factory = sqlite3.Row
    return conn


def _rows(cur):
    return [dict(r) for r in cur.fetchall()]


def _row(cur):
    r = cur.fetchone()
    return dict(r) if r else None


def _run_cli(args, cwd=None):
    try:
        result = subprocess.run(
            ["rewindex"] + list(args),
            capture_output=True, text=True, timeout=30, cwd=cwd,
        )
        stdout = re.sub(r"\x1b\[[0-9;]*[a-zA-Z]", "", result.stdout)
        stderr = re.sub(r"\x1b\[[0-9;]*[a-zA-Z]", "", result.stderr)
        return {"output": stdout.strip(), "error": stderr.strip(), "code": result.returncode}
    except FileNotFoundError:
        return {"output": "", "error": "rewindex CLI not found", "code": -1}
    except subprocess.TimeoutExpired:
        return {"output": "", "error": "Command timed out", "code": -1}
    except Exception as e:
        return {"output": "", "error": str(e), "code": -1}


def _project_cwd(project_name):
    config = _load_config()
    for p in config.get("projects", []):
        if p["name"] == project_name:
            for folder in p.get("folders", []):
                expanded = os.path.expanduser(folder)
                if os.path.isdir(expanded):
                    return expanded
    return None


def _fmt_bytes(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


# ── Public API — read ──

def discover_projects():
    config = _load_config()
    projects = []
    for p in config.get("projects", []):
        name = p["name"]
        info = {
            "name": name,
            "folders": [os.path.expanduser(f) for f in p.get("folders", [])],
            "exclude": p.get("project_exclude", []),
            "total_files": 0,
            "total_sessions": 0,
            "total_snapshots": 0,
            "last_session": None,
            "db_size": "0 B",
            "db_size_bytes": 0,
        }
        db_path = _find_db(name)
        if db_path:
            info["db_size_bytes"] = db_path.stat().st_size
            info["db_size"] = _fmt_bytes(db_path.stat().st_size)
        conn = _connect(name)
        if conn:
            try:
                cur = conn.cursor()
                cur.execute("SELECT COUNT(*) FROM file_registry")
                info["total_files"] = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM sessions")
                info["total_sessions"] = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM file")
                info["total_snapshots"] = cur.fetchone()[0]
                cur.execute("SELECT created_at FROM sessions ORDER BY uid DESC LIMIT 1")
                row = cur.fetchone()
                if row:
                    info["last_session"] = row[0]
            except Exception:
                pass
            finally:
                conn.close()
        projects.append(info)
    return projects


def get_sessions(project, limit=50, offset=0):
    conn = _connect(project)
    if not conn:
        return {"sessions": [], "total": 0}
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT s.uid, s.project, s.created_at, s.updated_at,
                   s.note, s.is_forced, COUNT(f.uid) AS file_count
            FROM sessions s
            LEFT JOIN file f ON f.session_uid = s.uid
            GROUP BY s.uid
            ORDER BY s.uid DESC
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        )
        sessions = _rows(cur)
        cur.execute("SELECT COUNT(*) FROM sessions")
        total = cur.fetchone()[0]
        return {"sessions": sessions, "total": total}
    finally:
        conn.close()


def get_session_detail(project, uid):
    conn = _connect(project)
    if not conn:
        return None
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM sessions WHERE uid = ?", (uid,))
        session = _row(cur)
        if not session:
            return None
        cur.execute(
            """
            SELECT f.uid, f.file_registry_uid, f.file_version, f.created_at,
                   f.hash, f.status, f.is_full, f.file_size, f.note,
                   f.is_deleted, r.file_id, r.filepath, r.filename, r.folder_path
            FROM file f
            JOIN file_registry r ON r.uid = f.file_registry_uid
            WHERE f.session_uid = ?
            ORDER BY f.uid
            """,
            (uid,),
        )
        files = _rows(cur)
        return {"session": session, "files": files}
    finally:
        conn.close()


def get_files(project):
    conn = _connect(project)
    if not conn:
        return []
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT r.uid, r.file_id, r.filepath, r.filename, r.folder_path,
                   COUNT(f.uid) AS version_count,
                   MAX(f.file_version) AS latest_version,
                   MAX(f.created_at) AS last_update,
                   (SELECT status FROM file
                    WHERE file_registry_uid = r.uid
                    ORDER BY uid DESC LIMIT 1) AS last_status
            FROM file_registry r
            LEFT JOIN file f ON f.file_registry_uid = r.uid
            GROUP BY r.uid
            ORDER BY r.filepath
            """
        )
        return _rows(cur)
    finally:
        conn.close()


def get_file_detail(project, file_id):
    conn = _connect(project)
    if not conn:
        return None
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM file_registry WHERE file_id = ? AND project = ?",
            (file_id, project),
        )
        registry = _row(cur)
        if not registry:
            return None
        cur.execute(
            """
            SELECT uid, session_uid, file_version, created_at, hash, status, is_full,
                   file_size, is_compressed, note, is_deleted, promoted_by, filepath
            FROM file
            WHERE file_registry_uid = ?
            ORDER BY file_version DESC
            """,
            (registry["uid"],),
        )
        versions = _rows(cur)
        return {"file": registry, "versions": versions}
    finally:
        conn.close()


def get_diff(project, file_id, v_from=None, v_to=None):
    cwd = _project_cwd(project)
    args = ["diff", file_id]
    if v_from and v_to:
        args += [v_from, v_to]
    elif v_to:
        args.append(v_to)
    return _run_cli(args, cwd=cwd)


# ── Reconstruction + Rich Diff ──

def _read_storage(path, is_compressed):
    try:
        if is_compressed or path.endswith(".gz"):
            with gzip.open(path, "rt") as f:
                return f.read()
        with open(path, "r") as f:
            return f.read()
    except Exception:
        return None


def _apply_ops(old_lines, ops):
    result = []
    for op in ops:
        tag = op[0]
        if tag == "eq":
            result.extend(old_lines[op[1]:op[2]])
        elif tag == "ins":
            result.extend(op[1])
        elif tag == "rep":
            result.extend(op[3])
    return result


def _reconstruct_at(project, reg_uid, target_uid):
    conn = _connect(project)
    if not conn:
        return None
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT uid, storage_path, is_compressed FROM file "
            "WHERE file_registry_uid = ? AND is_full = 1 ORDER BY uid ASC LIMIT 1",
            (reg_uid,),
        )
        base = _row(cur)
        if not base:
            return None

        raw = _read_storage(base["storage_path"], base["is_compressed"])
        if raw is None:
            return None
        lines = raw.splitlines(keepends=True)

        if base["uid"] == target_uid:
            return lines

        cur.execute(
            "SELECT uid, storage_path, is_compressed FROM file "
            "WHERE file_registry_uid = ? AND uid > ? AND uid <= ? AND is_full = 0 "
            "ORDER BY uid ASC",
            (reg_uid, base["uid"], target_uid),
        )
        for drow in cur.fetchall():
            drow = dict(drow)
            dstr = _read_storage(drow["storage_path"], drow["is_compressed"])
            if dstr is None:
                continue
            data = json.loads(dstr)
            lines = _apply_ops(lines, data.get("ops", []))

        return lines
    except Exception:
        return None
    finally:
        conn.close()


def get_rich_diff(project, file_id, v_to):
    conn = _connect(project)
    if not conn:
        return None
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT uid FROM file_registry WHERE file_id = ? AND project = ?",
            (file_id, project),
        )
        row = cur.fetchone()
        if not row:
            return None
        reg_uid = row[0]

        cur.execute(
            "SELECT uid, file_version FROM file "
            "WHERE file_registry_uid = ? ORDER BY file_version ASC",
            (reg_uid,),
        )
        versions = _rows(cur)
    finally:
        conn.close()

    if not versions:
        return None

    target = None
    prev = None
    for i, v in enumerate(versions):
        if v["file_version"] == v_to:
            target = v
            prev = versions[i - 1] if i > 0 else None
            break

    if not target:
        return None

    after = _reconstruct_at(project, reg_uid, target["uid"])
    if after is None:
        return None

    before = _reconstruct_at(project, reg_uid, prev["uid"]) if prev else []
    if before is None:
        before = []

    before_clean = [l.rstrip("\n") for l in before]
    after_clean = [l.rstrip("\n") for l in after]

    v_from_label = "v" + str(prev["file_version"]) if prev else "(new)"
    v_to_label = "v" + str(v_to)

    diff = list(difflib.unified_diff(
        before_clean, after_clean,
        fromfile=v_from_label,
        tofile=v_to_label,
        lineterm="",
    ))

    lines = []
    old_ln = 0
    new_ln = 0
    for line in diff:
        if line.startswith("---") or line.startswith("+++"):
            continue
        elif line.startswith("@@"):
            m = re.match(r"@@ -(\d+)(?:,\d+)? \+(\d+)", line)
            if m:
                old_ln = int(m.group(1))
                new_ln = int(m.group(2))
            lines.append({"t": "sep"})
        elif line.startswith("+"):
            lines.append({"t": "add", "s": line[1:], "ln": new_ln})
            new_ln += 1
        elif line.startswith("-"):
            lines.append({"t": "del", "s": line[1:], "ln": old_ln})
            old_ln += 1
        else:
            text = line[1:] if line.startswith(" ") else line
            lines.append({"t": "ctx", "s": text, "ln": new_ln})
            old_ln += 1
            new_ln += 1

    total_add = sum(1 for l in lines if l["t"] == "add")
    total_del = sum(1 for l in lines if l["t"] == "del")

    return {
        "lines": lines,
        "v_from": v_from_label,
        "v_to": v_to_label,
        "total_add": total_add,
        "total_del": total_del,
    }


def get_daemon_status():
    pid_file = REWINDEX_DIR / "daemon.pid"
    if not pid_file.exists():
        return {"running": False, "pid": None}
    try:
        pid = int(pid_file.read_text().strip())
        os.kill(pid, 0)
        return {"running": True, "pid": pid}
    except (ValueError, ProcessLookupError, PermissionError):
        return {"running": False, "pid": None}


def get_config():
    return _load_config()


def get_license_info():
    return _run_cli(["member"])


# ── Public API — write / actions ──

def execute_rewind(project, target):
    if not target or len(target) > 64 or not re.match(r'^[\w\s.\-]+$', target):
        return {"output": "", "error": "Invalid rewind target", "code": -1}
    cwd = _project_cwd(project)
    args = ["rewind"] + target.split() + ["--yes"]
    return _run_cli(args, cwd=cwd)


def execute_snap(project, message=""):
    cwd = _project_cwd(project)
    args = ["snap"]
    if message:
        args.append(message)
    return _run_cli(args, cwd=cwd)


def execute_note(project, target, message):
    cwd = _project_cwd(project)
    return _run_cli(["note", target, message], cwd=cwd)


def activate_license(key):
    return _run_cli(["member", "--activate", key])


def daemon_control(action):
    if action not in ("start", "stop", "restart"):
        return {"output": "", "error": "Invalid action", "code": -1}
    return _run_cli([action])


def _get_installed_version(package):
    try:
        from importlib.metadata import version
        return version(package)
    except Exception:
        pass
    if package == "rewindex":
        try:
            result = subprocess.run(
                ["rewindex", "--version"], capture_output=True, text=True, timeout=5
            )
            m = re.search(r"(\d+\.\d+[\.\d]*)", result.stdout + result.stderr)
            if m:
                return m.group(1)
        except Exception:
            pass
    return None


def _get_pypi_version(package):
    """Returns (version_or_None, reachable: bool)."""
    url = f"https://pypi.org/pypi/{package}/json"
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = json.loads(resp.read())
            return data["info"]["version"], True
    except urllib.error.HTTPError:
        return None, True
    except urllib.error.URLError:
        return None, False
    except Exception:
        return None, False


def _parse_ver(v):
    try:
        return tuple(int(x) for x in v.split("."))
    except Exception:
        return (0,)


def check_versions():
    packages = ["rewindex", "rewindex-web"]
    online = True
    results = {}
    for pkg in packages:
        installed = _get_installed_version(pkg)
        latest, reachable = _get_pypi_version(pkg)
        if not reachable:
            online = False
        up_to_date = (
            installed is not None and latest is not None
            and _parse_ver(installed) >= _parse_ver(latest)
        )
        results[pkg] = {
            "installed": installed or "unknown",
            "latest": latest,
            "up_to_date": up_to_date,
        }
    return {"online": online, "packages": results}


def run_pip_upgrade(package):
    allowed = {"rewindex", "rewindex-web"}
    if package not in allowed:
        return {"output": "", "error": "Unknown package", "code": -1}
    try:
        import sys
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "--upgrade", package],
            capture_output=True, text=True, timeout=60,
        )
        return {"output": (result.stdout + result.stderr).strip(), "code": result.returncode}
    except subprocess.TimeoutExpired:
        return {"output": "", "error": "Update timed out", "code": -1}
    except Exception as e:
        return {"output": "", "error": str(e), "code": -1}


EVENTS_FILE = REWINDEX_DIR / "events.jsonl"


def get_events(since_ts: float = 0) -> list[dict]:
    if not EVENTS_FILE.exists():
        return []
    events = []
    try:
        with open(EVENTS_FILE) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                    if e.get("ts", 0) > since_ts:
                        events.append(e)
                except Exception:
                    pass
    except Exception:
        pass
    return events
