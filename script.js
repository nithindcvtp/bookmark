/**
 * BOOKMARK HUB — script.js
 * Fixed version: forces GitHub sync on every load and save.
 * Bookmarks are stored in GitHub repo as bookmarks.json
 * and loaded fresh on every page visit from any device.
 */

'use strict';

/* ════════════════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════════════════ */
const state = {
  bookmarks: [],
  categories: ['Work', 'Personal', 'Tools', 'Learning', 'Shopping'],
  view: 'all',
  search: '',
  sort: 'newest',
  layout: 'grid',
  pendingDeleteId: null,
  fileSha: null,
  theme: localStorage.getItem('bh-theme') || 'light',
};

/* ════════════════════════════════════════════════════════════
   GITHUB CONFIGURATION
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
    if (token && !token.includes('•')) {
      localStorage.setItem('bh-gh-token', token);
    }
  },

  isConfigured() {
    return !!(this.username && this.repo && this.token);
  },
};

/* ════════════════════════════════════════════════════════════
   GITHUB API
════════════════════════════════════════════════════════════ */
const github = {
  apiBase() {
    return `https://api.github.com/repos/${cfg.username}/${cfg.repo}/contents/bookmarks.json`;
  },

  headers() {
    return {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    };
  },

  /* READ bookmarks.json from GitHub */
  async load() {
    if (!cfg.isConfigured()) {
      console.warn('GitHub not configured');
      return null;
    }

    const url = `${github.apiBase()}?ref=${cfg.branch}&t=${Date.now()}`;
    console.log('Loading from GitHub:', url);

    const res = await fetch(url, {
      method: 'GET',
      headers: github.headers(),
      cache: 'no-store',
    });

    console.log('GitHub load response:', res.status);

    if (res.status === 404) {
      console.log('bookmarks.json not found on GitHub yet');
      state.fileSha = null;
      return null;
    }

    if (res.status === 401) {
      throw new Error('Invalid token — check your GitHub Personal Access Token');
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub error ${res.status}`);
    }

    const meta = await res.json();
    state.fileSha = meta.sha;
    console.log('Got SHA:', state.fileSha);

    // Decode base64 content (handle unicode properly)
    const base64 = meta.content.replace(/\n/g, '');
    const decoded = decodeURIComponent(
      atob(base64).split('').map(c =>
        '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
      ).join('')
    );

    return JSON.parse(decoded);
  },

  /* WRITE bookmarks.json to GitHub */
  async save() {
    if (!cfg.isConfigured()) {
      throw new Error('GitHub not configured');
    }

    // Always get the latest SHA before writing to avoid conflicts
    try {
      const checkUrl = `${github.apiBase()}?ref=${cfg.branch}&t=${Date.now()}`;
      const checkRes = await fetch(checkUrl, {
        headers: github.headers(),
        cache: 'no-store',
      });
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        state.fileSha = checkData.sha;
        console.log('Refreshed SHA before save:', state.fileSha);
      }
    } catch (e) {
      console.warn('Could not refresh SHA, proceeding with existing:', state.fileSha);
    }

    const payload = {
      categories: state.categories,
      bookmarks: state.bookmarks,
    };

    const jsonStr = JSON.stringify(payload, null, 2);

    // Encode to base64 (handle unicode)
    const base64Content = btoa(
      encodeURIComponent(jsonStr).replace(/%([0-9A-F]{2})/g, (_, p1) =>
        String.fromCharCode(parseInt(p1, 16))
      )
    );

    const body = {
      message: `Updated bookmarks via Bookmark Hub — ${new Date().toISOString()}`,
      content: base64Content,
      branch: cfg.branch,
    };

    if (state.fileSha) {
      body.sha = state.fileSha;
    }

    console.log('Writing to GitHub, SHA:', state.fileSha);

    const res = await fetch(github.apiBase(), {
      method: 'PUT',
      headers: github.headers(),
      body: JSON.stringify(body),
    });

    console.log('GitHub save response:', res.status);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('GitHub save error:', err);
      throw new Error(err.message || `GitHub write error ${res.status}`);
    }

    const data = await res.json();
    state.fileSha = data.content.sha;
    console.log('Save successful, new SHA:', state.fileSha);
    return true;
  },

  async testConnection() {
    const res = await fetch('https://api.github.com/user', {
      headers: github.headers(),
    });
    if (!res.ok) throw new Error('Authentication failed — check your token');
    const user = await res.json();
    return user.login;
  },
};

/* ════════════════════════════════════════════════════════════
   LOCAL STORAGE (fallback only)
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
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
};

/* ════════════════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════════════════ */
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const today = () => new Date().toISOString().slice(0, 10);
const faviconUrl = (url) => {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch { return ''; }
};
const pillClass = (cat) => {
  const map = {
    Work:'pill-Work', Personal:'pill-Personal', Tools:'pill-Tools',
    Learning:'pill-Learning', Shopping:'pill-Shopping', Design:'pill-Design',
    Development:'pill-Development', Reading:'pill-Reading', Travel:'pill-Travel',
  };
  return map[cat] || 'pill-default';
};

const getFiltered = () => {
  let list = [...state.bookmarks];
  if (state.view === 'favorites')     list = list.filter(b => b.starred);
  else if (state.view === 'recent')   list = list.filter(b => new Date(b.created) >= new Date(Date.now() - 7*86400000));
  else if (state.view === 'uncategorized') list = list.filter(b => !b.category);
  else if (state.view !== 'all')      list = list.filter(b => b.category === state.view);

  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter(b =>
      b.title.toLowerCase().includes(q) ||
      b.url.toLowerCase().includes(q) ||
      (b.notes||'').toLowerCase().includes(q)
    );
  }
  list.sort((a,b) => {
    if (state.sort === 'newest')   return new Date(b.created) - new Date(a.created);
    if (state.sort === 'oldest')   return new Date(a.created) - new Date(b.created);
    if (state.sort === 'title-az') return a.title.localeCompare(b.title);
    if (state.sort === 'title-za') return b.title.localeCompare(a.title);
    return 0;
  });
  return list;
};

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ════════════════════════════════════════════════════════════
   PERSIST — always tries GitHub first
════════════════════════════════════════════════════════════ */
async function persistData(successMsg = 'Saved.') {
  local.save(); // always save locally as backup

  if (!cfg.isConfigured()) {
    toast('Saved locally only. Configure GitHub Settings to sync across devices.', 'info');
    return;
  }

  // Show saving indicator
  const saveBtn = document.getElementById('save-bookmark');
  if (saveBtn) { saveBtn.textContent = 'Saving…'; saveBtn.disabled = true; }

  try {
    await github.save();
    toast('✓ ' + successMsg + ' Synced to GitHub — visible on all devices!', 'success');
  } catch (err) {
    console.error('GitHub sync failed:', err);
    toast('⚠ Saved locally but GitHub sync FAILED: ' + err.message, 'error');
  } finally {
    if (saveBtn) { saveBtn.textContent = 'Save Bookmark'; saveBtn.disabled = false; }
  }
}

/* ════════════════════════════════════════════════════════════
   RENDERING
════════════════════════════════════════════════════════════ */
function renderSidebarCategories() {
  const nav = document.getElementById('categories-nav');
  nav.innerHTML = '';
  state.categories.forEach(cat => {
    const count = state.bookmarks.filter(b => b.category === cat).length;
    const row = document.createElement('li');
    row.className = 'cat-nav-row';
    row.innerHTML = `
      <button class="nav-item${state.view===cat?' active':''}" data-view="${escHtml(cat)}">
        <i data-lucide="folder"></i><span>${escHtml(cat)}</span>
        <span class="nav-badge">${count}</span>
      </button>
      <button class="cat-more-btn" data-cat="${escHtml(cat)}" aria-label="Options">
        <i data-lucide="more-horizontal"></i>
      </button>`;
    nav.appendChild(row);
  });

  document.getElementById('badge-all').textContent = state.bookmarks.length;
  document.getElementById('badge-fav').textContent = state.bookmarks.filter(b=>b.starred).length;
  lucide.createIcons();

  nav.querySelectorAll('.nav-item').forEach(btn =>
    btn.addEventListener('click', () => setView(btn.dataset.view))
  );
  nav.querySelectorAll('.cat-more-btn').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); openCategoryModal(btn.dataset.cat); })
  );
}

function renderBookmarks() {
  const container = document.getElementById('bookmarks-container');
  const empty     = document.getElementById('empty-state');
  const loading   = document.getElementById('loading-state');
  loading.classList.add('hidden');

  const list = getFiltered();
  document.getElementById('view-subtitle').textContent = `${list.length} bookmark${list.length!==1?'s':''}`;

  if (list.length === 0) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    document.getElementById('empty-msg').textContent = state.search
      ? `No results for "${state.search}"`
      : 'Add your first bookmark to get started.';
    return;
  }
  empty.classList.add('hidden');

  container.innerHTML = list.map(bm => `
    <article class="bookmark-card" data-id="${bm.id}">
      <div class="card-top">
        <div class="card-favicon">
          <img src="${faviconUrl(bm.url)}" alt="" width="20" height="20"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
          <span class="favicon-fallback" style="display:none">${(bm.title[0]||'?').toUpperCase()}</span>
        </div>
        <div class="card-meta">
          <div class="card-title" onclick="window.open('${escHtml(bm.url)}','_blank','noopener')"
            title="${escHtml(bm.title)}">${escHtml(bm.title)}</div>
          <div class="card-url">${escHtml(bm.url)}</div>
        </div>
        <button class="card-star${bm.starred?' starred':''}" data-id="${bm.id}" aria-label="Favorite">
          <i data-lucide="star"></i>
        </button>
      </div>
      ${bm.notes?`<p class="card-notes">${escHtml(bm.notes)}</p>`:''}
      <div class="card-footer">
        <span class="card-pill ${pillClass(bm.category)}">${escHtml(bm.category||'Uncategorized')}</span>
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

  container.querySelectorAll('.card-star').forEach(b => b.addEventListener('click', ()=>toggleStar(b.dataset.id)));
  container.querySelectorAll('.edit-btn').forEach(b => b.addEventListener('click', ()=>openEditModal(b.dataset.id)));
  container.querySelectorAll('.delete-btn').forEach(b => b.addEventListener('click', ()=>openDeleteModal(b.dataset.id)));
  container.querySelectorAll('.copy-btn').forEach(b => b.addEventListener('click', ()=>{
    navigator.clipboard.writeText(b.dataset.url);
    toast('URL copied!','success');
  }));
}

function render() {
  renderSidebarCategories();
  renderBookmarks();
  updateCategoryActions();
}

function updateCategoryActions() {
  const isCategory = !['all','favorites','recent','uncategorized'].includes(state.view);
  document.getElementById('cat-actions').classList.toggle('hidden', !isCategory);
}

function setView(view) {
  state.view = view;
  const titles = { all:'All Bookmarks', favorites:'Favorites', recent:'Recently Added', uncategorized:'Uncategorized' };
  document.getElementById('view-title').textContent = titles[view] || view;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view===view));
  render();
}

/* ════════════════════════════════════════════════════════════
   CRUD
════════════════════════════════════════════════════════════ */
async function saveBookmark() {
  const id    = document.getElementById('edit-id').value;
  const title = document.getElementById('bm-title').value.trim();
  const url   = document.getElementById('bm-url').value.trim();
  const cat   = document.getElementById('bm-category').value;
  const notes = document.getElementById('bm-notes').value.trim();

  if (!title) { toast('Title is required.','error'); return; }
  if (!url)   { toast('URL is required.','error'); return; }
  try { new URL(url); } catch { toast('Enter a valid URL (include https://).','error'); return; }

  if (id) {
    const idx = state.bookmarks.findIndex(b=>b.id===id);
    if (idx>-1) state.bookmarks[idx] = {...state.bookmarks[idx], title, url, category:cat, notes};
  } else {
    state.bookmarks.unshift({ id:uid(), title, url, category:cat, notes, created:today(), starred:false });
  }

  closeAllModals();
  render();
  await persistData(id ? 'Bookmark updated.' : 'Bookmark added.');
}

async function toggleStar(id) {
  const bm = state.bookmarks.find(b=>b.id===id);
  if (!bm) return;
  bm.starred = !bm.starred;
  render();
  await persistData(bm.starred?'Added to favorites.':'Removed from favorites.');
}

async function deleteBookmark() {
  state.bookmarks = state.bookmarks.filter(b=>b.id!==state.pendingDeleteId);
  closeAllModals();
  render();
  await persistData('Bookmark deleted.');
}

async function saveCategory() {
  const name    = document.getElementById('cat-name').value.trim();
  const oldName = document.getElementById('cat-old-name').value;
  if (!name) { toast('Category name is required.','error'); return; }
  if (oldName) {
    const idx = state.categories.indexOf(oldName);
    if (idx>-1) state.categories[idx] = name;
    state.bookmarks.forEach(b=>{ if(b.category===oldName) b.category=name; });
    if (state.view===oldName) state.view=name;
  } else {
    if (state.categories.includes(name)) { toast('Category already exists.','error'); return; }
    state.categories.push(name);
  }
  closeAllModals();
  render();
  await persistData(oldName?'Category renamed.':'Category created.');
}

async function deleteCategory(name) {
  if (!confirm(`Delete category "${name}"? Bookmarks will become Uncategorized.`)) return;
  state.categories = state.categories.filter(c=>c!==name);
  state.bookmarks.forEach(b=>{ if(b.category===name) b.category=''; });
  if (state.view===name) setView('all');
  render();
  await persistData('Category deleted.');
}

/* ════════════════════════════════════════════════════════════
   MODALS
════════════════════════════════════════════════════════════ */
function openModal(id) {
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById(id).classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  const anyOpen = document.querySelectorAll('.modal:not(.hidden)').length>0;
  if (!anyOpen) document.getElementById('modal-overlay').classList.add('hidden');
}
function closeAllModals() {
  document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden'));
  document.getElementById('modal-overlay').classList.add('hidden');
}

function openAddModal() {
  document.getElementById('edit-id').value='';
  document.getElementById('bm-title').value='';
  document.getElementById('bm-url').value='';
  document.getElementById('bm-notes').value='';
  document.getElementById('modal-title').textContent='Add Bookmark';
  populateCategorySelect();
  openModal('bookmark-modal');
  setTimeout(()=>document.getElementById('bm-title').focus(),50);
}
function openEditModal(id) {
  const bm = state.bookmarks.find(b=>b.id===id);
  if (!bm) return;
  document.getElementById('edit-id').value=bm.id;
  document.getElementById('bm-title').value=bm.title;
  document.getElementById('bm-url').value=bm.url;
  document.getElementById('bm-notes').value=bm.notes||'';
  document.getElementById('modal-title').textContent='Edit Bookmark';
  populateCategorySelect(bm.category);
  openModal('bookmark-modal');
}
function openDeleteModal(id) {
  const bm = state.bookmarks.find(b=>b.id===id);
  if (!bm) return;
  state.pendingDeleteId=id;
  document.getElementById('delete-bm-title').textContent=bm.title;
  openModal('delete-modal');
}
function openCategoryModal(oldName='') {
  document.getElementById('cat-name').value=oldName;
  document.getElementById('cat-old-name').value=oldName;
  document.getElementById('cat-modal-title').textContent=oldName?'Rename Category':'New Category';
  openModal('category-modal');
  setTimeout(()=>document.getElementById('cat-name').focus(),50);
}
function populateCategorySelect(selected='') {
  const sel = document.getElementById('bm-category');
  sel.innerHTML = '<option value="">— No category —</option>' +
    state.categories.map(c=>`<option value="${escHtml(c)}"${c===selected?' selected':''}>${escHtml(c)}</option>`).join('');
}

/* ════════════════════════════════════════════════════════════
   SETTINGS
════════════════════════════════════════════════════════════ */
function openSettingsModal() {
  document.getElementById('gh-username').value = cfg.username;
  document.getElementById('gh-repo').value = cfg.repo;
  document.getElementById('gh-branch').value = cfg.branch||'main';
  document.getElementById('gh-token').value = cfg.token ? '••••••••••••••••' : '';
  document.getElementById('connection-status').textContent='';
  document.getElementById('connection-status').className='connection-status';
  openModal('settings-modal');
}

function saveSettings() {
  const username = document.getElementById('gh-username').value.trim();
  const repo     = document.getElementById('gh-repo').value.trim();
  const branch   = document.getElementById('gh-branch').value.trim()||'main';
  const rawToken = document.getElementById('gh-token').value.trim();
  const token    = rawToken.includes('•') ? cfg.token : rawToken;

  if (!username || !repo || !token) {
    toast('Please fill in all fields including the token.','error');
    return;
  }

  cfg.save({ username, repo, branch, token });
  closeAllModals();
  toast('Settings saved! Reloading data from GitHub…','success');

  // Immediately reload from GitHub with new settings
  setTimeout(()=> loadFromGitHub(), 500);
}

async function testConnection() {
  const statusEl = document.getElementById('connection-status');
  const rawToken = document.getElementById('gh-token').value.trim();
  const token = rawToken.includes('•') ? cfg.token : rawToken;
  if (!token) { statusEl.textContent='Enter a token first.'; statusEl.className='connection-status err'; return; }

  const prevToken = cfg.token;
  localStorage.setItem('bh-gh-token', token);
  statusEl.textContent='Testing…'; statusEl.className='connection-status';

  try {
    const login = await github.testConnection();
    statusEl.textContent=`✓ Connected as ${login}`;
    statusEl.className='connection-status ok';
  } catch(err) {
    statusEl.textContent='✗ '+err.message;
    statusEl.className='connection-status err';
    localStorage.setItem('bh-gh-token', prevToken);
  }
}

/* ════════════════════════════════════════════════════════════
   IMPORT / EXPORT
════════════════════════════════════════════════════════════ */
function exportJSON() {
  const blob = new Blob([JSON.stringify({categories:state.categories,bookmarks:state.bookmarks},null,2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bookmarks-${today()}.json`;
  a.click();
  toast('Exported!','success');
}
function importJSON(file) {
  const reader = new FileReader();
  reader.onload = async(e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.bookmarks||!Array.isArray(data.bookmarks)) throw new Error('Invalid format');
      const existingIds = new Set(state.bookmarks.map(b=>b.id));
      const newBms = data.bookmarks.filter(b=>!existingIds.has(b.id));
      state.bookmarks.push(...newBms);
      if (Array.isArray(data.categories)) data.categories.forEach(c=>{ if(!state.categories.includes(c)) state.categories.push(c); });
      closeAllModals();
      render();
      await persistData(`Imported ${newBms.length} bookmark(s).`);
    } catch { toast('Failed to import: invalid JSON.','error'); }
  };
  reader.readAsText(file);
}

/* ════════════════════════════════════════════════════════════
   THEME
════════════════════════════════════════════════════════════ */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme',theme);
  const icon = document.querySelector('#theme-toggle i');
  if (icon) { icon.setAttribute('data-lucide', theme==='dark'?'sun':'moon'); lucide.createIcons(); }
  localStorage.setItem('bh-theme',theme);
}
function toggleTheme() { state.theme = state.theme==='dark'?'light':'dark'; applyTheme(state.theme); }

/* ════════════════════════════════════════════════════════════
   TOAST
════════════════════════════════════════════════════════════ */
function toast(msg, type='info') {
  const icons = {success:'check-circle',error:'x-circle',info:'info'};
  const el = document.createElement('div');
  el.className=`toast ${type}`;
  el.style.setProperty('--toast-delay','4s');
  el.innerHTML=`<i data-lucide="${icons[type]}"></i><span>${escHtml(msg)}</span>`;
  document.getElementById('toast-container').appendChild(el);
  lucide.createIcons();
  setTimeout(()=>el.remove(), 4500);
}

/* ════════════════════════════════════════════════════════════
   LOAD FROM GITHUB (called on startup and after settings save)
════════════════════════════════════════════════════════════ */
async function loadFromGitHub() {
  const loadingEl = document.getElementById('loading-state');
  const container = document.getElementById('bookmarks-container');
  loadingEl.classList.remove('hidden');
  container.innerHTML='';

  try {
    const data = await github.load();
    if (data) {
      state.bookmarks  = data.bookmarks  || [];
      state.categories = data.categories || state.categories;
      local.save(); // update local copy
      toast('✓ Loaded from GitHub successfully!','success');
    } else {
      // No file on GitHub yet — upload local data if any
      const localData = local.load();
      if (localData && localData.bookmarks && localData.bookmarks.length > 0) {
        state.bookmarks  = localData.bookmarks;
        state.categories = localData.categories || state.categories;
        toast('No GitHub file found. Uploading your local bookmarks now…','info');
        await github.save();
        toast('✓ Local bookmarks uploaded to GitHub!','success');
      } else {
        toast('GitHub connected! Add your first bookmark.','info');
      }
    }
  } catch(err) {
    console.error('GitHub load error:', err);
    toast('GitHub load failed: ' + err.message + ' — showing local data.','error');
    const localData = local.load();
    if (localData) {
      state.bookmarks  = localData.bookmarks  || [];
      state.categories = localData.categories || state.categories;
    }
  }

  render();
}

/* ════════════════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════════════════ */
async function init() {
  applyTheme(state.theme);

  if (cfg.isConfigured()) {
    // Always load fresh from GitHub on every page load
    await loadFromGitHub();
  } else {
    // Fall back to localStorage and prompt user to configure
    const localData = local.load();
    if (localData) {
      state.bookmarks  = localData.bookmarks  || [];
      state.categories = localData.categories || state.categories;
    }
    render();
    toast('Configure GitHub Settings (⚙) to sync across devices.','info');
  }
}

/* ════════════════════════════════════════════════════════════
   EVENT WIRING
════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Sidebar fixed nav
  document.querySelectorAll('.nav-item[data-view]').forEach(btn =>
    btn.addEventListener('click', ()=>setView(btn.dataset.view))
  );

  // Mobile sidebar
  const sidebar = document.getElementById('sidebar');
  document.getElementById('sidebar-toggle').addEventListener('click', ()=>sidebar.classList.toggle('open'));
  document.getElementById('modal-overlay').addEventListener('click', ()=>{
    sidebar.classList.remove('open');
    closeAllModals();
  });

  // Add bookmark
  document.getElementById('open-add-modal').addEventListener('click', openAddModal);
  document.getElementById('empty-add-btn').addEventListener('click', openAddModal);

  // Bookmark modal
  document.getElementById('close-modal').addEventListener('click', ()=>closeModal('bookmark-modal'));
  document.getElementById('cancel-modal').addEventListener('click', ()=>closeModal('bookmark-modal'));
  document.getElementById('save-bookmark').addEventListener('click', saveBookmark);

  // Delete modal
  document.getElementById('close-delete-modal').addEventListener('click', ()=>closeModal('delete-modal'));
  document.getElementById('cancel-delete').addEventListener('click', ()=>closeModal('delete-modal'));
  document.getElementById('confirm-delete').addEventListener('click', deleteBookmark);

  // Category modal
  document.getElementById('add-category-btn').addEventListener('click', ()=>openCategoryModal());
  document.getElementById('close-cat-modal').addEventListener('click', ()=>closeModal('category-modal'));
  document.getElementById('cancel-cat').addEventListener('click', ()=>closeModal('category-modal'));
  document.getElementById('save-cat').addEventListener('click', saveCategory);

  // Category header actions
  document.getElementById('rename-cat-btn').addEventListener('click', ()=>openCategoryModal(state.view));
  document.getElementById('delete-cat-btn').addEventListener('click', ()=>deleteCategory(state.view));
  document.getElementById('open-all-in-cat').addEventListener('click', ()=>{
    const bms = state.bookmarks.filter(b=>b.category===state.view);
    if (bms.length===0) { toast('No bookmarks in this category.','info'); return; }
    bms.forEach(b=>window.open(b.url,'_blank','noopener'));
  });

  // Settings modal
  const openSettings = ()=>openSettingsModal();
  document.getElementById('open-settings').addEventListener('click', openSettings);
  document.getElementById('open-settings-sidebar').addEventListener('click', openSettings);
  document.getElementById('close-settings-modal').addEventListener('click', ()=>closeModal('settings-modal'));
  document.getElementById('cancel-settings').addEventListener('click', ()=>closeModal('settings-modal'));
  document.getElementById('save-settings').addEventListener('click', saveSettings);
  document.getElementById('test-connection').addEventListener('click', testConnection);

  // Token visibility
  document.getElementById('toggle-token-vis').addEventListener('click', ()=>{
    const inp = document.getElementById('gh-token');
    const icon = document.querySelector('#toggle-token-vis i');
    inp.type = inp.type==='password'?'text':'password';
    icon.setAttribute('data-lucide', inp.type==='password'?'eye':'eye-off');
    lucide.createIcons();
  });

  // Import/Export
  document.getElementById('open-ie-modal').addEventListener('click', ()=>openModal('import-export-modal'));
  document.getElementById('close-ie-modal').addEventListener('click', ()=>closeModal('import-export-modal'));
  document.getElementById('cancel-ie').addEventListener('click', ()=>closeModal('import-export-modal'));
  document.getElementById('export-json').addEventListener('click', exportJSON);
  const importInput = document.getElementById('import-file-input');
  importInput.addEventListener('change', e=>{
    const file=e.target.files[0]; if(!file) return;
    document.getElementById('import-filename').textContent=file.name;
    importJSON(file); importInput.value='';
  });

  // Theme
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // Search
  let searchTimer;
  document.getElementById('global-search').addEventListener('input', e=>{
    clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>{ state.search=e.target.value.trim(); renderBookmarks(); },150);
  });

  // Sort
  document.getElementById('sort-select').addEventListener('change', e=>{ state.sort=e.target.value; renderBookmarks(); });

  // Layout toggle
  document.querySelectorAll('.layout-btn').forEach(btn=>btn.addEventListener('click', ()=>{
    state.layout=btn.dataset.layout;
    document.querySelectorAll('.layout-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('bookmarks-container').classList.toggle('list-layout', state.layout==='list');
  }));

  // Keyboard shortcuts
  document.addEventListener('keydown', e=>{
    if ((e.ctrlKey||e.metaKey)&&e.key==='k') { e.preventDefault(); document.getElementById('global-search').focus(); }
    if (e.key==='Escape') { closeAllModals(); sidebar.classList.remove('open'); }
  });

  // Enter key in modals
  ['bm-title','bm-url','bm-category'].forEach(id=>
    document.getElementById(id).addEventListener('keydown', e=>{ if(e.key==='Enter') saveBookmark(); })
  );
  document.getElementById('cat-name').addEventListener('keydown', e=>{ if(e.key==='Enter') saveCategory(); });

  // Start app
  init();
});
