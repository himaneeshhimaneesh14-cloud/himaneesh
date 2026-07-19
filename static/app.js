'use strict';

// ═══════════════════════════════════════════════════════════════
// YOGAMATE - Premium AI Yoga Assistant
// ═══════════════════════════════════════════════════════════════

// ─── Configuration ───
const CONFIG = {
  API_BASE: '',
  DEFAULT_INTERVAL: 150,
  CAMERA_WIDTH: 480,
  CAMERA_HEIGHT: 360,
  SNAPSHOT_QUALITY: 0.5,
  REQUIRED_IMAGES: 5,
  HISTORY_LIMIT: 50,
  SCORE_HISTORY_LIMIT: 5,
};

// ─── State ───
let STATE = {
  currentUser: null,          // { userId, name, email }
  poses: [],
  selectedPose: null,
  currentView: 'home',
  cameraStream: null,
  isAnalysing: false,
  liveInterval: CONFIG.DEFAULT_INTERVAL,
  mirrorEnabled: true,
  showFps: false,
  isFullscreen: false,
  isDark: localStorage.getItem('ym_dark') === 'true',
  historyData: [],
  scoreHistory: [],
  currentLandmarks: null,
  currentScore: 0,
  currentStatus: '',
  currentSuggestions: [],
  lastFrameTime: 0,
  animationFrameId: null,
  liveLoopTimer: null,
  sessionStartTime: null,
  sessionScores: [],
  favorites: [],
  practiceCount: 0,
  streak: 0,
  lastPracticeDate: null,
  uploadedImages: [],
  generatedPose: null,
  isGenerating: false,
  searchQuery: '',
  floatingSaveBtn: null,
  achievements: [],
};

// ─── User‑prefixed localStorage helpers ───
function getUserKey(key) {
  if (!STATE.currentUser) return `ym_${key}`;
  return `ym_${STATE.currentUser.userId}_${key}`;
}

function getUserLocalStorage(key) {
  return localStorage.getItem(getUserKey(key));
}

function setUserLocalStorage(key, value) {
  localStorage.setItem(getUserKey(key), value);
}

function removeUserLocalStorage(key) {
  localStorage.removeItem(getUserKey(key));
}

// ─── Load user data from localStorage ───
function loadUserData() {
  if (!STATE.currentUser) return;
  STATE.historyData = JSON.parse(getUserLocalStorage('history') || '[]');
  STATE.favorites = JSON.parse(getUserLocalStorage('favorites') || '[]');
  STATE.practiceCount = parseInt(getUserLocalStorage('practice_count') || '0');
  STATE.streak = parseInt(getUserLocalStorage('streak') || '0');
  STATE.lastPracticeDate = getUserLocalStorage('last_practice_date') || null;
  STATE.achievements = JSON.parse(getUserLocalStorage('achievements') || '[]');
  STATE.isDark = getUserLocalStorage('dark') === 'true';
  // Theme
  applyTheme(STATE.isDark);
}

function saveUserData() {
  if (!STATE.currentUser) return;
  setUserLocalStorage('history', JSON.stringify(STATE.historyData));
  setUserLocalStorage('favorites', JSON.stringify(STATE.favorites));
  setUserLocalStorage('practice_count', String(STATE.practiceCount));
  setUserLocalStorage('streak', String(STATE.streak));
  setUserLocalStorage('last_practice_date', STATE.lastPracticeDate || '');
  setUserLocalStorage('achievements', JSON.stringify(STATE.achievements));
  setUserLocalStorage('dark', String(STATE.isDark));
}

// ─── DOM Helpers ───
function el(id) {
  const element = document.getElementById(id);
  if (!element) {
    return {
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      style: {},
      textContent: '',
      innerHTML: '',
      value: '',
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }
  return element;
}

function $$(sel, ctx = document) {
  return [...ctx.querySelectorAll(sel)];
}

// ─── Toast System ───
let toastTimeout;

function showToast(message, type = 'info', duration = 3000) {
  const toast = el('toast');
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: '💡' };
  
  toast.innerHTML = `<span>${icons[type] || '💡'}</span> ${message}`;
  toast.className = `toast toast-${type}`;
  toast.classList.remove('hidden');
  
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.add('hidden'), duration);
}

// ─── Theme ───
function applyTheme(dark) {
  STATE.isDark = dark;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : '');
  setUserLocalStorage('dark', dark);
  const btn = el('theme-toggle');
  if (btn) btn.classList.toggle('on', dark);
}

function toggleTheme() {
  applyTheme(!STATE.isDark);
  showToast(STATE.isDark ? 'Dark mode enabled 🌙' : 'Light mode enabled ☀️');
}

function toggleMirror() {
  STATE.mirrorEnabled = !STATE.mirrorEnabled;
  const btn = el('mirror-toggle');
  if (btn) btn.classList.toggle('on', STATE.mirrorEnabled);
  showToast(STATE.mirrorEnabled ? 'Mirror mode ON' : 'Mirror mode OFF');
}

function toggleFps() {
  STATE.showFps = !STATE.showFps;
  const btn = el('fps-toggle');
  if (btn) btn.classList.toggle('on', STATE.showFps);
  const fpsBadge = el('fps-badge');
  if (fpsBadge) {
    fpsBadge.classList.toggle('hidden', !STATE.showFps || !STATE.cameraStream);
  }
}

function updateInterval(value) {
  STATE.liveInterval = parseInt(value);
  const label = el('interval-val');
  if (label) label.textContent = `${value} ms`;
  
  if (STATE.liveLoopTimer) {
    clearInterval(STATE.liveLoopTimer);
    STATE.liveLoopTimer = setInterval(sendFrameToServer, STATE.liveInterval);
  }
}

function selectDifficulty(btn) {
  $$('.difficulty-pills .pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
}

// ─── API (with X-User-ID header) ───
async function apiRequest(endpoint, options = {}) {
  const headers = options.headers || {};
  if (STATE.currentUser) {
    headers['X-User-ID'] = STATE.currentUser.userId;
  }
  options.headers = headers;
  options.credentials = 'include';

  try {
    const response = await fetch(`${CONFIG.API_BASE}${endpoint}`, options);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data;
  } catch (error) {
    console.error(`[API] ${endpoint} error:`, error);
    throw error;
  }
}

// ─── Authentication ───
async function login(email, password) {
  try {
    const data = await apiRequest('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    STATE.currentUser = { userId: data.user_id, name: data.name, email };
    loadUserData();
    showApp();
    showToast(`Welcome back, ${data.name}! 🧘`, 'success');
    return true;
  } catch (error) {
    showToast(error.message || 'Login failed', 'error');
    return false;
  }
}

async function register(name, email, password) {
  try {
    const data = await apiRequest('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    STATE.currentUser = { userId: data.user_id, name: data.name, email };
    loadUserData();
    showApp();
    showToast(`Welcome, ${data.name}! 🎉`, 'success');
    return true;
  } catch (error) {
    showToast(error.message || 'Registration failed', 'error');
    return false;
  }
}

async function logout() {
  try {
    await apiRequest('/api/logout', { method: 'POST' });
  } catch (e) {}
  STATE.currentUser = null;
  // Clear user data from memory but keep localStorage (will be overwritten on next login)
  // We'll just hide the app and show login
  document.getElementById('app-shell').style.display = 'none';
  document.getElementById('login-overlay').style.display = 'flex';
  showToast('Logged out', 'info');
}

function showApp() {
  document.getElementById('login-overlay').style.display = 'none';
  document.getElementById('app-shell').style.display = 'flex';
  // Update UI with user info
  document.getElementById('user-name').textContent = STATE.currentUser.name;
  document.getElementById('user-email').textContent = STATE.currentUser.email;
  // Load data
  fetchPoses();
  renderHistory();
  renderProgress();
  renderFavorites();
  updateBadge();
  // Re-render if needed
}

// ─── Login/Register UI handlers ───
function initAuthUI() {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const toggleRegister = document.getElementById('login-toggle-register');
  const toggleLogin = document.getElementById('login-toggle-login');
  const logoutBtn = document.getElementById('logout-btn');

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    errorEl.classList.add('hidden');
    const ok = await login(email, password);
    if (!ok) {
      errorEl.textContent = 'Invalid email or password';
      errorEl.classList.remove('hidden');
    }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;
    const errorEl = document.getElementById('register-error');
    errorEl.classList.add('hidden');
    if (!name || !email || !password) {
      errorEl.textContent = 'All fields are required';
      errorEl.classList.remove('hidden');
      return;
    }
    const ok = await register(name, email, password);
    if (!ok) {
      errorEl.textContent = 'Registration failed. Email may already exist.';
      errorEl.classList.remove('hidden');
    }
  });

  toggleRegister.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.style.display = 'none';
    registerForm.style.display = 'block';
  });

  toggleLogin.addEventListener('click', (e) => {
    e.preventDefault();
    registerForm.style.display = 'none';
    loginForm.style.display = 'block';
  });

  logoutBtn.addEventListener('click', logout);
}

// ─── Fetch Poses ───
async function fetchPoses() {
  try {
    const poses = await apiRequest('/api/poses');
    STATE.poses = poses;
    console.log(`[YogaMate] Loaded ${poses.length} poses`);
    renderPoseGrid();
    renderFavorites();
    updateSearchResults();
    return poses;
  } catch (error) {
    console.error('[YogaMate] Error fetching poses:', error);
    showToast('Failed to load poses', 'error');
    return [];
  }
}

// ─── Render Pose Grid ───
function renderPoseGrid() {
  const grid = el('pose-grid');
  if (!grid) return;
  
  const poses = STATE.poses.slice(0, 10);
  
  if (!poses || poses.length === 0) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:var(--text-secondary);">
        <div style="font-size:48px;margin-bottom:16px;">🧘</div>
        <h3 style="font-size:18px;margin-bottom:8px;">No poses found</h3>
        <p style="font-size:14px;color:var(--text-muted);">Click "Add Pose" to create custom poses</p>
      </div>
    `;
    return;
  }
  
  grid.innerHTML = poses.map(p => {
    const isFav = STATE.favorites.includes(p.id);
    const diffClass = `pose-diff-${(p.difficulty || 'beginner').toLowerCase()}`;
    const isCustom = p.is_custom || false;
    const customBadge = isCustom ? '<span class="custom-badge">CUSTOM</span>' : '';
    
    return `
      <div class="pose-card" data-pose-id="${p.id}" onclick="openPractice('${p.id}')">
        <button class="pose-fav ${isFav ? 'active' : ''}" onclick="event.stopPropagation();toggleFavorite('${p.id}')">
          ${isFav ? '❤️' : '🤍'}
        </button>
        <div class="pose-emoji">${p.emoji || '🧘'}</div>
        <div class="pose-name">${p.name || p.id} ${customBadge}</div>
        <div class="pose-english">${p.english || p.id}</div>
        <div class="pose-diff ${diffClass}">${p.difficulty || 'Beginner'}</div>
      </div>
    `;
  }).join('');
  
  const countEl = el('pose-count');
  if (countEl) {
    countEl.textContent = `Showing ${Math.min(STATE.poses.length, 10)} of ${STATE.poses.length} poses`;
  }
}

// ─── Favorites ───
function toggleFavorite(poseId) {
  const index = STATE.favorites.indexOf(poseId);
  if (index > -1) {
    STATE.favorites.splice(index, 1);
    showToast('Removed from favorites');
  } else {
    STATE.favorites.push(poseId);
    showToast('Added to favorites ❤️');
  }
  saveUserData();
  renderPoseGrid();
  renderFavorites();
}

function renderFavorites() {
  const container = el('favorites-grid');
  if (!container) return;
  
  const favs = STATE.poses.filter(p => STATE.favorites.includes(p.id));
  if (favs.length === 0) {
    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">No favorites yet</div>';
    return;
  }
  
  container.innerHTML = favs.map(p => `
    <div class="pose-card" onclick="openPractice('${p.id}')" style="padding:16px;">
      <div class="pose-emoji" style="font-size:32px;">${p.emoji || '🧘'}</div>
      <div class="pose-name" style="font-size:13px;">${p.name || p.id}</div>
    </div>
  `).join('');
}

// ─── Search ───
function setupSearch() {
  const input = el('home-search-input');
  const clearBtn = el('home-search-clear');
  const panel = el('search-results-panel');
  const list = el('search-results-list');
  const label = el('search-results-label');

  if (!input) return;

  input.addEventListener('input', () => {
    const query = input.value.trim();
    STATE.searchQuery = query;
    performSearch(query);
  });

  input.addEventListener('focus', () => {
    if (STATE.searchQuery) {
      performSearch(STATE.searchQuery);
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      STATE.searchQuery = '';
      clearBtn.classList.add('hidden');
      if (panel) {
        panel.style.display = 'none';
        panel.classList.remove('visible');
      }
      input.focus();
    });
  }

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      input.focus();
      input.select();
    }
    if (e.key === 'Escape') {
      input.blur();
      if (panel) {
        panel.style.display = 'none';
        panel.classList.remove('visible');
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (panel && !panel.contains(e.target) && e.target !== input) {
      panel.style.display = 'none';
      panel.classList.remove('visible');
    }
  });
}

function performSearch(query) {
  const clearBtn = el('home-search-clear');
  const panel = el('search-results-panel');
  const list = el('search-results-list');
  const label = el('search-results-label');

  if (clearBtn) {
    if (query) {
      clearBtn.classList.remove('hidden');
    } else {
      clearBtn.classList.add('hidden');
    }
  }
  
  if (!query) {
    if (panel) {
      panel.style.display = 'none';
      panel.classList.remove('visible');
    }
    return;
  }
  
  const results = STATE.poses.filter(p =>
    (p.name && p.name.toLowerCase().includes(query.toLowerCase())) ||
    (p.english && p.english.toLowerCase().includes(query.toLowerCase())) ||
    (p.category && p.category.toLowerCase().includes(query.toLowerCase()))
  );
  
  if (panel) {
    panel.style.display = 'block';
    panel.classList.add('visible');
  }
  
  if (label) {
    label.textContent = results.length > 0 ? `Results (${results.length})` : 'No Results';
  }
  
  if (list) {
    if (results.length > 0) {
      list.innerHTML = results.map(p => {
        const isCustom = p.is_custom || false;
        const customBadge = isCustom ? ' <span class="custom-badge" style="font-size:8px;">CUSTOM</span>' : '';
        return `
          <div class="search-result-item" onclick="openPractice('${p.id}')">
            <div class="result-emoji">${p.emoji || '🧘'}</div>
            <div class="result-info">
              <div class="result-name">${p.name || p.id}${customBadge}</div>
              <div class="result-english">${p.english || p.id}</div>
            </div>
            <svg class="result-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        `;
      }).join('');
    } else {
      list.innerHTML = `
        <div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">
          🔍 No poses found for "<strong>${query}</strong>"
        </div>
      `;
    }
  }
}

function updateSearchResults() {
  const input = el('home-search-input');
  if (input && input.value.trim()) {
    performSearch(input.value.trim());
  }
}

// ─── Reference Images ───
function displayReferenceImages(images) {
  const container = el('reference-images-container');
  if (!container) return;
  
  container.innerHTML = '';
  
  if (!images || images.length === 0) {
    container.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-secondary);font-size:13px;">
        📷 No reference images found
      </div>
    `;
    return;
  }
  
  images.forEach((img, index) => {
    const card = document.createElement('div');
    card.className = 'reference-image-card';
    
    const imgElement = document.createElement('img');
    imgElement.src = `data:${img.mime};base64,${img.data}`;
    imgElement.alt = `Reference ${index + 1}`;
    imgElement.loading = 'lazy';
    
    const label = document.createElement('div');
    label.className = 'ref-label';
    label.textContent = `#${index + 1}`;
    
    card.appendChild(imgElement);
    card.appendChild(label);
    container.appendChild(card);
  });
}

async function loadReferenceImages(poseId) {
  const container = el('reference-images-container');
  if (!container) return;
  
  container.innerHTML = `
    <div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-secondary);font-size:13px;">
      <div class="spinner" style="margin:0 auto 12px;"></div>
      Loading reference images...
    </div>
  `;
  
  try {
    const data = await apiRequest(`/api/pose/${poseId}/references`);
    
    if (data.references && data.references.length > 0) {
      displayReferenceImages(data.references);
    } else {
      container.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-secondary);font-size:13px;">
          📷 No reference images found
        </div>
      `;
    }
  } catch (error) {
    console.error('[YogaMate] Error loading reference images:', error);
    container.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-secondary);font-size:13px;">
        ❌ Error loading images
      </div>
    `;
  }
}

function refreshReferenceImages() {
  if (!STATE.selectedPose) {
    showToast('No pose selected');
    return;
  }
  loadReferenceImages(STATE.selectedPose.id);
}

// ─── Open Practice ───
function openPractice(poseId) {
  const pose = STATE.poses.find(p => p.id === poseId);
  if (!pose) {
    showToast('Pose not found');
    return;
  }
  
  STATE.selectedPose = pose;
  
  const titleEl = el('practice-pose-title');
  if (titleEl) titleEl.textContent = `Practice: ${pose.english || pose.name || pose.id}`;
  
  const artEl = el('practice-pose-art');
  if (artEl) artEl.textContent = pose.emoji || '🧘';
  
  const nameEl = el('practice-pose-name');
  if (nameEl) nameEl.textContent = pose.name || pose.id;
  
  const sanskritEl = el('practice-pose-sanskrit');
  if (sanskritEl) sanskritEl.textContent = pose.english || pose.id;
  
  const diffEl = el('practice-pose-difficulty');
  if (diffEl) {
    diffEl.textContent = pose.difficulty || 'Beginner';
    diffEl.className = `practice-pose-difficulty difficulty-${(pose.difficulty || 'beginner').toLowerCase()}`;
  }
  
  const benefits = pose.benefits || ['Practice this pose', 'Improve alignment', 'Build strength'];
  const steps = pose.steps || ['Position yourself in the pose', 'Hold the posture', 'Breathe deeply'];
  
  const benefitsEl = el('benefits-list');
  if (benefitsEl) benefitsEl.innerHTML = benefits.map(b => `<li>${b}</li>`).join('');
  
  const stepsEl = el('steps-list');
  if (stepsEl) stepsEl.innerHTML = steps.map(s => `<li>${s}</li>`).join('');
  
  loadReferenceImages(poseId);
  resetCameraUI();
  navigateTo('practice');
}

// ─── Navigation ───
function navigateTo(view) {
  $$('.view').forEach(v => v.classList.remove('active'));
  const target = el(`view-${view}`);
  if (target) target.classList.add('active');
  
  $$('.nav-item[data-view]').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  
  STATE.currentView = view;
  
  if (view === 'history') renderHistory();
  if (view === 'progress') renderProgress();
  if (view === 'home') {
    renderPoseGrid();
    renderFavorites();
    updateSearchResults();
  }
}

function goHome() {
  stopCamera();
  navigateTo('home');
}

function openAddPose() {
  resetAddPoseForm();
  navigateTo('add-pose');
  $$('.nav-item').forEach(el => el.classList.remove('active'));
}

// ─── Reset Add Pose Form ───
function resetAddPoseForm() {
  STATE.uploadedImages = [];
  STATE.generatedPose = null;
  STATE.isGenerating = false;
  removeFloatingSaveButton();
  
  const container = el('uploaded-images-container');
  if (container) container.innerHTML = '';
  
  const preview = el('generated-pose-preview');
  if (preview) preview.classList.add('hidden');
  
  const results = el('generation-results');
  if (results) results.classList.add('hidden');
  
  const btn = el('generate-pose-btn');
  if (btn) {
    btn.textContent = '✨ Generate Pose Reference';
    btn.disabled = true;
  }
  
  const progress = el('generation-progress');
  if (progress) {
    progress.classList.add('hidden');
    const bar = el('generation-progress-bar');
    if (bar) bar.style.width = '0%';
    const text = el('generation-progress-text');
    if (text) text.textContent = '';
  }
  
  const form = el('add-pose-form');
  if (form) form.reset();
  
  $$('.difficulty-pills .pill').forEach(p => p.classList.remove('active'));
  const beginnerPill = document.querySelector('.difficulty-pills .pill[data-diff="Beginner"]');
  if (beginnerPill) beginnerPill.classList.add('active');
  
  const progressEl = el('upload-progress');
  if (progressEl) progressEl.textContent = '0/5 uploaded';
  const statusEl = el('upload-status');
  if (statusEl) statusEl.textContent = 'Select images';
  const bar = document.querySelector('.upload-progress-bar');
  if (bar) bar.style.width = '0%';
}

// ─── Camera Management ───
async function startCamera() {
  if (!STATE.selectedPose) {
    showToast('Please select a pose first');
    return;
  }
  
  try {
    STATE.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: CONFIG.CAMERA_WIDTH },
        height: { ideal: CONFIG.CAMERA_HEIGHT },
        facingMode: 'user',
      },
      audio: false,
    });
  } catch (err) {
    showToast('Camera access denied. Please allow camera permission.', 'error');
    console.error('[Camera]', err);
    return;
  }
  
  const video = el('webcam-video');
  const canvas = el('webcam-canvas');
  if (!video || !canvas) return;
  
  video.srcObject = STATE.cameraStream;
  
  video.onloadedmetadata = () => {
    video.play();
    canvas.width = CONFIG.CAMERA_WIDTH;
    canvas.height = CONFIG.CAMERA_HEIGHT;
    
    el('camera-off-overlay').classList.add('hidden');
    el('score-overlay').classList.remove('hidden');
    el('live-badge').classList.remove('hidden');
    el('start-camera-btn').classList.add('hidden');
    el('stop-camera-btn').classList.remove('hidden');
    el('snapshot-btn').classList.remove('hidden');
    el('result-card').classList.remove('hidden');
    el('suggestions-panel').classList.remove('hidden');
    
    if (STATE.showFps) el('fps-badge').classList.remove('hidden');
    
    STATE.sessionStartTime = Date.now();
    STATE.sessionScores = [];
    
    if (STATE.animationFrameId) cancelAnimationFrame(STATE.animationFrameId);
    renderLoop();
    sendFrameToServer();
    STATE.liveLoopTimer = setInterval(sendFrameToServer, STATE.liveInterval);
    
    showToast('Camera started! 🎥');
  };
}

function stopCamera() {
  if (STATE.liveLoopTimer) {
    clearInterval(STATE.liveLoopTimer);
    STATE.liveLoopTimer = null;
  }
  if (STATE.animationFrameId) {
    cancelAnimationFrame(STATE.animationFrameId);
    STATE.animationFrameId = null;
  }
  if (STATE.cameraStream) {
    STATE.cameraStream.getTracks().forEach(t => t.stop());
    STATE.cameraStream = null;
  }
  
  const video = el('webcam-video');
  if (video) video.srcObject = null;
  
  el('live-badge').classList.add('hidden');
  el('fps-badge').classList.add('hidden');
  el('score-overlay').classList.add('hidden');
  el('camera-off-overlay').classList.remove('hidden');
  el('start-camera-btn').classList.remove('hidden');
  el('stop-camera-btn').classList.add('hidden');
  el('snapshot-btn').classList.add('hidden');
  el('suggestions-panel').classList.add('hidden');
  el('fullscreen-suggestions').style.display = 'none';
  
  STATE.currentLandmarks = null;
  
  if (STATE.sessionScores.length > 0) {
    showSessionSummary();
  }
  
  STATE.sessionStartTime = null;
}

function renderLoop() {
  if (!STATE.cameraStream) {
    STATE.animationFrameId = null;
    return;
  }
  
  const video = el('webcam-video');
  const canvas = el('webcam-canvas');
  if (!video || !canvas) {
    STATE.animationFrameId = requestAnimationFrame(renderLoop);
    return;
  }
  
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  ctx.save();
  if (STATE.mirrorEnabled) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.restore();
  
  if (STATE.currentLandmarks) {
    drawSkeleton(ctx, STATE.currentLandmarks, canvas.width, canvas.height, STATE.mirrorEnabled);
  }
  
  if (STATE.showFps) {
    const now = performance.now();
    const fps = Math.round(1000 / (now - STATE.lastFrameTime));
    STATE.lastFrameTime = now;
    const fpsBadge = el('fps-badge');
    if (fpsBadge) fpsBadge.textContent = `${fps} fps`;
  }
  
  STATE.animationFrameId = requestAnimationFrame(renderLoop);
}

function drawSkeleton(ctx, landmarks, width, height, mirror) {
  if (!landmarks || landmarks.length === 0) return;
  
  const scaleX = width;
  const scaleY = height;
  
  let color;
  if (STATE.currentScore >= 80) color = '#22C55E';
  else if (STATE.currentScore >= 65) color = '#F59E0B';
  else color = '#EF4444';
  
  const connections = [
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
    [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
    [24, 26], [26, 28], [11, 0], [12, 0]
  ];
  
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = color;
  
  connections.forEach(([i, j]) => {
    if (i < landmarks.length && j < landmarks.length) {
      const p1 = landmarks[i];
      const p2 = landmarks[j];
      
      let x1 = p1[0] * scaleX;
      let y1 = p1[1] * scaleY;
      let x2 = p2[0] * scaleX;
      let y2 = p2[1] * scaleY;
      
      if (mirror) {
        x1 = width - x1;
        x2 = width - x2;
      }
      
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  });
  
  landmarks.forEach((lm, index) => {
    let x = lm[0] * scaleX;
    let y = lm[1] * scaleY;
    
    if (mirror) x = width - x;
    
    const isMajor = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].includes(index);
    const radius = isMajor ? 5 : 3;
    
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  });
}

// ─── Send Frame to Server ───
async function sendFrameToServer() {
  if (!STATE.cameraStream || STATE.isAnalysing || !STATE.selectedPose) return;
  STATE.isAnalysing = true;
  
  const video = el('webcam-video');
  const canvas = el('webcam-canvas');
  if (!video || !canvas) {
    STATE.isAnalysing = false;
    return;
  }
  
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  
  const b64 = canvas.toDataURL('image/jpeg', CONFIG.SNAPSHOT_QUALITY);
  
  try {
    const data = await apiRequest('/api/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: b64, pose_id: STATE.selectedPose.id }),
    });
    
    if (data.error) {
      console.warn('[Live]', data.error);
      STATE.isAnalysing = false;
      return;
    }
    
    if (data.landmarks && data.landmarks.length > 0) {
      STATE.currentLandmarks = data.landmarks;
    }
    
    if (data.score !== undefined) {
      STATE.currentScore = data.score;
      STATE.currentStatus = data.status || '';
      STATE.currentSuggestions = data.suggestions || [];
      
      STATE.sessionScores.push(STATE.currentScore);
      STATE.scoreHistory.push(STATE.currentScore);
      if (STATE.scoreHistory.length > CONFIG.SCORE_HISTORY_LIMIT) {
        STATE.scoreHistory.shift();
      }
      
      const smoothedScore = Math.round(
        STATE.scoreHistory.reduce((a, b) => a + b, 0) / STATE.scoreHistory.length
      );
      
      updateLiveUI(smoothedScore, STATE.currentStatus, STATE.currentSuggestions);
      
      if (STATE.isFullscreen) {
        updateFullscreenSuggestions(STATE.currentSuggestions, smoothedScore);
      }
    }
  } catch (err) {
    console.error('[SendFrame]', err);
  } finally {
    STATE.isAnalysing = false;
  }
}

// ─── Update Live UI ───
function updateLiveUI(score, status, suggestions) {
  const overlayScore = el('overlay-score');
  const overlayStatus = el('overlay-status');
  
  let colour;
  if (score >= 80) colour = '#22C55E';
  else if (score >= 65) colour = '#F59E0B';
  else colour = '#EF4444';
  
  if (overlayScore) {
    overlayScore.textContent = `${score}%`;
    overlayScore.style.color = colour;
  }
  if (overlayStatus) {
    overlayStatus.textContent = status || '–';
    overlayStatus.style.color = colour;
  }
  
  const badge = el('result-badge');
  const scoreVal = el('score-value');
  const barFill = el('score-bar-fill');
  const suggList = el('suggestions-list');
  
  if (scoreVal) {
    scoreVal.textContent = `${score}%`;
    scoreVal.style.color = colour;
  }
  if (barFill) {
    barFill.style.width = `${score}%`;
    barFill.style.background = colour;
  }
  
  let level, badgeClass;
  if (score >= 80) {
    level = 'Excellent';
    badgeClass = 'badge-excellent';
  } else if (score >= 65) {
    level = 'Good';
    badgeClass = 'badge-good';
  } else {
    level = 'Needs Correction';
    badgeClass = 'badge-correction';
  }
  
  if (badge) {
    badge.textContent = level;
    badge.className = `result-badge ${badgeClass}`;
  }
  
  let displaySugg = suggestions;
  if (!displaySugg || displaySugg.length === 0) {
    if (score >= 80) displaySugg = ['🌟 Excellent posture!', 'Keep breathing deeply'];
    else if (score >= 65) displaySugg = ['Almost there!', 'Small adjustments needed'];
    else displaySugg = ['Focus on alignment', 'Practice this pose more'];
  }
  
  if (suggList) {
    suggList.innerHTML = displaySugg.slice(0, 4).map(s => `
      <li>
        <span class="suggestion-dot" style="background:${colour};"></span>
        ${s}
      </li>
    `).join('');
  }
  
  updateSuggestionsPanel(displaySugg, score);
}

function updateSuggestionsPanel(suggestions, score) {
  const panel = el('suggestions-panel');
  if (!panel) return;
  
  let colour;
  if (score >= 80) colour = '#22C55E';
  else if (score >= 65) colour = '#F59E0B';
  else colour = '#EF4444';
  
  let displaySugg = suggestions;
  if (!displaySugg || displaySugg.length === 0) {
    if (score >= 80) displaySugg = ['🌟 Excellent posture!', 'Keep it up!'];
    else if (score >= 65) displaySugg = ['Almost there!', 'Small adjustments'];
    else displaySugg = ['Keep practicing', 'Focus on alignment'];
  }
  
  panel.innerHTML = `
    <div class="suggestions-panel-header" style="border-bottom-color: ${colour};">
      <span style="font-weight:700;">💡 Pose Guidance</span>
      <span class="suggestions-score" style="color:${colour};font-weight:800;font-size:20px;">${score}%</span>
    </div>
    <div class="suggestions-panel-body">
      ${displaySugg.slice(0, 5).map((s, i) => `
        <div class="suggestion-item" style="border-left-color: ${colour};">
          <span class="suggestion-number">${i + 1}</span>
          <span class="suggestion-text">${s}</span>
        </div>
      `).join('')}
    </div>
    <div class="suggestions-panel-footer">
      💡 Follow these tips for better alignment
    </div>
  `;
}

function updateFullscreenSuggestions(suggestions, score) {
  const container = el('fullscreen-suggestions');
  if (!container) return;
  
  let colour;
  if (score >= 80) colour = '#22C55E';
  else if (score >= 65) colour = '#F59E0B';
  else colour = '#EF4444';
  
  let displaySugg = suggestions;
  if (!displaySugg || displaySugg.length === 0) {
    if (score >= 80) displaySugg = ['🌟 Excellent posture!', 'Keep it up!'];
    else if (score >= 65) displaySugg = ['Almost there!', 'Small adjustments'];
    else displaySugg = ['Keep practicing', 'Focus on alignment'];
  }
  
  container.innerHTML = `
    <div class="fs-title">💡 Pose Guidance</div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <span style="font-size:13px;color:rgba(255,255,255,0.7);">Accuracy</span>
      <span class="fs-score" style="color:${colour};">${score}%</span>
    </div>
    ${displaySugg.slice(0, 4).map(s => `
      <div class="fs-item">
        <span class="fs-bullet" style="background:${colour};"></span>
        ${s}
      </div>
    `).join('')}
  `;
}

// ─── Fullscreen ───
function toggleFullscreen() {
  const cameraPanel = document.querySelector('.camera-panel');
  if (!cameraPanel) return;
  
  if (!document.fullscreenElement) {
    cameraPanel.requestFullscreen().catch(err => console.warn('Fullscreen error:', err));
  } else {
    document.exitFullscreen();
  }
}

document.addEventListener('fullscreenchange', () => {
  STATE.isFullscreen = !!document.fullscreenElement;
  const btn = el('fullscreen-btn');
  if (btn) {
    btn.textContent = STATE.isFullscreen ? '⏹ Exit' : '⛶ Fullscreen';
  }
});

// ─── Snapshot ───
function takeSnapshot() {
  if (!STATE.cameraStream) {
    showToast('Start camera first', 'warning');
    return;
  }
  
  const canvas = el('webcam-canvas');
  if (!canvas) return;
  
  const dataUrl = canvas.toDataURL('image/png');
  const preview = el('snapshot-preview');
  const imgEl = el('snapshot-img');
  
  if (imgEl) imgEl.src = dataUrl;
  if (preview) preview.classList.remove('hidden');
  
  if (STATE.selectedPose && STATE.currentScore > 0) {
    saveHistory(STATE.selectedPose, STATE.currentScore);
    showToast('Snapshot saved 📸', 'success');
  } else {
    showToast('No pose data to save', 'warning');
  }
}

// ─── Save History ───
function saveHistory(pose, score) {
  const entry = {
    id: Date.now(),
    pose: pose.name || pose.id,
    english: pose.english || pose.id,
    emoji: pose.emoji || '🧘',
    score,
    date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
    time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    timestamp: new Date().toISOString(),
  };
  
  STATE.historyData.unshift(entry);
  if (STATE.historyData.length > CONFIG.HISTORY_LIMIT) {
    STATE.historyData = STATE.historyData.slice(0, CONFIG.HISTORY_LIMIT);
  }
  saveUserData();
  
  updateStreak();
  updatePracticeCount();
  checkAchievements(score);
  renderHistory();
  updateBadge();
}

function updateStreak() {
  const today = new Date().toDateString();
  const lastPractice = STATE.lastPracticeDate;
  
  if (lastPractice === today) return;
  
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();
  
  if (lastPractice === yesterdayStr) {
    STATE.streak += 1;
  } else {
    STATE.streak = 1;
  }
  
  STATE.lastPracticeDate = today;
  saveUserData();
}

function updatePracticeCount() {
  STATE.practiceCount += 1;
  saveUserData();
}

function showSessionSummary() {
  const scores = STATE.sessionScores;
  if (scores.length === 0) return;
  
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const max = Math.max(...scores);
  const duration = Math.round((Date.now() - STATE.sessionStartTime) / 1000);
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  const calories = Math.round((duration / 60) * 3.5);
  
  showToast(
    `Session Complete! 🎉 Avg: ${avg}% | Best: ${max}% | Duration: ${minutes}m ${seconds}s | ${calories} kcal`,
    'success',
    5000
  );
  
  const session = {
    date: new Date().toISOString(),
    avg,
    max,
    duration,
    calories,
    pose: STATE.selectedPose?.name || 'Unknown',
  };
  
  const sessions = JSON.parse(getUserLocalStorage('sessions') || '[]');
  sessions.unshift(session);
  if (sessions.length > 20) sessions.pop();
  setUserLocalStorage('sessions', JSON.stringify(sessions));
}

function checkAchievements(score) {
  const achievements = [];
  
  if (STATE.practiceCount === 1) {
    achievements.push({ id: 'first-practice', name: 'First Practice 🧘', icon: '🌟' });
  }
  if (score >= 95) {
    achievements.push({ id: 'perfect-pose', name: 'Perfect Pose ⭐', icon: '🏆' });
  }
  if (STATE.streak === 7) {
    achievements.push({ id: 'week-streak', name: '7 Day Streak 🔥', icon: '🔥' });
  }
  if (STATE.streak === 30) {
    achievements.push({ id: 'month-streak', name: '30 Day Streak 💪', icon: '💪' });
  }
  if (STATE.practiceCount === 10) {
    achievements.push({ id: 'ten-sessions', name: '10 Sessions 🎯', icon: '🎯' });
  }
  if (STATE.practiceCount === 100) {
    achievements.push({ id: 'hundred-sessions', name: '100 Sessions 🏅', icon: '🏅' });
  }
  
  const existing = STATE.achievements;
  const newAchievements = achievements.filter(a => !existing.some(e => e.id === a.id));
  
  if (newAchievements.length > 0) {
    STATE.achievements = [...existing, ...newAchievements];
    saveUserData();
    
    newAchievements.forEach(a => {
      showToast(`🏆 Achievement Unlocked: ${a.name}`, 'success', 4000);
    });
  }
}

// ─── Render History ───
function renderHistory() {
  const container = el('history-list');
  if (!container) return;
  
  if (!STATE.historyData.length) {
    container.innerHTML = `
      <div class="history-empty">
        <div style="font-size:48px;margin-bottom:16px;">📜</div>
        <h3 style="font-size:18px;margin-bottom:8px;">No practice sessions yet</h3>
        <p style="font-size:14px;color:var(--text-muted);">Select a pose, start the camera, and take a snapshot</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = STATE.historyData.map(entry => `
    <div class="history-item">
      <div class="history-emoji">${entry.emoji || '🧘'}</div>
      <div class="history-info">
        <div class="history-pose">${entry.pose}</div>
        <div class="history-meta">${entry.english} — ${entry.date} at ${entry.time}</div>
      </div>
      <div class="history-score" style="color:${entry.score >= 80 ? '#22C55E' : entry.score >= 65 ? '#F59E0B' : '#EF4444'}">
        ${entry.score}%
      </div>
    </div>
  `).join('');
}

function clearHistory() {
  if (!confirm('Clear all history?')) return;
  STATE.historyData = [];
  saveUserData();
  renderHistory();
  showToast('History cleared', 'warning');
}

function updateBadge() {
  const badge = el('history-badge');
  if (badge) badge.textContent = STATE.historyData.length;
}

// ─── Render Progress ───
function renderProgress() {
  const statsEl = el('progress-stats');
  const chartEl = el('chart-area');
  if (!statsEl || !chartEl) return;
  
  if (!STATE.historyData.length) {
    statsEl.innerHTML = `
      <div class="history-empty" style="grid-column:1/-1;">
        <div style="font-size:48px;margin-bottom:16px;">📊</div>
        <h3 style="font-size:18px;margin-bottom:8px;">No data yet</h3>
        <p style="font-size:14px;color:var(--text-muted);">Practice some poses to see your progress</p>
      </div>
    `;
    chartEl.innerHTML = '';
    return;
  }
  
  const scores = STATE.historyData.map(h => h.score);
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const best = Math.max(...scores);
  const total = STATE.historyData.length;
  
  const sessions = JSON.parse(getUserLocalStorage('sessions') || '[]');
  const totalDuration = sessions.reduce((sum, s) => sum + (s.duration || 0), 0);
  const hours = Math.floor(totalDuration / 3600);
  const minutes = Math.floor((totalDuration % 3600) / 60);
  const totalCalories = sessions.reduce((sum, s) => sum + (s.calories || 0), 0);
  
  statsEl.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Total Sessions</div>
      <div class="stat-value">${total}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Average Score</div>
      <div class="stat-value">${avg}<span class="stat-unit">%</span></div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Best Score</div>
      <div class="stat-value">${best}<span class="stat-unit">%</span></div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Day Streak</div>
      <div class="stat-value">${STATE.streak}<span class="stat-unit">d</span></div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total Time</div>
      <div class="stat-value">${hours}h ${minutes}m</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Calories Burned</div>
      <div class="stat-value">${totalCalories}<span class="stat-unit">kcal</span></div>
    </div>
  `;
  
  const recent = STATE.historyData.slice(0, 15).reverse();
  chartEl.innerHTML = recent.map((entry, i) => {
    const h = Math.round((entry.score / 100) * 140);
    return `
      <div class="chart-bar-wrap">
        <div class="chart-bar" style="height:${h}px;background:${entry.score >= 80 ? '#22C55E' : entry.score >= 65 ? '#F59E0B' : '#EF4444'};" 
             title="${entry.score}% - ${entry.pose}"></div>
        <div class="chart-bar-label">${i + 1}</div>
      </div>
    `;
  }).join('');
}

// ─── Custom Pose Generation ───
function handlePoseImageUpload(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;
  
  if (STATE.uploadedImages.length + files.length > CONFIG.REQUIRED_IMAGES) {
    showToast(`Please upload exactly ${CONFIG.REQUIRED_IMAGES} images`, 'warning');
    event.target.value = '';
    return;
  }
  
  for (const file of files) {
    if (STATE.uploadedImages.length >= CONFIG.REQUIRED_IMAGES) break;
    
    const reader = new FileReader();
    reader.onload = function(e) {
      STATE.uploadedImages.push({
        data: e.target.result,
        name: file.name,
        type: file.type,
      });
      
      renderUploadedImages();
      
      if (STATE.uploadedImages.length === CONFIG.REQUIRED_IMAGES) {
        showToast('All 5 images uploaded! Ready to generate pose 🎉', 'success');
        const btn = el('generate-pose-btn');
        if (btn) btn.disabled = false;
      }
    };
    reader.readAsDataURL(file);
  }
  
  event.target.value = '';
}

function renderUploadedImages() {
  const container = el('uploaded-images-container');
  if (!container) return;
  
  if (STATE.uploadedImages.length === 0) {
    container.innerHTML = `
      <div class="upload-placeholder" style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">
        No images uploaded yet
      </div>
    `;
    return;
  }
  
  container.innerHTML = STATE.uploadedImages.map((img, index) => `
    <div class="uploaded-image-card">
      <img src="${img.data}" alt="Upload ${index + 1}">
      <div class="uploaded-image-number">${index + 1}</div>
      <button class="remove-image-btn" onclick="removeUploadedImage(${index})">✕</button>
    </div>
  `).join('');
  
  const progress = el('upload-progress');
  if (progress) {
    progress.textContent = `${STATE.uploadedImages.length}/${CONFIG.REQUIRED_IMAGES} uploaded`;
    const bar = document.querySelector('.upload-progress-bar');
    if (bar) bar.style.width = `${(STATE.uploadedImages.length / CONFIG.REQUIRED_IMAGES) * 100}%`;
  }
  const status = el('upload-status');
  if (status) {
    status.textContent = STATE.uploadedImages.length === CONFIG.REQUIRED_IMAGES ? '✅ Complete!' : 'Upload more...';
  }
}

function removeUploadedImage(index) {
  STATE.uploadedImages.splice(index, 1);
  renderUploadedImages();
  
  const btn = el('generate-pose-btn');
  if (btn) {
    btn.disabled = STATE.uploadedImages.length < CONFIG.REQUIRED_IMAGES;
  }
}

async function generateCustomPose() {
  if (STATE.uploadedImages.length !== CONFIG.REQUIRED_IMAGES) {
    showToast(`Please upload exactly ${CONFIG.REQUIRED_IMAGES} images`, 'warning');
    return;
  }
  
  if (STATE.isGenerating) return;
  STATE.isGenerating = true;
  
  const progress = el('generation-progress');
  const progressBar = el('generation-progress-bar');
  const progressText = el('generation-progress-text');
  const progressPct = el('generation-progress-pct');
  const btn = el('generate-pose-btn');
  
  if (progress) progress.classList.remove('hidden');
  if (btn) {
    btn.textContent = '⏳ Generating...';
    btn.disabled = true;
  }
  
  const name = el('asana-name')?.value.trim();
  if (!name) {
    showToast('Please enter a pose name', 'error');
    STATE.isGenerating = false;
    if (btn) {
      btn.textContent = '✨ Generate Pose Reference';
      btn.disabled = false;
    }
    if (progress) progress.classList.add('hidden');
    return;
  }
  
  const category = el('asana-category')?.value || 'General';
  const difficulty = document.querySelector('.difficulty-pills .pill.active')?.dataset.diff || 'Beginner';
  
  if (progressText) progressText.textContent = 'Uploading images...';
  if (progressPct) progressPct.textContent = '20%';
  if (progressBar) progressBar.style.width = '20%';
  
  try {
    const formData = new FormData();
    formData.append('name', name);
    formData.append('category', category);
    formData.append('difficulty', difficulty);
    
    for (let i = 0; i < STATE.uploadedImages.length; i++) {
      const imgData = STATE.uploadedImages[i];
      const response = await fetch(imgData.data);
      const blob = await response.blob();
      const ext = imgData.name.split('.').pop() || 'jpg';
      formData.append(`image_${i}`, blob, `pose_${i+1}.${ext}`);
    }
    
    if (progressText) progressText.textContent = 'Generating pose reference...';
    if (progressPct) progressPct.textContent = '50%';
    if (progressBar) progressBar.style.width = '50%';
    
    const response = await fetch(`${CONFIG.API_BASE}/api/generate-pose`, {
      method: 'POST',
      body: formData,
    });
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.error || 'Generation failed');
    }
    
    if (result.error) {
      throw new Error(result.error);
    }
    
    if (progressText) progressText.textContent = 'Processing results...';
    if (progressPct) progressPct.textContent = '80%';
    if (progressBar) progressBar.style.width = '80%';
    
    STATE.generatedPose = result;
    showGenerationResults(result);
    
    if (progressText) progressText.textContent = '✅ Generation complete!';
    if (progressPct) progressPct.textContent = '100%';
    if (progressBar) progressBar.style.width = '100%';
    
    showToast(`Pose "${name}" generated successfully! 🎉`, 'success');
    
  } catch (error) {
    console.error('[GeneratePose]', error);
    showToast(`❌ Generation failed: ${error.message}`, 'error', 5000);
    
    if (progressText) progressText.textContent = '❌ Generation failed';
    if (progressPct) progressPct.textContent = 'Error';
    if (progressBar) {
      progressBar.style.width = '100%';
      progressBar.style.background = '#EF4444';
    }
  } finally {
    STATE.isGenerating = false;
    if (btn) {
      btn.textContent = '✨ Generate Pose Reference';
      btn.disabled = false;
    }
    
    setTimeout(() => {
      if (progress) progress.classList.add('hidden');
      if (progressBar) {
        progressBar.style.width = '0%';
        progressBar.style.background = '';
      }
      if (progressPct) progressPct.textContent = '0%';
    }, 3000);
  }
}

// ─── Floating Save Button ───
function createFloatingSaveButton() {
  removeFloatingSaveButton();
  const btn = document.createElement('button');
  btn.id = 'floating-save-btn';
  btn.textContent = '💾 Save Now';
  btn.style.cssText = `
    position: fixed;
    bottom: 30px;
    right: 30px;
    z-index: 9999;
    background: #22C55E;
    color: white;
    padding: 16px 32px;
    border: none;
    border-radius: 12px;
    font-size: 18px;
    font-weight: bold;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    transition: transform 0.2s;
  `;
  btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.05)'; });
  btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; });
  btn.addEventListener('click', saveGeneratedPose);
  document.body.appendChild(btn);
  STATE.floatingSaveBtn = btn;
}

function removeFloatingSaveButton() {
  if (STATE.floatingSaveBtn) {
    STATE.floatingSaveBtn.remove();
    STATE.floatingSaveBtn = null;
  }
  const existing = document.getElementById('floating-save-btn');
  if (existing) existing.remove();
}

function showGenerationResults(result) {
  console.log('🟢 showGenerationResults called with result:', result);
  const container = el('generation-results');
  const preview = el('generated-pose-preview');
  if (!container || !preview) {
    console.error('❌ Container or preview not found');
    return;
  }

  container.classList.remove('hidden');

  preview.innerHTML = `
    <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
      <div style="flex:1;min-width:200px;">
        <h3 style="font-size:18px;font-weight:700;">${result.pose_name || 'Generated Pose'}</h3>
        <div style="color:var(--text-secondary);font-size:14px;margin:4px 0;">
          ${result.category || 'General'} • ${result.difficulty || 'Beginner'}
        </div>
        <div style="display:flex;gap:16px;margin-top:12px;flex-wrap:wrap;">
          <div style="background:rgba(34,197,94,0.1);padding:6px 14px;border-radius:10px;border:1px solid rgba(34,197,94,0.1);">
            <span style="font-size:11px;color:var(--text-muted);">Similarity</span>
            <span style="font-size:16px;font-weight:700;color:#22C55E;">${(result.similarity * 100).toFixed(1)}%</span>
          </div>
          <div style="background:rgba(139,92,246,0.1);padding:6px 14px;border-radius:10px;border:1px solid rgba(139,92,246,0.1);">
            <span style="font-size:11px;color:var(--text-muted);">Samples</span>
            <span style="font-size:16px;font-weight:700;color:#A78BFA;">${result.sample_count || 5}</span>
          </div>
          <div style="background:rgba(245,158,11,0.1);padding:6px 14px;border-radius:10px;border:1px solid rgba(245,158,11,0.1);">
            <span style="font-size:11px;color:var(--text-muted);">Angles</span>
            <span style="font-size:16px;font-weight:700;color:#F59E0B;">${result.avg_angles?.length || 15}</span>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px;">
        <button 
          data-action="save-pose"
          onclick="saveGeneratedPose()"
          class="btn-primary" 
          style="font-size:13px;padding:10px 28px;">
          💾 Save Pose
        </button>
        <button 
          data-action="discard-pose"
          onclick="discardGeneratedPose()"
          class="btn-outline" 
          style="font-size:13px;padding:10px 20px;">
          Discard
        </button>
      </div>
    </div>
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.04);">
      <div style="font-size:12px;color:var(--text-muted);">📊 Generated Reference Angles</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
        ${result.avg_angles?.slice(0, 15).map((angle, i) => `
          <span class="angle-tag" style="background:rgba(255,255,255,0.03);padding:2px 8px;border-radius:4px;font-size:11px;color:var(--text-secondary);border:1px solid rgba(255,255,255,0.03);">
            J${i+1}: ${angle.toFixed(1)}°
          </span>
        `).join('')}
      </div>
    </div>
  `;

  // Event delegation (backup)
  preview.removeEventListener('click', handlePreviewClick);
  preview.addEventListener('click', handlePreviewClick);

  // Auto-scroll
  setTimeout(() => {
    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);

  // Floating save button
  createFloatingSaveButton();
  console.log('✅ Floating save button created');
}

function handlePreviewClick(e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'save-pose') {
    saveGeneratedPose();
  } else if (action === 'discard-pose') {
    discardGeneratedPose();
  }
}

async function saveGeneratedPose() {
  console.log('🔵 saveGeneratedPose called');

  if (!STATE.generatedPose) {
    showToast('No pose to save', 'error');
    console.warn('⚠️ STATE.generatedPose is null/undefined');
    return;
  }

  console.log('📦 Pose data:', STATE.generatedPose);

  const saveBtns = document.querySelectorAll('[data-action="save-pose"], #floating-save-btn');
  saveBtns.forEach(btn => {
    btn.disabled = true;
    btn.textContent = '⏳ Saving...';
  });

  try {
    const response = await fetch(`${CONFIG.API_BASE}/api/save-custom-pose`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-User-ID': STATE.currentUser ? STATE.currentUser.userId : '',
      },
      body: JSON.stringify({
        pose_id: STATE.generatedPose.pose_id,
        reference: STATE.generatedPose.reference,
        name: STATE.generatedPose.pose_name,
      }),
    });

    const result = await response.json();
    console.log('📥 Save response:', result);

    if (!response.ok) {
      throw new Error(result.error || 'Save failed');
    }

    if (result.success) {
      showToast(`✅ Pose "${STATE.generatedPose.pose_name}" saved!`, 'success', 4000);
      removeFloatingSaveButton();
      await fetchPoses();
      goHome();
      const searchInput = el('home-search-input');
      if (searchInput && STATE.generatedPose) {
        const poseName = STATE.generatedPose.pose_name || '';
        searchInput.value = poseName;
        STATE.searchQuery = poseName;
        performSearch(poseName);
        searchInput.focus();
      }
    } else {
      throw new Error(result.error || 'Unknown error');
    }
  } catch (error) {
    console.error('❌ Save error:', error);
    showToast(`❌ Save failed: ${error.message}`, 'error', 5000);
    saveBtns.forEach(btn => {
      btn.disabled = false;
      btn.textContent = btn.id === 'floating-save-btn' ? '💾 Save Now' : '💾 Retry Save';
    });
  }
}

function discardGeneratedPose() {
  STATE.generatedPose = null;
  const container = el('generation-results');
  if (container) container.classList.add('hidden');
  const preview = el('generated-pose-preview');
  if (preview) preview.innerHTML = '';
  removeFloatingSaveButton();
  showToast('Generation discarded', 'info');
}

// ─── Reset Camera UI ───
function resetCameraUI() {
  stopCamera();
  STATE.scoreHistory = [];
  STATE.currentLandmarks = null;
  
  el('result-card').classList.add('hidden');
  el('score-overlay').classList.add('hidden');
  el('live-badge').classList.add('hidden');
  el('fps-badge').classList.add('hidden');
  el('snapshot-preview').classList.add('hidden');
  el('camera-off-overlay').classList.remove('hidden');
  el('start-camera-btn').classList.remove('hidden');
  el('stop-camera-btn').classList.add('hidden');
  el('snapshot-btn').classList.add('hidden');
  el('suggestions-panel').classList.add('hidden');
  el('fullscreen-suggestions').style.display = 'none';
  
  const canvas = el('webcam-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

// ─── Setup ───
function setupNav() {
  $$('.nav-item[data-view]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const view = el.dataset.view;
      if (view === 'history') renderHistory();
      if (view === 'progress') renderProgress();
      if (view !== 'practice') stopCamera();
      navigateTo(view);
    });
  });
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (STATE.isFullscreen) {
        document.exitFullscreen();
      }
    }
    
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      if (e.key === ' ' && STATE.currentView === 'practice') {
        e.preventDefault();
        if (STATE.cameraStream) {
          stopCamera();
        } else {
          startCamera();
        }
      }
    }
    
    if (e.key === 's' && STATE.currentView === 'practice' && STATE.cameraStream) {
      e.preventDefault();
      takeSnapshot();
    }
  });
}

// ─── Initialize ───
document.addEventListener('DOMContentLoaded', () => {
  try {
    // Check if user is already logged in via session
    apiRequest('/api/me')
      .then(data => {
        if (data.user_id) {
          STATE.currentUser = { userId: data.user_id, name: data.name };
          loadUserData();
          showApp();
        } else {
          document.getElementById('login-overlay').style.display = 'flex';
        }
      })
      .catch(() => {
        document.getElementById('login-overlay').style.display = 'flex';
      });
    
    initAuthUI();
    setupSearch();
    setupNav();
    setupKeyboardShortcuts();
    
    console.log('[YogaMate] Initialized successfully 🧘');
  } catch (err) {
    console.error('[YogaMate] Startup error:', err);
    showToast('Error loading application', 'error');
  }
});

// ─── Expose Global Functions ───
window.startCamera = startCamera;
window.stopCamera = stopCamera;
window.takeSnapshot = takeSnapshot;
window.toggleFullscreen = toggleFullscreen;
window.toggleMirror = toggleMirror;
window.toggleFps = toggleFps;
window.toggleTheme = toggleTheme;
window.updateInterval = updateInterval;
window.selectDifficulty = selectDifficulty;
window.openPractice = openPractice;
window.openAddPose = openAddPose;
window.goHome = goHome;
window.handlePoseImageUpload = handlePoseImageUpload;
window.removeUploadedImage = removeUploadedImage;
window.generateCustomPose = generateCustomPose;
window.saveGeneratedPose = saveGeneratedPose;
window.discardGeneratedPose = discardGeneratedPose;
window.clearHistory = clearHistory;
window.refreshReferenceImages = refreshReferenceImages;
window.toggleFavorite = toggleFavorite;
window.resetAddPoseForm = resetAddPoseForm;
window.performSearch = performSearch;
window.updateSearchResults = updateSearchResults;
