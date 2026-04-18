(function () {
  const SESSION_KEY = 'tp_auth_session';
  let heartbeatTimer = null;
  let redirectingToLogin = false;

  function nowMs() { return Date.now(); }

  function parseJSON(raw) {
    try { return JSON.parse(raw || 'null'); } catch (_) { return null; }
  }

  function getAuthBase() {
    return String(window.AUTH_API_BASE || '').replace(/\/+$/, '');
  }

  function isNetworkError(err) {
    const msg = String(err && err.message ? err.message : '').toLowerCase();
    return msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed');
  }

  function createTimeoutSignal(timeoutMs) {
    if (typeof AbortController !== 'function') return null;
    const controller = new AbortController();
    const timer = setTimeout(function () {
      controller.abort();
    }, timeoutMs);
    return {
      signal: controller.signal,
      clear: function () { clearTimeout(timer); }
    };
  }

  async function wakeServer(base) {
    if (!base) return false;
    const timeoutMs = Number(window.AUTH_WAKE_TIMEOUT_MS || 70000);
    const endpoints = [base + '/health', base + '/api/wake-up'];

    for (const endpoint of endpoints) {
      const timeout = createTimeoutSignal(timeoutMs);
      try {
        await fetch(endpoint + '?ts=' + Date.now(), {
          method: 'GET',
          cache: 'no-store',
          signal: timeout ? timeout.signal : undefined
        });
        if (timeout) timeout.clear();
        return true;
      } catch (_) {
        if (timeout) timeout.clear();
      }
    }
    return false;
  }

  async function fetchWithWake(url, init) {
    try {
      return await fetch(url, init);
    } catch (err) {
      if (!isNetworkError(err)) throw err;

      const base = getAuthBase();
      await wakeServer(base);
      try {
        return await fetch(url, init);
      } catch (err2) {
        if (isNetworkError(err2)) {
          throw new Error('Servidor em hibernacao no Render. Aguarde ~1 minuto e tente novamente.');
        }
        throw err2;
      }
    }
  }

  async function prewarmAuthServer() {
    const base = getAuthBase();
    if (!base) return false;
    return wakeServer(base);
  }

  function getStoredSession() {
    return parseJSON(localStorage.getItem(SESSION_KEY));
  }

  function saveSession(data, remember) {
    const rememberDays = Number(window.AUTH_TTL_DAYS || 7);
    const shortHours = Number(window.AUTH_SHORT_TTL_HOURS || 12);
    const ttlMs = remember
      ? rememberDays * 24 * 60 * 60 * 1000
      : shortHours * 60 * 60 * 1000;

    const exp = nowMs() + ttlMs;
    const payload = {
      provider: 'fastapi',
      exp,
      token: data && data.token ? data.token : null,
      user: data && data.user ? data.user : null,
      allowedPages: Array.isArray(data && data.allowed_pages) ? data.allowed_pages : []
    };

    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
    return payload;
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function isLoginPage() {
    const path = window.location.pathname || '';
    return path.endsWith('/login.html') || path.endsWith('login.html');
  }

  function getCurrentPageFile() {
    const path = (window.location.pathname || '').split('/').filter(Boolean);
    const last = path.length ? path[path.length - 1] : 'index.html';
    if (!last || !last.includes('.')) return 'index.html';
    return last;
  }

  function isLoggedIn() {
    const session = getStoredSession();
    return !!(session && session.provider === 'fastapi' && session.token && session.exp && session.exp > nowMs());
  }

  function roleValue(raw) {
    const value = String(raw || '').toLowerCase().trim();
    if (value === 'developer' || value === 'desenvolvedor') return 'desenvolvedor';
    if (value === 'admin' || value === 'administrador') return 'administrador';
    return 'usuario';
  }

  function getCurrentRole(sessionObj) {
    const session = sessionObj || getStoredSession();
    return roleValue(session && session.user && session.user.role);
  }

  function canAccessPage(pageFile, sessionObj) {
    const session = sessionObj || getStoredSession();
    if (!session || !session.user) return false;

    const role = roleValue(session.user.role);
    if (role === 'desenvolvedor') return true;

    const allowed = Array.isArray(session.allowedPages) ? session.allowedPages : [];
    if (allowed.includes('*')) return true;
    return allowed.includes(pageFile);
  }

  function getNextFromUrl() {
    const params = new URLSearchParams(window.location.search || '');
    return params.get('next');
  }

  function buildLoginTarget() {
    const next = window.location.pathname + window.location.search + window.location.hash;
    return 'login.html?next=' + encodeURIComponent(next);
  }

  function forceRelogin() {
    if (isLoginPage() || redirectingToLogin) return;
    redirectingToLogin = true;
    stopHeartbeat();
    clearSession();
    window.location.replace(buildLoginTarget());
  }

  function getFallbackPage(session) {
    if (!session) return 'index.html';
    const role = roleValue(session.user && session.user.role);
    if (role === 'desenvolvedor') return 'index.html';

    const allowed = Array.isArray(session.allowedPages) ? session.allowedPages : [];
    const first = allowed.find((p) => typeof p === 'string' && p.endsWith('.html'));
    return first || 'index.html';
  }

  function requireAuth() {
    if (window.AUTH_DISABLED === true) return;
    if (isLoginPage()) return;

    const session = getStoredSession();
    if (!isLoggedIn()) {
      window.location.replace(buildLoginTarget());
      return;
    }

    const page = getCurrentPageFile();
    const role = getCurrentRole(session);

    if ((page === 'controle-usuarios.html' || page === 'controle-recargas-celular.html' || page === 'configuracoes-pix-dev.html') && role !== 'desenvolvedor') {
      window.location.replace(getFallbackPage(session));
      return;
    }

    if (!canAccessPage(page, session)) {
      window.location.replace(getFallbackPage(session));
    }
  }

  function getSessionProfile() {
    const session = getStoredSession();
    if (!isLoggedIn() || !session || !session.user) return null;

    const u = session.user;
    const fullName = String(u.name || '').trim();
    const labelName = fullName || u.email || u.phone || 'Usuario';
    const initials = labelName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join('') || 'U';

    return {
      name: labelName,
      email: u.email || '',
      group: roleValue(u.role),
      imageUrl: u.image_url || '',
      initials,
      allowedPages: Array.isArray(session.allowedPages) ? session.allowedPages : []
    };
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getRequestIdentity() {
    const session = getStoredSession();
    const user = session && session.user ? session.user : null;

    return {
      token: session && session.token ? session.token : null,
      userId: user && user.id ? user.id : null,
      email: user && user.email ? user.email : null,
      name: user && user.name ? user.name : null,
      role: user && user.role ? roleValue(user.role) : null
    };
  }

  function patchFetchWithUserHeaders() {
    if (window.__TP_FETCH_PATCHED__) return;
    if (typeof window.fetch !== 'function') return;
    const originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      const requestInit = init ? { ...init } : {};
      const headers = new Headers(requestInit.headers || {});
      const identity = getRequestIdentity();
      const base = getAuthBase();
      const rawRequestUrl = typeof input === 'string'
        ? input
        : (input && typeof input.url === 'string' ? input.url : '');
      let requestUrl = '';
      try {
        requestUrl = new URL(rawRequestUrl, window.location.href).toString();
      } catch (_) {
        requestUrl = rawRequestUrl;
      }
      const isBackendCall = !!(base && requestUrl && requestUrl.startsWith(base + '/'));

      if (isBackendCall) {
        if (identity.token) headers.set('Authorization', 'Bearer ' + identity.token);
        if (identity.userId) headers.set('X-User-Id', identity.userId);
        if (identity.email) headers.set('X-User-Email', identity.email);
        if (identity.name) headers.set('X-User-Name', identity.name);
        if (identity.role) headers.set('X-User-Role', identity.role);
      }
      requestInit.headers = headers;
      return originalFetch(input, requestInit).then(function (response) {
        const isAuthApiCall = !!(base && requestUrl && requestUrl.startsWith(base + '/auth/'));
        if (response && response.status === 401 && isAuthApiCall && !isLoginPage()) {
          forceRelogin();
        }
        return response;
      });
    };
    window.__TP_FETCH_PATCHED__ = true;
  }

  async function login(identifier, password, remember) {
    const base = getAuthBase();
    if (!base) throw new Error('AUTH_API_BASE nao configurada.');

    const response = await fetchWithWake(base + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload || !payload.success) {
      throw new Error(payload && payload.error ? payload.error : 'Falha no login.');
    }

    saveSession(payload.data, !!remember);
    startHeartbeat();
    return payload.data;
  }

  async function register(data) {
    const base = getAuthBase();
    if (!base) throw new Error('AUTH_API_BASE nao configurada.');

    const identity = getRequestIdentity();
    const headers = { 'Content-Type': 'application/json' };
    if (identity.token) headers.Authorization = 'Bearer ' + identity.token;

    const response = await fetchWithWake(base + '/auth/register', {
      method: 'POST',
      headers,
      body: JSON.stringify(data)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload || !payload.success) {
      throw new Error(payload && payload.error ? payload.error : 'Falha no cadastro.');
    }

    return payload.data;
  }

  async function refreshCurrentUser() {
    if (!isLoggedIn()) return null;

    const base = getAuthBase();
    const session = getStoredSession();
    if (!base || !session || !session.token) return null;

    try {
      const response = await fetchWithWake(base + '/auth/me', {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + session.token }
      });
      const payload = await response.json();
      if (!response.ok || !payload || !payload.success) return null;

      saveSession({
        token: session.token,
        user: payload.data.user,
        allowed_pages: payload.data.allowed_pages
      }, true);
      return payload.data;
    } catch (_) {
      return null;
    }
  }

  async function updateMyProfile(data) {
    if (!isLoggedIn()) throw new Error('Sessao expirada.');

    const base = getAuthBase();
    const session = getStoredSession();
    if (!base || !session || !session.token) throw new Error('AUTH_API_BASE nao configurada.');

    const response = await fetchWithWake(base + '/auth/me', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + session.token
      },
      body: JSON.stringify(data || {})
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload || !payload.success) {
      throw new Error(payload && payload.detail ? payload.detail : (payload && payload.error ? payload.error : 'Falha ao atualizar perfil.'));
    }

    const remember = session.exp && (session.exp - nowMs()) > (24 * 60 * 60 * 1000);
    saveSession({
      token: session.token,
      user: payload.data.user,
      allowed_pages: payload.data.allowed_pages
    }, remember);

    return payload.data;
  }

  async function pingPresence() {
    if (!isLoggedIn()) return false;
    const base = getAuthBase();
    const session = getStoredSession();
    if (!base || !session || !session.token) return false;
    try {
      const response = await fetch(base + '/auth/ping', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + session.token }
      });
      return !!response.ok;
    } catch (_) {
      return false;
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    if (!isLoggedIn()) return;
    const ms = Number(window.AUTH_HEARTBEAT_MS || 30000);
    pingPresence();
    heartbeatTimer = setInterval(function () {
      pingPresence();
    }, Math.max(10000, ms));
  }

  async function logout() {
    const base = getAuthBase();
    const session = getStoredSession();
    try {
      if (base && session && session.token) {
        await fetch(base + '/auth/logout', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + session.token }
        });
      }
    } catch (_) {
      // best effort
    } finally {
      stopHeartbeat();
      clearSession();
    }
  }

  function applyNavigationPermissions() {
    if (isLoginPage()) return;
    if (!isLoggedIn()) return;

    const session = getStoredSession();
    const role = roleValue(session && session.user && session.user.role);
    if (role === 'desenvolvedor') return;

    const links = document.querySelectorAll('a[href]');
    links.forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('http') || !href.includes('.html')) return;
      const file = href.split('?')[0].split('/').pop();
      if (!file) return;

      if (!canAccessPage(file, session) && !href.endsWith('login.html')) {
        a.style.display = 'none';
      }
    });
  }

  function standardizeSidebarMenu() {
    if (isLoginPage()) return;
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;

    const current = getCurrentPageFile();
    const session = getStoredSession();
    const role = getCurrentRole(session);
    const items = [
      { href: 'dashboard.html', icon: 'fas fa-chart-pie', label: 'Dashboard' },
      { href: 'index.html', icon: 'fas fa-users', label: 'Clientes' },
      { href: 'revendedores.html', icon: 'fas fa-user-tie', label: 'Revendedores' },
      { href: 'servidores.html', icon: 'fas fa-server', label: 'Servidores' },
      { href: 'mensagens.html', icon: 'fas fa-comment', label: 'Mensagens' },
      { href: 'precificacao.html', icon: 'fas fa-calculator', label: 'Precificacao' },
      { href: 'recebiveis.html', icon: 'fas fa-file-invoice-dollar', label: 'Recebiveis Ateli' },
      { href: 'dindin.html', icon: 'fas fa-sack-dollar', label: 'Dindin pra Receber' },
      { href: 'produtos-atelie.html', icon: 'fas fa-box-archive', label: 'Produtos Registrados' },
      { href: 'recarga-celular.html', icon: 'fas fa-mobile-screen-button', label: 'Recarga Celular' },
      { href: 'historico-compras.html', icon: 'fas fa-receipt', label: 'Historico Compras' },
      { href: 'historico-renovacoes.html', icon: 'fas fa-clock-rotate-left', label: 'Historico Renovacoes' },
      { href: 'configuracoes.html', icon: 'fas fa-sliders', label: 'Configuracoes' },
      { href: 'perfil-usuario.html', icon: 'fas fa-user-circle', label: 'Perfil do Usuario' },
      { href: 'controle-usuarios.html', icon: 'fas fa-user-shield', label: 'Controle de Usuarios', devOnly: true },
      { href: 'controle-recargas-celular.html', icon: 'fas fa-sim-card', label: 'Controle Recargas', devOnly: true },
      { href: 'configuracoes-pix-dev.html', icon: 'fas fa-qrcode', label: 'Configuracoes PIX (Dev)', devOnly: true }
    ];

    nav.innerHTML = '';
    const section = document.createElement('div');
    section.className = 'nav-section-title';
    section.textContent = 'Menu';
    nav.appendChild(section);

    items.forEach((item) => {
      if (item.devOnly && role !== 'desenvolvedor') return;
      const a = document.createElement('a');
      const isActive = current === item.href;
      a.href = item.href;
      a.className = 'nav-item' + (isActive ? ' active' : '') + (item.devOnly ? ' tp-dev-sidebar-link' : '');
      a.innerHTML = `<i class="${item.icon}"></i><span>${item.label}</span>`;
      nav.appendChild(a);
    });
  }

  function setupSidebarMobileToggle() {
    if (isLoginPage()) return;
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    if (!document.getElementById('tpSidebarMobileStyle')) {
      const style = document.createElement('style');
      style.id = 'tpSidebarMobileStyle';
      style.textContent = `
        /* baseline shared sidebar look to avoid unstyled links in new pages */
        .sidebar-nav .nav-item { display:flex; align-items:center; gap:12px; padding:12px 14px; margin-bottom:6px; border-radius:12px; color:#a1a1aa; text-decoration:none; font-weight:600; border:1px solid transparent; transition:all .2s ease; }
        .sidebar-nav .nav-item i { width:18px; text-align:center; color:#9ca3af; }
        .sidebar-nav .nav-item:hover { color:#fff; background:rgba(255,255,255,.06); border-color:rgba(255,255,255,.10); }
        .sidebar-nav .nav-item.active { color:#111; background:#f5b915; border-color:#f5b915; box-shadow:0 6px 18px rgba(245,185,21,.22); }
        .sidebar-nav .nav-item.active i { color:#111; }
        .sidebar-nav .nav-section-title { margin:6px 10px 12px; color:#8f95a3; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; }

        .tp-sidebar-toggle { display:none; position:fixed; top:12px; left:12px; z-index:1300; width:42px; height:42px; border-radius:10px; border:1px solid rgba(255,255,255,.2); background:#11131c; color:#fff; font-size:18px; }
        .tp-sidebar-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:1199; }
        @media (max-width: 960px) {
          .tp-sidebar-toggle { display:flex; align-items:center; justify-content:center; }
          body { overflow-x:hidden; }
          .sidebar {
            position:fixed !important;
            top:0 !important;
            left:0 !important;
            height:100vh !important;
            width:280px !important;
            max-width:84vw !important;
            transform:translateX(-100%) !important;
            transition:transform .25s ease;
            z-index:1200;
          }
          body.tp-sidebar-open .sidebar { transform:translateX(0); }
          body.tp-sidebar-open .tp-sidebar-overlay { display:block; }
          .main, .main-content, main.main-content {
            margin-left:0 !important;
            width:100% !important;
            max-width:100% !important;
          }
          .main { padding-top:72px !important; }
          .main-content, main.main-content { padding-top:72px !important; padding-left:14px !important; padding-right:14px !important; }
          .main .main-content { padding-top:12px !important; }

          .main-content table { display:block; width:100%; overflow-x:auto; white-space:nowrap; }
          .main-content .stats-grid,
          .main-content .cards-grid,
          .main-content .overview-grid,
          .main-content .summary-grid { grid-template-columns:1fr !important; }
          .main-content .header,
          .main-content .page-header,
          .main-content .toolbar { flex-wrap:wrap; gap:10px; }
        }
      `;
      document.head.appendChild(style);
    }

    let toggle = document.getElementById('tpSidebarToggle');
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.id = 'tpSidebarToggle';
      toggle.className = 'tp-sidebar-toggle';
      toggle.type = 'button';
      toggle.setAttribute('aria-label', 'Abrir menu');
      toggle.innerHTML = '&#9776;';
      document.body.appendChild(toggle);
    }

    let overlay = document.getElementById('tpSidebarOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'tpSidebarOverlay';
      overlay.className = 'tp-sidebar-overlay';
      document.body.appendChild(overlay);
    }

    const closeMenu = function () { document.body.classList.remove('tp-sidebar-open'); };
    const openMenu = function () { document.body.classList.add('tp-sidebar-open'); };

    toggle.onclick = function () {
      if (document.body.classList.contains('tp-sidebar-open')) closeMenu();
      else openMenu();
    };
    overlay.onclick = closeMenu;

    document.querySelectorAll('.sidebar .nav-item').forEach((item) => {
      item.addEventListener('click', function () {
        if (window.innerWidth <= 960) closeMenu();
      });
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth > 960) closeMenu();
    });
  }

  function mountDeveloperSidebarLink() {
    if (isLoginPage()) return;
    if (!isLoggedIn()) return;

    const session = getStoredSession();
    const role = getCurrentRole(session);
    const existing = document.querySelector('.tp-dev-sidebar-link');

    if (role !== 'desenvolvedor') {
      if (existing) existing.remove();
      return;
    }

    if (existing) return;

    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;

    const anchor = document.createElement('a');
    anchor.href = 'controle-usuarios.html';
    anchor.className = 'nav-item tp-dev-sidebar-link';
    anchor.innerHTML = '<i class="fas fa-user-shield"></i><span>Controle de Usuarios</span>';

    const current = getCurrentPageFile();
    if (current === 'controle-usuarios.html') {
      anchor.classList.add('active');
    }

    nav.appendChild(anchor);
  }

  function ensureMenuStyles() {
    if (document.getElementById('tpUserMenuStyle')) return;
    const style = document.createElement('style');
    style.id = 'tpUserMenuStyle';
    style.textContent = `
      .tp-user-menu { position: fixed; top: 12px; right: 14px; z-index: 9999; font-family: Inter, sans-serif; }
      .tp-user-menu-btn { display:flex; align-items:center; gap:10px; border:1px solid rgba(255,255,255,.18); background: rgba(10,10,11,.92); color:#fafafa; border-radius:12px; padding:8px 10px; min-width:220px; cursor:pointer; }
      .tp-user-avatar { width:34px; height:34px; border-radius:50%; background:#fbbf24; color:#111; display:flex; align-items:center; justify-content:center; font-weight:800; overflow:hidden; flex-shrink:0; }
      .tp-user-avatar img { width:100%; height:100%; object-fit:cover; display:block; }
      .tp-user-meta { line-height:1.25; min-width:0; flex:1; text-align:left; }
      .tp-user-name { font-size:13px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .tp-user-group { font-size:11px; color:#a1a1aa; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-transform:capitalize; }
      .tp-user-caret { color:#a1a1aa; font-size:12px; }
      .tp-user-dropdown { display:none; position:absolute; top:calc(100% + 8px); right:0; width:290px; border-radius:12px; border:1px solid rgba(255,255,255,.14); background:#10131c; box-shadow:0 16px 34px rgba(0,0,0,.4); overflow:hidden; }
      .tp-user-menu.open .tp-user-dropdown { display:block; }
      .tp-user-profile { padding:12px; border-bottom:1px solid rgba(255,255,255,.08); }
      .tp-user-profile .tp-user-name { font-size:14px; }
      .tp-user-profile .tp-user-email { color:#a1a1aa; font-size:12px; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .tp-user-profile .tp-user-group { margin-top:6px; font-size:12px; color:#fbbf24; font-weight:600; }
      .tp-user-pages { margin-top:8px; color:#a1a1aa; font-size:11px; }
      .tp-user-actions a, .tp-user-actions button { width:100%; border:0; border-top:1px solid rgba(255,255,255,.06); background:transparent; color:#fafafa; text-decoration:none; text-align:left; padding:11px 12px; cursor:pointer; font-size:13px; display:block; }
      .tp-user-actions a:hover, .tp-user-actions button:hover { background:rgba(255,255,255,.06); }
      @media (max-width: 960px) {
        .tp-user-menu { top:12px; right:12px; left:62px; max-width:calc(100vw - 74px); }
        .tp-user-menu-btn { min-width:0; width:100%; max-width:100%; padding:8px 9px; }
        .tp-user-name { font-size:12px; }
        .tp-user-group { font-size:10px; }
        .tp-user-dropdown { width:min(92vw, 320px); right:0; }
      }
    `;
    document.head.appendChild(style);
  }

  function mountUserMenu() {
    if (isLoginPage()) return;
    if (window.AUTH_DISABLED === true) return;
    if (document.getElementById('tpUserMenu')) return;

    const profile = getSessionProfile();
    if (!profile) return;

    ensureMenuStyles();

    const menu = document.createElement('div');
    menu.id = 'tpUserMenu';
    menu.className = 'tp-user-menu';

    const avatarHtml = profile.imageUrl
      ? `<img src="${escapeHtml(profile.imageUrl)}" alt="Foto do usuario">`
      : `<span>${escapeHtml(profile.initials)}</span>`;

    const allowedPreview = profile.group === 'desenvolvedor'
      ? 'Acesso total'
      : (profile.allowedPages.slice(0, 5).join(', ') || 'Sem paginas liberadas');

    const devLink = profile.group === 'desenvolvedor'
      ? '<a href="controle-usuarios.html">Controle de usuarios</a><a href="controle-recargas-celular.html">Controle recargas</a><a href="configuracoes-pix-dev.html">Configuracoes PIX (Dev)</a>'
      : '';

    menu.innerHTML = `
      <button type="button" class="tp-user-menu-btn" id="tpUserMenuBtn" aria-haspopup="menu" aria-expanded="false">
        <span class="tp-user-avatar">${avatarHtml}</span>
        <span class="tp-user-meta">
          <span class="tp-user-name">${escapeHtml(profile.name)}</span>
          <span class="tp-user-group">Grupo: ${escapeHtml(profile.group)}</span>
        </span>
        <span class="tp-user-caret">&#9662;</span>
      </button>
      <div class="tp-user-dropdown" id="tpUserMenuDropdown">
        <div class="tp-user-profile">
          <div class="tp-user-name">${escapeHtml(profile.name)}</div>
          <div class="tp-user-email">${escapeHtml(profile.email || 'Sem e-mail')}</div>
          <div class="tp-user-group">Nivel: ${escapeHtml(profile.group)}</div>
          <div class="tp-user-pages">Paginas: ${escapeHtml(allowedPreview)}</div>
        </div>
        <div class="tp-user-actions">
          ${devLink}
          <a href="perfil-usuario.html">Perfil do usuario</a>
          <a href="configuracoes.html">Configuracoes</a>
          <button type="button" id="tpUserLogoutBtn">Sair</button>
        </div>
      </div>
    `;

    document.body.appendChild(menu);

    const btn = document.getElementById('tpUserMenuBtn');
    const logoutBtn = document.getElementById('tpUserLogoutBtn');

    btn.addEventListener('click', function () {
      const isOpen = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(isOpen));
    });

    document.addEventListener('click', function (event) {
      if (!menu.contains(event.target)) {
        menu.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });

    logoutBtn.addEventListener('click', async function () {
      await logout();
      window.location.replace('login.html');
    });
  }

  function refreshUserMenu() {
    const menu = document.getElementById('tpUserMenu');
    if (menu) menu.remove();
    mountUserMenu();
  }

  window.requireAuth = requireAuth;
  window.authIsLoggedIn = isLoggedIn;
  window.authGetNext = getNextFromUrl;
  window.authSetSession = saveSession;
  window.authClearSession = function () {
    stopHeartbeat();
    clearSession();
  };
  window.authLogout = logout;
  window.authGetSessionProfile = getSessionProfile;
  window.authLogin = login;
  window.authRegister = register;
  window.authRefreshCurrentUser = refreshCurrentUser;
  window.authUpdateMyProfile = updateMyProfile;
  window.authPrewarm = prewarmAuthServer;
  window.authRefreshUserMenu = refreshUserMenu;

  patchFetchWithUserHeaders();

  document.addEventListener('DOMContentLoaded', function () {
    requireAuth();
    standardizeSidebarMenu();
    setupSidebarMobileToggle();
    startHeartbeat();
    applyNavigationPermissions();
    mountDeveloperSidebarLink();
    mountUserMenu();
  });
})();

