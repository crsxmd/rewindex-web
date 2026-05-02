// ── State ──
let state = { project: null, projects: [], page: 'overview' };
let eventSource = null;

// ── API ──
const api = {
    async get(url) {
        try {
            const r = await fetch(url);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return await r.json();
        } catch (e) {
            console.error('API:', e);
            return null;
        }
    },
    async post(url, body) {
        try {
            const r = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return await r.json();
        } catch (e) {
            console.error('API:', e);
            showToast(e.message, 'error');
            return null;
        }
    },
};

// ── Helpers ──
const _UTC_OFFSET_MAP = {
    'UTC-12': 'Etc/GMT+12', 'UTC-11': 'Etc/GMT+11', 'UTC-10': 'Etc/GMT+10',
    'UTC-9':  'Etc/GMT+9',  'UTC-8':  'Etc/GMT+8',  'UTC-7':  'Etc/GMT+7',
    'UTC-6':  'Etc/GMT+6',  'UTC-5':  'Etc/GMT+5',  'UTC-4':  'Etc/GMT+4',
    'UTC-3':  'Etc/GMT+3',  'UTC-2':  'Etc/GMT+2',  'UTC-1':  'Etc/GMT+1',
    'UTC+0':  'Etc/GMT',    'UTC+1':  'Etc/GMT-1',  'UTC+2':  'Etc/GMT-2',
    'UTC+3':  'Etc/GMT-3',  'UTC+4':  'Etc/GMT-4',  'UTC+5':  'Etc/GMT-5',
    'UTC+5:30': 'Asia/Kolkata', 'UTC+6': 'Etc/GMT-6', 'UTC+7': 'Etc/GMT-7',
    'UTC+8':  'Etc/GMT-8',  'UTC+9':  'Etc/GMT-9',  'UTC+10': 'Etc/GMT-10',
    'UTC+11': 'Etc/GMT-11', 'UTC+12': 'Etc/GMT-12',
};

function getTimezone() {
    const saved = localStorage.getItem('rewindex-tz');
    if (!saved || saved === 'auto') return Intl.DateTimeFormat().resolvedOptions().timeZone;
    return _UTC_OFFSET_MAP[saved] || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function setTimezone(tz) {
    localStorage.setItem('rewindex-tz', tz);
    router();
}

function timeAgo(iso) {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    const sec = Math.floor(ms / 1000);
    if (sec < 60)   return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60)   return min + 'm ago';
    const hr = Math.floor(min / 60);
    if (hr < 24)    return hr + 'h ago';
    const day = Math.floor(hr / 24);
    if (day < 30)   return day + 'd ago';
    return new Date(iso).toLocaleDateString(undefined, { timeZone: getTimezone() });
}

function fmtTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, { timeZone: getTimezone() });
}

function fmtSize(b) {
    if (b == null) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
}

function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function statusBadge(s) {
    const m = { CREATE: 'success', CHANGE: 'info', DELETE: 'danger', MOVE: 'warning', RENAME: 'warning', CORRUPT: 'danger' };
    return `<span class="badge badge-${m[s] || 'default'}">${s || '—'}</span>`;
}

function fmtDiff(text) {
    if (!text) return '';
    return text.split('\n').map(l => {
        const e = esc(l);
        if (l.startsWith('+'))  return `<span class="diff-add">${e}</span>`;
        if (l.startsWith('-'))  return `<span class="diff-del">${e}</span>`;
        if (l.startsWith('@') || l.startsWith('─')) return `<span class="diff-header">${e}</span>`;
        return e;
    }).join('\n');
}

// ── Toast ──
function showToast(msg, type) {
    type = type || 'info';
    const c = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateY(10px)';
        t.style.transition = '0.3s ease';
        setTimeout(() => t.remove(), 300);
    }, 3000);
}

// ── Modal ──
function openModal(title, body, footer) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = body;
    document.getElementById('modal-footer').innerHTML = footer;
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
}

// ── Sidebar ──
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

// ── Daemon status ──
async function refreshDaemon() {
    const d = await api.get('/api/status');
    const dot = document.querySelector('.daemon-dot');
    const txt = document.getElementById('daemon-text');
    if (d && d.running) {
        dot.classList.remove('offline');
        txt.textContent = 'Running (PID ' + d.pid + ')';
    } else {
        dot.classList.add('offline');
        txt.textContent = 'Stopped';
    }
}

// ── Router ──
function router() {
    const hash = window.location.hash.slice(1) || 'overview';
    state.page = hash;
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.page === hash);
    });
    document.getElementById('sidebar').classList.remove('open');

    const pages = {
        overview: renderOverview,
        files:    renderFiles,
        timeline: renderTimeline,
        projects: renderProjects,
        settings: renderSettings,
        license:  renderLicense,
        update:   renderUpdate,
    };
    (pages[hash] || renderOverview)();
}

// ── Init ──
async function init() {
    const projects = await api.get('/api/projects');
    if (!projects || projects.length === 0) {
        renderNoProjects();
        return;
    }
    state.projects = projects;
    const savedProject = localStorage.getItem('rewindex-project');
    state.project = projects.find(p => p.name === savedProject) ? savedProject : projects[0].name;

    const sel = document.getElementById('project-select');
    sel.innerHTML = projects.map(p =>
        `<option value="${esc(p.name)}">${esc(p.name)}</option>`
    ).join('');
    sel.value = state.project;
    sel.addEventListener('change', () => {
        state.project = sel.value;
        localStorage.setItem('rewindex-project', sel.value);
        router();
    });

    refreshDaemon();
    setInterval(refreshDaemon, 15000);

    const pollSel = document.getElementById('poll-select');
    pollSel.value = localStorage.getItem('rewindex-live') === 'off' ? '0' : '1';
    startSSE();

    router();

    api.get('/api/version-check').then(d => {
        if (!d || !d.online) return;
        const hasUpdates = Object.values(d.packages).some(p => !p.up_to_date && p.latest !== null);
        const badge = document.getElementById('update-badge');
        if (badge) badge.classList.toggle('hidden', !hasUpdates);
    });
}

function renderNoProjects() {
    document.getElementById('page-content').innerHTML = `
        <div class="empty-state">
            <h2>No projects found</h2>
            <p class="text-muted" style="margin-top:8px">Set up Rewindex in your project folder:</p>
            <div class="code-block" style="display:inline-block;margin:16px 0;text-align:left">
<span style="color:var(--text-muted)"># 1. Go to your project</span>
cd /your/project

<span style="color:var(--text-muted)"># 2. Initialize</span>
rewindex init

<span style="color:var(--text-muted)"># 3. Start the daemon</span>
rewindex start</div>
            <p class="text-muted">Then <a class="link" href="javascript:location.reload()">refresh this page</a>.</p>
        </div>`;
}

// ═══════════════════════════════════════
//  Page: Overview
// ═══════════════════════════════════════
async function renderOverview() {
    const el = document.getElementById('page-content');
    el.innerHTML = '<div class="loading-state">Loading...</div>';
    if (!state.project) { renderNoProjects(); return; }

    const sessData = await api.get('/api/sessions/' + state.project + '?limit=10');
    const proj = state.projects.find(p => p.name === state.project) || {};
    const sessions = sessData ? sessData.sessions : [];

    el.innerHTML = `
        <div class="page-header">
            <h1>Overview</h1>
        </div>
        <div class="stat-grid">
            <div class="stat-card"><div class="stat-value">${proj.total_files || 0}</div><div class="stat-label">Files</div></div>
            <div class="stat-card"><div class="stat-value">${proj.total_snapshots || 0}</div><div class="stat-label">Snapshots</div></div>
            <div class="stat-card"><div class="stat-value">${proj.total_sessions || 0}</div><div class="stat-label">Sessions</div></div>
        </div>
        <div class="hotlink-grid">
            <a href="#files" class="hotlink-card">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" stroke-width="1.5"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                <span>Files</span>
            </a>
            <a href="#timeline" class="hotlink-card">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/><path d="M12 7v5l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                <span>Timeline</span>
            </a>
            <a href="#projects" class="hotlink-card">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" stroke="currentColor" stroke-width="1.5"/></svg>
                <span>Projects</span>
            </a>
            <a href="#settings" class="hotlink-card">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" stroke-width="1.5"/></svg>
                <span>Settings</span>
            </a>
            <a href="#license" class="hotlink-card">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" stroke="currentColor" stroke-width="1.5"/><path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                <span>License</span>
            </a>
        </div>
        <div class="card">
            <div class="card-header">
                <h2>Recent Sessions</h2>
                <a href="#timeline" class="link">View all</a>
            </div>
            <div class="card-body-flush">
                ${sessions.length === 0
                    ? '<div class="empty-state"><p>No sessions yet</p></div>'
                    : sessions.map(s => `
                        <div class="session-item" onclick="window.location.hash='timeline'">
                            <span class="session-id">SS${s.uid}</span>
                            <span class="session-time">${timeAgo(s.created_at)}</span>
                            <span class="session-files">${s.file_count} file${s.file_count !== 1 ? 's' : ''}</span>
                            <span class="session-note">${esc(s.note || '')}</span>
                        </div>`).join('')}
            </div>
        </div>`;
}

// ═══════════════════════════════════════
//  Page: Files
// ═══════════════════════════════════════
let _filesCache = null;

function getFileView() {
    return localStorage.getItem('rewindex-file-view') || 'folder';
}

function setFileView(mode) {
    localStorage.setItem('rewindex-file-view', mode);
    if (_filesCache) renderFilesBody(_filesCache);
}

async function renderFiles() {
    const el = document.getElementById('page-content');
    el.innerHTML = '<div class="loading-state">Loading...</div>';
    if (!state.project) { renderNoProjects(); return; }

    const [files, sessData] = await Promise.all([
        api.get('/api/files/' + state.project),
        api.get('/api/sessions/' + state.project + '?limit=1'),
    ]);
    if (!files) { el.innerHTML = '<div class="empty-state"><p>Failed to load</p></div>'; return; }
    _filesCache = files;
    const latestSess = sessData && sessData.sessions && sessData.sessions[0];
    const view = getFileView();

    el.innerHTML = `
        <div class="page-header">
            <div class="page-header-left">
                <h1>Files</h1>
                ${latestSess ? '<span class="badge badge-session">Session ' + latestSess.uid + ' <span class="mono">SS' + latestSess.uid + '</span></span>' : ''}
            </div>
            <div class="view-toggle">
                <button class="view-btn ${view === 'flat' ? 'active' : ''}" onclick="setFileView('flat')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                    Flat
                </button>
                <button class="view-btn ${view === 'folder' ? 'active' : ''}" onclick="setFileView('folder')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
                    Folder
                </button>
            </div>
        </div>
        <input type="text" class="form-input search-input" placeholder="Search files..." id="file-search" oninput="filterFiles()">
        <div id="files-body"></div>`;
    renderFilesBody(files);
}

function renderFilesBody(files) {
    const el = document.getElementById('files-body');
    if (!el) return;
    const view = getFileView();
    if (view === 'folder') {
        renderFolderView(el, files);
    } else {
        renderFlatView(el, files);
    }
    document.querySelectorAll('.view-btn').forEach(b => {
        b.classList.toggle('active', b.textContent.trim().toLowerCase() === view);
    });
}

function renderFlatView(el, files) {
    el.innerHTML = `
        <div class="card">
            <div class="card-body-flush">
                <div class="table-wrap">
                    <table>
                        <thead><tr>
                            <th>ID</th><th>Path</th><th>Versions</th><th>Last Update</th><th>Status</th>
                        </tr></thead>
                        <tbody id="file-tbody">
                            ${files.length === 0 ? '<tr><td colspan="5"><div class="empty-state"><p>No tracked files</p></div></td></tr>' : files.map(f => `
                                <tr class="clickable file-row" data-fid="${f.file_id}" onclick="toggleFile('${f.file_id}')">
                                    <td><span class="mono" style="color:var(--accent-hover);font-weight:600">${f.file_id}</span></td>
                                    <td>${esc(f.filepath || f.filename)}</td>
                                    <td>${f.version_count || 0}</td>
                                    <td class="text-secondary">${timeAgo(f.last_update)}</td>
                                    <td>${statusBadge(f.last_status)}</td>
                                </tr>
                                <tr class="file-detail-tr" id="fdet-${f.file_id}" style="display:none">
                                    <td colspan="5" style="padding:0">
                                        <div class="file-detail" id="fdet-c-${f.file_id}">
                                            <div class="loading-state">Loading versions...</div>
                                        </div>
                                    </td>
                                </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>`;
}

function buildFolderTree(files) {
    const root = { _files: [], _subs: {} };
    files.forEach(f => {
        const fp = f.filepath || f.filename || '';
        const parts = fp.split('/');
        const fileName = parts.pop();
        let node = root;
        parts.forEach(p => {
            if (!p) return;
            if (!node._subs[p]) node._subs[p] = { _files: [], _subs: {} };
            node = node._subs[p];
        });
        node._files.push(f);
    });
    return root;
}

function renderFolderNode(name, node, depth, prefix) {
    const fullPath = prefix ? prefix + '/' + name : name;
    const id = 'fld-' + fullPath.replace(/[^a-zA-Z0-9]/g, '_');
    const fileCount = countFilesRecursive(node);
    const indent = depth * 16;

    let html = '';
    if (name) {
        html += `<div class="folder-row clickable" style="padding-left:${20 + indent}px" onclick="toggleFolder('${id}')">
            <svg class="folder-icon" id="fic-${id}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
            <span class="folder-name">${esc(name)}</span>
            <span class="folder-count">${fileCount}</span>
        </div>
        <div id="${id}" class="folder-children" style="display:none">`;
    }

    const subNames = Object.keys(node._subs).sort();
    subNames.forEach(sub => {
        html += renderFolderNode(sub, node._subs[sub], depth + (name ? 1 : 0), fullPath);
    });

    node._files.forEach(f => {
        const fIndent = (depth + (name ? 1 : 0)) * 16;
        html += `<div class="folder-file-row clickable file-row" data-fid="${f.file_id}" style="padding-left:${20 + fIndent}px" onclick="toggleFile('${f.file_id}')">
            <span class="mono" style="color:var(--accent-hover);font-weight:600;min-width:40px">${f.file_id}</span>
            <span class="folder-file-name">${esc(f.filename || f.filepath)}</span>
            <span class="text-secondary" style="font-size:12px">v${f.latest_version || f.version_count || 0}</span>
            ${statusBadge(f.last_status)}
            <span class="text-secondary" style="font-size:12px;margin-left:auto">${timeAgo(f.last_update)}</span>
        </div>
        <div class="file-detail-tr" id="fdet-${f.file_id}" style="display:none">
            <div class="file-detail" id="fdet-c-${f.file_id}">
                <div class="loading-state">Loading versions...</div>
            </div>
        </div>`;
    });

    if (name) html += '</div>';
    return html;
}

function countFilesRecursive(node) {
    let count = node._files.length;
    Object.values(node._subs).forEach(sub => { count += countFilesRecursive(sub); });
    return count;
}

function toggleFolder(id) {
    const el = document.getElementById(id);
    const icon = document.getElementById('fic-' + id);
    if (!el) return;
    const open = el.style.display === 'none';
    el.style.display = open ? '' : 'none';
    if (icon) icon.classList.toggle('folder-open', open);
}

function renderFolderView(el, files) {
    if (files.length === 0) {
        el.innerHTML = '<div class="card"><div class="empty-state"><p>No tracked files</p></div></div>';
        return;
    }
    const tree = buildFolderTree(files);
    el.innerHTML = '<div class="card"><div class="card-body-flush">' + renderFolderNode('', tree, 0, '') + '</div></div>';
}

function filterFiles() {
    const q = document.getElementById('file-search').value.toLowerCase();
    const view = getFileView();
    if (view === 'folder') {
        document.querySelectorAll('.folder-file-row').forEach(r => {
            const match = r.textContent.toLowerCase().includes(q);
            r.style.display = match ? '' : 'none';
            const det = document.getElementById('fdet-' + r.dataset.fid);
            if (det && !match) det.style.display = 'none';
        });
        document.querySelectorAll('.folder-row').forEach(r => {
            if (!q) { r.style.display = ''; return; }
            const id = r.getAttribute('onclick').match(/'([^']+)'/)[1];
            const children = document.getElementById(id);
            if (children) {
                const hasVisible = children.querySelector('.folder-file-row:not([style*="display: none"])');
                r.style.display = hasVisible ? '' : 'none';
                if (hasVisible) children.style.display = '';
            }
        });
    } else {
        document.querySelectorAll('.file-row').forEach(r => {
            const match = r.textContent.toLowerCase().includes(q);
            r.style.display = match ? '' : 'none';
            const det = document.getElementById('fdet-' + r.dataset.fid);
            if (det && !match) det.style.display = 'none';
        });
    }
}

async function toggleFile(fid) {
    const tr = document.getElementById('fdet-' + fid);
    const box = document.getElementById('fdet-c-' + fid);
    const row = document.querySelector('.file-row[data-fid="' + fid + '"]');
    if (tr.style.display !== 'none') { tr.style.display = 'none'; if (row) row.classList.remove('active'); return; }
    tr.style.display = '';
    if (row) row.classList.add('active');
    box.innerHTML = '<div class="loading-state">Loading...</div>';

    const d = await api.get('/api/files/' + state.project + '/' + fid);
    if (!d) { box.innerHTML = '<div class="empty-state"><p>Failed</p></div>'; return; }

    const versions = d.versions || [];
    const latest = versions.length > 0 ? versions[0].file_version : 0;

    box.innerHTML = `
        <div class="file-detail-header">
            <span style="font-weight:600">${esc(d.file.filepath)}</span>
            <span class="text-muted">${versions.length} version${versions.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="version-list">
            ${versions.map(v => `
                <div class="version-row">
                    <span class="version-id">SN${v.uid}</span>
                    <span class="version-id">SS${v.session_uid}</span>
                    <span class="version-v">v${v.file_version}</span>
                    <span class="version-time">${timeAgo(v.created_at)}</span>
                    ${statusBadge(v.status)}
                    <span class="version-note">${esc(v.note || '')}</span>
                    <div class="version-actions">
                        <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();toggleDiff('${fid}',${v.file_version},${v.uid})">Diff</button>
                        ${v.file_version < latest
                            ? `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();confirmRewind('${fid} v${v.file_version}','${esc(d.file.filepath)}','v${v.file_version}')">Rewind</button>`
                            : '<span class="badge badge-current">Current</span>'}
                    </div>
                </div>
                <div id="diff-${v.uid}" data-note="${esc(v.note || '')}" style="display:none"></div>`).join('')}
        </div>`;
}

async function toggleDiff(fileId, version, uid) {
    const el = document.getElementById('diff-' + uid);
    if (!el) return;
    if (el.style.display !== 'none') { el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = '<div class="loading-state" style="padding:10px">Loading diff...</div>';

    const note = el.getAttribute('data-note') || '';
    const noteHtml = note ? '<div class="expand-note"><span class="expand-note-label"># Note</span>' + esc(note) + '</div>' : '';

    const d = await api.get('/api/richdiff/' + state.project + '/' + fileId + '/' + version);
    if (d && d.lines && d.lines.length > 0) {
        el.innerHTML = noteHtml + renderDiffView(d);
    } else {
        el.innerHTML = noteHtml + '<div class="text-muted" style="padding:10px;font-size:12px">' + esc(d && d.error ? d.error : 'No changes') + '</div>';
    }
}

function renderDiffView(d) {
    const from = d.v_from || '';
    const to = d.v_to || '';
    const hdr = '<div class="diff-header-bar">' +
        '<span class="diff-versions">' + esc(from) + ' → ' + esc(to) + '</span>' +
        '<span class="diff-stats-inline"><span class="diff-stat-add">+' + d.total_add + '</span> <span class="diff-stat-del">-' + d.total_del + '</span></span>' +
        '</div>';

    const lines = d.lines.map(l => {
        if (l.t === 'sep') return '<div class="diff-line diff-sep">···</div>';
        const prefix = l.t === 'add' ? '+' : l.t === 'del' ? '-' : ' ';
        const ln = l.ln != null ? String(l.ln).padStart(4) : '    ';
        return '<div class="diff-line diff-' + l.t + '"><span class="diff-ln">' + ln + '</span><span class="diff-text">' + esc(prefix + ' ' + l.s) + '</span></div>';
    }).join('');
    return hdr + '<div class="diff-block">' + lines + '</div>';
}

// ═══════════════════════════════════════
//  Page: Timeline
// ═══════════════════════════════════════
async function renderTimeline() {
    const el = document.getElementById('page-content');
    el.innerHTML = '<div class="loading-state">Loading...</div>';
    if (!state.project) { renderNoProjects(); return; }

    const d = await api.get('/api/sessions/' + state.project + '?limit=50');
    if (!d) { el.innerHTML = '<div class="empty-state"><p>Failed to load</p></div>'; return; }

    const sessions = d.sessions || [];
    el.innerHTML = `
        <div class="page-header">
            <h1>Timeline</h1>
            <div style="display:flex;align-items:center;gap:12px">
                <span class="text-muted">${d.total} session${d.total !== 1 ? 's' : ''}</span>
                <button class="btn btn-secondary btn-sm" onclick="doSnap()">+ Snap</button>
            </div>
        </div>
        ${sessions.length === 0
            ? '<div class="empty-state"><p>No sessions yet</p></div>'
            : sessions.map(s => `
                <div class="card" style="margin-bottom:10px">
                    <div class="session-item" id="sitem-${s.uid}" onclick="toggleSession(${s.uid})">
                        <span class="session-id">SS${s.uid}</span>
                        <span class="session-time">${fmtTime(s.created_at)}</span>
                        <span class="session-files">${s.file_count} file${s.file_count !== 1 ? 's' : ''}</span>
                        ${s.is_forced ? '<span class="badge badge-warning">forced</span>' : ''}
                        <span class="session-note">${esc(s.note || '')}</span>
                        <button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="event.stopPropagation();confirmRewind('SS${s.uid}','Session SS${s.uid}','${esc(s.note || timeAgo(s.created_at))}')">Rewind</button>
                    </div>
                    <div id="sess-${s.uid}" style="display:none"></div>
                </div>`).join('')}`;
}

async function toggleSession(uid) {
    const el = document.getElementById('sess-' + uid);
    const item = document.getElementById('sitem-' + uid);
    if (!el) return;
    if (el.style.display !== 'none') { el.style.display = 'none'; if (item) item.classList.remove('active'); return; }
    el.style.display = '';
    if (item) item.classList.add('active');
    el.innerHTML = '<div class="loading-state" style="padding:14px">Loading...</div>';

    const d = await api.get('/api/sessions/' + state.project + '/' + uid);
    if (!d) { el.innerHTML = '<div class="text-muted" style="padding:14px">Failed</div>'; return; }

    const files = d.files || [];
    const sessNote = d.session && d.session.note ? d.session.note : '';
    el.innerHTML = `
        <div style="padding:4px 20px 16px">
            ${sessNote ? '<div class="expand-note"><span class="expand-note-label"># Note</span>' + esc(sessNote) + '</div>' : ''}
            <div class="version-list">
                ${files.map(f => `
                    <div class="version-row">
                        <span class="version-id">SN${f.uid}</span>
                        <span class="version-id">${f.file_id}</span>
                        <span class="session-filepath">${esc(f.filepath || f.filename)}</span>
                        <span class="version-v">v${f.file_version}</span>
                        ${statusBadge(f.status)}
                        <span class="version-note">${esc(f.note || '')}</span>
                        <div class="version-actions">
                            <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();toggleSessionDiff('${f.file_id}',${f.file_version},${f.uid})">Diff</button>
                        </div>
                    </div>
                    <div id="sdiff-${f.uid}" data-note="${esc(f.note || '')}" style="display:none"></div>`).join('')}
            </div>
        </div>`;
}

async function toggleSessionDiff(fileId, version, uid) {
    const el = document.getElementById('sdiff-' + uid);
    if (!el) return;
    if (el.style.display !== 'none') { el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = '<div class="loading-state" style="padding:10px">Loading diff...</div>';

    const note = el.getAttribute('data-note') || '';
    const noteHtml = note ? '<div class="expand-note"><span class="expand-note-label"># Note</span>' + esc(note) + '</div>' : '';

    const d = await api.get('/api/richdiff/' + state.project + '/' + fileId + '/' + version);
    if (d && d.lines && d.lines.length > 0) {
        el.innerHTML = '<div style="padding:4px 0 12px">' + noteHtml + renderDiffView(d) + '</div>';
    } else {
        el.innerHTML = '<div style="padding:4px 0 12px">' + noteHtml + '<div class="text-muted" style="padding:10px 0;font-size:12px">' + esc(d && d.error ? d.error : 'No changes') + '</div></div>';
    }
}

// ═══════════════════════════════════════
//  Page: Projects
// ═══════════════════════════════════════
async function renderProjects() {
    const el = document.getElementById('page-content');
    el.innerHTML = '<div class="loading-state">Loading...</div>';

    const [projects, config] = await Promise.all([
        api.get('/api/projects'),
        api.get('/api/config'),
    ]);
    if (!projects) { el.innerHTML = '<div class="empty-state"><p>Failed</p></div>'; return; }

    el.innerHTML = `
        <div class="page-header"><h1>Projects</h1></div>
        ${projects.map(p => `
            <div class="card" style="margin-bottom:14px">
                <div class="card-header">
                    <h2>${esc(p.name)}</h2>
                    <span class="text-muted">${p.total_files} files &middot; ${p.total_snapshots} snapshots</span>
                </div>
                <div class="card-body">
                    <div class="info-grid">
                        <span class="info-label">Folders</span>
                        <span class="info-value">${p.folders.map(f => '<code>' + esc(f) + '</code>').join('<br>') || '—'}</span>
                        <span class="info-label">Excludes</span>
                        <span class="info-value">${p.exclude && p.exclude.length ? p.exclude.map(e => '<code>' + esc(e) + '</code>').join(', ') : '—'}</span>
                        <span class="info-label">Last Session</span>
                        <span class="info-value">${p.last_session ? timeAgo(p.last_session) : '—'}</span>
                    </div>
                </div>
            </div>`).join('')}
        ${config && config.global_exclude ? `
            <div class="card">
                <div class="card-header"><h2>Global Excludes</h2></div>
                <div class="card-body">
                    <div class="flex flex-wrap gap-8">
                        ${config.global_exclude.map(e => '<code class="badge badge-default">' + esc(e) + '</code>').join('')}
                    </div>
                </div>
            </div>` : ''}`;
}

// ═══════════════════════════════════════
//  Page: Settings
// ═══════════════════════════════════════
async function renderSettings() {
    const el = document.getElementById('page-content');
    el.innerHTML = '<div class="loading-state">Loading...</div>';

    const [config, status] = await Promise.all([
        api.get('/api/config'),
        api.get('/api/status'),
    ]);
    if (!config) { el.innerHTML = '<div class="empty-state"><p>Failed</p></div>'; return; }

    el.innerHTML = `
        <div class="page-header"><h1>Settings</h1></div>
        <div class="card mb-16">
            <div class="card-header"><h2>Daemon</h2></div>
            <div class="card-body">
                <div class="info-grid mb-16">
                    <span class="info-label">Status</span>
                    <span class="info-value">
                        <span class="daemon-dot ${status && status.running ? '' : 'offline'}" style="display:inline-block;vertical-align:middle;margin-right:6px"></span>
                        ${status && status.running ? 'Running (PID ' + status.pid + ')' : 'Stopped'}
                    </span>
                </div>
                <div class="flex gap-8">
                    <button class="btn btn-secondary btn-sm" onclick="daemonAction('start')">Start</button>
                    <button class="btn btn-secondary btn-sm" onclick="daemonAction('stop')">Stop</button>
                    <button class="btn btn-secondary btn-sm" onclick="daemonAction('restart')">Restart</button>
                </div>
            </div>
        </div>
        <div class="card mb-16">
            <div class="card-header"><h2>Session</h2></div>
            <div class="card-body">
                <div class="info-grid">
                    <span class="info-label">Gap (seconds)</span>
                    <span class="info-value">${config.session_gap_seconds != null ? config.session_gap_seconds : 20}</span>
                    <span class="info-label">Safe limit</span>
                    <span class="info-value">${config.session_safe != null ? config.session_safe : 500}</span>
                    <span class="info-label">Max limit</span>
                    <span class="info-value">${config.session_max != null ? config.session_max : 600}</span>
                </div>
            </div>
        </div>
        <div class="card">
            <div class="card-header"><h2>Config File</h2></div>
            <div class="card-body">
                <pre class="code-block">${esc(JSON.stringify(config, null, 2))}</pre>
                <p class="text-muted mt-8" style="font-size:12px">~/.rewindex/.rewindex.config.yaml</p>
            </div>
        </div>`;
}

// ═══════════════════════════════════════
//  Page: License
// ═══════════════════════════════════════
async function renderLicense() {
    const el = document.getElementById('page-content');
    el.innerHTML = '<div class="loading-state">Loading...</div>';

    const d = await api.get('/api/license');

    el.innerHTML = `
        <div class="page-header"><h1>License</h1></div>
        <div class="card mb-16">
            <div class="card-header"><h2>Current Plan</h2></div>
            <div class="card-body">
                ${d && d.output ? '<pre class="code-block">' + esc(d.output) + '</pre>' : '<p class="text-muted">Could not retrieve license info</p>'}
                ${d && d.error ? '<p class="text-muted mt-8" style="font-size:12px">' + esc(d.error) + '</p>' : ''}
            </div>
        </div>
        <div class="card mb-16">
            <div class="card-header"><h2>Activate License</h2></div>
            <div class="card-body">
                <div class="form-group">
                    <label class="form-label">License Key</label>
                    <input type="text" class="form-input" id="license-key" placeholder="Enter your license key...">
                </div>
                <button class="btn btn-primary" onclick="activateLicense()">Activate</button>
                <div id="license-result" class="mt-8"></div>
            </div>
        </div>
        <div class="card">
            <div class="card-header"><h2>Plans</h2></div>
            <div class="card-body">
                <p class="text-muted" style="font-size:13px">See all features and pricing at the official website.</p>
                <a href="https://rewindex.web.app" target="_blank" rel="noopener" class="btn btn-secondary mt-8" style="display:inline-flex;align-items:center;gap:6px">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M15 3h6v6M10 14L21 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    rewindex.web.app
                </a>
            </div>
        </div>`;
}

// ═══════════════════════════════════════
//  Actions
// ═══════════════════════════════════════
function confirmRewind(target, label, detail) {
    openModal(
        'Confirm Rewind',
        '<p style="margin-bottom:12px">Rewind <strong>' + esc(label) + '</strong> to <strong>' + esc(detail) + '</strong>?</p>' +
        '<div class="cmd-display"><span class="cmd-kw">rewindex rewind</span> <span class="cmd-id">' + esc(target) + '</span> <span class="cmd-flag">--yes</span></div>' +
        '<p class="text-muted mt-8" style="font-size:12px">Files will be restored and a new snapshot created automatically.</p>' +
        '<input type="text" id="rewind-note" class="form-input mt-8" placeholder="Note (optional)" style="width:100%">',
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" id="rewind-go" onclick="execRewind(\'' + target.replace(/'/g, "\\'") + '\')">Rewind</button>'
    );
}

async function execRewind(target) {
    const footer = document.getElementById('modal-footer');
    const noteEl = document.getElementById('rewind-note');
    const note = noteEl ? noteEl.value.trim() : '';
    footer.innerHTML = '<span class="text-muted">Rewinding...</span>';

    const r = await api.post('/api/rewind', { project: state.project, target: target });

    if (r && r.code === 0) {
        if (note) {
            const sessData = await api.get('/api/sessions/' + state.project + '?limit=1');
            const latestUid = sessData && sessData.sessions[0] ? sessData.sessions[0].uid : null;
            if (latestUid) await api.post('/api/note', { project: state.project, target: 'SS' + latestUid, message: note });
        }

        const flash = document.createElement('div');
        flash.className = 'rewind-flash';
        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 500);

        closeModal();
        showToast('Rewind successful', 'success');

        const fresh = await api.get('/api/projects');
        if (fresh) state.projects = fresh;
        router();
    } else {
        document.getElementById('modal-body').innerHTML +=
            '<div class="mt-8" style="color:var(--danger);font-size:13px">' +
            esc(r ? (r.error || r.output || 'Failed') : 'Failed') + '</div>';
        footer.innerHTML = '<button class="btn btn-secondary" onclick="closeModal()">Close</button>';
    }
}

async function doSnap() {
    const r = await api.post('/api/snap', { project: state.project });
    if (r && r.code === 0) {
        showToast('Snapshot created', 'success');
        const fresh = await api.get('/api/projects');
        if (fresh) state.projects = fresh;
        router();
    } else {
        showToast(r ? (r.error || r.output || 'Failed') : 'Failed', 'error');
    }
}

async function activateLicense() {
    const key = document.getElementById('license-key').value.trim();
    if (!key) { showToast('Enter a license key', 'error'); return; }

    const el = document.getElementById('license-result');
    el.innerHTML = '<span class="text-muted">Activating...</span>';

    const r = await api.post('/api/license/activate', { key: key });
    if (r && r.code === 0) {
        el.innerHTML = '<span style="color:var(--success)">' + esc(r.output) + '</span>';
        showToast('License activated', 'success');
    } else {
        el.innerHTML = '<span style="color:var(--danger)">' + esc(r ? (r.error || r.output || 'Failed') : 'Failed') + '</span>';
    }
}

// ═══════════════════════════════════════
//  Page: Updates
// ═══════════════════════════════════════
const PKG_LABELS  = { 'rewindex': 'rewindex (core)', 'rewindex-web': 'rewindex-web (dashboard)' };
const PKG_GITHUB  = { 'rewindex': 'https://github.com/crsxmd/rewindex', 'rewindex-web': 'https://github.com/crsxmd/rewindex-web' };
const GH_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.014-1.703-2.782.604-3.369-1.341-3.369-1.341-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844a9.59 9.59 0 012.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.579.688.481C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>`;

async function renderUpdate() {
    const el = document.getElementById('page-content');
    el.innerHTML = `
        <div class="page-header"><h1>Updates</h1></div>
        <div class="update-grid" id="update-cards">
            ${['rewindex','rewindex-web'].map(pkg => `
            <div class="update-card" id="ucard-${pkg.replace('-','_')}">
                <div class="update-card-header">
                    <a href="${PKG_GITHUB[pkg]}" target="_blank" rel="noopener" class="gh-link" title="View on GitHub">${GH_ICON}</a>
                    <span class="update-pkg-name">${PKG_LABELS[pkg]}</span>
                    <span class="update-status-badge badge-check">Checking...</span>
                </div>
                <div class="update-versions">
                    <div><div class="update-ver-label">Installed</div><div class="update-ver-value">—</div></div>
                    <div><div class="update-ver-label">Latest</div><div class="update-ver-value">—</div></div>
                </div>
                <button class="btn btn-secondary btn-sm" disabled>Update</button>
            </div>`).join('')}
        </div>
        <pre id="update-log" class="code-block" style="display:none;max-height:200px;overflow-y:auto;margin-top:0"></pre>`;

    const data = await api.get('/api/version-check');

    if (!data) {
        document.getElementById('update-cards').innerHTML = `
            <div class="update-offline-msg">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.56 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                Could not connect to check for updates.
            </div>`;
        return;
    }

    if (!data.online) {
        const offlineMsg = `
            <div class="update-offline-msg">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.56 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                Connect to internet to check for new versions
            </div>`;
        document.getElementById('update-cards').insertAdjacentHTML('beforebegin', offlineMsg);
    }

    let hasUpdates = false;
    for (const [pkg, info] of Object.entries(data.packages)) {
        const cardId = 'ucard-' + pkg.replace('-', '_');
        const card = document.getElementById(cardId);
        if (!card) continue;

        const latestAvailable = info.latest !== null;
        const upToDate = info.up_to_date;
        if (!upToDate && latestAvailable) hasUpdates = true;

        const badge = upToDate
            ? '<span class="update-status-badge badge-ok">Up to date</span>'
            : (latestAvailable
                ? `<span class="update-status-badge badge-new">Update available</span>`
                : '<span class="update-status-badge badge-check">Unknown</span>');

        const latestClass = (!upToDate && latestAvailable) ? ' is-new' : '';

        card.innerHTML = `
            <div class="update-card-header">
                <a href="${PKG_GITHUB[pkg]}" target="_blank" rel="noopener" class="gh-link" title="View on GitHub">${GH_ICON}</a>
                <span class="update-pkg-name">${PKG_LABELS[pkg]}</span>
                ${badge}
            </div>
            <div class="update-versions">
                <div>
                    <div class="update-ver-label">Installed</div>
                    <div class="update-ver-value">${esc(info.installed)}</div>
                </div>
                <div>
                    <div class="update-ver-label">Latest</div>
                    <div class="update-ver-value${latestClass}">${info.latest ? esc(info.latest) : '—'}</div>
                </div>
            </div>
            <button class="btn btn-primary btn-sm" ${upToDate || !latestAvailable ? 'disabled' : ''}
                onclick="runUpdate('${pkg}')">
                ${upToDate ? 'Up to date' : 'Update'}
            </button>`;
    }

    const badge = document.getElementById('update-badge');
    if (badge) badge.classList.toggle('hidden', !hasUpdates);
}

async function runUpdate(pkg) {
    const log = document.getElementById('update-log');
    log.style.display = 'block';
    log.textContent = 'Updating ' + pkg + '...\n';
    const r = await api.post('/api/update', { package: pkg });
    log.textContent = r ? (r.output || r.error || 'Done') : 'Failed';
    if (r && r.code === 0) {
        showToast(pkg + ' updated', 'success');
        renderUpdate();
    }
}

async function daemonAction(action) {
    const r = await api.post('/api/daemon/' + action);
    if (r && r.code === 0) {
        showToast('Daemon ' + action + ' OK', 'success');
        setTimeout(refreshDaemon, 1000);
        setTimeout(renderSettings, 1500);
    } else {
        showToast(r ? (r.error || r.output || 'Failed') : 'Failed', 'error');
    }
}

// ── SSE Live updates ──
let _sseRetryDelay = 1000;
let _sseRetryTimer = null;

function startSSE() {
    if (eventSource) { eventSource.close(); eventSource = null; }
    if (_sseRetryTimer) { clearTimeout(_sseRetryTimer); _sseRetryTimer = null; }
    if (localStorage.getItem('rewindex-live') === 'off') return;

    eventSource = new EventSource('/api/stream');
    eventSource.onmessage = async (e) => {
        _sseRetryDelay = 1000;
        try {
            const ev = JSON.parse(e.data);
            if (ev.event === 'snap' || ev.event === 'rewind' || ev.event === 'project_change') {
                const projects = await api.get('/api/projects');
                if (projects) state.projects = projects;
                router();
            }
        } catch {}
    };
    eventSource.onopen = () => { _sseRetryDelay = 1000; };
    eventSource.onerror = () => {
        if (eventSource) { eventSource.close(); eventSource = null; }
        if (localStorage.getItem('rewindex-live') === 'off') return;
        _sseRetryTimer = setTimeout(() => {
            _sseRetryDelay = Math.min(_sseRetryDelay * 2, 30000);
            startSSE();
        }, _sseRetryDelay);
    };
}

function setPollInterval(val) {
    localStorage.setItem('rewindex-live', val === '0' ? 'off' : 'on');
    startSSE();
}

// ── Theme ──
function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('rewindex-theme', next);
    document.getElementById('theme-label').textContent = next === 'dark' ? 'Light mode' : 'Dark mode';
}

function loadTheme() {
    const saved = localStorage.getItem('rewindex-theme');
    const theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    const label = document.getElementById('theme-label');
    if (label) label.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
}

// ── Timezone ──
function loadTimezone() {
    const sel = document.getElementById('tz-select');
    if (!sel) return;
    const offsets = [
        { label: 'Auto (machine)', value: 'auto' },
        { label: 'UTC-12', value: 'UTC-12' },
        { label: 'UTC-11', value: 'UTC-11' },
        { label: 'UTC-10', value: 'UTC-10' },
        { label: 'UTC-9',  value: 'UTC-9'  },
        { label: 'UTC-8',  value: 'UTC-8'  },
        { label: 'UTC-7',  value: 'UTC-7'  },
        { label: 'UTC-6',  value: 'UTC-6'  },
        { label: 'UTC-5',  value: 'UTC-5'  },
        { label: 'UTC-4',  value: 'UTC-4'  },
        { label: 'UTC-3',  value: 'UTC-3'  },
        { label: 'UTC-2',  value: 'UTC-2'  },
        { label: 'UTC-1',  value: 'UTC-1'  },
        { label: 'UTC+0',  value: 'UTC+0'  },
        { label: 'UTC+1',  value: 'UTC+1'  },
        { label: 'UTC+2',  value: 'UTC+2'  },
        { label: 'UTC+3',  value: 'UTC+3'  },
        { label: 'UTC+4',  value: 'UTC+4'  },
        { label: 'UTC+5',  value: 'UTC+5'  },
        { label: 'UTC+5:30', value: 'UTC+5:30' },
        { label: 'UTC+6',  value: 'UTC+6'  },
        { label: 'UTC+7',  value: 'UTC+7'  },
        { label: 'UTC+8',  value: 'UTC+8'  },
        { label: 'UTC+9',  value: 'UTC+9'  },
        { label: 'UTC+10', value: 'UTC+10' },
        { label: 'UTC+11', value: 'UTC+11' },
        { label: 'UTC+12', value: 'UTC+12' },
    ];
    const current = localStorage.getItem('rewindex-tz') || 'auto';
    sel.innerHTML = offsets.map(o =>
        `<option value="${o.value}"${o.value === current ? ' selected' : ''}>${o.label}</option>`
    ).join('');
}

// ── Boot ──
loadTheme();
window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', () => { loadTimezone(); init(); });
