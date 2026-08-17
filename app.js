// Dashboard Nuvera Bot — rediseño completo (2026-08-16).
// Vanilla JS, sin frameworks, sin build step (se sirve tal cual desde GitHub
// Pages). Principios: rendimiento primero (datos críticos en <1s, gráfica
// después, caché por tipo de dato, máximo 3 peticiones al abrir la página) y
// móvil primero (sin hover, sin scroll horizontal, toques grandes).

// ---------- Config / API base ----------
// Mismo mecanismo que el dashboard anterior (ver README.md): ?api=URL en la
// query string lo guarda en localStorage, así que no hace falta repetirlo en
// cada visita desde el mismo navegador.
const DEFAULT_API_BASE = 'https://shorter-sprung-process.ngrok-free.dev';
function resolveApiBase() {
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get('api');
  if (fromQuery) {
    localStorage.setItem('nuvera_api', fromQuery);
    return fromQuery;
  }
  return localStorage.getItem('nuvera_api') || DEFAULT_API_BASE;
}
const API_BASE = resolveApiBase();

const $ = (id) => document.getElementById(id);
const fmtUsd = (n) => (n === null || n === undefined ? '—' : `$${n.toFixed(2)}`);
const fmtPct = (n, digits = 1) => (n === null || n === undefined ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`);
const pnlClass = (n) => (n === null || n === undefined ? '' : (n >= 0 ? 'pnl-pos' : 'pnl-neg'));

// ---------- Caché en memoria, TTL por tipo de dato ----------
// Un fetch dentro del TTL reutiliza lo que ya está en memoria en vez de
// pegarle a la API de nuevo — esto es lo que hace que cambiar de tab o volver
// a una sección ya vista se sienta instantáneo. El polling programado (ver
// startPolling) es más espaciado que el TTL a propósito: cuando el timer
// dispara, el caché ya venció y siempre trae datos frescos.
const CACHE_TTL_MS = {
  '/api/dashboard-summary': 10_000,
  '/api/positions': 30_000,
  '/api/trades-history': 30_000,
  '/api/strategies-today': 60_000,
  '/api/motor-status': 30_000,
  '/api/diary/today': 30 * 60_000,
  '/api/health': 60_000,
  '/api/system': 60_000,
  '/api/regime': 60_000,
  '/api/market-mood': 60_000,
  '/api/autonomia': 60_000,
  '/api/cooldowns': 60_000,
};
const cache = new Map(); // path -> { data, fetchedAt }

async function fetchJson(path, { force = false } = {}) {
  // /api/trades-history?filter=wins&page=2 etc: el TTL se busca por la parte
  // antes del '?' (una sola entrada en CACHE_TTL_MS para todas las
  // combinaciones de filtro/página), pero cada combinación se cachea aparte
  // (la query string completa es la key del Map) — cambiar de filtro o de
  // página siempre pide datos frescos la primera vez, no reusa el filtro anterior.
  const ttl = CACHE_TTL_MS[path.split('?')[0]] ?? 30_000;
  const cached = cache.get(path);
  if (!force && cached && Date.now() - cached.fetchedAt < ttl) return cached.data;

  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'ngrok-skip-browser-warning': 'true' },
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  const data = await res.json();
  cache.set(path, { data, fetchedAt: Date.now() });
  return data;
}

// ---------- Header + 3 cards (un solo endpoint) ----------
let lastSummaryFetchAt = null;

function renderSummary(s) {
  $('statusText').textContent = s.estado === 'operando' ? 'OPERANDO' : 'PAUSADO';
  $('statusDot').className = 'dot ' + (s.estado === 'operando' ? 'ok' : 'bad');
  $('modePill').textContent = s.modo === 'live' ? '🔴 LIVE' : '📄 PAPER';

  $('capitalValue').textContent = fmtUsd(s.capital);
  const pnlEl = $('pnlValue');
  pnlEl.textContent = `${fmtUsd(s.pnlHoy)} (${fmtPct(s.pnlPct)})`;
  pnlEl.className = 'metric-value metric-pnl ' + pnlClass(s.pnlHoy);

  $('fearGreedText').textContent = s.fearGreed !== null && s.fearGreed !== undefined
    ? `Fear & Greed: ${s.fearGreed} ${s.fearGreedLabel || ''}`
    : 'Fear & Greed: —';

  // Racha actual (header): solo se muestra si hay 2+ seguidos — una racha de
  // 1 no dice nada todavía, no vale la pena ocupar espacio en el header.
  const rachaEl = $('rachaPill');
  if (s.rachaActual >= 2 && s.rachaTipo) {
    rachaEl.style.display = 'inline-flex';
    rachaEl.className = 'pill racha-' + s.rachaTipo;
    rachaEl.textContent = s.rachaTipo === 'wins' ? `🔥 ${s.rachaActual} wins seguidos` : `⚠️ ${s.rachaActual} losses seguidos`;
  } else {
    rachaEl.style.display = 'none';
  }

  // Card HOY
  const hoyPnlEl = $('cardHoyPnl');
  hoyPnlEl.textContent = fmtUsd(s.pnlHoy);
  hoyPnlEl.className = 'cell-value ' + pnlClass(s.pnlHoy);
  $('cardHoyTrades').textContent = s.tradesHoy ?? '—';
  const pfBadge = s.pfHoy >= 1.3 ? '🌟' : s.pfHoy >= 1.0 ? '✅' : '⚠️';
  $('cardHoyWrPf').textContent = `${s.wrHoy ?? '—'}% | ${s.pfHoy?.toFixed(2) ?? '—'} ${pfBadge}`;

  // Card CAPITAL
  $('cardCapitalTotal').textContent = fmtUsd(s.capital);
  const pctEnTrades = s.capital > 0 ? Math.round((s.capitalEnTrades / s.capital) * 100) : 0;
  $('cardCapitalEnTrades').textContent = `${fmtUsd(s.capitalEnTrades)} (${pctEnTrades}%)`;
  $('cardCapitalLibre').textContent = fmtUsd(s.capitalLibre);

  // Card INTELIGENCIA
  $('cardIaOllama').textContent = s.ollamaOk ? '✅ en RAM' : '⚠️ no cargado';
  $('cardIaXgb').textContent = s.xgboostAccuracy !== null && s.xgboostAccuracy !== undefined
    ? `${s.xgboostAccuracy.toFixed(1)}% acc`
    : 'sin modelo';
  const learningsTrendTxt = s.aprendizajesAyer !== null && s.aprendizajesAyer !== undefined
    ? ` (${s.aprendizajesHoy >= s.aprendizajesAyer ? '↑' : '↓'} vs ${s.aprendizajesAyer} ayer)`
    : '';
  $('cardIaLearnings').textContent = `${s.aprendizajesHoy ?? '—'}${learningsTrendTxt}`;

  lastSummaryFetchAt = Date.now();
}

async function loadSummary(force = false) {
  try {
    const data = await fetchJson('/api/dashboard-summary', { force });
    renderSummary(data);
  } catch (err) {
    console.warn('dashboard-summary falló:', err.message);
  }
}

// "Última act: hace Ns" — se actualiza cada segundo sin pegarle a la red,
// solo recalcula contra el timestamp del último fetch exitoso.
function tickLastUpdate() {
  if (!lastSummaryFetchAt) return;
  const secs = Math.round((Date.now() - lastSummaryFetchAt) / 1000);
  $('lastUpdateText').textContent = `Última act: hace ${secs}s`;
}

// ---------- TAB TRADES — sub-tab ABIERTOS ----------
const MAX_POSICIONES_VISIBLES = 10;

function renderPosiciones(list) {
  const container = $('posicionesList');
  const verMas = $('posicionesVerMas');
  if (!list || list.length === 0) {
    container.innerHTML = '<div class="empty-state">Sin posiciones abiertas ahora mismo.</div>';
    verMas.style.display = 'none';
    return;
  }
  const visibles = list.slice(0, MAX_POSICIONES_VISIBLES);
  container.innerHTML = visibles.map((p) => `
    <div class="pos-row">
      <div class="pair">${p.par}</div>
      <div><div class="cell-label">Invertido</div><div class="cell-value">${fmtUsd(p.invertido)}</div></div>
      <div><div class="cell-label">PnL actual</div><div class="cell-value ${pnlClass(p.pnlActual)}">${fmtUsd(p.pnlActual)} ${p.pnlActual >= 0 ? '✅' : '🔴'}</div></div>
      <div><div class="cell-label">Tiempo</div><div class="cell-value">${p.tiempoAbierto || '—'}</div></div>
    </div>
  `).join('');

  if (list.length > MAX_POSICIONES_VISIBLES) {
    verMas.style.display = 'block';
    verMas.textContent = `+${list.length - MAX_POSICIONES_VISIBLES} posiciones más abiertas`;
  } else {
    verMas.style.display = 'none';
  }
}

async function loadPosiciones(force = false) {
  try {
    const data = await fetchJson('/api/positions', { force });
    renderPosiciones(data);
  } catch (err) {
    $('posicionesList').innerHTML = '<div class="empty-state">No se pudo cargar (reintentando…)</div>';
  }
}

// ---------- TAB TRADES — sub-tab HISTORIAL ----------
// Estado de filtro/página en memoria (no en la URL, no hace falta persistir
// entre visitas) — cambiar de filtro siempre vuelve a página 1.
const historialState = { filter: 'all', page: 1 };

function renderHistorial(data) {
  const container = $('historialList');
  const pagination = $('historialPagination');
  const trades = (data && data.trades) || [];

  if (trades.length === 0) {
    container.innerHTML = '<div class="empty-state">Sin trades cerrados para este filtro.</div>';
    pagination.style.display = 'none';
    return;
  }

  container.innerHTML = trades.map((t) => {
    const isWin = t.outcome === 'win';
    const hora = (t.fecha || '').slice(11, 16) + ' UTC';
    return `
      <div class="hist-row ${isWin ? 'win' : 'loss'}">
        <div class="hist-top">
          <div class="hist-par">${t.par}</div>
          <div class="hist-resultado ${isWin ? 'win' : 'loss'}">${isWin ? 'WIN ✅' : 'LOSS 🔴'}</div>
        </div>
        <div class="hist-cell hist-extra"><div class="cell-label">Estrategia</div><div class="cell-value">${t.estrategia || '—'}</div></div>
        <div class="hist-cell hist-extra"><div class="cell-label">Nivel</div><div class="cell-value">${t.nivel ?? '—'}</div></div>
        <div class="hist-cell hist-extra"><div class="cell-label">Entrada</div><div class="cell-value">${t.entrada ?? '—'}</div></div>
        <div class="hist-cell hist-extra"><div class="cell-label">Salida</div><div class="cell-value">${t.salida ?? '—'}</div></div>
        <div class="hist-cell hist-pnl"><div class="cell-label">PnL</div><div class="cell-value ${pnlClass(t.pnl)}">${fmtUsd(t.pnl)}</div></div>
        <div class="hist-cell"><div class="cell-label">Duración</div><div class="cell-value">${t.duracion || '—'}</div></div>
        <div class="hist-cell"><div class="cell-label">Hora</div><div class="cell-value">${hora}</div></div>
      </div>
    `;
  }).join('');

  pagination.style.display = 'flex';
  $('paginationInfo').textContent = `Página ${data.page} de ${data.totalPages}`;
  $('paginationPrev').disabled = data.page <= 1;
  $('paginationNext').disabled = data.page >= data.totalPages;
}

async function loadHistorial(force = false) {
  try {
    const path = `/api/trades-history?limit=20&filter=${historialState.filter}&page=${historialState.page}`;
    const data = await fetchJson(path, { force });
    renderHistorial(data);
  } catch (err) {
    $('historialList').innerHTML = '<div class="empty-state">No se pudo cargar el historial (reintentando…)</div>';
  }
}

document.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.filter === historialState.filter) return;
    document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    historialState.filter = btn.dataset.filter;
    historialState.page = 1;
    loadHistorial(true);
  });
});
$('paginationPrev').addEventListener('click', () => {
  if (historialState.page <= 1) return;
  historialState.page -= 1;
  loadHistorial(true);
});
$('paginationNext').addEventListener('click', () => {
  historialState.page += 1;
  loadHistorial(true);
});

// ---------- TAB TRADES — sub-tabs (Abiertos / Historial) ----------
const SUBTAB_LOADERS = { abiertos: loadPosiciones, historial: loadHistorial };
const subtabLoadedOnce = new Set();
let activeSubtab = 'abiertos';

function switchSubtab(subtab) {
  if (subtab === activeSubtab) return;
  if (!SUBTAB_LOADERS[subtab]) {
    console.warn('Sub-tab desconocida (sin loader registrado):', subtab);
    return;
  }
  activeSubtab = subtab;
  document.querySelectorAll('.subtab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.subtab === subtab));
  document.querySelectorAll('.subtab-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `subtab-${subtab}`));
  subtabLoadedOnce.add(subtab);
  SUBTAB_LOADERS[subtab]();
}

document.querySelectorAll('.subtab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchSubtab(btn.dataset.subtab));
});

// Loader único para la tab "trades" (lo que usa el orquestador de tabs de
// más abajo): carga/refresca solo la sub-tab activa ahora mismo.
function loadTradesTab(force = false) {
  subtabLoadedOnce.add(activeSubtab);
  return SUBTAB_LOADERS[activeSubtab](force);
}

// ---------- TAB 2: Estrategias ----------
function renderEstrategias(list) {
  const container = $('estrategiasList');
  if (!list || list.length === 0) {
    container.innerHTML = '<div class="empty-state">Sin datos de estrategias todavía.</div>';
    return;
  }
  const trendIcon = { up: '↗️', down: '↘️', same: '→' };
  const trendClass = { up: 'trend-up', down: 'trend-down', same: 'trend-same' };

  container.innerHTML = list.map((s) => {
    const pfBadge = s.pfHoy >= 2.0 ? '🌟' : s.pfHoy >= 1.0 ? '✅' : (s.tradesHoy > 0 ? '⚠️' : '');
    const slots = s.slotsTotal !== null ? `${s.slotsOcupados}/${s.slotsTotal} slots ocupados` : `${s.slotsOcupados} posiciones`;
    const mejorParTxt = s.mejorPar ? `Mejor par: <span class="hl">${s.mejorPar.pair}</span> (${fmtUsd(s.mejorPar.pnl)})` : '';
    return `
      <div class="strat-card">
        <div class="strat-header">
          <span>${s.emoji} ${s.nombre}</span>
          <span class="${trendClass[s.pfTrend] || 'trend-same'}">${trendIcon[s.pfTrend] || '→'}</span>
        </div>
        <div class="strat-line">Trades hoy: <span class="hl">${s.tradesHoy}</span> | WR: <span class="hl">${s.wrHoy}%</span> | PF: <span class="hl">${s.pfHoy.toFixed(2)}</span> <span class="badge">${pfBadge}</span></div>
        <div class="strat-line">Capital: <span class="hl">${fmtUsd(s.capital)}</span> | ${slots}</div>
        ${mejorParTxt ? `<div class="strat-line">${mejorParTxt}</div>` : ''}
      </div>
    `;
  }).join('');
}

// Barras de confianza + detalle de ciclo (2026-08-16, mejoras finales,
// pedido explícito CAMBIO 5) — consume GET /api/motor-status, que no existía
// cuando se armó el tab Estrategias original. Ancho de la barra: PF
// normalizado (PF=2.0 o más -> 100%, PF=0 -> apenas visible) — no es un %
// real, es una escala visual para comparar pares entre sí de un vistazo.
function confFillWidth(pf) {
  if (pf === null || pf === undefined) return 8;
  return Math.min(100, Math.max(8, (Math.min(pf, 2) / 2) * 100));
}
function confClass(nivel) {
  return { ALTA: 'alta', MEDIA: 'media', BAJA: 'baja', NUEVO: 'nuevo' }[nivel] || 'nuevo';
}

// Detalle de un par de Motor A (btc/eth) — shape pedido explícito
// (2026-08-17, PROBLEMA 3): { cicloActual, compras, promedio, esperando }.
function motorAPairLine(nombre, p) {
  if (!p) return `<div class="strat-line">${nombre}: <span class="hl">sin datos</span></div>`;
  const detalle = p.esperando
    ? 'sin ciclo activo, esperando caída'
    : `ciclo ${p.cicloActual}/${p.maxCompras} activo · promedio ${fmtUsd(p.promedio)} · invertido ${fmtUsd(p.capitalInvertido)}${p.tpObjetivoPct !== null ? ` · TP +${p.tpObjetivoPct}%` : ''}`;
  return `<div class="strat-line">${nombre}: <span class="hl">${detalle}</span></div>`;
}

function renderMotorStatus(data) {
  const container = $('motorStatusDetail');
  if (!data) {
    container.innerHTML = '';
    return;
  }

  const motorA = data.motorA || { nombre: 'DCA Estable', capitalAsignado: 0, capitalPct: 0 };
  const motorB = data.motorB || { nombre: 'Scalping Selectivo', capitalAsignado: 0, capitalPct: 0, disponible: 0, posiciones: [], maxPosiciones: 3, cryptoConfianza: {} };

  // Bloque "DISTRIBUCIÓN DE CAPITAL" — pedido explícito (2026-08-17, PROBLEMA 3).
  const distribucion = `
    <div class="strat-card">
      <div class="strat-header"><span>💰 DISTRIBUCIÓN DE CAPITAL</span></div>
      <div class="strat-line">${motorA.nombre} — <span class="hl">${motorA.capitalPct}% | ${fmtUsd(motorA.capitalAsignado)}</span></div>
      ${motorAPairLine('&nbsp;&nbsp;BTC', motorA.btc)}
      ${motorAPairLine('&nbsp;&nbsp;ETH', motorA.eth)}
      <div class="strat-line" style="margin-top:8px">${motorB.nombre} — <span class="hl">${motorB.capitalPct}% | ${fmtUsd(motorB.capitalAsignado)}</span></div>
      <div class="strat-line">&nbsp;&nbsp;${motorB.posicionesActivas}/${motorB.maxPosiciones} posiciones activas · disponible ${fmtUsd(motorB.disponible)}</div>
      <div class="strat-line" style="margin-top:8px">Régimen: <span class="hl">${data.regimen || '—'}</span> ${data.regimenMercado ? `(mercado ${data.regimenMercado})` : ''}</div>
      <div class="strat-line">Capital libre: <span class="hl">${fmtUsd(data.capitalLibre)}</span></div>
      ${data.modoDefensivo && data.modoDefensivo.activo ? `<div class="strat-line">🛡️ Modo defensivo activo: tamaño ${Math.round(data.modoDefensivo.multiplicador * 100)}%${data.modoDefensivo.razon ? ` — ${data.modoDefensivo.razon}` : ''}</div>` : ''}
    </div>`;

  const motorBPosLines = (motorB.posiciones || []).length === 0
    ? '<div class="strat-line">Sin posiciones activas.</div>'
    : motorB.posiciones.map((p) => `<div class="strat-line">${p.pair}: <span class="hl">${fmtUsd(p.monto)}</span> @ ${fmtUsd(p.entryPrice)} (confianza ${p.nivelConfianza || '—'}, TP +${p.tpPct}%/SL -${p.slPct}%)</div>`).join('');

  const confianzaRows = (data.confianza || []).map((c) => {
    const pfTxt = c.pf7d === null ? '—' : (c.pf7d >= 999 ? '∞' : c.pf7d.toFixed(2));
    return `
      <div class="conf-row">
        <div class="conf-pair">${c.pair.replace('/USDT', '')}</div>
        <div class="conf-track"><div class="conf-fill ${confClass(c.nivel)}" style="width:${confFillWidth(c.pf7d)}%"></div></div>
        <div class="conf-label">${c.nivel} (PF ${pfTxt})</div>
      </div>`;
  }).join('');

  container.innerHTML = `
    ${distribucion}
    <div class="strat-card">
      <div class="strat-header"><span>🎯 Motor B — posiciones abiertas</span></div>
      ${motorBPosLines}
    </div>
    <div class="strat-card">
      <div class="strat-header"><span>📊 Confianza por crypto (7 días)</span></div>
      ${confianzaRows || '<div class="strat-line">Sin datos todavía.</div>'}
    </div>
  `;
}

async function loadEstrategias(force = false) {
  try {
    const [data, motorStatus] = await Promise.all([
      fetchJson('/api/strategies-today', { force }),
      fetchJson('/api/motor-status', { force }).catch(() => null),
    ]);
    renderEstrategias(data);
    renderMotorStatus(motorStatus);
  } catch (err) {
    $('estrategiasList').innerHTML = '<div class="empty-state">No se pudo cargar (reintentando…)</div>';
  }
}

// ---------- TAB 3: Análisis Nuvera Research ----------
function renderAnalisis(d) {
  const container = $('analisisContent');
  if (!d || !d.disponible) {
    container.innerHTML = '<div class="empty-state">Todavía sin análisis publicado hoy.</div>';
    return;
  }
  const stats = d.datosMercado || {};
  const chips = ['BTC', 'ETH', 'SOL'].filter((sym) => stats[sym] !== undefined).map((sym) => {
    const val = stats[sym];
    const num = typeof val === 'number' ? val : parseFloat(val);
    const cls = Number.isFinite(num) ? pnlClass(num) : '';
    return `<div class="market-chip"><div class="sym">${sym}</div><div class="val ${cls}">${Number.isFinite(num) ? fmtPct(num) : val}</div></div>`;
  }).join('');

  container.innerHTML = `
    <div class="diary-grid">
      <div class="diary-main">
        <div class="diary-title">${d.titular || 'Análisis Cripto Diario'}</div>
        <div class="diary-body">${(d.analisis || '').replace(/</g, '&lt;')}</div>
        <div class="diary-meta">Nuvera Research · ${d.creadoEn || ''}</div>
      </div>
      <div class="diary-side">
        ${chips ? `<div class="market-grid">${chips}</div>` : ''}
      </div>
    </div>
  `;
}

async function loadAnalisis(force = false) {
  try {
    const data = await fetchJson('/api/diary/today', { force });
    renderAnalisis(data);
  } catch (err) {
    $('analisisContent').innerHTML = '<div class="empty-state">No se pudo cargar el análisis de hoy.</div>';
  }
}

// ---------- TAB 4: Sistema ----------
function fmtUptime(ms) {
  if (!ms) return '—';
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}min`;
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

function renderSistema([health, system, regime, mood, autonomia, cooldowns]) {
  const container = $('sistemaContent');
  const errores = health.errores || {};
  const erroresHtml = errores.total24h === 0
    ? '<div class="empty-state">✅ Sin errores en las últimas 24h</div>'
    : (errores.recientes || []).slice(0, 8).map((e) => `
        <div class="err-item">[${e.fecha || ''}] ${e.tipo}${e.estrategia ? ` (${e.estrategia})` : ''}: ${e.descripcion || ''}</div>
      `).join('');

  const regimenHtml = regime && regime.disponible
    ? `${regime.emoji || '➡️'} ${regime.label || regime.regimen} | BTC 7d: ${fmtPct(regime.btc7d)}`
    : 'Sin datos de régimen todavía.';

  const moodHtml = mood && mood.mood
    ? `${mood.mood === 'favorable' ? '🟢' : mood.mood === 'esperar' ? '🟡' : '⚪'} ${mood.mood} — ${mood.razon || 'sin detalle'}`
    : 'Sin lectura de mercado todavía.';

  const restricciones = (autonomia && autonomia.restricciones) || [];
  const autonomiaHtml = restricciones.length === 0
    ? 'Sin restricciones propias activas.'
    : `${restricciones.length} restricción(es) activa(s): ${restricciones.slice(0, 5).map((r) => r.pair || 'horario').join(', ')}`;

  const cooldownList = (cooldowns && cooldowns.pares) || [];
  const cooldownsHtml = cooldownList.length === 0
    ? 'Sin cooldowns activos.'
    : cooldownList.slice(0, 6).map((c) => `${c.pair} (libre en ${c.minutosRestantes}min)`).join(' · ');

  container.innerHTML = `
    <div class="sys-list">
      <div class="sys-item"><span class="dot ok"></span> Bot: OPERANDO <span class="val">uptime ${fmtUptime(system.botUptimeMs)}</span></div>
      <div class="sys-item"><span class="dot ${health.postgresql?.ok ? 'ok' : 'bad'}"></span> DB <span class="val">${health.postgresql?.tradesGuardados ?? '—'} trades</span></div>
      <div class="sys-item"><span class="dot ${health.ollama?.ok ? 'ok' : 'bad'}"></span> Ollama <span class="val">${health.ollama?.ok ? 'OK' : (health.ollama?.deshabilitado ? 'deshabilitado' : 'sin respuesta')}</span></div>
      <div class="sys-item"><span class="dot ${health.groq?.configurado ? 'ok' : 'bad'}"></span> Groq <span class="val">${health.groq?.configurado ? 'configurado' : 'sin configurar'}</span></div>
      <div class="sys-item"><span class="dot ${health.ngrok?.ok ? 'ok' : 'bad'}"></span> ngrok <span class="val">${health.ngrok?.ok ? 'OK' : 'sin túnel'}</span></div>
    </div>

    <div class="subsection-title">Errores recientes (24h)</div>
    ${erroresHtml}

    <div class="subsection-title">Régimen de mercado</div>
    <div class="strat-line">${regimenHtml}</div>

    <div class="subsection-title">Market Mood</div>
    <div class="strat-line">${moodHtml}</div>

    <div class="subsection-title">Decisiones autónomas de la IA</div>
    <div class="strat-line">${autonomiaHtml}</div>

    <div class="subsection-title">Cooldowns activos</div>
    <div class="strat-line">${cooldownsHtml}</div>
  `;
}

async function loadSistema(force = false) {
  try {
    const [health, system, regime, mood, autonomia, cooldowns] = await Promise.all([
      fetchJson('/api/health', { force }),
      fetchJson('/api/system', { force }),
      fetchJson('/api/regime', { force }),
      fetchJson('/api/market-mood', { force }),
      fetchJson('/api/autonomia', { force }),
      fetchJson('/api/cooldowns', { force }),
    ]);
    renderSistema([health, system, regime, mood, autonomia, cooldowns]);
  } catch (err) {
    $('sistemaContent').innerHTML = '<div class="empty-state">No se pudo cargar el estado del sistema.</div>';
  }
}

// ---------- Tabs: cambio instantáneo, carga perezosa una sola vez ----------
const TAB_LOADERS = {
  trades: loadTradesTab,
  estrategias: loadEstrategias,
  analisis: loadAnalisis,
  sistema: loadSistema,
};
const tabLoadedOnce = new Set();
let activeTab = 'trades';

function switchTab(tab) {
  if (tab === activeTab) return;
  // Defensivo (2026-08-16): si el botón no tiene un loader registrado (data-tab
  // mal escrito, o un botón nuevo agregado al HTML sin su entrada en
  // TAB_LOADERS), avisar en consola en vez de tirar "TAB_LOADERS[tab] is not
  // a function" y dejar la tab a medio cambiar.
  if (!TAB_LOADERS[tab]) {
    console.warn('Tab desconocida (sin loader registrado):', tab);
    return;
  }
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `tab-${tab}`));

  // Instantáneo: el panel cambia ya (arriba). Si esta tab nunca cargó datos,
  // se pide ahora en segundo plano; si ya cargó, el caché decide si hace
  // falta refrescar (ver fetchJson) — nunca bloquea el cambio visual de tab.
  tabLoadedOnce.add(tab);
  TAB_LOADERS[tab]();
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ---------- Gráfica de capital (lazy, después de 500ms) ----------
const MAX_CHART_POINTS = 200;
let chart = null;
let chartSeries = null;
let currentPeriod = '24h';

// Reduce a lo sumo a MAX_CHART_POINTS, promediando en baldes — mantiene el
// tiempo estrictamente ascendente (Lightweight Charts lo exige).
function downsample(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const bucketSize = Math.ceil(points.length / maxPoints);
  const result = [];
  for (let i = 0; i < points.length; i += bucketSize) {
    const bucket = points.slice(i, i + bucketSize);
    const avg = bucket.reduce((sum, p) => sum + p.value, 0) / bucket.length;
    result.push({ time: bucket[bucket.length - 1].time, value: Math.round(avg * 100) / 100 });
  }
  return result;
}

function initChart() {
  const container = $('chartContainer');
  chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight,
    layout: { background: { color: 'transparent' }, textColor: '#8b949e', fontSize: 11 },
    grid: { vertLines: { visible: false }, horzLines: { color: '#21262d' } },
    rightPriceScale: { borderColor: '#30363d' },
    timeScale: { borderColor: '#30363d', timeVisible: true, secondsVisible: false },
    handleScroll: false,
    handleScale: false,
  });
  chartSeries = chart.addAreaSeries({
    lineColor: '#00ff88',
    topColor: 'rgba(0, 255, 136, 0.25)',
    bottomColor: 'rgba(0, 255, 136, 0)',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: true,
  });

  new ResizeObserver(() => {
    if (chart) chart.applyOptions({ width: container.clientWidth });
  }).observe(container);
}

async function loadChart(period, force = false) {
  try {
    const raw = await fetchJson(`/api/capital-chart?period=${period}`, { force });
    if (!raw || raw.length === 0) return;
    const points = downsample(raw, MAX_CHART_POINTS);
    // El contenedor tiene que estar visible ANTES de crear/redimensionar el
    // chart — Lightweight Charts mide clientWidth/clientHeight al crearse, y
    // un elemento con display:none siempre mide 0x0 (bug real encontrado en
    // pruebas: la gráfica quedaba invisible aunque los datos sí llegaban).
    $('chartPlaceholder').style.display = 'none';
    $('chartContainer').style.display = 'block';
    if (!chart) initChart();
    chartSeries.setData(points);
    chart.timeScale().fitContent();
  } catch (err) {
    $('chartPlaceholder').textContent = 'No se pudo cargar la gráfica.';
  }
}

document.querySelectorAll('.period-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.period === currentPeriod) return;
    document.querySelectorAll('.period-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentPeriod = btn.dataset.period;
    loadChart(currentPeriod, true);
  });
});

// ---------- Carga progresiva + polling ----------
// 0-500ms: header + cards (ya en marcha) + tab activa (posiciones).
// 500ms+: gráfica (lazy, después de lo importante).
// Timers separados por sección, todos en pausa cuando la pestaña del
// navegador está oculta (evita fetches acumulados en móvil al volver de
// segundo plano — una de las causas típicas de "se bugea al refrescar").
let summaryTimer = null;
let tabTimer = null;
let chartTimer = null;

function startPolling() {
  stopPolling();
  summaryTimer = setInterval(() => loadSummary(true), 15_000);
  tabTimer = setInterval(() => TAB_LOADERS[activeTab](true), 60_000);
  chartTimer = setInterval(() => loadChart(currentPeriod, true), 60_000);
}
function stopPolling() {
  clearInterval(summaryTimer);
  clearInterval(tabTimer);
  clearInterval(chartTimer);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopPolling();
  } else {
    // Al volver a primer plano se refresca todo una vez de inmediato
    // (los datos pueden tener minutos de atraso) y recién ahí se retoma el
    // polling normal — evita ráfagas de timers atrasados apilados por el
    // navegador mientras la pestaña estaba en background.
    loadSummary(true);
    TAB_LOADERS[activeTab](true);
    if (chart) loadChart(currentPeriod, true);
    startPolling();
  }
});

function init() {
  loadSummary();
  TAB_LOADERS[activeTab]();
  setInterval(tickLastUpdate, 1000);
  setTimeout(() => loadChart(currentPeriod), 500);
  startPolling();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
