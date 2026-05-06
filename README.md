# Rewindex Dashboard

A local web UI for [Rewindex](https://rewindex.web.app) - easy to browse your snapshot history, view diffs, and rewind files without leaving the browser.

## Requirements

- Python 3.10+
- [Rewindex](https://github.com/crsxmd/rewindex) installed and daemon running

## Install

### AI agent setup (recommended)

Paste this into your AI agent's chat. It handles everything including install and run:

```
Read https://raw.githubusercontent.com/crsxmd/rewindex-web/main/AI-SETUP.md and follow the setup instructions.
```

---

### Manual setup

**1. Install**

```bash
pipx install rewindex-web
```

**2. Run** (each time you want to open the dashboard)

```bash
rewindex-web
```

Then open [http://localhost:9009](http://localhost:9009) — reads directly from `~/.rewindex/`, no extra configuration needed.

## What you can do

- **Projects** — overview of all tracked projects with snapshot counts and DB size
- **Sessions** — browse session history, view notes, see which files changed
- **Files** — per-file version history with timestamps and change status
- **Diffs** — rich inline diff viewer for any two file versions
- **Snap** — force a checkpoint with a note from the UI
- **Rewind** — restore any session or file version directly from the browser
- **Note** — annotate sessions and file versions
- **Daemon** — start, stop, or restart the Rewindex daemon
- **License** — activate a Pro license key

## Alternative: run from source

```bash
git clone https://github.com/crsxmd/rewindex-web
cd rewindex-web
./start.sh
```

## License

MIT
