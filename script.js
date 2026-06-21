/**
 * BOOKMARK HUB — script.js
 * ─────────────────────────────────────────────────────────────
 * A fully client-side bookmark manager that syncs data to a
 * GitHub repository via the REST API.
 *
 * Architecture:
 *  - `state`       → single source of truth (bookmarks, categories, UI)
 *  - `github`      → all GitHub API interactions
 *  - `render*()`   → pure DOM updates driven by state
 *  - event wiring  → at the bottom, via addEventListener
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

/* ════════════════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════════════════ */
const state = {
  /** @type {{ id:string, title:string, url:string, category:string, notes:string, created:string, starred:boolean }[]} */
  bookmarks: [],

  /** @type {string[]} */
  categories: ['Work', 'Personal', 'Tools', 'Learning', 'Shopping'],

  /** @type {'all'|'favorites'|'recent'|'uncategorized'|string} active sidebar view */
  view: 'all',

  /** @type {string} current search query */
  search: '',

  /** @type {'newest'|'oldest'|'title-az'|'title-za'} */
  sort: 'newest',

  /** @type {'grid'|'list'} */
  layout: 'grid',

  /** pending delete bookmark id */
  pendingDeleteId: null,

  /** SHA of bookmarks.json on GitHub (needed for updates) */
  fileSha: null,

  theme: localStorage.getItem('bh-theme') || 'light',
};

/* ════════════════════════════════════════════════════════════
   GITHUB CONFIGURATION (stored in localStorage)
════════════════════════════════════════════════════════════ */
const cfg = {
  get username() { return localStorage.getItem('bh-gh-username') || ''; },
  get repo()     { return localStorage.getItem('bh-gh-repo') || ''; },
  get branch()   { return localStorage.getItem('bh-gh-branch') || 'main'; },
  get token()    { return localStorage.getItem('bh-gh-token') || ''; },

  save({ username, repo, branch, token }) {
    localStorage.setItem('bh-gh-username', username);
    localStorage.setItem('bh-gh-repo', repo);
    localStorage.setItem('bh-gh-branch', branch);
    localStorage.setItem('bh-gh-token', token);
  },

  isConfigured() {
    return !!(this.username && this.repo && this.token);
  },
};

/* ════════════════════════════════════════════════════════════
   GITHUB API LAYER
════════════════════════════════════════════════════════════ */
const github = {
  /** Base URL for the bookmarks.json file */
  fileUrl() {
    return `https://api.github.com/repos/${cfg.username}/${cfg.repo}/contents/bookmarks.json?ref=${cfg.branch}`;
  },

  /** Common headers for all requests */
  headers() {
    return {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  },

  /**
   * Fetch bookmarks.json from the repo.
   * Sets state.fileSha and returns parsed data.
   */
  async load() {
    if (!cfg.isConfigured()) return null;

    const res = await fetch(github.fileUrl(), { headers: github.headers() });

    if (res.status === 404) {
      // File doesn't exist yet — that's okay, we'll create it on first save
      state.fileSha = null;
      return null;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub API error ${res.status}`);
    }

    const meta = await res.json();
    state.fileSha = meta.sha;

    // Content is base64-encoded
    const decoded = atob(meta.content.replace(/\n/g, ''));
    return JSON.parse(decoded);
  },

  /**
   * Write the current state back to GitHub as bookmarks.json.
   * Uses PUT (create or update). Requires the current SHA for updates.
   */
  async save() {
    if (!cfg.isConfigured()) {
      toast('Configure GitHub settings first.', 'error');
      return false;
    }

    const payload = {
      categories: state.categories,
      bookmarks: state.bookmarks,
    };

    const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));

    const body = {
      message: 'Updated bookmarks via Bookmark Hub',
      content,
      branch: cfg.branch,
    };

    // SHA is required to update an existing file
    if (state.fileSha) body.sha = state.fileSha;

    const res = await fetch(
      `https://api.github.com/repos/${cfg.username}/${cfg.repo}/contents/bookmarks.json`,
      {
        method: 'PUT',
        headers: { ...github.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub write error ${res.status}`);
    }

    const data = await res.json();
    // Update SHA for the next write
    state.fileSha = data.content.sha;
    return true;
  },

  /** Test that credentials work by hitting /user */
  async testConnection() {
    const res = await fetch('https://api.github.com/user', {
      headers: github.headers(),
    });
    if (!res.ok) throw new Error('Authentication failed');
    const user = await res.json();
    return user.login;
  },
};

/* ════════════════════════════════════════════════════════════
   LOCAL STORAGE PERSISTENCE (fallback when GitHub not configured)
════════════════════════════════════════════════════════════ */
const local = {
  save() {
    localStorage.setItem('bh-data', JSON.stringify({
      bookmarks: state.bookmarks,
      categories: state.categories,
    }));
  },

  load() {
    try {
      const raw = localStorage.getItem('bh-data');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
};

/* ════════════════════════════════════════════════════════════
   DATA HELPERS
════════════════════════════════════════════════════════════ */
/** Generate a simple unique ID */
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** Today's date as YYYY-MM-DD */
const today = () => new Date().toISOString().slice(0, 10);

/** Favicon URL via Google's favicon service */
const faviconUrl = (url) => {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return '';
  }
};

/** Return category pill CSS class */
const pillClass = (category) => {
  const map = {
    Work: 'pill-Work', Personal: 'pill-Personal', Tools: 'pill-Tools',
    Learning: 'pill-Learning', Shopping: 'pill-Shopping', Design: 'pill-Design',
    Development: 'pill-Development', Reading: 'pill-Reading', Travel: 'pill-Travel',
  };
  return map[category] || 'pill-default';
};

/** Filter + sort bookmarks according to current state */
const getFilteredBookmarks = () => {
  let list = [...state.bookmarks];

  // View filter
  if (state.view === 'favorites') {
    list = list.filter(b => b.starred);
  } else if (state.view === 'recent') {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    list = list.filter(b => new Date(b.created) >= cutoff);
  } else if (state.view === 'uncategorized') {
    list = list.filter(b => !b.category || b.category === '');
  } else if (state.view !== 'all') {
    // Must be a specific category
    list = list.filter(b => b.category === state.view);
  }

  // Search filter
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter(b =>
      b.title.toLowerCase().includes(q) ||
      b.url.toLowerCase().includes(q) ||
      (b.notes || '').toLowerCase().includes(q)
    );
  }

  // Sort
  list.sort((a, b) => {
    switch (state.sort) {
      case 'newest':   return new Date(b.created) - new Date(a.created);
      case 'oldest':   return new Date(a.created) - new Date(b.created);
      case 'title-az': return a.title.localeCompare(b.title);
      case 'title-za': return b.title.localeCompare(a.title);
      default:         return 0;
    }
  });

  return list;
};

/* ════════════════════════════════════════════════════════════
   RENDERING
════════════════════════════════════════════════════════════ */

/** Render sidebar navigation (categories) */
function renderSidebarCategories() {
  const nav = document.getElementById('categories-nav');
  nav.innerHTML = '';

  state.categories.forEach(cat => {
    const count = state.bookmarks.filter(b => b.category === cat).length;
    const row = document.createElement('li');
    row.className = 'cat-nav-row';
    row.innerHTML = `
      <button class="nav-item${state.view === cat ? ' active' : ''}" data-view="${escHtml(cat)}">
        <i data-lucide="folder"></i>
        <span>${escHtml(cat)}</span>
        <span class="nav-badge">${count}</span>
      </button>
      <button class="cat-more-btn" data-cat="${escHtml(cat)}" aria-label="Category options for ${escHtml(cat)}">
        <i data-lucide="more-horizontal"></i>
      </button>`;
    nav.appendChild(row);
  });

  // Badges
  document.getElementById('badge-all').textContent = state.bookmarks.length;
  document.getElementById('badge-fav').textContent = state.bookmarks.filter(b => b.starred).length;

  lucide.createIcons();

  // Wire up category more buttons
  nav.querySelectorAll('.cat-more-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCategoryContextMenu(btn.dataset.cat, btn);
    });
  });

  // Wire up category nav buttons
  nav.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      setView(btn.dataset.view);
    });
  });
}

/** Render bookmark cards */
function renderBookmarks() {
  const container = document.getElementById('bookmarks-container');
  const empty = document.getElementById('empty-state');
  const loading = document.getElementById('loading-state');

  loading.classList.add('hidden');

  const list = getFilteredBookmarks();

  // Subtitle
  const subtitle = document.getElementById('view-subtitle');
  subtitle.textContent = `${list.length} bookmark${list.length !== 1 ? 's' : ''}`;

  if (list.length === 0) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    const msg = document.getElementById('empty-msg');
    msg.textContent = state.search
      ? `No results for "${state.search}"`
      : 'Add your first bookmark to get started.';
    return;
  }

  empty.classList.add('hidden');

  container.innerHTML = list.map(bm => `
    <article class="bookmark-card" data-id="${bm.id}">
      <div class="card-top">
        <div class="card-favicon">
          <img
            src="${faviconUrl(bm.url)}"
            alt=""
            width="20" height="20"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
          />
          <span class="favicon-fallback" style="display:none">${(bm.title[0] || '?').toUpperCase()}</span>
        </div>
        <div class="card-meta">
          <div class="card-title" title="${escHtml(bm.title)}"
               onclick="window.open('${escHtml(bm.url)}','_blank','noopener')">${escHtml(bm.title)}</div>
          <div class="card-url">${escHtml(bm.url)}</div>
        </div>
        <button class="card-star${bm.starred ? ' starred' : ''}" data-id="${bm.id}" aria-label="Toggle favorite">
          <i data-lucide="star"></i>
        </button>
      </div>
      ${bm.notes ? `<p class="card-notes">${escHtml(bm.notes)}</p>` : ''}
      <div class="card-footer">
        <span class="card-pill ${pillClass(bm.category)}">${escHtml(bm.category || 'Uncategorized')}</span>
        <div class="card-actions">
          <button class="card-action-btn copy-btn" data-url="${escHtml(bm.url)}" title="Copy URL">
            <i data-lucide="copy"></i>
          </button>
          <button class="card-action-btn edit-btn" data-id="${bm.id}" title="Edit">
            <i data-lucide="pencil"></i>
          </button>
          <button class="card-action-btn delete-btn" data-id="${bm.id}" title="Delete">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>
    </article>`).join('');

  lucide.createIcons();

  // Wire up card buttons
  container.querySelectorAll('.card-star').forEach(btn => {
    btn.addEventListener('click', () => toggleStar(btn.dataset.id));
  });
  container.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.id));
  });
  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => openDeleteModal(btn.dataset.id));
  });
  container.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.url);
      toast('URL copied!', 'success');
    });
  });
}

/** Full re-render */
function render() {
  renderSidebarCategories();
  renderBookmarks();
  updateCategoryActions();
}

/** Show/hide category-specific action buttons */
function updateCategoryActions() {
  const catActions = document.getElementById('cat-actions');
  const isCategory = !['all', 'favorites', 'recent', 'uncategorized'].includes(state.view);
  catActions.classList.toggle('hidden', !isCategory);
}

/** Update view title */
function setView(view) {
  state.view = view;
  const titles = {
    all: 'All Bookmarks',
    favorites: 'Favorites',
    recent: 'Recently Added',
    uncategorized: 'Uncategorized',
  };
  document.getElementById('view-title').textContent = titles[view] || view;

  // Update active sidebar item
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  render();
}

/* ════════════════════════════════════════════════════════════
   BOOKMARK CRUD
════════════════════════════════════════════════════════════ */

/** Add or update a bookmark */
async function saveBookmark() {
  const id    = document.getElementById('edit-id').value;
  const title = document.getElementById('bm-title').value.trim();
  const url   = document.getElementById('bm-url').value.trim();
  const cat   = document.getElementById('bm-category').value;
  const notes = document.getElementById('bm-notes').value.trim();

  if (!title) { toast('Title is required.', 'error'); return; }
  if (!url)   { toast('URL is required.', 'error'); return; }

  // Basic URL validation
  try { new URL(url); } catch {
    toast('Please enter a valid URL (include https://).', 'error');
    return;
  }

  if (id) {
    // Edit existing
    const idx = state.bookmarks.findIndex(b => b.id === id);
    if (idx > -1) {
      state.bookmarks[idx] = { ...state.bookmarks[idx], title, url, category: cat, notes };
    }
  } else {
    // Add new
    state.bookmarks.unshift({ id: uid(), title, url, category: cat, notes, created: today(), starred: false });
  }

  closeAllModals();
  render();
  await persistData(id ? 'Bookmark updated.' : 'Bookmark saved.');
}

/** Toggle starred status */
async function toggleStar(id) {
  const bm = state.bookmarks.find(b => b.id === id);
  if (!bm) return;
  bm.starred = !bm.starred;
  render();
  await persistData(bm.starred ? 'Added to favorites.' : 'Removed from favorites.');
}

/** Delete confirmed bookmark */
async function deleteBookmark() {
  state.bookmarks = state.bookmarks.filter(b => b.id !== state.pendingDeleteId);
  closeAllModals();
  render();
  await persistData('Bookmark deleted.');
}

/* ════════════════════════════════════════════════════════════
   CATEGORY CRUD
════════════════════════════════════════════════════════════ */

async function saveCategory() {
  const name    = document.getElementById('cat-name').value.trim();
  const oldName = document.getElementById('cat-old-name').value;

  if (!name) { toast('Category name is required.', 'error'); return; }

  if (oldName) {
    // Rename
    const idx = state.categories.indexOf(oldName);
    if (idx > -1) state.categories[idx] = name;
    // Update bookmarks using old name
    state.bookmarks.forEach(b => { if (b.category === oldName) b.category = name; });
    if (state.view === oldName) state.view = name;
  } else {
    // New
    if (state.categories.includes(name)) { toast('Category already exists.', 'error'); return; }
    state.categories.push(name);
  }

  closeAllModals();
  render();
  await persistData(oldName ? 'Category renamed.' : 'Category created.');
}

async function deleteCategory(name) {
  if (!confirm(`Delete category "${name}"? Bookmarks in it will become Uncategorized.`)) return;
  state.categories = state.categories.filter(c => c !== name);
  state.bookmarks.forEach(b => { if (b.category === name) b.category = ''; });
  if (state.view === name) setView('all');
  render();
  await persistData('Category deleted.');
}

function openCategoryContextMenu(cat) {
  // Show a simple inline confirm flow via the rename/delete buttons in the header when the category is active
  setView(cat);
}

/* ════════════════════════════════════════════════════════════
   PERSIST DATA (GitHub + Local)
════════════════════════════════════════════════════════════ */
async function persistData(successMsg = 'Saved.') {
  local.save(); // Always persist locally

  if (!cfg.isConfigured()) {
    toast(successMsg + ' (Local only — configure GitHub to sync.)', 'info');
    return;
  }

  try {
    await github.save();
    toast(successMsg + ' Synced to GitHub.', 'success');
  } catch (err) {
    console.error('GitHub sync error:', err);
    toast('Saved locally. GitHub sync failed: ' + err.message, 'error');
  }
}

/* ════════════════════════════════════════════════════════════
   MODAL HELPERS
════════════════════════════════════════════════════════════ */

function openModal(id) {
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById(id).classList.remove('hidden');
  document.getElementById('modal-overlay').setAttribute('aria-hidden', 'false');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  // Close overlay if no other modals are open
  const anyOpen = document.querySelectorAll('.modal:not(.hidden)').length > 0;
  if (!anyOpen) {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.getElementById('modal-overlay').setAttribute('aria-hidden', 'true');
  }
}

function closeAllModals() {
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  document.getElementById('modal-overlay').classList.add('hidden');
}

/** Open the Add Bookmark modal */
function openAddModal() {
  document.getElementById('edit-id').value = '';
  document.getElementById('bm-title').value = '';
  document.getElementById('bm-url').value = '';
  document.getElementById('bm-notes').value = '';
  document.getElementById('modal-title').textContent = 'Add Bookmark';
  populateCategorySelect();
  openModal('bookmark-modal');
  setTimeout(() => document.getElementById('bm-title').focus(), 50);
}

/** Open the Edit Bookmark modal */
function openEditModal(id) {
  const bm = state.bookmarks.find(b => b.id === id);
  if (!bm) return;
  document.getElementById('edit-id').value = bm.id;
  document.getElementById('bm-title').value = bm.title;
  document.getElementById('bm-url').value = bm.url;
  document.getElementById('bm-notes').value = bm.notes || '';
  document.getElementById('modal-title').textContent = 'Edit Bookmark';
  populateCategorySelect(bm.category);
  openModal('bookmark-modal');
  setTimeout(() => document.getElementById('bm-title').focus(), 50);
}

/** Populate the category dropdown in the bookmark modal */
function populateCategorySelect(selected = '') {
  const sel = document.getElementById('bm-category');
  sel.innerHTML = '<option value="">— No category —</option>' +
    state.categories.map(c =>
      `<option value="${escHtml(c)}"${c === selected ? ' selected' : ''}>${escHtml(c)}</option>`
    ).join('');
}

/** Open delete confirmation modal */
function openDeleteModal(id) {
  const bm = state.bookmarks.find(b => b.id === id);
  if (!bm) return;
  state.pendingDeleteId = id;
  document.getElementById('delete-bm-title').textContent = bm.title;
  openModal('delete-modal');
}

/** Open the New/Rename category modal */
function openCategoryModal(oldName = '') {
  document.getElementById('cat-name').value = oldName;
  document.getElementById('cat-old-name').value = oldName;
  document.getElementById('cat-modal-title').textContent = oldName ? 'Rename Category' : 'New Category';
  openModal('category-modal');
  setTimeout(() => document.getElementById('cat-name').focus(), 50);
}

/* ════════════════════════════════════════════════════════════
   IMPORT / EXPORT
════════════════════════════════════════════════════════════ */

function exportJSON() {
  const data = { categories: state.categories, bookmarks: state.bookmarks };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bookmarks-${today()}.json`;
  a.click();
  toast('Exported successfully.', 'success');
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.bookmarks || !Array.isArray(data.bookmarks)) throw new Error('Invalid format');

      // Merge bookmarks (skip duplicates by ID)
      const existingIds = new Set(state.bookmarks.map(b => b.id));
      const newBms = data.bookmarks.filter(b => !existingIds.has(b.id));
      state.bookmarks.push(...newBms);

      // Merge categories
      if (Array.isArray(data.categories)) {
        data.categories.forEach(c => {
          if (!state.categories.includes(c)) state.categories.push(c);
        });
      }

      closeAllModals();
      render();
      await persistData(`Imported ${newBms.length} bookmark(s).`);
    } catch {
      toast('Failed to import: invalid JSON format.', 'error');
    }
  };
  reader.readAsText(file);
}

/* ════════════════════════════════════════════════════════════
   SETTINGS
════════════════════════════════════════════════════════════ */

function openSettingsModal() {
  document.getElementById('gh-username').value = cfg.username;
  document.getElementById('gh-repo').value = cfg.repo;
  document.getElementById('gh-branch').value = cfg.branch || 'main';
  document.getElementById('gh-token').value = cfg.token ? '••••••••••••••••' : '';
  document.getElementById('connection-status').textContent = '';
  document.getElementById('connection-status').className = 'connection-status';
  openModal('settings-modal');
}

function saveSettings() {
  const username = document.getElementById('gh-username').value.trim();
  const repo     = document.getElementById('gh-repo').value.trim();
  const branch   = document.getElementById('gh-branch').value.trim() || 'main';
  const rawToken = document.getElementById('gh-token').value.trim();

  // Don't overwrite token with the masked placeholder
  const token = rawToken.includes('•') ? cfg.token : rawToken;

  cfg.save({ username, repo, branch, token });
  closeAllModals();
  toast('Settings saved.', 'success');
}

async function testConnection() {
  const statusEl = document.getElementById('connection-status');
  const rawToken = document.getElementById('gh-token').value.trim();
  const token = rawToken.includes('•') ? cfg.token : rawToken;

  if (!token) { statusEl.textContent = 'Enter a token first.'; statusEl.className = 'connection-status err'; return; }

  // Temporarily save the token for the test
  const prevToken = cfg.token;
  localStorage.setItem('bh-gh-token', token);
  statusEl.textContent = 'Testing…';
  statusEl.className = 'connection-status';

  try {
    const login = await github.testConnection();
    statusEl.textContent = `✓ Connected as ${login}`;
    statusEl.className = 'connection-status ok';
  } catch (err) {
    statusEl.textContent = '✗ ' + err.message;
    statusEl.className = 'connection-status err';
    localStorage.setItem('bh-gh-token', prevToken); // restore
  }
}

/* ════════════════════════════════════════════════════════════
   THEME
════════════════════════════════════════════════════════════ */

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = document.querySelector('#theme-toggle i');
  if (icon) {
    icon.setAttribute('data-lucide', theme === 'dark' ? 'sun' : 'moon');
    lucide.createIcons();
  }
  localStorage.setItem('bh-theme', theme);
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme(state.theme);
}

/* ════════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
════════════════════════════════════════════════════════════ */

/** @param {string} msg @param {'success'|'error'|'info'} type */
function toast(msg, type = 'info') {
  const icons = { success: 'check-circle', error: 'x-circle', info: 'info' };
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.style.setProperty('--toast-delay', '3s');
  el.innerHTML = `<i data-lucide="${icons[type]}"></i><span>${escHtml(msg)}</span>`;
  container.appendChild(el);
  lucide.createIcons();
  setTimeout(() => el.remove(), 3400);
}

/* ════════════════════════════════════════════════════════════
   UTILITY
════════════════════════════════════════════════════════════ */

/** Escape HTML special characters to prevent XSS */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ════════════════════════════════════════════════════════════
   INITIALISATION
════════════════════════════════════════════════════════════ */

async function init() {
  // Apply saved theme
  applyTheme(state.theme);

  // Try to load from GitHub first, fall back to localStorage
  const loadingEl = document.getElementById('loading-state');

  if (cfg.isConfigured()) {
    loadingEl.classList.remove('hidden');
    document.getElementById('bookmarks-container').innerHTML = '';
    try {
      const data = await github.load();
      if (data) {
        state.bookmarks  = data.bookmarks  || [];
        state.categories = data.categories || state.categories;
        // Sync local copy
        local.save();
      } else {
        // No file on GitHub yet — check local
        const localData = local.load();
        if (localData) {
          state.bookmarks  = localData.bookmarks  || [];
          state.categories = localData.categories || state.categories;
        }
      }
    } catch (err) {
      console.warn('GitHub load failed, falling back to local storage:', err);
      toast('GitHub sync failed — using local data.', 'error');
      const localData = local.load();
      if (localData) {
        state.bookmarks  = localData.bookmarks  || [];
        state.categories = localData.categories || state.categories;
      }
    }
  } else {
    // No GitHub config — use localStorage
    const localData = local.load();
    if (localData) {
      state.bookmarks  = localData.bookmarks  || [];
      state.categories = localData.categories || state.categories;
    }
  }

  render();
}

/* ════════════════════════════════════════════════════════════
   EVENT WIRING (runs after DOM ready)
════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  // ── Sidebar nav (fixed items) ────────────────────────────
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  // ── Mobile sidebar toggle ────────────────────────────────
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });
  // Close sidebar when clicking overlay
  document.getElementById('modal-overlay').addEventListener('click', () => {
    sidebar.classList.remove('open');
    closeAllModals();
  });

  // ── Add bookmark button ──────────────────────────────────
  document.getElementById('open-add-modal').addEventListener('click', openAddModal);
  document.getElementById('empty-add-btn').addEventListener('click', openAddModal);

  // ── Bookmark modal controls ──────────────────────────────
  document.getElementById('close-modal').addEventListener('click', () => closeModal('bookmark-modal'));
  document.getElementById('cancel-modal').addEventListener('click', () => closeModal('bookmark-modal'));
  document.getElementById('save-bookmark').addEventListener('click', saveBookmark);

  // ── Delete modal controls ────────────────────────────────
  document.getElementById('close-delete-modal').addEventListener('click', () => closeModal('delete-modal'));
  document.getElementById('cancel-delete').addEventListener('click', () => closeModal('delete-modal'));
  document.getElementById('confirm-delete').addEventListener('click', deleteBookmark);

  // ── Category modal controls ──────────────────────────────
  document.getElementById('add-category-btn').addEventListener('click', () => openCategoryModal());
  document.getElementById('close-cat-modal').addEventListener('click', () => closeModal('category-modal'));
  document.getElementById('cancel-cat').addEventListener('click', () => closeModal('category-modal'));
  document.getElementById('save-cat').addEventListener('click', saveCategory);

  // ── Category header actions ──────────────────────────────
  document.getElementById('rename-cat-btn').addEventListener('click', () => openCategoryModal(state.view));
  document.getElementById('delete-cat-btn').addEventListener('click', () => deleteCategory(state.view));
  document.getElementById('open-all-in-cat').addEventListener('click', () => {
    const bms = state.bookmarks.filter(b => b.category === state.view);
    bms.forEach(b => window.open(b.url, '_blank', 'noopener'));
    if (bms.length === 0) toast('No bookmarks in this category.', 'info');
  });

  // ── Settings modal controls ──────────────────────────────
  const openSettings = () => openSettingsModal();
  document.getElementById('open-settings').addEventListener('click', openSettings);
  document.getElementById('open-settings-sidebar').addEventListener('click', openSettings);
  document.getElementById('close-settings-modal').addEventListener('click', () => closeModal('settings-modal'));
  document.getElementById('cancel-settings').addEventListener('click', () => closeModal('settings-modal'));
  document.getElementById('save-settings').addEventListener('click', saveSettings);
  document.getElementById('test-connection').addEventListener('click', testConnection);

  // Token visibility toggle
  document.getElementById('toggle-token-vis').addEventListener('click', () => {
    const inp = document.getElementById('gh-token');
    const icon = document.querySelector('#toggle-token-vis i');
    if (inp.type === 'password') {
      inp.type = 'text';
      icon.setAttribute('data-lucide', 'eye-off');
    } else {
      inp.type = 'password';
      icon.setAttribute('data-lucide', 'eye');
    }
    lucide.createIcons();
  });

  // ── Import / Export modal controls ──────────────────────
  document.getElementById('open-ie-modal').addEventListener('click', () => openModal('import-export-modal'));
  document.getElementById('close-ie-modal').addEventListener('click', () => closeModal('import-export-modal'));
  document.getElementById('cancel-ie').addEventListener('click', () => closeModal('import-export-modal'));
  document.getElementById('export-json').addEventListener('click', exportJSON);

  const importInput = document.getElementById('import-file-input');
  importInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('import-filename').textContent = file.name;
    importJSON(file);
    importInput.value = '';
  });

  // ── Theme toggle ─────────────────────────────────────────
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // ── Search ───────────────────────────────────────────────
  const searchInput = document.getElementById('global-search');
  let searchTimer;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = e.target.value.trim();
      renderBookmarks();
    }, 150);
  });

  // Keyboard shortcut Ctrl+K / Cmd+K to focus search
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
    if (e.key === 'Escape') {
      closeAllModals();
      sidebar.classList.remove('open');
    }
  });

  // ── Sort ─────────────────────────────────────────────────
  document.getElementById('sort-select').addEventListener('change', (e) => {
    state.sort = e.target.value;
    renderBookmarks();
  });

  // ── Layout toggle ─────────────────────────────────────────
  document.querySelectorAll('.layout-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.layout = btn.dataset.layout;
      document.querySelectorAll('.layout-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const grid = document.getElementById('bookmarks-container');
      grid.classList.toggle('list-layout', state.layout === 'list');
    });
  });

  // ── Bookmark modal Enter key ──────────────────────────────
  ['bm-title', 'bm-url', 'bm-category'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveBookmark();
    });
  });

  // ── Category modal Enter key ──────────────────────────────
  document.getElementById('cat-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveCategory();
  });

  // ── Bootstrap app ────────────────────────────────────────
  init();
});
