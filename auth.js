(function () {
  const SESSION_KEY = 'tp_auth_session';
  const PUBLIC_PAGE_FILES = new Set(['marketplace.html', 'recarga-celular.html', 'reset-password.html', 'forgot-password.html']);
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
          throw new Error('Servidor em hibernação no Render. Aguarde ~1 minuto e tente novamente.');
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
    return path.endsWith('/login.html')
      || path.endsWith('login.html')
      || path.endsWith('/forgot-password.html')
      || path.endsWith('forgot-password.html')
      || path.endsWith('/reset-password.html')
      || path.endsWith('reset-password.html');
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

  const MENU_ITEMS = [
    { href: 'dashboard.html', icon: 'fas fa-chart-pie', label: 'Dashboard', inSidebar: true },
    { href: 'index.html', icon: 'fas fa-users', label: 'Clientes', inSidebar: true },
    { href: 'revendedores.html', icon: 'fas fa-user-tie', label: 'Revendedores', inSidebar: true },
    { href: 'servidores.html', icon: 'fas fa-server', label: 'Servidores', inSidebar: true },
    { href: 'mensagens.html', icon: 'fas fa-comment', label: 'Mensagens', inSidebar: true },
    { href: 'precificacao.html', icon: 'fas fa-calculator', label: 'Precificação', inSidebar: true },
    { href: 'recebiveis.html', icon: 'fas fa-file-invoice-dollar', label: 'Recebíveis Ateliê', inSidebar: true },
    { href: 'dindin.html', icon: 'fas fa-sack-dollar', label: 'Dindin pra Receber', inSidebar: true },
    { href: 'produtos-atelie.html', icon: 'fas fa-box-archive', label: 'Produtos Registrados', inSidebar: true },
    { href: 'recarga-celular.html', icon: 'fas fa-mobile-screen-button', label: 'Recarga Celular', inSidebar: true },
    { href: 'marketplace.html', icon: 'fas fa-store', label: 'Marketplace', inSidebar: true },
    { href: 'historico-renovacoes.html', icon: 'fas fa-clock-rotate-left', label: 'Histórico Renovações', inSidebar: true },
    { href: 'configuracoes.html', icon: 'fas fa-sliders', label: 'Configurações', inSidebar: true, inUserMenu: true },
    { href: 'historico-compras.html', icon: 'fas fa-receipt', label: 'Histórico de compras', inUserMenu: true },
    { href: 'perfil-usuario.html', icon: 'fas fa-user-circle', label: 'Perfil do usuário', inUserMenu: true },
    { href: 'controle-usuarios.html', icon: 'fas fa-user-shield', label: 'Controle de usuários', devOnly: true, inUserMenu: true },
    { href: 'controle-recargas-celular.html', icon: 'fas fa-sim-card', label: 'Controle recargas', devOnly: true, inUserMenu: true },
    { href: 'configuracoes-pix-dev.html', icon: 'fas fa-qrcode', label: 'Configurações PIX (Dev)', devOnly: true, inUserMenu: true },
    { href: 'configuracoes-marketplace-dev.html', icon: 'fas fa-store-slash', label: 'Configurações marketplace (Dev)', devOnly: true, inUserMenu: true },
    { href: 'pedidos-marketplace-dev.html', icon: 'fas fa-bag-shopping', label: 'Pedidos marketplace (Dev)', devOnly: true, inUserMenu: true },
    { href: 'usuarios-online-dev.html', icon: 'fas fa-signal', label: 'Usuários online (Dev)', devOnly: true, inUserMenu: true }
  ];

  function pageFileFromHref(href) {
    return String(href || '').split('?')[0].split('/').pop();
  }

  function isMenuItemVisible(item, session, role) {
    if (!item || !item.href) return false;
    if (item.devOnly && role !== 'desenvolvedor') return false;
    if (role === 'desenvolvedor') return true;
    const pageFile = pageFileFromHref(item.href);
    return !!(pageFile && canAccessPage(pageFile, session));
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
    if (!session) return 'marketplace.html';
    const role = roleValue(session.user && session.user.role);
    if (role === 'desenvolvedor') return 'marketplace.html';

    const allowed = Array.isArray(session.allowedPages) ? session.allowedPages : [];
    if (allowed.includes('marketplace.html')) return 'marketplace.html';
    const first = allowed.find((p) => typeof p === 'string' && p.endsWith('.html'));
    return first || 'marketplace.html';
  }

  function requireAuth() {
    if (window.AUTH_DISABLED === true) return;
    if (isLoginPage()) return;
    const page = getCurrentPageFile();
    if (PUBLIC_PAGE_FILES.has(page)) return;

    const session = getStoredSession();
    if (!isLoggedIn()) {
      window.location.replace('marketplace.html');
      return;
    }

    const role = getCurrentRole(session);

    if ((page === 'controle-usuarios.html'
      || page === 'controle-recargas-celular.html'
      || page === 'configuracoes-pix-dev.html'
      || page === 'configuracoes-marketplace-dev.html'
      || page === 'pedidos-marketplace-dev.html'
      || page === 'usuarios-online-dev.html') && role !== 'desenvolvedor') {
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
    const labelName = fullName || u.email || u.phone || 'Usuário';
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
    if (!base) throw new Error('AUTH_API_BASE não configurada.');

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
    if (!base) throw new Error('AUTH_API_BASE não configurada.');

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

  async function requestPasswordReset(identifier) {
    const base = getAuthBase();
    if (!base) throw new Error('AUTH_API_BASE não configurada.');
    const email = String(identifier || '').trim();
    const paths = ['/auth/password/forgot', '/api/auth/password/forgot', '/password/forgot', '/api/password/forgot'];
    let lastPayload = null;
    let lastStatus = 0;
    for (const path of paths) {
      const response = await fetchWithWake(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, identifier: email })
      });
      const payload = await response.json().catch(() => ({}));
      lastPayload = payload;
      lastStatus = Number(response.status || 0);
      if (response.ok && payload && payload.success) {
        return payload.data || {};
      }
      if (lastStatus !== 404) break;
    }
    throw new Error(lastPayload && lastPayload.detail
      ? lastPayload.detail
      : (lastPayload && lastPayload.error
        ? lastPayload.error
        : 'Falha ao solicitar recuperação de senha.'));
  }

  async function resetPasswordWithCode(identifier, code, newPassword) {
    const base = getAuthBase();
    if (!base) throw new Error('AUTH_API_BASE não configurada.');
    const paths = ['/auth/password/reset', '/api/auth/password/reset', '/password/reset', '/api/password/reset'];
    let lastPayload = null;
    let lastStatus = 0;
    for (const path of paths) {
      const response = await fetchWithWake(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: String(identifier || '').trim(),
          code: String(code || '').trim(),
          new_password: String(newPassword || '')
        })
      });
      const payload = await response.json().catch(() => ({}));
      lastPayload = payload;
      lastStatus = Number(response.status || 0);
      if (response.ok && payload && payload.success) {
        return payload.data || {};
      }
      if (lastStatus !== 404) break;
    }
    throw new Error(lastPayload && lastPayload.detail
      ? lastPayload.detail
      : (lastPayload && lastPayload.error
        ? lastPayload.error
        : 'Falha ao redefinir senha.'));
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
    if (!base || !session || !session.token) throw new Error('AUTH_API_BASE não configurada.');

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
    if (!isLoggedIn()) {
      nav.innerHTML = '';
      return;
    }

    const session = getStoredSession();
    const role = getCurrentRole(session);
    nav.innerHTML = '';
    const section = document.createElement('div');
    section.className = 'nav-section-title';
    section.textContent = 'Menu';
    nav.appendChild(section);

    MENU_ITEMS.forEach((item) => {
      if (!item.inSidebar) return;
      if (!isMenuItemVisible(item, session, role)) return;
      const a = document.createElement('a');
      const isActive = current === item.href;
      a.href = item.href;
      a.className = 'nav-item' + (isActive ? ' active' : '');
      a.innerHTML = `<i class="${item.icon}"></i><span>${item.label}</span>`;
      nav.appendChild(a);
    });
  }

  function setupSidebarMobileToggle() {
    if (isLoginPage()) return;
    if (!isLoggedIn()) return;
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    document.body.classList.remove('tp-sidebar-collapsed');
    try { localStorage.removeItem('tp_sidebar_collapsed'); } catch (_) {}
    const oldCollapseBtn = document.getElementById('tpSidebarCollapseBtn');
    if (oldCollapseBtn) oldCollapseBtn.remove();
    document.querySelectorAll('.tp-sidebar-collapse-btn,[aria-label*="menu lateral"],[title*="menu"]').forEach(function (el) {
      if (el && el.classList && el.classList.contains('tp-sidebar-toggle')) return;
      if (!el || !el.closest || !el.closest('.sidebar')) return;
      const txt = String(el.textContent || '').trim();
      if (el.classList.contains('tp-sidebar-collapse-btn') || txt === '<<' || txt === '>>' || txt === '«' || txt === '»') {
        el.remove();
      }
    });

    if (!document.getElementById('tpSidebarMobileStyle')) {
      const style = document.createElement('style');
      style.id = 'tpSidebarMobileStyle';
      style.textContent = `
        /* baseline shared sidebar look to avoid unstyled links in new pages */
        .sidebar { transition: width .25s ease, transform .25s ease; }
        .sidebar-nav .nav-item { display:flex; align-items:center; gap:12px; padding:12px 14px; margin-bottom:6px; border-radius:12px; color:#a1a1aa; text-decoration:none; font-weight:600; border:1px solid transparent; transition:all .2s ease; }
        .sidebar-nav .nav-item i { width:18px; text-align:center; color:#9ca3af; transition: transform .2s ease, color .2s ease, filter .2s ease; }
        .sidebar-nav .nav-item span { transition: opacity .2s ease, transform .2s ease; white-space: nowrap; }
        .sidebar-nav .nav-item:hover { color:#fff; background:rgba(255,255,255,.06); border-color:rgba(255,255,255,.10); }
        .sidebar-nav .nav-item:hover i { transform: translateY(-1px) scale(1.14) rotate(-6deg); color:#f5b915; filter: drop-shadow(0 0 8px rgba(245,185,21,.35)); }
        .sidebar-nav .nav-item.active { color:#111; background:#f5b915; border-color:#f5b915; box-shadow:0 6px 18px rgba(245,185,21,.22); }
        .sidebar-nav .nav-item.active i { color:#111; }
        .sidebar-nav .nav-section-title { margin:6px 10px 12px; color:#8f95a3; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; }


        .tp-sidebar-toggle { display:none; position:fixed; top:12px; left:12px; z-index:2147483600; width:42px; height:42px; border-radius:10px; border:1px solid rgba(255,255,255,.2); background:#11131c; color:#fff; font-size:18px; }
        .tp-sidebar-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:2147483500; pointer-events:none; }
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
            transform:translateX(-108%) !important;
            transition:transform .25s ease;
            z-index:2147483550 !important;
            visibility:hidden !important;
            pointer-events:none !important;
            overflow-y:auto !important;
            -webkit-overflow-scrolling: touch;
          }
          body.tp-sidebar-open .sidebar,
          .sidebar.open {
            transform:translateX(0) !important;
            left:0 !important;
            visibility:visible !important;
            pointer-events:auto !important;
          }
          .sidebar a,
          .sidebar button,
          .sidebar .nav-item {
            pointer-events: auto !important;
            touch-action: manipulation;
          }
          .sidebar-nav {
            touch-action: pan-y;
          }
          .sidebar-nav {
            position: relative;
            z-index: 2147483551;
          }
          .sidebar .nav-item {
            position: relative;
            z-index: 2147483552;
            padding-top: 14px;
            padding-bottom: 14px;
            margin-bottom: 8px;
          }
          body.tp-sidebar-open .main,
          body.tp-sidebar-open .main-content,
          body.tp-sidebar-open main.main-content {
            pointer-events: none !important;
            user-select: none;
          }
          body.tp-sidebar-open .sidebar,
          body.tp-sidebar-open .tp-sidebar-toggle,
          body.tp-sidebar-open .tp-sidebar-overlay {
            pointer-events: auto !important;
          }
          body.tp-sidebar-open .tp-user-menu {
            display: none !important;
          }
          body.tp-sidebar-open .tp-sidebar-overlay {
            display:block;
            pointer-events:auto;
            left:min(84vw, 280px);
          }
          body.tp-sidebar-open { overflow:hidden; }
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

    const closeMenu = function () {
      document.body.classList.remove('tp-sidebar-open');
      sidebar.classList.remove('open');
    };
    const openMenu = function () {
      document.body.classList.add('tp-sidebar-open');
      sidebar.classList.add('open');
    };

    let lastTouchToggleTs = 0;
    const toggleMenu = function (event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      if (document.body.classList.contains('tp-sidebar-open')) closeMenu();
      else openMenu();
    };
    const onToggleTouchStart = function (event) {
      lastTouchToggleTs = Date.now();
      toggleMenu(event);
    };
    const onToggleClick = function (event) {
      // Em mobile, apos touchstart o navegador pode disparar click sintetico.
      // Ignora esse click para não alternar duas vezes (abre e fecha).
      if ((Date.now() - lastTouchToggleTs) < 500) return;
      toggleMenu(event);
    };

    toggle.onclick = onToggleClick;
    toggle.addEventListener('touchstart', onToggleTouchStart, { passive: false });
    overlay.onclick = closeMenu;

    const sidebarTouchState = {
      startX: 0,
      startY: 0,
      moved: false,
      startedOnItem: null
    };
    let lastTouchNavTs = 0;
    let lastTouchNavHref = '';
    const sidebarTapMoveThreshold = 10;
    const resetSidebarTouchState = function () {
      sidebarTouchState.startX = 0;
      sidebarTouchState.startY = 0;
      sidebarTouchState.moved = false;
      sidebarTouchState.startedOnItem = null;
    };
    const onSidebarTouchStart = function (event) {
      if (window.innerWidth > 960) return;
      const touch = event.touches && event.touches[0];
      if (!touch) return;
      sidebarTouchState.startX = touch.clientX;
      sidebarTouchState.startY = touch.clientY;
      sidebarTouchState.moved = false;
      sidebarTouchState.startedOnItem = event.target && event.target.closest ? event.target.closest('.sidebar .nav-item') : null;
    };
    const onSidebarTouchMove = function (event) {
      if (window.innerWidth > 960) return;
      const touch = event.touches && event.touches[0];
      if (!touch) return;
      if (Math.abs(touch.clientX - sidebarTouchState.startX) > sidebarTapMoveThreshold || Math.abs(touch.clientY - sidebarTouchState.startY) > sidebarTapMoveThreshold) {
        sidebarTouchState.moved = true;
      }
    };
    const navigateFromSidebarItem = function (event) {
      if (window.innerWidth > 960) return;
      const target = event.target && event.target.closest ? event.target.closest('.sidebar .nav-item') : null;
      if (!target) return;
      if (event.type === 'click' && (Date.now() - lastTouchNavTs) < 700 && target.getAttribute('href') === lastTouchNavHref) {
        event.preventDefault();
        return;
      }
      if (event.type === 'touchend') {
        if (sidebarTouchState.moved) {
          resetSidebarTouchState();
          return;
        }
        if (!sidebarTouchState.startedOnItem || sidebarTouchState.startedOnItem !== target) {
          resetSidebarTouchState();
          return;
        }
      }
      const href = target.getAttribute('href');
      if (!href || href.startsWith('#')) {
        event.preventDefault();
        closeMenu();
        resetSidebarTouchState();
        return;
      }
      event.preventDefault();
      closeMenu();
      if (event.type === 'touchend') {
        lastTouchNavTs = Date.now();
        lastTouchNavHref = href;
      }
      resetSidebarTouchState();
      window.location.assign(href);
    };
    sidebar.addEventListener('click', navigateFromSidebarItem);
    sidebar.addEventListener('touchstart', onSidebarTouchStart, { passive: true });
    sidebar.addEventListener('touchmove', onSidebarTouchMove, { passive: true });
    sidebar.addEventListener('touchend', navigateFromSidebarItem, { passive: false });
    sidebar.addEventListener('touchcancel', resetSidebarTouchState, { passive: true });

    window.addEventListener('resize', function () {
      if (window.innerWidth > 960) closeMenu();
    });

    if (window.innerWidth <= 960) {
      closeMenu();
    }
  }

  function mountDeveloperSidebarLink() {
    // Links de desenvolvedor ficam apenas no menu de perfil (top-right).
    return;
  }

  function applySidebarVisibilityByAuth() {
    if (isLoginPage()) return;
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    if (!document.getElementById('tpSidebarAuthVisibilityStyle')) {
      const style = document.createElement('style');
      style.id = 'tpSidebarAuthVisibilityStyle';
      style.textContent = `
        body.tp-no-sidebar .sidebar { display:none !important; }
        body.tp-no-sidebar .tp-sidebar-toggle,
        body.tp-no-sidebar .tp-sidebar-overlay { display:none !important; }
        body.tp-no-sidebar .main,
        body.tp-no-sidebar .main-content,
        body.tp-no-sidebar main.main-content { margin-left:0 !important; width:100% !important; max-width:100% !important; }
      `;
      document.head.appendChild(style);
    }

    if (isLoggedIn()) {
      document.body.classList.remove('tp-no-sidebar');
      sidebar.style.display = '';
      return;
    }

    document.body.classList.add('tp-no-sidebar');
    sidebar.style.display = 'none';
    const nav = sidebar.querySelector('.sidebar-nav');
    if (nav) nav.innerHTML = '';
    sidebar.querySelectorAll('.tp-sidebar-collapse-btn,[aria-label*="menu lateral"],[title*="menu"]').forEach(function (el) {
      if (!el || !el.closest || !el.closest('.sidebar')) return;
      el.remove();
    });
    const toggle = document.getElementById('tpSidebarToggle');
    const overlay = document.getElementById('tpSidebarOverlay');
    if (toggle) toggle.remove();
    if (overlay) overlay.remove();
  }

  function ensureMenuStyles() {
    if (document.getElementById('tpUserMenuStyle')) return;
    const style = document.createElement('style');
    style.id = 'tpUserMenuStyle';
    style.textContent = `
      .tp-user-menu { position: fixed; top: 12px; right: 14px; z-index: 9999; font-family: "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Helvetica Neue", "Segoe UI", Arial, sans-serif; }
      .tp-user-menu-btn { display:flex; align-items:center; gap:10px; border:1px solid rgba(34,197,94,.42); background: linear-gradient(180deg, rgba(34,197,94,.95), rgba(22,163,74,.95)); color:#f8fafc; border-radius:16px; padding:9px 12px; min-width:248px; cursor:pointer; box-shadow: 0 12px 26px rgba(2,6,23,.42), 0 0 0 1px rgba(74,222,128,.18) inset; transition: transform .2s ease, border-color .2s ease, box-shadow .2s ease, filter .2s ease; }
      .tp-user-menu-btn:hover { transform: translateY(-1px); border-color: rgba(134,239,172,.62); box-shadow: 0 16px 28px rgba(2,6,23,.5), 0 0 0 1px rgba(134,239,172,.32) inset; filter: saturate(1.06); }
      .tp-user-menu.open .tp-user-menu-btn { border-color: rgba(134,239,172,.68); box-shadow: 0 18px 34px rgba(2,6,23,.55), 0 0 0 1px rgba(134,239,172,.34) inset; }
      .tp-user-avatar { width:38px; height:38px; border-radius:50%; background: radial-gradient(circle at 30% 20%, #bbf7d0, #4ade80 55%, #16a34a 100%); color:#052e16; display:flex; align-items:center; justify-content:center; font-weight:800; overflow:hidden; flex-shrink:0; box-shadow: 0 6px 16px rgba(34,197,94,.35), 0 0 0 2px rgba(255,255,255,.45); }
      .tp-user-avatar img { width:100%; height:100%; object-fit:cover; display:block; }
      .tp-user-meta { line-height:1.25; min-width:0; flex:1; text-align:left; }
      .tp-user-name { font-size:13px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .tp-user-group { font-size:11px; color:rgba(231,255,240,.88); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-transform:capitalize; }
      .tp-user-caret { color:rgba(231,255,240,.88); font-size:12px; transition: transform .22s ease, color .22s ease; }
      .tp-user-menu.open .tp-user-caret { transform: rotate(180deg); color:#dcfce7; }
      .tp-user-dropdown { display:block; position:absolute; top:calc(100% + 10px); right:0; width:388px; border-radius:18px; border:1px solid rgba(148,163,184,.28); background: linear-gradient(180deg, rgba(15,23,42,.9), rgba(2,6,23,.9)); backdrop-filter: blur(16px); box-shadow: 0 28px 56px rgba(2,6,23,.6), 0 0 0 1px rgba(148,163,184,.1) inset; overflow:hidden; opacity:0; transform: translateY(-8px) scale(.985); pointer-events:none; transition: opacity .2s ease, transform .22s ease; }
      .tp-user-dropdown::before { content:""; position:absolute; inset:0; background: radial-gradient(120% 70% at 100% 0%, rgba(74,222,128,.14), transparent 55%); pointer-events:none; }
      .tp-user-menu.open .tp-user-dropdown { opacity:1; transform: translateY(0) scale(1); pointer-events:auto; }
      .tp-user-profile { position:relative; z-index:1; padding:16px 16px 14px; border-bottom:1px solid rgba(148,163,184,.2); background: linear-gradient(180deg, rgba(30,41,59,.42), rgba(15,23,42,.2)); }
      .tp-user-profile .tp-user-name { font-size:18px; font-weight:800; line-height:1.15; letter-spacing:-.01em; color:#f8fbff; }
      .tp-user-profile .tp-user-email { color:#b7c7df; font-size:14px; margin-top:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .tp-user-profile .tp-user-group { margin-top:10px; font-size:30px; color:#facc15; font-weight:900; letter-spacing:-.01em; line-height:1.1; }
      .tp-user-pages { margin-top:10px; color:#b7c7df; font-size:12px; }
      .tp-user-actions { position:relative; z-index:1; padding:10px; display:grid; gap:6px; }
      .tp-user-actions a, .tp-user-actions button { width:100%; border:1px solid rgba(148,163,184,.16); background:rgba(15,23,42,.34); color:#e7eefc; text-decoration:none; text-align:left; padding:12px 12px; cursor:pointer; font-size:15px; font-weight:600; display:flex; align-items:center; gap:10px; border-radius:12px; transition: background .18s ease, border-color .18s ease, transform .18s ease, color .18s ease, box-shadow .18s ease; }
      .tp-user-actions a i, .tp-user-actions button i { width:18px; text-align:center; color:#b4c5e0; transition: color .18s ease, transform .18s ease; }
      .tp-user-actions a:hover, .tp-user-actions button:hover { background:linear-gradient(180deg, rgba(30,41,59,.76), rgba(15,23,42,.62)); border-color: rgba(74,222,128,.45); color:#ffffff; transform: translateX(2px); box-shadow: 0 8px 16px rgba(2,6,23,.34); }
      .tp-user-actions a:hover i, .tp-user-actions button:hover i { color:#86efac; transform: scale(1.06); }
      .tp-user-logout { margin-top:6px; color:#ecfdf5 !important; border-color: rgba(74,222,128,.45) !important; background: linear-gradient(135deg, rgba(34,197,94,.92), rgba(22,163,74,.92)) !important; box-shadow: 0 8px 18px rgba(22,163,74,.32); }
      .tp-user-logout i { color:#ecfdf5 !important; }
      .tp-user-logout:hover { color:#fff !important; border-color: rgba(167,243,208,.78) !important; background: linear-gradient(135deg, rgba(74,222,128,.96), rgba(22,163,74,.96)) !important; box-shadow: 0 12px 22px rgba(22,163,74,.4); }
      @media (max-width: 960px) {
        .tp-user-menu {
          top: 10px;
          right: 10px;
          left: auto;
          width: auto;
          max-width: calc(100vw - 100px);
        }
        .tp-user-menu-btn {
          min-width: 0;
          width: auto;
          max-width: min(72vw, 300px);
          padding: 6px 8px;
          gap: 8px;
          border-radius: 12px;
        }
        .tp-user-avatar {
          width: 30px;
          height: 30px;
        }
        .tp-user-name {
          font-size: 11px;
          line-height: 1.15;
        }
        .tp-user-group {
          display: none;
        }
        .tp-user-caret {
          font-size: 10px;
        }
        .tp-user-dropdown {
          width: min(94vw, 388px);
          right: 0;
        }
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
    const session = getStoredSession();
    const role = getCurrentRole(session);
    const userMenuLinks = MENU_ITEMS
      .filter((item) => item.inUserMenu)
      .filter((item) => isMenuItemVisible(item, session, role))
      .map((item) => `<a href="${item.href}"><i class="${escapeHtml(item.icon)}" aria-hidden="true"></i><span>${escapeHtml(item.label)}</span></a>`)
      .join('');

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
          <div class="tp-user-group">Nível: ${escapeHtml(profile.group)}</div>
          <div class="tp-user-pages">Páginas: ${escapeHtml(allowedPreview)}</div>
        </div>
        <div class="tp-user-actions">
          ${userMenuLinks}
          <button type="button" id="tpUserLogoutBtn" class="tp-user-logout"><i class="fas fa-right-from-bracket" aria-hidden="true"></i><span>Sair</span></button>
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
  window.authRequestPasswordReset = requestPasswordReset;
  window.authResetPasswordWithCode = resetPasswordWithCode;
  window.authRefreshCurrentUser = refreshCurrentUser;
  window.authUpdateMyProfile = updateMyProfile;
  window.authPrewarm = prewarmAuthServer;
  window.authRefreshUserMenu = refreshUserMenu;

  patchFetchWithUserHeaders();

  document.addEventListener('DOMContentLoaded', function () {
    requireAuth();
    applySidebarVisibilityByAuth();
    standardizeSidebarMenu();
    setupSidebarMobileToggle();
    startHeartbeat();
    applyNavigationPermissions();
    mountDeveloperSidebarLink();
    mountUserMenu();
  });
})();


