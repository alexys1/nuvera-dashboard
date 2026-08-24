// Dashboard Nuvera Bot — rediseño "Institutional" (2026-08-19): sidebar fijo
// + vista individual por bot/estrategia (Overview, Motor B, Motor A DCA,
// Bot 2 Grid, Bot 3 DCA, Bot 4 DCA, Settings). Vanilla JS, sin frameworks,
// sin build step (se sirve tal cual desde GitHub Pages). Reemplaza por
// completo al dashboard de tabs anterior — mismo backend (src/api/server.js),
// más 5 endpoints nuevos de solo lectura (/api/overview, /api/bot/motorb/
// stats, /api/bot/grid/levels, /api/bot/dca/:id/path, /api/bot/motora/stats).

// ---------- Config / API base (mismo mecanismo que el dashboard anterior) ----------
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
let API_BASE = resolveApiBase();

const $ = (id) => document.getElementById(id);
const fmtUsd = (n) => (n === null || n === undefined ? '—' : `$${Number(n).toFixed(2)}`);
const fmtUsdPrecise = (n, d = 2) => (n === null || n === undefined ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const fmtPct = (n, digits = 1) => (n === null || n === undefined ? '—' : `${n >= 0 ? '+' : ''}${Number(n).toFixed(digits)}%`);
const pnlClass = (n) => (n === null || n === undefined ? '' : (n >= 0 ? 'pnl-pos' : 'pnl-neg'));
const esc = (s) => String(s ?? '').replace(/</g, '&lt;');

// ---------- Caché en memoria, TTL por tipo de dato (2026-08-20, pedido
// explícito "polling inteligente" — capital/PnL 15s, posiciones abiertas
// 30s, gráficas 60s, stats generales 60s) ----------
const CACHE_TTL_CRITICAL = 15_000; // capital, PnL — headers de cada página
const CACHE_TTL_POSITIONS = 30_000; // posiciones abiertas / niveles de grid
const CACHE_TTL_CHARTS = 60_000; // gráficas
const CACHE_TTL_GENERAL = 60_000; // historial de trades, ranking, "path" de DCA
// Página Bot 3/Bot 4 — DCA (2026-08-22, pedido explícito, "actualización en
// tiempo real sin recargar la página"): intervalos propios para Accumulation
// Path (=posiciones abiertas, misma fuente /api/bot/dca/:id/path) e Historial
// de trades — más rápidos que el CACHE_TTL_GENERAL de 60s que usaban antes.
const CACHE_TTL_DCA_TRADES = 20_000; // DCA Execution History
const CACHE_TTL_DCA_CHART = 30_000; // gráfica de capital propia de Bot 3/4

const CACHE_TTL_MS = {
  '/api/overview': CACHE_TTL_CRITICAL,
  '/api/motor-status': CACHE_TTL_CRITICAL,
  '/api/bot/motorb/stats': CACHE_TTL_CRITICAL,
  '/api/bot/motora/stats': CACHE_TTL_CRITICAL,
  '/api/bot/grid/levels': CACHE_TTL_POSITIONS,
  '/api/competition/ranking': CACHE_TTL_GENERAL,
  '/api/bot/4/balance-real': CACHE_TTL_CRITICAL, // saldo real Binance — capital/balance cada 15s
  '/api/bot/4/thoughts': CACHE_TTL_CRITICAL, // "qué está pensando el bot" — cada 15s (2026-08-22, pedido explícito)
  '/api/bot/4/cycles': CACHE_TTL_DCA_TRADES, // Historial de Ciclos (2026-08-24) — misma cadencia que la tabla de trades que reemplaza
};
// Rutas dinámicas (con :id numérico en el medio) no matchean por string
// exacto contra CACHE_TTL_MS — se clasifican por el sufijo del path. Los
// regex con \d+ (id numérico) apuntan solo a Bot 2/3/4 — Motor B usa el
// literal "motorB" en el path y no matchea, así que su cadencia (chart/trades
// en el bucket GENERAL/CHARTS de siempre) queda intacta.
function resolveTtl(path) {
  const clean = path.split('?')[0];
  if (CACHE_TTL_MS[clean] !== undefined) return CACHE_TTL_MS[clean];
  if (/^\/api\/competition\/bot\/[^/]+$/.test(clean)) return CACHE_TTL_CRITICAL; // header del bot (capital/PnL)
  if (/^\/api\/bot\/dca\/\d+\/path$/.test(clean)) return CACHE_TTL_CRITICAL; // Accumulation Path / "posiciones abiertas" de Bot 3/4
  if (/^\/api\/competition\/bot\/\d+\/trades/.test(clean)) return CACHE_TTL_DCA_TRADES; // DCA Execution History de Bot 3/4
  if (/^\/api\/competition\/bot\/\d+\/chart/.test(clean)) return CACHE_TTL_DCA_CHART; // gráfica de capital de Bot 3/4
  if (clean.endsWith('/positions')) return CACHE_TTL_POSITIONS;
  if (clean.endsWith('/chart') || clean === '/api/capital-chart') return CACHE_TTL_CHARTS;
  return CACHE_TTL_GENERAL; // /trades, /path, etc.
}
const cache = new Map();

async function fetchJson(path, { force = false } = {}) {
  const ttl = resolveTtl(path);
  const cached = cache.get(path);
  if (!force && cached && Date.now() - cached.fetchedAt < ttl) return cached.data;

  const res = await fetch(`${API_BASE}${path}`, { headers: { 'ngrok-skip-browser-warning': 'true' } });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  const data = await res.json();
  cache.set(path, { data, fetchedAt: Date.now() });
  return data;
}

// ---------- Resolución de bot_instances.id por estrategia (Bot 2/3/4) ----------
let rankingPromise = null;
async function getRanking(force = false) {
  if (force) rankingPromise = null;
  if (!rankingPromise) {
    // Si el fetch falla, se limpia la promesa cacheada (en vez de dejar una
    // promesa RECHAZADA cacheada para siempre) — así la próxima llamada
    // reintenta contra la red en vez de fallar instantáneo por horas.
    rankingPromise = fetchJson('/api/competition/ranking', { force }).catch((err) => {
      rankingPromise = null;
      throw err;
    });
  }
  return rankingPromise;
}
async function getBotIdByEstrategia(estrategia) {
  const ranking = await getRanking();
  const bot = ranking.find((b) => b.estrategia === estrategia);
  return bot ? bot.id : null;
}

// ---------- Sidebar / mobile ----------
function openSidebar() { $('sidebar').classList.add('open'); $('sidebarOverlay').classList.add('open'); }
function closeSidebar() { $('sidebar').classList.remove('open'); $('sidebarOverlay').classList.remove('open'); }
$('hamburgerBtn').addEventListener('click', openSidebar);
$('sidebarOverlay').addEventListener('click', closeSidebar);

document.querySelectorAll('.nav-item[data-route]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (window.location.hash === `#${btn.dataset.route}`) return;
    window.location.hash = btn.dataset.route;
  });
});

// ---------- Sparkline SVG (sin librería — usado en las cards del Overview) ----------
function sparklineSvg(values, color) {
  if (!values || values.length < 2) return '<div class="chart-placeholder" style="height:34px;font-size:11px;">Sin datos hoy</div>';
  const w = 200;
  const h = 34;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = (max - min) || 1;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`).join(' ');
  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

// ---------- Lightweight Charts: helper genérico ----------
const chartInstances = {}; // containerId -> { chart, series }
function clearAllCharts() {
  Object.values(chartInstances).forEach((c) => { try { c.chart.remove(); } catch (err) { /* ya destruido */ } });
  for (const k of Object.keys(chartInstances)) delete chartInstances[k];
}
function ensureAreaChart(containerId, color = '#00ff88') {
  if (chartInstances[containerId]) return chartInstances[containerId];
  const container = $(containerId);
  if (!container) return null;
  const chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight || 220,
    layout: { background: { color: 'transparent' }, textColor: '#64748b', fontSize: 11 },
    grid: { vertLines: { visible: false }, horzLines: { color: '#1c1c28' } },
    rightPriceScale: { borderColor: '#2a2a3a' },
    timeScale: { borderColor: '#2a2a3a', timeVisible: true, secondsVisible: false },
    handleScroll: false,
    handleScale: false,
  });
  const series = chart.addAreaSeries({
    lineColor: color, topColor: `${color}33`, bottomColor: `${color}00`,
    lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
  });
  new ResizeObserver(() => { if (chartInstances[containerId]) chart.applyOptions({ width: container.clientWidth }); }).observe(container);
  chartInstances[containerId] = { chart, series };
  return chartInstances[containerId];
}
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

function modePillHtml(modo) {
  return modo === 'live' ? '<span class="pill mode-live">🔴 LIVE</span>' : '<span class="pill mode-paper">○ PAPER</span>';
}
function statusPillHtml(activo) {
  if (activo === false) return '<span class="pill status-inactive"><span class="dot"></span>PAUSADO</span>';
  return '<span class="pill status-active"><span class="dot ok"></span>ACTIVE</span>';
}
// Línea "$X invertido · $Y libre" (2026-08-20, pedido explícito: "cuando
// dinero está en inversión y cuánto está libre de cada bot") — reusada en el
// header de las 5 páginas individuales.
function investedFreeHtml(capitalInvertido, capitalLibre) {
  if (capitalInvertido === undefined || capitalInvertido === null) return '';
  return `${fmtUsd(capitalInvertido)} invertido · ${fmtUsd(capitalLibre)} libre`;
}
const RANK_MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
// formatTimePeru (2026-08-23, pedido explícito: "columna con hora de Perú
// UTC-5" en DCA Execution History) — dos líneas en la misma celda, hora
// servidor (UTC) arriba en gris y hora Perú abajo en blanco/negrita, para
// que el usuario no tenga que restar 5h a mano en cada trade.
function formatTimePeru(iso) {
  if (!iso) return '—';
  const fecha = new Date(iso);
  const utcStr = fecha.toLocaleString('es-PE', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const peruStr = fecha.toLocaleString('es-PE', {
    timeZone: 'America/Lima',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `<span class="time-utc">${utcStr} UTC</span><span class="time-peru">${peruStr} PE</span>`;
}

// =========================================================================
// PÁGINA: OVERVIEW
// =========================================================================
function overviewSkeleton() {
  return `
    <div class="page-header">
      <div class="ph-title">TOTAL PORTFOLIO VALUE</div>
      <div class="ph-value" id="ovCapital">—</div>
      <div class="ph-sub">
        <span id="ovPnlInline">—</span>
        <span id="ovStatusPill"></span>
        <span id="ovModePill"></span>
      </div>
    </div>
    <div class="stat-row">
      <div class="stat-box"><div class="stat-label">24H Profit/Loss</div><div class="stat-value" id="ovPnl24h">—</div></div>
      <div class="stat-box"><div class="stat-label">Active Bots</div><div class="stat-value" id="ovActiveBots">—</div></div>
      <div class="stat-box"><div class="stat-label">Win Rate</div><div class="stat-value" id="ovWinRate">—</div></div>
    </div>
    <div class="chart-card">
      <div class="chart-card-title">Capital total</div>
      <div class="period-selector" id="ovPeriodSelector">
        <button class="period-btn" data-period="24h">24H</button>
        <button class="period-btn active" data-period="7d">7D</button>
        <button class="period-btn" data-period="30d">30D</button>
      </div>
      <div id="ovChartPlaceholder" class="chart-placeholder">Cargando gráfica…</div>
      <div id="ovChartContainer" class="chart-el" style="display:none;"></div>
    </div>
    <div class="section-title">Active Strategy Performance</div>
    <div class="bots-grid" id="ovBotsGrid"><div class="empty-state skeleton">Cargando…</div></div>
  `;
}

let ovCurrentPeriod = '7d';
async function loadOverviewChart(period, force = false) {
  try {
    const raw = await fetchJson(`/api/capital-chart?period=${period}`, { force });
    if (!raw || raw.length === 0) {
      $('ovChartPlaceholder').style.display = 'flex';
      $('ovChartPlaceholder').textContent = 'Sin datos de capital todavía.';
      return;
    }
    const points = downsample(raw, 200);
    $('ovChartPlaceholder').style.display = 'none';
    $('ovChartContainer').style.display = 'block';
    const { chart, series } = ensureAreaChart('ovChartContainer', '#00ff88');
    series.setData(points);
    chart.timeScale().fitContent();
  } catch (err) {
    if ($('ovChartPlaceholder')) { $('ovChartPlaceholder').style.display = 'flex'; $('ovChartPlaceholder').textContent = 'No se pudo cargar la gráfica.'; }
  }
}

function renderOverviewBots(bots) {
  const container = $('ovBotsGrid');
  if (!bots || bots.length === 0) {
    container.innerHTML = '<div class="empty-state">Sin bots activos.</div>';
    return;
  }
  // bots ya viene ordenado por capital actual descendente (ver /api/overview)
  // — medallas 🥇🥈🥉4️⃣5️⃣ (2026-08-20, pedido explícito "ranking").
  container.innerHTML = bots.map((b, i) => {
    const color = b.dailyPnl >= 0 ? '#00ff88' : '#ff4444';
    const pfTxt = b.pfHoy === null || b.pfHoy === undefined ? '—' : (b.pfHoy >= 999 ? '∞' : b.pfHoy.toFixed(2));
    const pfBadge = b.trades > 0 ? (b.pfHoy >= 1.3 ? ' 🌟' : b.pfHoy >= 1.0 ? ' ✅' : ' ⚠️') : '';
    const medal = RANK_MEDALS[i] || `${i + 1}`;
    return `
      <div class="bot-card" data-bot-route="${b.id}">
        <div class="bc-top">
          <div class="bc-name">${medal} ${b.emoji} ${esc(b.nombre)}</div>
          ${b.activo === false ? '<span class="pill status-inactive">Pausado</span>' : ''}
        </div>
        <div class="bc-sub">${esc(b.subtitulo)}</div>
        <div class="bc-row"><span class="label">Daily</span><span class="value ${pnlClass(b.dailyPnl)}">${fmtUsd(b.dailyPnl)}</span></div>
        <div class="bc-row"><span class="label">Trades</span><span class="value">${b.trades}</span></div>
        <div class="bc-row"><span class="label">PF hoy</span><span class="value">${pfTxt}${pfBadge}</span></div>
        ${b.capitalInvertido !== undefined ? `<div class="bc-row"><span class="label">Capital</span><span class="value">${investedFreeHtml(b.capitalInvertido, b.capitalLibre)}</span></div>` : ''}
        <div class="bc-spark">${sparklineSvg(b.sparkline, color)}</div>
      </div>`;
  }).join('');

  container.querySelectorAll('.bot-card').forEach((card) => {
    card.addEventListener('click', async () => {
      const id = card.dataset.botRoute;
      if (id === 'motorB') { window.location.hash = 'motorb'; return; }
      if (id === 'motorA') { window.location.hash = 'motora'; return; }
      const ranking = await getRanking();
      const bot = ranking.find((b) => String(b.id) === id);
      const routeMap = { competitionGrid: 'bot2', competitionDca: 'bot3', competitionDcaMotorA: 'bot4' };
      if (bot && routeMap[bot.estrategia]) window.location.hash = routeMap[bot.estrategia];
    });
  });
}

// renderOverviewSkeleton (2026-08-20, arreglo de parpadeo — pedido
// explícito): construye el HTML de la página UNA sola vez, al entrar a la
// ruta. refreshOverview() se llama en cada poll y SOLO actualiza texto de
// elementos existentes — nunca vuelve a tocar $('content').innerHTML, así
// que no hay parpadeo ni reseteo de scroll en el polling silencioso.
function renderOverviewSkeleton() {
  $('content').innerHTML = overviewSkeleton();
  $('ovPeriodSelector').querySelectorAll('.period-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.period === ovCurrentPeriod);
    btn.addEventListener('click', () => {
      if (btn.dataset.period === ovCurrentPeriod) return;
      $('ovPeriodSelector').querySelectorAll('.period-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      ovCurrentPeriod = btn.dataset.period;
      loadOverviewChart(ovCurrentPeriod, true);
    });
  });
}

async function refreshOverview() {
  try {
    const data = await fetchJson('/api/overview');
    $('ovCapital').textContent = fmtUsd(data.capitalTotal);
    $('ovPnlInline').innerHTML = `<span class="${pnlClass(data.pnlHoy)}">${fmtUsd(data.pnlHoy)} (${fmtPct(data.pnlPct)})</span>`;
    $('ovStatusPill').innerHTML = data.estado === 'operando'
      ? '<span class="pill status-active"><span class="dot ok"></span>OPERANDO</span>'
      : '<span class="pill status-paused"><span class="dot bad"></span>PAUSADO</span>';
    $('ovModePill').innerHTML = modePillHtml(data.modo);

    const pnl24hEl = $('ovPnl24h');
    pnl24hEl.textContent = `${fmtUsd(data.pnlHoy)} (${fmtPct(data.pnlPct)})`;
    pnl24hEl.className = `stat-value ${pnlClass(data.pnlHoy)}`;
    // Bot 4 con dinero real (2026-08-21, pedido explícito, Opción A —
    // "todo el foco en el bot real"): con MODE=live en el bot, Motor A/B y
    // Bot 2/3 quedan sin cron (ver BOT4_LIVE_FOCUS en bot.js) — el Overview
    // deja de mostrarlos para no confundir con bots pausados. Si el bot
    // vuelve a MODE=paper (arquitectura completa de 5 bots), vuelven a
    // aparecer solos, sin tocar código de nuevo.
    const bots = data.modo === 'live' ? data.bots.filter((b) => b.estrategia === 'competitionDcaMotorA') : data.bots;
    $('ovActiveBots').textContent = `${bots.filter((b) => b.activo !== false).length} Running`;
    $('ovWinRate').textContent = `${data.winRateGlobal}% / ${data.tradesHoy} trades`;

    renderOverviewBots(bots);
  } catch (err) {
    $('ovBotsGrid').innerHTML = '<div class="empty-state">No se pudo cargar el overview (reintentando…)</div>';
  }
  loadOverviewChart(ovCurrentPeriod);
}

// =========================================================================
// PÁGINA: MOTOR B — Scalping Selectivo
// =========================================================================
function motorBSkeleton() {
  return `
    <div class="bot-page-header">
      <div class="bph-title">🔄 Motor B — Scalping Selectivo <span id="mbStatusPill"></span></div>
      <div class="bph-capital"><span id="mbCapital">—</span> <span id="mbPct" class="pct"></span> ${modePillHtml('paper')}</div>
      <div class="stat-sub" id="mbInvestedFree"></div>
    </div>

    <div class="subnav" id="mbSubnav">
      <button class="subnav-btn active" data-sub="portfolio">Portfolio</button>
      <button class="subnav-btn" data-sub="orders">Orders</button>
      <button class="subnav-btn" data-sub="history">History</button>
    </div>

    <div class="stat-row" id="mbStatRow">
      <div class="stat-box"><div class="stat-label">Avg Profit/Trade</div><div class="stat-value" id="mbAvgProfit">—</div></div>
      <div class="stat-box"><div class="stat-label">Max Drawdown (24h)</div><div class="stat-value" id="mbDrawdown">—</div></div>
      <div class="stat-box"><div class="stat-label">Total Trades (hoy)</div><div class="stat-value" id="mbTrades">—</div></div>
    </div>

    <div class="subnav-panel active" data-panel="portfolio">
      <div class="chart-card">
        <div class="chart-card-title">Capital — Motor B</div>
        <div class="period-selector" id="mbPeriodSelector">
          <button class="period-btn active" data-period="1">1D</button>
          <button class="period-btn" data-period="7">7D</button>
          <button class="period-btn" data-period="30">30D</button>
        </div>
        <div id="mbChartPlaceholder" class="chart-placeholder">Cargando gráfica…</div>
        <div id="mbChartContainer" class="chart-el" style="display:none;"></div>
      </div>
    </div>

    <div class="subnav-panel" data-panel="orders">
      <div class="panel">
        <div class="panel-title">Posiciones abiertas (PnL en vivo)</div>
        <div id="mbPositions"><div class="empty-state skeleton">Cargando…</div></div>
      </div>
    </div>

    <div class="subnav-panel" data-panel="history">
      <div class="panel">
        <div class="panel-title">Recent Trades</div>
        <div class="table-wrap" id="mbHistory"><div class="empty-state skeleton">Cargando…</div></div>
      </div>
    </div>
  `;
}

function tradesTableHtml(trades) {
  if (!trades || trades.length === 0) return '<div class="empty-state">Sin trades todavía.</div>';
  const rows = trades.map((t) => {
    const time = formatTimePeru(t.closedAt || t.createdAt);
    const sideTxt = (t.side || 'buy').toUpperCase();
    const rowClass = t.outcome === 'open' ? '' : (t.pnl >= 0 ? 'row-buy' : 'row-sell');
    return `
      <tr class="${rowClass}">
        <td>${time}</td>
        <td>${esc(t.pair)}</td>
        <td class="side-cell side-${t.side || 'buy'}">${sideTxt}</td>
        <td>${fmtUsdPrecise(t.entryPrice, t.entryPrice < 10 ? 4 : 2)}</td>
        <td>${fmtUsd(t.sizeUsdt)}</td>
        <td class="${pnlClass(t.pnl)}">${t.outcome === 'open' ? 'abierto' : fmtUsd(t.pnl)}</td>
      </tr>`;
  }).join('');
  return `
    <table class="data-table">
      <thead><tr><th>Time</th><th>Pair</th><th>Side</th><th>Price</th><th>Size</th><th>PnL</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function positionsListHtml(positions) {
  if (!positions || positions.length === 0) return '<div class="empty-state">Sin posiciones abiertas.</div>';
  return `<div class="table-wrap"><table class="data-table">
    <thead><tr><th>Pair</th><th>Size</th><th>Entry</th><th>Current</th><th>PnL</th><th>Tiempo</th></tr></thead>
    <tbody>
      ${positions.map((p) => `
        <tr>
          <td>${esc(p.pair)}</td>
          <td>${fmtUsd(p.sizeUsdt)}</td>
          <td>${fmtUsdPrecise(p.entryPrice, p.entryPrice < 10 ? 4 : 2)}</td>
          <td>${p.currentPrice !== null ? fmtUsdPrecise(p.currentPrice, p.currentPrice < 10 ? 4 : 2) : '—'}</td>
          <td class="${pnlClass(p.pnlActual)}">${fmtUsd(p.pnlActual)} (${fmtPct(p.pnlPct)})</td>
          <td>${p.tiempoAbierto || '—'}</td>
        </tr>`).join('')}
    </tbody>
  </table></div>`;
}

let mbPeriod = '1';
async function loadMotorBChart(days, force = false) {
  try {
    const raw = await fetchJson(`/api/competition/bot/motorB/chart?days=${days}`, { force });
    if (!raw || raw.length === 0) {
      $('mbChartPlaceholder').style.display = 'flex';
      $('mbChartPlaceholder').textContent = 'Sin historial de capital todavía (sin trades cerrados).';
      return;
    }
    const points = raw.map((p) => ({ time: Math.floor(new Date(p.timestamp).getTime() / 1000), value: p.capital }));
    $('mbChartPlaceholder').style.display = 'none';
    $('mbChartContainer').style.display = 'block';
    const { chart, series } = ensureAreaChart('mbChartContainer', '#00ff88');
    series.setData(downsample(points, 200));
    chart.timeScale().fitContent();
  } catch (err) {
    $('mbChartPlaceholder').style.display = 'flex';
    $('mbChartPlaceholder').textContent = 'No se pudo cargar la gráfica.';
  }
}

function wireSubnav(navId, onSwitch) {
  $(navId).querySelectorAll('.subnav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $(navId).querySelectorAll('.subnav-btn').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.subnav-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === btn.dataset.sub));
      onSwitch(btn.dataset.sub);
    });
  });
}

const mbLoadedOnce = new Set();
let mbActiveSub = 'portfolio';
// renderMotorBSkeleton/refreshMotorB (2026-08-20, arreglo de parpadeo): el
// comentario original sobre "el polling reconstruye este HTML entero" ya no
// aplica — el skeleton se construye una sola vez por visita a la ruta, el
// polling solo llama a refreshMotorB(). El sync de sub-tab activo se
// mantiene igual (sigue haciendo falta al entrar/volver a la ruta).
function renderMotorBSkeleton() {
  $('content').innerHTML = motorBSkeleton();

  $('mbSubnav').querySelectorAll('.subnav-btn').forEach((b) => b.classList.toggle('active', b.dataset.sub === mbActiveSub));
  document.querySelectorAll('.subnav-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === mbActiveSub));

  $('mbPeriodSelector').querySelectorAll('.period-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.period === mbPeriod);
    btn.addEventListener('click', () => {
      if (btn.dataset.period === mbPeriod) return;
      $('mbPeriodSelector').querySelectorAll('.period-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      mbPeriod = btn.dataset.period;
      loadMotorBChart(mbPeriod, true);
    });
  });
  mbLoadedOnce.clear();
  wireSubnav('mbSubnav', (sub) => {
    mbActiveSub = sub;
    if (sub === 'orders' && !mbLoadedOnce.has('orders')) { mbLoadedOnce.add('orders'); loadMotorBOrders(); }
    if (sub === 'history' && !mbLoadedOnce.has('history')) { mbLoadedOnce.add('history'); loadMotorBHistory(); }
  });
  // El sub-tab activo tras sincronizar arriba puede no ser "portfolio" —
  // wireSubnav solo dispara el loader en el click, así que hace falta
  // pedir sus datos ahora mismo si venimos de un refresh en Orders/History.
  if (mbActiveSub === 'orders') { mbLoadedOnce.add('orders'); loadMotorBOrders(); }
  if (mbActiveSub === 'history') { mbLoadedOnce.add('history'); loadMotorBHistory(); }
}

async function refreshMotorB() {
  try {
    const [bot, stats] = await Promise.all([
      fetchJson('/api/competition/bot/motorB'),
      fetchJson('/api/bot/motorb/stats'),
    ]);
    $('mbStatusPill').innerHTML = statusPillHtml(bot.activo);
    $('mbCapital').textContent = fmtUsd(bot.capitalActual);
    const pctEl = $('mbPct');
    pctEl.textContent = fmtPct(bot.pnlPct);
    pctEl.className = `pct ${pnlClass(bot.pnlPct)}`;
    $('mbInvestedFree').textContent = investedFreeHtml(bot.capitalInvertido, bot.capitalLibre);

    $('mbAvgProfit').innerHTML = `<span class="${pnlClass(stats.avgProfitPerTradeUsd)}">${fmtUsd(stats.avgProfitPerTradeUsd)}</span>`;
    $('mbAvgProfit').insertAdjacentHTML('beforeend', `<div class="stat-sub">${fmtPct(stats.avgProfitPerTradePct, 3)}</div>`);
    $('mbDrawdown').innerHTML = `<span class="pnl-neg">-${stats.maxDrawdown24hPct}%</span>`;
    $('mbDrawdown').insertAdjacentHTML('beforeend', `<div class="stat-sub">-${fmtUsd(stats.maxDrawdown24hUsd)}</div>`);
    $('mbTrades').textContent = stats.totalTradesHoy;
  } catch (err) {
    $('mbStatRow').innerHTML = '<div class="empty-state">No se pudo cargar el estado de Motor B.</div>';
  }
  loadMotorBChart(mbPeriod);
  if (mbActiveSub === 'orders') loadMotorBOrders();
  if (mbActiveSub === 'history') loadMotorBHistory();
}
async function loadMotorBOrders() {
  try {
    const positions = await fetchJson('/api/competition/bot/motorB/positions');
    $('mbPositions').innerHTML = positionsListHtml(positions);
  } catch (err) {
    $('mbPositions').innerHTML = '<div class="empty-state">No se pudo cargar.</div>';
  }
}
async function loadMotorBHistory() {
  try {
    const trades = await fetchJson('/api/competition/bot/motorB/trades?limit=50');
    const closed = trades.filter((t) => t.outcome !== 'open');
    $('mbHistory').innerHTML = tradesTableHtml(closed);
  } catch (err) {
    $('mbHistory').innerHTML = '<div class="empty-state">No se pudo cargar.</div>';
  }
}

// =========================================================================
// PÁGINA: MOTOR A DCA (real, parte del bot principal)
// =========================================================================
function accumulationPairBlock(label, p) {
  if (!p) return '';
  const progressPct = p.maxCompras > 0 ? Math.round((p.compras / p.maxCompras) * 100) : 0;
  return `
    <div class="pair-block">
      <div class="pair-block-title">${label} <span class="stat-sub">${p.compras}/${p.maxCompras} compras</span></div>
      <div class="kv-row"><span class="label">Avg Entry</span><span class="value">${p.avgEntry !== null ? fmtUsdPrecise(p.avgEntry) : '—'}</span></div>
      <div class="kv-row"><span class="label">Precio actual</span><span class="value">${p.currentPrice !== null ? fmtUsdPrecise(p.currentPrice) : '—'}</span></div>
      <div class="kv-row"><span class="label">Capital invertido</span><span class="value">${fmtUsd(p.capitalInvertido ?? p.totalInvested)}</span></div>
      ${p.capitalAsignado !== undefined ? `<div class="kv-row"><span class="label">Capital asignado</span><span class="value">${fmtUsd(p.capitalAsignado)}</span></div>` : ''}
      <div class="ladder"><div class="ladder-step"><div class="ladder-bar"><div class="ladder-fill" style="width:${progressPct}%"></div></div><span class="stat-sub">${progressPct}%</span></div></div>
      ${p.nextTriggerPrice !== null ? `
        <div class="kv-row" style="margin-top:8px;"><span class="label">Próximo trigger</span><span class="value">${fmtUsdPrecise(p.nextTriggerPrice)}</span></div>
        <div class="kv-row"><span class="label">Drop necesario</span><span class="value pnl-neg">-${p.dropRequiredPct}%</span></div>
      ` : `<div class="stat-sub" style="margin-top:8px;">${p.compras >= p.maxCompras ? 'Ciclo completo, esperando Take Profit.' : 'Esperando caída para la próxima compra.'}</div>`}
    </div>`;
}

function motorASkeleton() {
  return `
    <div class="bot-page-header">
      <div class="bph-title">💛 Motor A — DCA BTC/ETH <span id="maStatusPill"></span></div>
      <div class="stat-sub">Capital 100% propio ($1,000), independiente de Motor B.</div>
      <div class="bph-capital"><span id="maCapital">—</span> ${modePillHtml('paper')}</div>
      <div class="stat-sub" id="maInvestedFree"></div>
    </div>
    <div id="maErrorBanner"></div>

    <div class="stat-row">
      <div class="stat-box"><div class="stat-label">Profit Factor (7d)</div><div class="stat-value" id="maPf">—</div></div>
      <div class="stat-box"><div class="stat-label">Winrate (7d)</div><div class="stat-value" id="maWr">—</div></div>
      <div class="stat-box"><div class="stat-label">Trades (hoy / 7d)</div><div class="stat-value" id="maTrades">—</div></div>
    </div>

    <div class="section-title">Accumulation Path</div>
    <div class="two-col">
      <div>
        <div id="maBtcBlock"></div>
        <div id="maEthBlock"></div>
      </div>
      <div>
        <div class="panel">
          <div class="panel-title">Capital asignado</div>
          <div id="maCapitalPanel"><div class="empty-state skeleton">Cargando…</div></div>
        </div>
        <div class="panel">
          <div class="panel-title">Configuración</div>
          <div id="maConfigPanel"><div class="empty-state skeleton">Cargando…</div></div>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">DCA Execution History</div>
      <div class="table-wrap" id="maHistory"><div class="empty-state skeleton">Cargando…</div></div>
    </div>
  `;
}

function renderMotorASkeleton() {
  $('content').innerHTML = motorASkeleton();
}

async function refreshMotorA() {
  try {
    const data = await fetchJson('/api/bot/motora/stats');
    $('maStatusPill').innerHTML = statusPillHtml(data.activo);
    $('maCapital').textContent = fmtUsd(data.capitalAsignado);
    $('maInvestedFree').textContent = investedFreeHtml(data.capitalInvertido, data.capitalLibre);
    $('maPf').textContent = data.pf7d >= 999 ? '∞' : data.pf7d;
    $('maWr').textContent = `${data.winrate7d}%`;
    $('maTrades').textContent = `${data.tradesHoy} / ${data.trades7d}`;

    $('maBtcBlock').innerHTML = accumulationPairBlock('₿ BTC', data.btc);
    $('maEthBlock').innerHTML = accumulationPairBlock('Ξ ETH', data.eth);

    $('maCapitalPanel').innerHTML = `
      <div class="kv-row"><span class="label">Total (${data.capitalPct}%)</span><span class="value">${fmtUsd(data.capitalAsignado)}</span></div>
      <div class="kv-row"><span class="label">BTC</span><span class="value">${fmtUsd(data.btc.capitalAsignado)}</span></div>
      <div class="kv-row"><span class="label">ETH</span><span class="value">${fmtUsd(data.eth.capitalAsignado)}</span></div>
      <div class="kv-row"><span class="label">PnL 7d</span><span class="value ${pnlClass(data.pnl7d)}">${fmtUsd(data.pnl7d)}</span></div>`;

    $('maConfigPanel').innerHTML = `
      <div class="kv-row"><span class="label">Drop</span><span class="value">${esc(data.config.dropModeLabel)}</span></div>
      <div class="kv-row"><span class="label">Take Profit</span><span class="value">${data.config.tpMinPct}% – ${data.config.tpMaxPct}%</span></div>
      <div class="kv-row"><span class="label">Máx. compras</span><span class="value">${data.config.maxCompras}</span></div>
      <div class="kv-row"><span class="label">Timeout</span><span class="value">${data.config.timeoutHoras}h</span></div>`;

    $('maHistory').innerHTML = tradesTableHtml(data.historial.filter((t) => t.outcome !== 'open'));
    $('maErrorBanner').innerHTML = '';
  } catch (err) {
    // Contenedor dedicado (2026-08-20, mismo criterio que Bot 2) — evita
    // acumular un mensaje de error por cada poll fallido.
    $('maErrorBanner').innerHTML = '<div class="empty-state">No se pudo cargar Motor A.</div>';
  }
}

// =========================================================================
// PÁGINA: BOT 2 — GRID BTC/ETH
// =========================================================================
function gridLevelsTable(pair, data) {
  if (!data || data.currentPrice === null) return '<div class="empty-state">Sin datos de precio.</div>';
  const rows = [];
  (data.buyLevels || []).forEach((l) => {
    rows.push({ price: l.price, type: 'BUY', status: l.status === 'FILLED' ? 'filled' : 'pending-buy', statusLabel: l.status === 'FILLED' ? 'FILLED' : 'PENDING', amount: data.capitalPorNivel / l.price, total: data.capitalPorNivel });
  });
  (data.sellLevels || []).forEach((l) => {
    rows.push({ price: l.price, type: 'SELL', status: 'pending-sell', statusLabel: 'PENDING', amount: l.amountUsd / l.price, total: l.amountUsd });
  });
  rows.push({ price: data.currentPrice, type: 'CURRENT', status: 'current', statusLabel: 'PRECIO ACTUAL', amount: null, total: null });
  rows.sort((a, b) => b.price - a.price);

  const rowsHtml = rows.map((r) => `
    <tr class="${r.type === 'CURRENT' ? '' : (r.type === 'BUY' ? 'row-buy' : 'row-sell')}">
      <td>${r.type === 'CURRENT' ? '⭐ ACTUAL' : r.type}</td>
      <td>${fmtUsdPrecise(r.price, r.price < 10 ? 4 : 2)}</td>
      <td>${r.amount !== null ? r.amount.toFixed(6) : '—'}</td>
      <td>${r.total !== null ? fmtUsd(r.total) : '—'}</td>
      <td><span class="badge-status ${r.status}">${r.statusLabel}</span></td>
    </tr>`).join('');

  return `<div class="table-wrap"><table class="data-table">
    <thead><tr><th>Type</th><th>Price</th><th>Amount</th><th>Total</th><th>Status</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table></div>`;
}

function bot2Skeleton() {
  return `
    <div class="bot-page-header">
      <div class="bph-title">📐 Bot 2 — Grid BTC/ETH <span id="b2StatusPill"></span></div>
      <div class="bph-capital"><span id="b2Capital">—</span> <span id="b2Pct" class="pct"></span> ${modePillHtml('paper')}</div>
      <div class="stat-sub" id="b2InvestedFree"></div>
    </div>
    <div id="b2ErrorBanner"></div>
    <div class="stat-row">
      <div class="stat-box"><div class="stat-label">Grid Profit</div><div class="stat-value" id="b2GridProfit">—</div></div>
      <div class="stat-box"><div class="stat-label">Floating PnL</div><div class="stat-value" id="b2Floating">—</div></div>
      <div class="stat-box"><div class="stat-label">Grids Filled</div><div class="stat-value" id="b2Filled">—</div></div>
    </div>
    <div class="panel">
      <div class="panel-title">₿ BTC/USDT — Grid Levels</div>
      <div id="b2BtcTable"><div class="empty-state skeleton">Cargando…</div></div>
    </div>
    <div class="panel">
      <div class="panel-title">Ξ ETH/USDT — Grid Levels</div>
      <div id="b2EthTable"><div class="empty-state skeleton">Cargando…</div></div>
    </div>
  `;
}

function renderBot2Skeleton() {
  $('content').innerHTML = bot2Skeleton();
}

async function refreshBot2() {
  try {
    const id = await getBotIdByEstrategia('competitionGrid');
    if (id === null) throw new Error('bot no encontrado');
    const [bot, positions, levels] = await Promise.all([
      fetchJson(`/api/competition/bot/${id}`),
      fetchJson(`/api/competition/bot/${id}/positions`),
      fetchJson('/api/bot/grid/levels'),
    ]);
    $('b2StatusPill').innerHTML = statusPillHtml(bot.activo);
    $('b2Capital').textContent = fmtUsd(bot.capitalActual);
    $('b2InvestedFree').textContent = investedFreeHtml(bot.capitalInvertido, bot.capitalLibre);
    const pctEl = $('b2Pct');
    pctEl.textContent = fmtPct(bot.pnlPct);
    pctEl.className = `pct ${pnlClass(bot.pnlPct)}`;

    const gridProfitEl = $('b2GridProfit');
    gridProfitEl.textContent = fmtUsd(bot.pnl);
    gridProfitEl.className = `stat-value ${pnlClass(bot.pnl)}`;

    const floating = positions.reduce((s, p) => s + (p.pnlActual || 0), 0);
    const floatEl = $('b2Floating');
    floatEl.textContent = fmtUsd(floating);
    floatEl.className = `stat-value ${pnlClass(floating)}`;

    const totalLlenos = (levels['BTC/USDT']?.nivelesLlenos || 0) + (levels['ETH/USDT']?.nivelesLlenos || 0);
    const totalNiveles = (levels['BTC/USDT']?.nivelesTotal || 0) + (levels['ETH/USDT']?.nivelesTotal || 0);
    $('b2Filled').textContent = `${totalLlenos}/${totalNiveles}`;

    $('b2BtcTable').innerHTML = gridLevelsTable('BTC/USDT', levels['BTC/USDT']);
    $('b2EthTable').innerHTML = gridLevelsTable('ETH/USDT', levels['ETH/USDT']);
    $('b2ErrorBanner').innerHTML = '';
  } catch (err) {
    // Contenedor dedicado (2026-08-20) en vez de `content.innerHTML +=`: con
    // el refresh corriendo cada 15s, appendear sin límite habría acumulado
    // un mensaje de error por cada poll fallido.
    $('b2ErrorBanner').innerHTML = '<div class="empty-state">No se pudo cargar Bot 2 — Grid.</div>';
  }
}

// =========================================================================
// PÁGINAS: BOT 3 (DCA Agresivo) / BOT 4 (DCA BTC/ETH) — renderer compartido
// =========================================================================
// Actualización en tiempo real sin recargar la página (2026-08-22, pedido
// explícito) — "Accumulation Path" y "DCA Execution History" son las dos
// secciones que antes solo se veían frescas recargando. Se resuelven con:
//   - Accumulation Path: skeleton de bloques por par construido UNA vez por
//     visita a la ruta (ids estables por par), después cada refresh solo pisa
//     texto de elementos existentes (misma técnica que ya usa el resto del
//     dashboard, ver comentario de ROUTE_RENDER/ROUTE_REFRESH más abajo).
//   - DCA Execution History: la tabla se arma una vez; los refresh
//     siguientes solo insertan las filas NUEVAS al principio del <tbody>
//     (con fade-in vía .row-new en style.css) — nunca se borran ni
//     reconstruyen las filas existentes.
//   - Gráfica de capital propia (nueva, /api/competition/bot/:id/chart, ya
//     existía en el backend para Motor B): en la carga inicial usa setData,
//     en los refresh siguientes solo agrega el punto nuevo con
//     series.update() — nunca vuelve a redibujar toda la serie.
// Bot 3 y Bot 4 comparten este renderer — los cambios de acá benefician a
// los dos por igual, no es exclusivo de Bot 4.
let dcaPairKeys = null; // set de pares (string) ya renderizado en el skeleton — null fuerza reconstruir
let dcaKnownTradeKeys = null; // Set<string> de trades ya en la tabla de historial — null fuerza reconstruir
let dcaKnownCycleKeys = null; // Set<string> de ciclos ya en "Historial de Ciclos" (solo Bot 4) — null fuerza reconstruir
let dcaChartLastTime = null; // timestamp (unix seg) del último punto ya graficado
let dcaCurrentBotId = null; // id de bot_instances resuelto en el último refresh — lo usa el selector de período de la gráfica
let dcaPeriod = '7';

function pairIdPrefix(pair) { return `dca-${pair.split('/')[0].toLowerCase()}`; }

// accumulationPairBlockSkeleton/updateAccumulationPairBlock: separan
// estructura (una vez) de datos (cada refresh) — accumulationPairBlock()
// de más arriba (usada por Motor A) sigue igual, sin tocar, esto es
// exclusivo de la página compartida Bot 3/Bot 4.
function accumulationPairBlockSkeleton(label, idPrefix) {
  return `
    <div class="pair-block">
      <div class="pair-block-title">${esc(label)} <span class="stat-sub" id="${idPrefix}-ciclo">—</span></div>
      <div class="kv-row"><span class="label">Avg Entry</span><span class="value" id="${idPrefix}-avg-entry">—</span></div>
      <div class="kv-row"><span class="label">Precio actual</span><span class="value" id="${idPrefix}-precio-actual">—</span></div>
      <div class="kv-row"><span class="label">Capital invertido</span><span class="value" id="${idPrefix}-capital-invertido">—</span></div>
      <div id="${idPrefix}-tp-block"></div>
      <div class="ladder"><div class="ladder-step"><div class="ladder-bar"><div class="ladder-fill" id="${idPrefix}-progress-fill" style="width:0%"></div></div><span class="stat-sub" id="${idPrefix}-progress-pct">0%</span></div></div>
      <div id="${idPrefix}-trigger-block"></div>
    </div>`;
}
function updateAccumulationPairBlock(idPrefix, p) {
  if (!p) return;
  const progressPct = p.maxCompras > 0 ? Math.round((p.compras / p.maxCompras) * 100) : 0;
  $(`${idPrefix}-ciclo`).textContent = `${p.compras}/${p.maxCompras} compras`;
  $(`${idPrefix}-avg-entry`).textContent = p.avgEntry !== null ? fmtUsdPrecise(p.avgEntry) : '—';
  $(`${idPrefix}-precio-actual`).textContent = p.currentPrice !== null ? fmtUsdPrecise(p.currentPrice) : '—';
  $(`${idPrefix}-capital-invertido`).textContent = fmtUsd(p.totalInvested);
  // TP actual del ciclo / precio de venta (2026-08-23, pedido explícito) —
  // solo se muestra si hay compras abiertas (p.tpPct viene null si el par
  // todavía no tiene ningún trade abierto).
  $(`${idPrefix}-tp-block`).innerHTML = p.tpPct !== null ? `
    <div class="tp-divider"></div>
    <div class="kv-row"><span class="label">🎯 TP actual</span><span class="value">${p.tpPct}%</span></div>
    <div class="kv-row"><span class="label">💰 Vende en</span><span class="value">${fmtUsdPrecise(p.precioVenta)}</span></div>
    <div class="kv-row"><span class="label">📈 Falta subir</span><span class="value pnl-pos">${fmtUsd(p.faltaSubir)} (+${p.faltaPct}%)</span></div>
    <div class="tp-divider"></div>
  ` : '';
  $(`${idPrefix}-progress-fill`).style.width = `${progressPct}%`;
  $(`${idPrefix}-progress-pct`).textContent = `${progressPct}%`;
  $(`${idPrefix}-trigger-block`).innerHTML = p.nextTriggerPrice !== null ? `
    <div class="kv-row" style="margin-top:8px;"><span class="label">Próximo trigger</span><span class="value">${fmtUsdPrecise(p.nextTriggerPrice)}</span></div>
    <div class="kv-row"><span class="label">Drop necesario</span><span class="value pnl-neg">-${p.dropRequiredPct}%</span></div>
  ` : `<div class="stat-sub" style="margin-top:8px;">${p.compras >= p.maxCompras ? 'Ciclo completo, esperando Take Profit.' : 'Esperando caída para la próxima compra.'}</div>`;
}
function renderAccumulationPathIncremental(pares) {
  const pairEntries = Object.entries(pares);
  const keys = pairEntries.map(([pair]) => pair).sort().join('|');
  if (keys !== dcaPairKeys) {
    dcaPairKeys = keys;
    $('dcaPairBlocks').innerHTML = pairEntries.map(([pair]) => accumulationPairBlockSkeleton(pair.split('/')[0], pairIdPrefix(pair))).join('');
  }
  pairEntries.forEach(([pair, p]) => updateAccumulationPairBlock(pairIdPrefix(pair), p));
}

// DCA Execution History incremental — la API no expone un id de trade (ver
// /api/competition/bot/:id/trades en server.js), así que se usa "pair +
// closedAt" como clave única (closedAt es un timestamp de Postgres con
// precisión de milisegundos, alcanza para no colisionar entre trades del
// mismo bot).
function tradeKey(t) { return `${t.pair}|${t.closedAt || t.createdAt}`; }
function tradeRowHtml(t, extraClass = '') {
  const time = formatTimePeru(t.closedAt || t.createdAt);
  const sideTxt = (t.side || 'buy').toUpperCase();
  const rowClass = [t.pnl >= 0 ? 'row-buy' : 'row-sell', extraClass].filter(Boolean).join(' ');
  return `
    <tr class="${rowClass}">
      <td>${time}</td>
      <td>${esc(t.pair)}</td>
      <td class="side-cell side-${t.side || 'buy'}">${sideTxt}</td>
      <td>${fmtUsdPrecise(t.entryPrice, t.entryPrice < 10 ? 4 : 2)}</td>
      <td>${fmtUsd(t.sizeUsdt)}</td>
      <td class="${pnlClass(t.pnl)}">${fmtUsd(t.pnl)}</td>
    </tr>`;
}
function renderDcaHistoryIncremental(closed) {
  const tbody = dcaKnownTradeKeys !== null ? $('dcaHistoryBody') : null;
  if (!tbody) {
    // Primera carga de esta visita a la ruta (o el contenedor todavía no
    // tenía tabla): arma todo de una, sin animación.
    dcaKnownTradeKeys = new Set(closed.map(tradeKey));
    $('dcaHistory').innerHTML = closed.length === 0
      ? '<div class="empty-state">Sin trades todavía.</div>'
      : `<table class="data-table">
          <thead><tr><th>Time</th><th>Pair</th><th>Side</th><th>Price</th><th>Size</th><th>PnL</th></tr></thead>
          <tbody id="dcaHistoryBody">${closed.map((t) => tradeRowHtml(t)).join('')}</tbody>
        </table>`;
    return;
  }
  // closed viene ordenado más nuevo primero (created_at DESC, ver
  // getTradesForBotInstance en queries.js) — se recorre desde el principio
  // hasta encontrar el primer trade ya conocido; todo lo anterior es nuevo.
  const nuevos = [];
  for (const t of closed) {
    const key = tradeKey(t);
    if (dcaKnownTradeKeys.has(key)) break;
    nuevos.push(t);
    dcaKnownTradeKeys.add(key);
  }
  if (nuevos.length === 0) return;
  // Se insertan en reversa para que, tras varios inserts al principio,
  // queden en el mismo orden (más nuevo primero) que trae la API.
  for (let i = nuevos.length - 1; i >= 0; i--) {
    tbody.insertAdjacentHTML('afterbegin', tradeRowHtml(nuevos[i], 'row-new'));
  }
}

// Historial de Ciclos (2026-08-24, pedido explícito, "reemplazar DCA
// Execution History con vista de ciclos" — exclusivo de Bot 4, GET
// /api/bot/4/cycles en server.js/nuvera-trading-bot): un ciclo = todas las
// compras DCA de un par que se cerraron JUNTAS en la misma venta (ver
// sellAll en competitionDcaMotorA.js) — antes se veía como N filas sueltas
// en la tabla de historial, ahora es UNA tarjeta expandible con el resumen
// del ciclo y, adentro, el detalle de cada compra. Misma técnica
// incremental que renderDcaHistoryIncremental (solo prepend de tarjetas
// nuevas) — clave única "par|cierreTs" (cierreTs = closed_at de la última
// compra del ciclo, ver server.js).
function cycleKey(c) { return `${c.par}|${c.cierreTs}`; }
function cycleCardHtml(c, extraClass = '') {
  const cardClass = ['cycle-card', extraClass].filter(Boolean).join(' ');
  const comprasHtml = c.compras.map((b) => `
    <tr>
      <td>${fmtUsdPrecise(b.precio, b.precio < 10 ? 4 : 2)}</td>
      <td>${fmtUsd(b.monto)}</td>
      <td class="${pnlClass(b.pnl)}">${fmtUsd(b.pnl)}</td>
    </tr>`).join('');
  return `
    <details class="${cardClass}">
      <summary>
        <div class="cycle-summary-row">
          <div class="cycle-summary-main">
            <span class="cycle-pair">${esc(c.par)}</span>
            <span class="cycle-meta">${esc(c.fechaInicio)} → ${esc(c.fechaFin)} (${esc(c.duracion)}) · ${c.numCompras} compras · ${fmtUsd(c.totalInvertido)} invertido</span>
          </div>
          <span class="cycle-outcome ${pnlClass(c.pnlTotal)}">${c.outcome === 'win' ? '✅' : '❌'} ${fmtUsd(c.pnlTotal)}<span class="cycle-chevron"> ▶</span></span>
        </div>
      </summary>
      <div class="cycle-body">
        <div class="kv-row"><span class="label">Precio promedio</span><span class="value">${fmtUsdPrecise(c.precioPromedio, c.precioPromedio < 10 ? 4 : 2)}</span></div>
        <div class="kv-row"><span class="label">Precio de salida</span><span class="value">${fmtUsdPrecise(c.precioSalida, c.precioSalida < 10 ? 4 : 2)}</span></div>
        <table class="data-table cycle-buys-table">
          <thead><tr><th>Precio</th><th>Monto</th><th>PnL</th></tr></thead>
          <tbody>${comprasHtml}</tbody>
        </table>
      </div>
    </details>`;
}
function renderDcaCyclesIncremental(ciclos) {
  const list = dcaKnownCycleKeys !== null ? $('dcaCyclesList') : null;
  if (!list) {
    // Primera carga de esta visita a la ruta: arma todas las tarjetas de una,
    // sin animación de "nuevo".
    dcaKnownCycleKeys = new Set(ciclos.map(cycleKey));
    $('dcaHistory').innerHTML = ciclos.length === 0
      ? '<div class="empty-state">Sin ciclos cerrados todavía.</div>'
      : `<div id="dcaCyclesList">${ciclos.map((c) => cycleCardHtml(c)).join('')}</div>`;
    return;
  }
  // ciclos viene ordenado más nuevo primero (ver /api/bot/4/cycles en
  // server.js) — se recorre desde el principio hasta el primer ciclo ya
  // conocido; todo lo anterior es nuevo.
  const nuevos = [];
  for (const c of ciclos) {
    const key = cycleKey(c);
    if (dcaKnownCycleKeys.has(key)) break;
    nuevos.push(c);
    dcaKnownCycleKeys.add(key);
  }
  if (nuevos.length === 0) return;
  for (let i = nuevos.length - 1; i >= 0; i--) {
    list.insertAdjacentHTML('afterbegin', cycleCardHtml(nuevos[i], 'row-new'));
  }
}

// Gráfica de capital de Bot 3/4 (2026-08-22, pedido explícito) — mismo
// helper genérico ensureAreaChart que Overview/Motor B, pero solo agrega el
// punto nuevo con series.update() en vez de volver a mandar toda la serie
// con setData() en cada refresh (eso es lo que "sin recargar toda la
// gráfica" pide evitar).
async function loadDcaChart(id, days, force = false) {
  try {
    let raw = await fetchJson(`/api/competition/bot/${id}/chart?days=${days}`, { force });
    if (!raw || raw.length === 0) {
      $('dcaChartPlaceholder').style.display = 'flex';
      $('dcaChartPlaceholder').textContent = 'Sin historial de capital todavía (sin trades cerrados).';
      return;
    }
    // No mezclar capital PAPER de antes de pasar a MODE=live con el capital
    // REAL de después (2026-08-22, pedido explícito: "el gráfico arranca en
    // mil tantos en vez de $65.11") — mismo criterio que ya usa el gráfico
    // de Overview (ver resolveBot4LiveChartScope en server.js), pero acá se
    // resuelve en el cliente: este endpoint genérico
    // (getBotInstanceCapitalHistory) no filtra por 'live_start', así que se
    // corta el array en el último evento 'live_start' que ya viene en la
    // respuesta (eventType por fila). No aplica (no-op) para bots que nunca
    // pasaron a live, como Bot 3.
    const liveStartIdx = raw.map((p) => p.eventType).lastIndexOf('live_start');
    if (liveStartIdx !== -1) raw = raw.slice(liveStartIdx);
    const points = raw
      .map((p) => ({ time: Math.floor(new Date(p.timestamp).getTime() / 1000), value: p.capital }))
      .sort((a, b) => a.time - b.time);
    $('dcaChartPlaceholder').style.display = 'none';
    $('dcaChartContainer').style.display = 'block';
    const { chart, series } = ensureAreaChart('dcaChartContainer', '#00ff88');
    if (dcaChartLastTime === null || force) {
      series.setData(downsample(points, 200));
      chart.timeScale().fitContent();
    } else {
      points.filter((p) => p.time > dcaChartLastTime).forEach((p) => series.update(p));
    }
    dcaChartLastTime = points[points.length - 1].time;
  } catch (err) {
    if ($('dcaChartPlaceholder')) { $('dcaChartPlaceholder').style.display = 'flex'; $('dcaChartPlaceholder').textContent = 'No se pudo cargar la gráfica.'; }
  }
}

// "🧠 Qué está pensando el bot" (2026-08-22, pedido explícito) — GET
// /api/bot/4/thoughts, exclusivo de Bot 4 (el endpoint no es genérico por
// id como el resto de la página compartida, así que Bot 3 no lo consulta).
function relativeTimeEs(iso) {
  if (!iso) return '—';
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `hace ${diffSec} segundo${diffSec === 1 ? '' : 's'}`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin} minuto${diffMin === 1 ? '' : 's'}`;
  const diffH = Math.round(diffMin / 60);
  return `hace ${diffH} hora${diffH === 1 ? '' : 's'}`;
}
function estadoGeneralThoughts(pensamientos) {
  if (!pensamientos || pensamientos.length === 0) return { icon: '⚪', label: 'SIN DATOS', sub: 'Todavía no hay pensamientos registrados.' };
  if (pensamientos.some((p) => p.decision === 'comprar')) return { icon: '🟢', label: 'COMPRANDO', sub: 'Encontró una entrada con confianza suficiente.' };
  return { icon: '🟡', label: 'ANALIZANDO', sub: 'Mercado bajo análisis, esperando mejor punto de entrada.' };
}
// Contexto semanal (2026-08-22, pedido explícito) — GET /api/bot/4/thoughts
// devuelve contextoSemanal.{btcCambio7d,ethCambio7d} (ver getMarketContext en
// competitionDcaMotorA.js, nuvera-trading-bot). Umbral ±10%: por encima de
// +10% es sobrecompra de la semana → naranja/cautela (mismo criterio que
// RSI_MAX_COMPRA del bot); por debajo de -10% es una caída fuerte → verde,
// porque para un bot DCA que compra el drop una caída grande es oportunidad,
// no riesgo (al revés del caso positivo). Entre medio, gris/normal.
function cambio7dInfo(pct) {
  if (pct === null || pct === undefined) return { texto: 'N/D', color: 'var(--text-sec)', icon: '' };
  const texto = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  if (pct > 10) return { texto, color: 'var(--yellow)', icon: ' ⚠️' };
  if (pct < -10) return { texto, color: 'var(--green)', icon: ' 🟢' };
  return { texto, color: 'var(--text-sec)', icon: '' };
}
function renderContextoSemanal(contextoSemanal) {
  if (!contextoSemanal) return '';
  const { btcCambio7d, ethCambio7d } = contextoSemanal;
  const btc = cambio7dInfo(btcCambio7d);
  const eth = cambio7dInfo(ethCambio7d);
  const sobreextendido = (btcCambio7d !== null && btcCambio7d > 10) || (ethCambio7d !== null && ethCambio7d > 10);
  const conDescuento = !sobreextendido && ((btcCambio7d !== null && btcCambio7d < -10) || (ethCambio7d !== null && ethCambio7d < -10));
  const resumen = sobreextendido
    ? '<div class="stat-sub" style="color:var(--yellow); margin-top:4px;">⚠️ Mercado sobreextendido — bot más cauteloso</div>'
    : conDescuento
      ? '<div class="stat-sub" style="color:var(--green); margin-top:4px;">🟢 Caída fuerte esta semana — posible oportunidad de compra</div>'
      : '';
  return `
    <div class="stat-sub" style="margin-top:10px; border-top:1px solid var(--border); padding-top:8px;">📈 CONTEXTO SEMANAL:</div>
    <div class="kv-row"><span class="label">BTC</span><span class="value" style="color:${btc.color};">${btc.texto} esta semana${btc.icon}</span></div>
    <div class="kv-row"><span class="label">ETH</span><span class="value" style="color:${eth.color};">${eth.texto} esta semana${eth.icon}</span></div>
    ${resumen}`;
}
function renderThoughtsPanel(data) {
  const pensamientos = data.pensamientos || [];
  const masReciente = pensamientos.reduce((max, p) => (!max || new Date(p.timestamp) > new Date(max.timestamp) ? p : max), null);
  const estado = estadoGeneralThoughts(pensamientos);
  const cuerpo = pensamientos.length === 0
    ? '<div class="empty-state">El bot todavía no registró ninguna decisión.</div>'
    : pensamientos.map((p) => `
      <div class="thought-block">
        <div class="thought-pair">${esc(p.par)}</div>
        <div class="thought-quote">💭 "${esc(p.razon || p.accion || 'sin detalle')}"</div>
        <div class="stat-sub">Confianza actual: ${p.confianza}% | Necesita: ${data.confianzaMinima}%</div>
      </div>`).join('');
  return `
    <div class="panel" style="border:1px solid #f0b90b55;">
      <div class="panel-title">🧠 Qué está pensando el bot</div>
      <div class="stat-sub" style="margin-bottom:10px;">Actualizado ${relativeTimeEs(masReciente && masReciente.timestamp)}</div>
      ${cuerpo}
      <div class="kv-row" style="margin-top:8px; border-top:1px solid var(--border); padding-top:8px;">
        <span class="label">Estado general</span>
        <span class="value">${estado.icon} ${estado.label}</span>
      </div>
      <div class="stat-sub">${esc(estado.sub)}</div>
      ${renderContextoSemanal(data.contextoSemanal)}
    </div>`;
}

function dcaBotSkeleton(title, emoji, isBot4 = false) {
  return `
    <div class="bot-page-header">
      <div class="bph-title">${emoji} ${esc(title)} <span id="dcaStatusPill"></span></div>
      <div class="bph-capital"><span id="dcaCapital">—</span> <span id="dcaPct" class="pct"></span> <span id="dcaModePill">${modePillHtml('paper')}</span></div>
      <div class="stat-sub" id="dcaInvestedFree"></div>
    </div>
    <div id="dcaErrorBanner"></div>
    <div id="dcaRealBalancePanel"></div>
    <div id="dcaThoughtsPanel"></div>
    <div class="stat-row">
      <div class="stat-box"><div class="stat-label">PnL total</div><div class="stat-value" id="dcaPnl">—</div></div>
      <div class="stat-box"><div class="stat-label">Winrate (7d)</div><div class="stat-value" id="dcaWr">—</div></div>
      <div class="stat-box"><div class="stat-label">Trades hoy / 7d</div><div class="stat-value" id="dcaTrades">—</div></div>
    </div>
    <div class="chart-card">
      <div class="chart-card-title">Capital — ${esc(title)}</div>
      <div class="period-selector" id="dcaPeriodSelector">
        <button class="period-btn" data-period="1">1D</button>
        <button class="period-btn active" data-period="7">7D</button>
        <button class="period-btn" data-period="30">30D</button>
      </div>
      <div id="dcaChartPlaceholder" class="chart-placeholder">Cargando gráfica…</div>
      <div id="dcaChartContainer" class="chart-el" style="display:none;"></div>
    </div>
    <div class="section-title">Accumulation Path</div>
    <div class="two-col">
      <div id="dcaPairBlocks"></div>
      <div>
        <div class="panel">
          <div class="panel-title">Strategy Config</div>
          <div id="dcaConfigPanel"><div class="empty-state skeleton">Cargando…</div></div>
        </div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title">${isBot4 ? 'Historial de Ciclos' : 'DCA Execution History'}</div>
      <div class="table-wrap" id="dcaHistory"><div class="empty-state skeleton">Cargando…</div></div>
    </div>
  `;
}

function renderDcaBotSkeleton(title, emoji, isBot4 = false) {
  $('content').innerHTML = dcaBotSkeleton(title, emoji, isBot4);
  dcaPairKeys = null;
  dcaKnownTradeKeys = null;
  dcaKnownCycleKeys = null;
  dcaChartLastTime = null;
  dcaCurrentBotId = null;

  $('dcaPeriodSelector').querySelectorAll('.period-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.period === dcaPeriod);
    btn.addEventListener('click', () => {
      if (btn.dataset.period === dcaPeriod) return;
      $('dcaPeriodSelector').querySelectorAll('.period-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      dcaPeriod = btn.dataset.period;
      dcaChartLastTime = null; // fuerza setData con la nueva ventana en vez de series.update()
      if (dcaCurrentBotId !== null) loadDcaChart(dcaCurrentBotId, dcaPeriod, true);
    });
  });
}

async function refreshDcaBotPage(estrategia) {
  try {
    const isBot4 = estrategia === 'competitionDcaMotorA';
    const id = await getBotIdByEstrategia(estrategia);
    if (id === null) throw new Error('bot no encontrado');
    dcaCurrentBotId = id;
    const [bot, trades, path, real, thoughts, cycles] = await Promise.all([
      fetchJson(`/api/competition/bot/${id}`),
      // trades crudo (2026-08-24): Bot 3 lo sigue usando para su tabla plana
      // de siempre — Bot 4 reemplazó esa tabla por "Historial de Ciclos"
      // (ver /api/bot/4/cycles abajo), así que no hace falta pedirlo acá.
      isBot4 ? Promise.resolve(null) : fetchJson(`/api/competition/bot/${id}/trades?limit=50`),
      fetchJson(`/api/bot/dca/${id}/path`),
      isBot4 ? fetchJson('/api/bot/4/balance-real').catch(() => null) : Promise.resolve(null),
      isBot4 ? fetchJson('/api/bot/4/thoughts').catch(() => null) : Promise.resolve(null),
      isBot4 ? fetchJson('/api/bot/4/cycles').catch(() => null) : Promise.resolve(null),
    ]);
    $('dcaStatusPill').innerHTML = statusPillHtml(bot.activo);
    $('dcaModePill').innerHTML = modePillHtml(real && real.live ? 'live' : 'paper');
    $('dcaCapital').textContent = fmtUsd(real && real.live ? real.capitalRealTotal : bot.capitalActual);
    $('dcaInvestedFree').textContent = investedFreeHtml(bot.capitalInvertido, bot.capitalLibre);
    const pctEl = $('dcaPct');
    pctEl.textContent = fmtPct(real && real.live ? real.pnlPct : bot.pnlPct);
    pctEl.className = `pct ${pnlClass(real && real.live ? real.pnlPct : bot.pnlPct)}`;

    const pnlEl = $('dcaPnl');
    pnlEl.textContent = fmtUsd(real && real.live ? real.pnlUsd : bot.pnl);
    pnlEl.className = `stat-value ${pnlClass(real && real.live ? real.pnlUsd : bot.pnl)}`;
    $('dcaWr').textContent = `${bot.winrate7d}%`;
    $('dcaTrades').textContent = `${bot.tradesHoy} / ${bot.trades7d}`;

    // Saldo REAL de Binance (2026-08-21, PASO 5, pedido explícito) — solo
    // Bot 4 en modo live lo muestra; el resto de bots queda igual que antes
    // (panel vacío).
    $('dcaRealBalancePanel').innerHTML = (isBot4 && real && real.live) ? `
      <div class="panel" style="border:1px solid #ff3b3b55;">
        <div class="panel-title">💰 Saldo real en Binance <span class="pill mode-live">🔴 LIVE</span></div>
        <div class="kv-row"><span class="label">USDT disponible</span><span class="value">${fmtUsd(real.usdtDisponible)}</span></div>
        <div class="kv-row"><span class="label">BTC</span><span class="value">${real.posiciones.BTC.cantidad.toFixed(6)} (${fmtUsd(real.posiciones.BTC.valorUsd)})</span></div>
        <div class="kv-row"><span class="label">ETH</span><span class="value">${real.posiciones.ETH.cantidad.toFixed(6)} (${fmtUsd(real.posiciones.ETH.valorUsd)})</span></div>
        <div class="kv-row"><span class="label">Capital total real</span><span class="value">${fmtUsd(real.capitalRealTotal)}</span></div>
      </div>` : '';

    // "Qué está pensando el bot" (2026-08-22, pedido explícito) — solo Bot 4.
    $('dcaThoughtsPanel').innerHTML = (isBot4 && thoughts) ? renderThoughtsPanel(thoughts) : '';

    renderAccumulationPathIncremental(path.pares);

    $('dcaConfigPanel').innerHTML = `
      <div class="kv-row"><span class="label">Orden por compra</span><span class="value">${path.config.baseOrderUsd !== null ? fmtUsd(path.config.baseOrderUsd) : 'variable (IA)'}</span></div>
      <div class="kv-row"><span class="label">Drop trigger</span><span class="value">${esc(path.config.dropPctLabel)}</span></div>
      <div class="kv-row"><span class="label">Take Profit</span><span class="value">${path.config.tpMinPct}% – ${path.config.tpMaxPct}%</span></div>
      <div class="kv-row"><span class="label">Máx. compras</span><span class="value">${path.config.maxCompras}</span></div>`;

    // Historial (2026-08-24): Bot 4 usa "Historial de Ciclos" (tarjetas por
    // ciclo, ver renderDcaCyclesIncremental) — Bot 3 sigue con la tabla plana
    // de siempre (no tiene /api/bot/4/cycles, ese endpoint es exclusivo de
    // Bot 4).
    if (isBot4) {
      renderDcaCyclesIncremental(cycles || []);
    } else {
      const closed = trades.filter((t) => t.outcome !== 'open');
      renderDcaHistoryIncremental(closed);
    }
    $('dcaErrorBanner').innerHTML = '';
  } catch (err) {
    // Contenedor dedicado (2026-08-20, mismo criterio que Bot 2/Motor A).
    $('dcaErrorBanner').innerHTML = '<div class="empty-state">No se pudo cargar la información del bot.</div>';
  }
  loadDcaChart(dcaCurrentBotId, dcaPeriod);
}

// =========================================================================
// PÁGINA: SETTINGS
// =========================================================================
function settingsSkeleton() {
  return `
    <div class="page-header">
      <div class="ph-title">Settings</div>
      <div class="ph-value" style="font-size:22px;">Configuración del dashboard</div>
    </div>
    <div class="panel">
      <div class="panel-title">Estado del bot</div>
      <div id="setStatus"><div class="empty-state skeleton">Cargando…</div></div>
    </div>
    <div class="panel">
      <div class="settings-field">
        <label>API base (ngrok)</label>
        <input type="text" id="apiBaseInput" value="${esc(API_BASE)}">
      </div>
      <button class="btn" id="apiBaseSave">Guardar y recargar</button>
      <div class="stat-sub" style="margin-top:10px;">También podés pasar <code>?api=https://tu-url</code> en la URL — se guarda solo para este navegador.</div>
    </div>
    <div class="panel">
      <div class="panel-title">📝 Borradores Binance Square</div>
      <div class="stat-sub" style="margin-bottom:10px;">Generados solos cuando Bot 4 cierra un trade real ganador (+$0.50). No se publican solos — copiá el texto y publicalo vos desde tu cuenta.</div>
      <div id="squarePostsList"><div class="empty-state skeleton">Cargando…</div></div>
    </div>
    <div class="panel">
      <div class="panel-title">Acerca de</div>
      <div class="kv-row"><span class="label">Dashboard</span><span class="value">Nuvera Bot — Institutional</span></div>
      <div class="kv-row"><span class="label">Repositorio bot</span><span class="value"><a href="https://github.com/alexys1/nuvera-trading-bot" target="_blank" rel="noopener">nuvera-trading-bot</a></span></div>
      <div class="kv-row"><span class="label">Repositorio dashboard</span><span class="value"><a href="https://github.com/alexys1/nuvera-dashboard" target="_blank" rel="noopener">nuvera-dashboard</a></span></div>
    </div>
  `;
}

// renderSettingsSkeleton/refreshSettings (2026-08-20, arreglo de parpadeo):
// además del parpadeo, el bug original era peor acá — reconstruir el HTML en
// cada poll pisaba <input id="apiBaseInput"> con su valor original, borrando
// lo que el usuario estuviera escribiendo. Separar skeleton/refresh lo
// arregla gratis (refreshSettings nunca toca el input).
function renderSettingsSkeleton() {
  $('content').innerHTML = settingsSkeleton();
  $('apiBaseSave').addEventListener('click', () => {
    const val = $('apiBaseInput').value.trim();
    if (!val) return;
    const url = new URL(window.location.href);
    url.searchParams.set('api', val);
    window.location.href = url.toString();
  });
}

async function refreshSettings() {
  try {
    const data = await fetchJson('/api/overview');
    $('setStatus').innerHTML = `
      <div class="kv-row"><span class="label">Estado</span><span class="value">${data.estado === 'operando' ? '✅ Operando' : '⏸️ Pausado'}</span></div>
      <div class="kv-row"><span class="label">Modo</span><span class="value">${data.modo === 'live' ? '🔴 LIVE' : '📄 PAPER'}</span></div>
      <div class="kv-row"><span class="label">Capital total</span><span class="value">${fmtUsd(data.capitalTotal)}</span></div>
      <div class="kv-row"><span class="label">Bots activos</span><span class="value">${data.botsActivos}</span></div>`;
  } catch (err) {
    $('setStatus').innerHTML = '<div class="empty-state">No se pudo conectar a la API.</div>';
  }
  try {
    const posts = await fetchJson('/api/square-posts?limit=10');
    $('squarePostsList').innerHTML = posts.length === 0
      ? '<div class="empty-state">Todavía no hay borradores.</div>'
      : posts.map((p) => `
        <div class="kv-row" style="align-items:flex-start; flex-direction:column; gap:4px; padding:10px 0;">
          <div>${esc(p.contenido)}</div>
          <div class="stat-sub">${new Date(p.createdAt).toLocaleString()} ${p.publicado ? '· ya marcado como publicado' : ''}</div>
        </div>`).join('');
  } catch (err) {
    $('squarePostsList').innerHTML = '<div class="empty-state">No se pudieron cargar los borradores.</div>';
  }
}

// =========================================================================
// ROUTER
// =========================================================================
const ROUTES = ['overview', 'motorb', 'motora', 'bot2', 'bot3', 'bot4', 'settings'];
// RENDER = construye el HTML de la página (skeleton), UNA sola vez por
// visita a la ruta. REFRESH = pide datos frescos y actualiza SOLO texto/
// clases de elementos ya existentes — es lo único que corre en cada poll
// (2026-08-20, arreglo de parpadeo/scroll, pedido explícito: "actualizar
// solo los valores sin recargar nada visual"). Nunca reemplaza
// $('content').innerHTML fuera de RENDER, así que no hay parpadeo ni salto
// de scroll en el polling silencioso.
const ROUTE_RENDER = {
  overview: renderOverviewSkeleton,
  motorb: renderMotorBSkeleton,
  motora: renderMotorASkeleton,
  bot2: renderBot2Skeleton,
  bot3: () => renderDcaBotSkeleton('Bot 3 — DCA Agresivo', '📈'),
  bot4: () => renderDcaBotSkeleton('Bot 4 — DCA BTC/ETH', '💰', true),
  settings: renderSettingsSkeleton,
};
const ROUTE_REFRESH = {
  overview: refreshOverview,
  motorb: refreshMotorB,
  motora: refreshMotorA,
  bot2: refreshBot2,
  bot3: () => refreshDcaBotPage('competitionDca'),
  bot4: () => refreshDcaBotPage('competitionDcaMotorA'),
  settings: refreshSettings,
};
let currentRoute = null;
let pollTimer = null;

function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
// Intervalo base 5s (2026-08-22, pedido explícito Bot 3/4: "capital 15s,
// posiciones 15s, historial 20s, gráfica 30s" — antes el tick era de 15s,
// que no puede alinearse con 20s/30s exactos; 5s sí, porque 15/20/30 son
// todos múltiplos de 5). Las llamadas a datos menos urgentes no necesitan un
// setInterval propio: fetchJson ya cachea por endpoint con su propio TTL
// (ver resolveTtl arriba), así que aunque refresh() se llame cada 5s, la red
// solo se golpea con la frecuencia real de cada tipo de dato — mismo
// resultado que antes para el resto de páginas (15/30/60s siguen siendo
// múltiplos de 5s), más preciso para Bot 3/4.
function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (document.hidden) return;
    const refresh = ROUTE_REFRESH[currentRoute];
    if (refresh) refresh();
  }, 5_000);
}

function applyRoute() {
  const raw = window.location.hash.replace('#', '');
  const route = ROUTES.includes(raw) ? raw : 'overview';
  currentRoute = route;
  document.querySelectorAll('.nav-item[data-route]').forEach((btn) => btn.classList.toggle('active', btn.dataset.route === route));
  clearAllCharts();
  closeSidebar();
  (ROUTE_RENDER[route] || renderOverviewSkeleton)();
  (ROUTE_REFRESH[route] || refreshOverview)();
  startPolling();
}
window.addEventListener('hashchange', applyRoute);

// Al volver a la pestaña: solo refresh (sin reconstruir el skeleton), así
// que tampoco pierde scroll acá.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopPolling(); return; }
  const refresh = ROUTE_REFRESH[currentRoute];
  if (refresh) refresh();
  startPolling();
});

// applySidebarFocus (2026-08-21, pedido explícito, Opción A — "todo el foco
// en el bot real"): con MODE=live el bot corre con BOT4_LIVE_FOCUS=true
// (Motor A/B y Bot 2/3 sin cron, ver bot.js) — el sidebar oculta esas rutas
// para no confundir con bots pausados. Si alguien tenía el hash de una ruta
// oculta abierto (p.ej. #motorb), lo manda a Overview. Vuelve MODE=paper y
// el próximo load del dashboard las muestra de nuevo solo — no hace falta
// tocar código de nuevo.
const BOTS_OCULTABLES = ['motorb', 'motora', 'bot2', 'bot3'];
async function applySidebarFocus() {
  try {
    const data = await fetchJson('/api/overview');
    if (data.modo !== 'live') return;
    BOTS_OCULTABLES.forEach((route) => {
      const btn = document.querySelector(`.nav-item[data-route="${route}"]`);
      if (btn) btn.style.display = 'none';
    });
    const raw = window.location.hash.replace('#', '');
    if (BOTS_OCULTABLES.includes(raw)) window.location.hash = 'overview';
  } catch (err) {
    // Sin conexión a la API todavía: se deja el sidebar completo, no bloquea nada.
  }
}

function init() {
  applySidebarFocus();
  if (!window.location.hash) window.location.hash = 'overview';
  else applyRoute();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
