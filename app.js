// Dashboard Nuvera Bot (2026-09-16, 6to rediseño: se saca Bootstrap, CSS
// propio con tamaños contenidos — ver style.css). El sistema quedó reducido
// a un solo bot operando con dinero real (Bot 2, Bot 3, Motor A y Motor B
// fueron desactivados en el backend, ver BOT4_LIVE_FOCUS en
// nuvera-trading-bot/src/core/bot.js): Inicio (capital + racha + actividad
// reciente), Posiciones (saldo real + accumulation path + comparativa),
// Historial (ciclos cerrados + comparativa histórica), Métricas (calendario
// tipo mapa de calor), Settings (salud del sistema). Vanilla JS, sin
// frameworks, sin build step (se sirve tal cual desde GitHub Pages).

// ---------- Config / API base ----------
const DEFAULT_API_BASE = 'https://basketball-date-introducing-est.trycloudflare.com';
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

// ---------- Helpers de markup reusados en todas las páginas ----------
function statBoxHtml(label, id) {
  return `<div class="stat-box"><div class="stat-label">${label}</div><div class="stat-value" id="${id}">—</div></div>`;
}
function statBoxValueHtml(label, valueHtml) {
  return `<div class="stat-box"><div class="stat-label">${label}</div><div class="stat-value">${valueHtml}</div></div>`;
}
function kv(label, valueHtml, valueClass = '') {
  return `<div class="kv"><span class="label">${label}</span><span class="value ${valueClass}">${valueHtml}</span></div>`;
}
function cardHtml(titleHtml, bodyHtml, extraClass = '') {
  return `<div class="card ${extraClass}"><div class="card-title">${titleHtml}</div>${bodyHtml}</div>`;
}

// ---------- Caché en memoria, TTL por tipo de dato ----------
const CACHE_TTL_CRITICAL = 15_000; // capital, PnL, saldo real — headers de cada página
const CACHE_TTL_GENERAL = 60_000; // historial, ranking, métricas agregadas
const CACHE_TTL_CHARTS = 60_000; // gráfica de capital
const CACHE_TTL_DCA_TRADES = 20_000; // Historial de Ciclos

const CACHE_TTL_MS = {
  '/api/overview': CACHE_TTL_CRITICAL,
  '/api/competition/ranking': CACHE_TTL_GENERAL,
  '/api/bot/4/balance-real': CACHE_TTL_CRITICAL,
  '/api/bot/4/thoughts': CACHE_TTL_CRITICAL,
  '/api/bot/4/cycles': CACHE_TTL_DCA_TRADES,
  '/api/racha': CACHE_TTL_GENERAL,
  '/api/health': CACHE_TTL_GENERAL,
  '/api/metrics/daily': CACHE_TTL_GENERAL,
  '/api/metrics/monthly': CACHE_TTL_GENERAL,
  '/api/metrics/top-trades': CACHE_TTL_GENERAL,
};
function resolveTtl(path) {
  const clean = path.split('?')[0];
  if (CACHE_TTL_MS[clean] !== undefined) return CACHE_TTL_MS[clean];
  if (/^\/api\/competition\/bot\/[^/]+$/.test(clean)) return CACHE_TTL_CRITICAL; // header del bot (capital/PnL)
  if (/^\/api\/competition\/bot\/[^/]+\/positions$/.test(clean)) return CACHE_TTL_CRITICAL; // posiciones abiertas
  if (/^\/api\/bot\/dca\/\d+\/path$/.test(clean)) return CACHE_TTL_CRITICAL; // Accumulation Path
  if (clean === '/api/capital-chart') return CACHE_TTL_CHARTS;
  return CACHE_TTL_GENERAL;
}
const cache = new Map();

async function fetchJson(path, { force = false } = {}) {
  const ttl = resolveTtl(path);
  const cached = cache.get(path);
  if (!force && cached && Date.now() - cached.fetchedAt < ttl) return cached.data;

  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  const data = await res.json();
  cache.set(path, { data, fetchedAt: Date.now() });
  return data;
}

// ---------- Resolución de bot_instances.id de Bot 4 ----------
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
let bot4IdCache = null;
async function getBot4Id() {
  if (bot4IdCache !== null) return bot4IdCache;
  const ranking = await getRanking();
  const bot = ranking.find((b) => b.estrategia === 'competitionDcaMotorA');
  bot4IdCache = bot ? bot.id : null;
  return bot4IdCache;
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

// ---------- Lightweight Charts: helper genérico ----------
// Colores fijos (no CSS var): Canvas no resuelve var(--x) en tiempo de
// dibujo, así que van directo acá, elegidos para calzar con la paleta de
// style.css (--bg #0a0a0f / --border #262631 / --text-dim #8b8fa3).
const chartInstances = {}; // containerId -> { chart, series }
function clearAllCharts() {
  Object.values(chartInstances).forEach((c) => { try { c.chart.remove(); } catch (err) { /* ya destruido */ } });
  for (const k of Object.keys(chartInstances)) delete chartInstances[k];
}
function ensureAreaChart(containerId, color = '#16c784') {
  if (chartInstances[containerId]) return chartInstances[containerId];
  const container = $(containerId);
  if (!container) return null;
  const chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight || 200,
    layout: { background: { color: 'transparent' }, textColor: '#8b949e', fontSize: 11 },
    grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
    rightPriceScale: { borderColor: '#262631' },
    timeScale: { borderColor: '#262631', timeVisible: true, secondsVisible: false },
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
function ensureHistogramChart(containerId) {
  if (chartInstances[containerId]) return chartInstances[containerId];
  const container = $(containerId);
  if (!container) return null;
  const chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight || 200,
    layout: { background: { color: 'transparent' }, textColor: '#8b949e', fontSize: 11 },
    grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
    rightPriceScale: { borderColor: '#262631' },
    timeScale: { borderColor: '#262631', timeVisible: false, secondsVisible: false },
    handleScroll: false,
    handleScale: false,
  });
  const series = chart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
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
  return modo === 'live' ? '<span class="pill live">🔴 LIVE</span>' : '<span class="pill paper">○ PAPER</span>';
}
function statusPillHtml(activo) {
  if (activo === false) return '<span class="pill warn"><span class="dot"></span>PAUSADO</span>';
  return '<span class="pill ok"><span class="dot ok"></span>ACTIVE</span>';
}
function investedFreeHtml(capitalInvertido, capitalLibre) {
  if (capitalInvertido === undefined || capitalInvertido === null) return '';
  return `${fmtUsd(capitalInvertido)} invertido · ${fmtUsd(capitalLibre)} libre`;
}
// timePeruParts: cálculo compartido de hora servidor (UTC) + hora Perú
// (UTC-5) a partir de un ISO.
function timePeruParts(iso) {
  if (!iso) return null;
  const fecha = new Date(iso);
  const utcStr = fecha.toLocaleString('es-PE', { timeZone: 'UTC', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const peruStr = fecha.toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return { utcStr, peruStr };
}
function formatTimePeruCompact(iso) {
  const parts = timePeruParts(iso);
  if (!parts) return '—';
  return `${parts.utcStr} UTC · ${parts.peruStr} PE`;
}
function relativeTimeEs(iso) {
  if (!iso) return '—';
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `hace ${diffSec}s`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin}min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 48) return `hace ${diffH}h`;
  return `hace ${Math.round(diffH / 24)}d`;
}

// ---------- Colores/íconos por cripto ----------
const PAIR_COLORS = { BTC: '#f7931a', ETH: '#8a92b2', BNB: '#f0b90b', SOL: '#14f195' };
const PAIR_EMOJI = { BTC: '₿', ETH: 'Ξ', BNB: '🔶', SOL: '◎' };
function pairColor(pair) { return PAIR_COLORS[pair.split('/')[0]] || '#16c784'; }
function pairEmoji(pair) { return PAIR_EMOJI[pair.split('/')[0]] || '●'; }
// pairIconHtml: ícono real (cryptocurrency-icons vía jsdelivr). Si el
// símbolo no existe en ese set (par nuevo/raro activado por Telegram con
// /activar), el onerror esconde el <img> roto y muestra el emoji de
// respaldo — nunca se rompe visualmente.
function pairIconHtml(pair, size = 20) {
  const sym = pair.split('/')[0];
  const url = `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${sym.toLowerCase()}.svg`;
  return `<span class="pair-icon" style="width:${size}px;height:${size}px;">` +
    `<img src="${url}" alt="${esc(sym)}" width="${size}" height="${size}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">` +
    `<span class="pair-icon-fallback" style="display:none;width:${size}px;height:${size}px;">${pairEmoji(pair)}</span>` +
    `</span>`;
}
function pairIdPrefix(pair) { return `dca-${pair.split('/')[0].toLowerCase()}`; }

// =========================================================================
// PÁGINA: INICIO — capital total, PnL, gráfica, racha, actividad reciente.
// =========================================================================
function inicioSkeleton() {
  return `
    <div class="hero">
      <div class="hero-label">Capital Total — Bot 4</div>
      <div class="hero-value" id="inCapital">—</div>
      <div class="hero-sub">
        <span id="inPnlInline">—</span>
        <span id="inStatusPill"></span>
        ${modePillHtml('live')}
      </div>
    </div>
    <div class="stat-row">
      ${statBoxHtml('📈 PnL Total', 'inPnlTotal')}
      ${statBoxHtml('🎯 Win Rate (7d)', 'inWinRate')}
      ${statBoxHtml('🔄 Trades (hoy / 7d)', 'inTrades')}
    </div>
    <div class="card">
      <div class="chart-head">
        <div class="card-title" style="margin:0;">Capital en el tiempo</div>
        <div class="period-group" id="inPeriodSelector">
          <button class="period-btn" data-period="24h">24H</button>
          <button class="period-btn active" data-period="7d">7D</button>
          <button class="period-btn" data-period="30d">30D</button>
        </div>
      </div>
      <div id="inChartPlaceholder" class="chart-placeholder">Cargando gráfica…</div>
      <div id="inChartContainer" class="chart-el" style="display:none;"></div>
    </div>
    <div class="card racha-card" id="inRachaCard" style="display:none;"></div>
    <div class="card">
      <div class="card-title">🕒 Actividad reciente</div>
      <div id="inActivityFeed"><div class="empty-state">Cargando…</div></div>
    </div>
  `;
}

let inCurrentPeriod = '7d';
async function loadInicioChart(period, force = false) {
  try {
    const raw = await fetchJson(`/api/capital-chart?period=${period}`, { force });
    if (!raw || raw.length === 0) {
      $('inChartPlaceholder').style.display = 'flex';
      $('inChartPlaceholder').textContent = 'Sin datos de capital todavía.';
      return;
    }
    const points = downsample(raw, 200);
    $('inChartPlaceholder').style.display = 'none';
    $('inChartContainer').style.display = 'block';
    const { chart, series } = ensureAreaChart('inChartContainer');
    series.setData(points);
    chart.timeScale().fitContent();
  } catch (err) {
    if ($('inChartPlaceholder')) { $('inChartPlaceholder').style.display = 'flex'; $('inChartPlaceholder').textContent = 'No se pudo cargar la gráfica.'; }
  }
}

function renderInicioSkeleton() {
  $('content').innerHTML = inicioSkeleton();
  $('inPeriodSelector').querySelectorAll('.period-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.period === inCurrentPeriod);
    btn.addEventListener('click', () => {
      if (btn.dataset.period === inCurrentPeriod) return;
      $('inPeriodSelector').querySelectorAll('.period-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      inCurrentPeriod = btn.dataset.period;
      loadInicioChart(inCurrentPeriod, true);
    });
  });
}

// renderRachaCard: /api/racha — técnicamente no filtra por bot_instance_id
// (cuenta los últimos trades cerrados de TODA la base), pero con
// BOT4_LIVE_FOCUS=true ningún otro bot cierra trades nuevos, así que en la
// práctica de hoy es 100% la racha de Bot 4.
function renderRachaCard(racha) {
  const el = $('inRachaCard');
  if (!racha || !racha.rachaActual) { el.style.display = 'none'; return; }
  const esWin = racha.tipo === 'wins';
  const modoNombre = racha.modo && racha.modo.nombre;
  const modoBadge = modoNombre && modoNombre !== 'NORMAL'
    ? `<span class="pill ${modoNombre === 'AGGRESSIVE' ? 'info' : 'warn'}">${modoNombre === 'AGGRESSIVE' ? '⚡ AGGRESSIVE' : `🛡️ ${esc(modoNombre)}`}</span>`
    : '';
  const ultimos5Html = (racha.ultimos5 || []).map((r) => (r === 'win' ? '<span class="pnl-pos">●</span>' : '<span class="pnl-neg">●</span>')).join(' ');
  el.style.display = 'flex';
  el.innerHTML = `
    <div>
      <div class="stat-label">Racha actual</div>
      <div class="racha-value ${esWin ? 'pnl-pos' : 'pnl-neg'}">${esWin ? '🔥' : '❄️'} ${racha.rachaActual} ${esWin ? 'ganancias' : 'pérdidas'} seguidas</div>
      <div class="stat-note">Últimas 5: ${ultimos5Html || '—'} · Récord: ${racha.recordWins} wins seguidos</div>
    </div>
    <div style="text-align:right;">
      ${modoBadge}
      ${racha.modo && racha.modo.razon ? `<div class="stat-note">${esc(racha.modo.razon)}</div>` : ''}
    </div>`;
}

// renderActivityFeed: combina posiciones abiertas (= compras en curso, con
// createdAt exacto) y ciclos cerrados (= venta, con cierreTs). No incluye
// cambios de configuración (/drop, /tp, etc.) — el backend no guarda ese
// historial, solo el valor vigente.
function activityEventHtml(e) {
  const time = relativeTimeEs(e.ts);
  if (e.type === 'buy') {
    return `<div class="activity-row">
      <div class="activity-left">
        <span class="pill ok">COMPRA</span>
        ${pairIconHtml(e.pair, 16)}
        <strong>${esc(e.pair.split('/')[0])}</strong>
        <span style="color:var(--text-dim);">${fmtUsd(e.sizeUsdt)} @ ${fmtUsdPrecise(e.entryPrice, e.entryPrice < 10 ? 4 : 2)}</span>
      </div>
      <span style="color:var(--text-dim);">${time}</span>
    </div>`;
  }
  return `<div class="activity-row">
    <div class="activity-left">
      <span class="pill ${e.outcome === 'win' ? 'ok' : 'warn'}">CICLO CERRADO</span>
      ${pairIconHtml(e.pair, 16)}
      <strong>${esc(e.pair.split('/')[0])}</strong>
      <span class="${pnlClass(e.pnl)}" style="font-weight:700;">${fmtUsd(e.pnl)}</span>
    </div>
    <span style="color:var(--text-dim);">${time}</span>
  </div>`;
}
function renderActivityFeed(positions, cycles) {
  const events = [
    ...(positions || []).map((p) => ({ type: 'buy', pair: p.pair, ts: p.createdAt, sizeUsdt: p.sizeUsdt, entryPrice: p.entryPrice })),
    ...(cycles || []).map((c) => ({ type: 'close', pair: c.par, ts: c.cierreTs, pnl: c.pnlTotal, outcome: c.outcome })),
  ].filter((e) => e.ts).sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 12);
  $('inActivityFeed').innerHTML = events.length === 0
    ? '<div class="empty-state">Sin actividad todavía.</div>'
    : events.map(activityEventHtml).join('');
}

async function refreshInicio() {
  try {
    const id = await getBot4Id();
    if (id === null) throw new Error('bot no encontrado');
    const [bot, real, racha, positions, cycles] = await Promise.all([
      fetchJson(`/api/competition/bot/${id}`),
      fetchJson('/api/bot/4/balance-real').catch(() => null),
      fetchJson('/api/racha').catch(() => null),
      fetchJson(`/api/competition/bot/${id}/positions`).catch(() => []),
      fetchJson('/api/bot/4/cycles').catch(() => []),
    ]);
    const isLive = real && real.live;
    const capital = isLive ? real.capitalRealTotal : bot.capitalActual;
    const pnlUsd = isLive ? real.pnlUsd : bot.pnl;
    const pnlPct = isLive ? real.pnlPct : bot.pnlPct;

    $('inCapital').textContent = fmtUsd(capital);
    $('inPnlInline').innerHTML = `<span class="${pnlClass(pnlUsd)}">${fmtUsd(pnlUsd)} (${fmtPct(pnlPct)})</span>`;
    $('inStatusPill').innerHTML = statusPillHtml(bot.activo);
    $('inPnlTotal').textContent = fmtUsd(pnlUsd);
    $('inPnlTotal').className = `stat-value ${pnlClass(pnlUsd)}`;
    $('inWinRate').textContent = `${bot.winrate7d}%`;
    $('inTrades').textContent = `${bot.tradesHoy} / ${bot.trades7d}`;

    renderRachaCard(racha);
    renderActivityFeed(positions, cycles);
  } catch (err) {
    $('inCapital').textContent = '—';
  }
  loadInicioChart(inCurrentPeriod);
}

// =========================================================================
// PÁGINA: POSICIONES — saldo real Binance, comparativa, qué piensa el bot,
// accumulation path (una tarjeta por par, con anillo de progreso).
// =========================================================================
function progressRingSvg(color, size = 52) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${stroke}"/>
      <circle class="ring-fill" data-circumference="${c.toFixed(2)}" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${c.toFixed(2)}" stroke-linecap="round" transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <text class="ring-text" x="50%" y="50%" text-anchor="middle" dy="0.35em">0%</text>
    </svg>`;
}
function updateProgressRing(idPrefix, pct) {
  const ring = $(`${idPrefix}-ring`);
  if (!ring) return;
  const circle = ring.querySelector('.ring-fill');
  const c = parseFloat(circle.dataset.circumference);
  const clamped = Math.min(100, Math.max(0, pct));
  circle.setAttribute('stroke-dashoffset', (c * (1 - clamped / 100)).toFixed(2));
  ring.querySelector('.ring-text').textContent = `${pct}%`;
}
function accumulationPairBlockSkeleton(pair, idPrefix) {
  const color = pairColor(pair);
  return `
    <div class="pair-card" style="--pair-color:${color}">
      <div class="pair-card-top">
        <div class="pair-card-name">${pairIconHtml(pair, 22)} ${esc(pair.split('/')[0])}</div>
        <div id="${idPrefix}-ring">${progressRingSvg(color)}</div>
      </div>
      <div class="stat-note" id="${idPrefix}-ciclo" style="margin-bottom:8px;">—</div>
      ${kv('Avg Entry', `<span id="${idPrefix}-avg-entry">—</span>`)}
      ${kv('Precio actual', `<span id="${idPrefix}-precio-actual">—</span>`)}
      ${kv('Invertido', `<span id="${idPrefix}-capital-invertido">—</span>`)}
      <div id="${idPrefix}-tp-block"></div>
      <div id="${idPrefix}-trigger-block"></div>
    </div>`;
}
function updateAccumulationPairBlock(idPrefix, p) {
  if (!p) return;
  const progressPct = p.maxCompras > 0 ? Math.round((p.compras / p.maxCompras) * 100) : 0;
  updateProgressRing(idPrefix, progressPct);
  $(`${idPrefix}-ciclo`).textContent = `${p.compras}/${p.maxCompras} compras`;
  $(`${idPrefix}-avg-entry`).textContent = p.avgEntry !== null ? fmtUsdPrecise(p.avgEntry) : '—';
  $(`${idPrefix}-precio-actual`).textContent = p.currentPrice !== null ? fmtUsdPrecise(p.currentPrice) : '—';
  $(`${idPrefix}-capital-invertido`).textContent = fmtUsd(p.totalInvested);
  $(`${idPrefix}-tp-block`).innerHTML = p.tpPct !== null ? `
    <hr>
    ${kv('🎯 TP actual', `${p.tpPct}%`)}
    ${kv('💰 Vende en', fmtUsdPrecise(p.precioVenta))}
    ${kv('📈 Falta subir', `${fmtUsd(p.faltaSubir)} (+${p.faltaPct}%)`, 'pnl-pos')}
  ` : '';
  $(`${idPrefix}-trigger-block`).innerHTML = p.nextTriggerPrice !== null ? `
    <hr>
    ${kv('Próximo trigger', fmtUsdPrecise(p.nextTriggerPrice))}
    ${kv('Drop necesario', `-${p.dropRequiredPct}%`, 'pnl-neg')}
  ` : `<hr><div class="stat-note">${p.triggerNote ? esc(p.triggerNote) : (p.compras >= p.maxCompras ? 'Ciclo completo, esperando Take Profit.' : 'Esperando caída para la próxima compra.')}</div>`;
}
let poPairKeys = null;
function renderAccumulationPathIncremental(pares) {
  const pairEntries = Object.entries(pares);
  const keys = pairEntries.map(([pair]) => pair).sort().join('|');
  if (keys !== poPairKeys) {
    poPairKeys = keys;
    $('poPairBlocks').innerHTML = pairEntries.map(([pair]) => accumulationPairBlockSkeleton(pair, pairIdPrefix(pair))).join('');
  }
  pairEntries.forEach(([pair, p]) => updateAccumulationPairBlock(pairIdPrefix(pair), p));
}

function estadoGeneralThoughts(pensamientos) {
  if (!pensamientos || pensamientos.length === 0) return { icon: '⚪', label: 'SIN DATOS', sub: 'Todavía no hay pensamientos registrados.' };
  if (pensamientos.some((p) => p.decision === 'comprar')) return { icon: '🟢', label: 'COMPRANDO', sub: 'Encontró una entrada con confianza suficiente.' };
  return { icon: '🟡', label: 'ANALIZANDO', sub: 'Mercado bajo análisis, esperando mejor punto de entrada.' };
}
function cambio7dInfo(pct) {
  if (pct === null || pct === undefined) return { texto: 'N/D', cls: '', icon: '' };
  const texto = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  if (pct > 10) return { texto, cls: 'pnl-neg', icon: ' ⚠️' };
  if (pct < -10) return { texto, cls: 'pnl-pos', icon: ' 🟢' };
  return { texto, cls: '', icon: '' };
}
function renderContextoSemanal(contextoSemanal) {
  if (!contextoSemanal) return '';
  const { btcCambio7d, ethCambio7d, bnbCambio7d } = contextoSemanal;
  const btc = cambio7dInfo(btcCambio7d);
  const eth = cambio7dInfo(ethCambio7d);
  const bnb = cambio7dInfo(bnbCambio7d);
  const cambios = [btcCambio7d, ethCambio7d, bnbCambio7d];
  const sobreextendido = cambios.some((c) => c !== null && c !== undefined && c > 10);
  const conDescuento = !sobreextendido && cambios.some((c) => c !== null && c !== undefined && c < -10);
  const resumen = sobreextendido
    ? '<div class="stat-note pnl-neg" style="margin-top:4px;">⚠️ Mercado sobreextendido — bot más cauteloso</div>'
    : conDescuento
      ? '<div class="stat-note pnl-pos" style="margin-top:4px;">🟢 Caída fuerte esta semana — posible oportunidad de compra</div>'
      : '';
  return `
    <div class="stat-note" style="margin-top:8px; border-top:1px solid var(--border); padding-top:6px;">📈 CONTEXTO SEMANAL:</div>
    ${kv('BTC', `${btc.texto} esta semana${btc.icon}`, btc.cls)}
    ${kv('ETH', `${eth.texto} esta semana${eth.icon}`, eth.cls)}
    ${kv('BNB', `${bnb.texto} esta semana${bnb.icon}`, bnb.cls)}
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
        <div class="stat-note">Confianza actual: ${p.confianza}% | Necesita: ${data.confianzaMinima}%</div>
      </div>`).join('');
  return cardHtml(
    '🧠 Qué está pensando el bot',
    `<div class="stat-note" style="margin-bottom:8px;">Actualizado ${relativeTimeEs(masReciente && masReciente.timestamp)}</div>
     ${cuerpo}
     ${kv('Estado general', `${estado.icon} ${estado.label}`)}
     <div class="stat-note">${esc(estado.sub)}</div>
     ${renderContextoSemanal(data.contextoSemanal)}`,
  );
}

function donutChartHtml(entries) {
  const total = entries.reduce((s, e) => s + e.value, 0);
  if (total <= 0) return '<div class="empty-state">Sin capital para distribuir todavía.</div>';
  let acc = 0;
  const stops = entries.filter((e) => e.value > 0).map((e) => {
    const start = (acc / total) * 360;
    acc += e.value;
    const end = (acc / total) * 360;
    return `${e.color} ${start.toFixed(1)}deg ${end.toFixed(1)}deg`;
  }).join(', ');
  const legend = entries.map((e) => `
    <div class="donut-legend-row">
      <span class="donut-dot" style="background:${e.color}"></span>
      <span class="donut-label">${esc(e.label)}</span>
      <span class="donut-value">${fmtUsd(e.value)} (${Math.round((e.value / total) * 100)}%)</span>
    </div>`).join('');
  return `
    <div class="donut-wrap">
      <div class="donut-chart" style="background: conic-gradient(${stops});"></div>
      <div class="donut-legend">${legend}</div>
    </div>`;
}

// comparativaHtml: barras divergentes — % de cambio del precio actual vs el
// promedio de entrada de cada par, para ver de un vistazo cuál va mejor sin
// entrar a cada tarjeta. Ordenado de mejor a peor.
function comparativaHtml(pares) {
  const rows = Object.entries(pares)
    .filter(([, p]) => p.avgEntry !== null && p.currentPrice !== null)
    .map(([pair, p]) => ({ pair, pct: ((p.currentPrice - p.avgEntry) / p.avgEntry) * 100 }))
    .sort((a, b) => b.pct - a.pct);
  if (rows.length === 0) return '<div class="empty-state">Sin posiciones abiertas para comparar.</div>';
  const maxAbs = Math.max(0.5, ...rows.map((r) => Math.abs(r.pct)));
  return rows.map((r) => `
    <div class="comp-row">
      <div class="comp-pair">${pairIconHtml(r.pair, 16)}${esc(r.pair.split('/')[0])}</div>
      <div class="comp-bar-track">
        <div class="comp-bar-mid"></div>
        <div class="comp-bar-fill" style="${r.pct >= 0 ? 'left:50%' : 'right:50%'}; width:${(Math.abs(r.pct) / maxAbs * 50).toFixed(1)}%; background:${r.pct >= 0 ? 'var(--green)' : 'var(--red)'};"></div>
      </div>
      <div class="comp-value ${pnlClass(r.pct)}">${fmtPct(r.pct)}</div>
    </div>`).join('');
}

function posicionesSkeleton() {
  return `
    <div class="page-title">💰 Posiciones — Bot 4</div>
    <div class="stat-row">
      ${statBoxHtml('💰 Capital Total', 'poCapitalTotal')}
      ${statBoxHtml('📥 Invertido', 'poInvertido')}
      ${statBoxHtml('📤 Libre', 'poLibre')}
    </div>
    <div class="two-col">
      <div class="card">
        <div class="card-title">🥧 Distribución del capital</div>
        <div id="poDonutPanel"><div class="empty-state">Cargando…</div></div>
      </div>
      <div class="card">
        <div class="card-title">⚖️ Comparativa — quién va mejor ahora</div>
        <div id="poComparativaPanel"><div class="empty-state">Cargando…</div></div>
      </div>
    </div>
    <div id="poErrorBanner"></div>
    <div id="poRealBalancePanel"></div>
    <div id="poThoughtsPanel"></div>
    <div class="section-title">Accumulation Path</div>
    <div class="pair-grid" id="poPairBlocks"><div class="empty-state">Cargando…</div></div>
    <div class="section-title">Configuración de la estrategia</div>
    <div class="stat-row" id="poConfigStats"></div>
    <div class="stat-note" id="poDropLabel"></div>
  `;
}
function renderPosicionesSkeleton() {
  $('content').innerHTML = posicionesSkeleton();
  poPairKeys = null;
}
async function refreshPosiciones() {
  try {
    const id = await getBot4Id();
    if (id === null) throw new Error('bot no encontrado');
    const [bot, real, thoughts, path] = await Promise.all([
      fetchJson(`/api/competition/bot/${id}`),
      fetchJson('/api/bot/4/balance-real').catch(() => null),
      fetchJson('/api/bot/4/thoughts').catch(() => null),
      fetchJson(`/api/bot/dca/${id}/path`),
    ]);
    // Capital Total/Invertido/Libre (2026-09-17, pedido explícito — el
    // usuario comparó contra Binance y no coincidía): antes estos 3 stat
    // boxes salían de bot.capitalActual/capitalInvertido/capitalLibre, que es
    // contabilidad interna (capital_actual solo se toca en trade_close/
    // reconciliación — ver persistCapital en competitionDcaMotorA.js — e
    // "invertido" es costo de entrada, no valor de mercado actual). Eso
    // diverge de Binance apenas el precio se mueve desde la entrada. Cuando
    // hay saldo real (live), se usa ESE (mismo dato que el panel "Saldo real
    // en Binance" de abajo) para que coincida con lo que el usuario ve en su
    // cuenta. Fallback a bot.* solo si falló el fetch a Binance (real===null).
    const realInvertido = (real && real.live)
      ? Object.values(real.posiciones).reduce((s, p) => s + p.valorUsd, 0)
      : null;
    const capitalTotalShown = (real && real.live) ? real.capitalRealTotal : bot.capitalActual;
    const invertidoShown = (real && real.live) ? realInvertido : bot.capitalInvertido;
    const libreShown = (real && real.live) ? real.usdtDisponible : bot.capitalLibre;

    $('poCapitalTotal').textContent = fmtUsd(capitalTotalShown);
    $('poInvertido').textContent = fmtUsd(invertidoShown);
    $('poLibre').textContent = fmtUsd(libreShown);

    const donutEntries = [
      ...Object.entries(path.pares).map(([pair, p]) => ({ label: pair.split('/')[0], value: p.totalInvested, color: pairColor(pair) })),
      { label: 'Libre', value: libreShown, color: '#8b8fa3' },
    ];
    $('poDonutPanel').innerHTML = donutChartHtml(donutEntries);
    $('poComparativaPanel').innerHTML = comparativaHtml(path.pares);

    // Saldo REAL de Binance — itera real.posiciones tal cual venga, no
    // asume cuáles/cuántos pares hay (si se activa uno nuevo con /activar
    // por Telegram, aparece solo).
    const posicionesHtml = (real && real.live)
      ? Object.entries(real.posiciones).map(([sym, p]) => kv(`${pairIconHtml(`${sym}/USDT`, 16)} ${esc(sym)}`, `${p.cantidad.toFixed(6)} (${fmtUsd(p.valorUsd)})`)).join('')
      : '';
    $('poRealBalancePanel').innerHTML = (real && real.live) ? cardHtml(
      `💰 Saldo real en Binance ${modePillHtml('live')}`,
      kv('USDT disponible', fmtUsd(real.usdtDisponible)) + posicionesHtml + kv('Capital total real', fmtUsd(real.capitalRealTotal)),
    ) : '';

    $('poThoughtsPanel').innerHTML = thoughts ? renderThoughtsPanel(thoughts) : '';

    renderAccumulationPathIncremental(path.pares);

    $('poConfigStats').innerHTML = [
      statBoxValueHtml('Orden por compra', path.config.baseOrderUsd !== null ? fmtUsd(path.config.baseOrderUsd) : 'variable'),
      statBoxValueHtml('Take Profit', `${path.config.tpMinPct}% – ${path.config.tpMaxPct}%`),
      statBoxValueHtml('Máx. compras', path.config.maxCompras),
    ].join('');
    $('poDropLabel').textContent = `Drop trigger: ${path.config.dropPctLabel}`;
    $('poErrorBanner').innerHTML = '';
  } catch (err) {
    $('poErrorBanner').innerHTML = '<div class="empty-state">No se pudo cargar la información de posiciones.</div>';
  }
}

// =========================================================================
// PÁGINA: HISTORIAL — un ciclo = todas las compras DCA de un par que se
// cerraron JUNTAS en la misma venta (ver sellAll en competitionDcaMotorA.js).
// =========================================================================
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
    <details class="${cardClass}" style="--pair-color:${pairColor(c.par)}">
      <summary>
        <div class="cycle-summary-row">
          <div class="cycle-summary-main">
            <span class="cycle-pair">${pairIconHtml(c.par, 16)} ${esc(c.par)}</span>
            <span class="cycle-meta">Inicio: ${formatTimePeruCompact(c.inicioTs)} · Fin: ${formatTimePeruCompact(c.cierreTs)}</span>
            <span class="cycle-meta">(${esc(c.duracion)}) · ${c.numCompras} compras · ${fmtUsd(c.totalInvertido)} invertido</span>
          </div>
          <span class="cycle-outcome ${pnlClass(c.pnlTotal)}">${c.outcome === 'win' ? '✅' : '❌'} ${fmtUsd(c.pnlTotal)}<span class="cycle-chevron"> ▶</span></span>
        </div>
      </summary>
      <div class="cycle-body">
        ${kv('Precio promedio', fmtUsdPrecise(c.precioPromedio, c.precioPromedio < 10 ? 4 : 2))}
        ${kv('Precio de salida', fmtUsdPrecise(c.precioSalida, c.precioSalida < 10 ? 4 : 2))}
        <div class="table-wrap" style="margin-top:8px;">
          <table class="data-table">
            <thead><tr><th>Precio</th><th>Monto</th><th>PnL</th></tr></thead>
            <tbody>${comprasHtml}</tbody>
          </table>
        </div>
      </div>
    </details>`;
}
let dcaKnownCycleKeys = null;
function renderDcaCyclesIncremental(ciclos) {
  const list = dcaKnownCycleKeys !== null ? $('dcaCyclesList') : null;
  if (!list) {
    dcaKnownCycleKeys = new Set(ciclos.map(cycleKey));
    $('dcaHistory').innerHTML = ciclos.length === 0
      ? '<div class="empty-state">Sin ciclos cerrados todavía.</div>'
      : `<div id="dcaCyclesList">${ciclos.map((c) => cycleCardHtml(c)).join('')}</div>`;
    return;
  }
  const nuevos = [];
  for (const c of ciclos) {
    const key = cycleKey(c);
    if (dcaKnownCycleKeys.has(key)) break;
    nuevos.push(c);
    dcaKnownCycleKeys.add(key);
  }
  if (nuevos.length === 0) return;
  for (let i = nuevos.length - 1; i >= 0; i--) {
    list.insertAdjacentHTML('afterbegin', cycleCardHtml(nuevos[i], 'cycle-new'));
  }
}
function comparativaPorCriptoHtml(cycles) {
  const byPair = {};
  (cycles || []).forEach((c) => {
    if (!byPair[c.par]) byPair[c.par] = { count: 0, wins: 0, pnl: 0 };
    byPair[c.par].count += 1;
    if (c.outcome === 'win') byPair[c.par].wins += 1;
    byPair[c.par].pnl += c.pnlTotal;
  });
  const rows = Object.entries(byPair).sort((a, b) => b[1].pnl - a[1].pnl);
  if (rows.length === 0) return '<div class="empty-state">Sin ciclos cerrados todavía.</div>';
  return rows.map(([pair, s]) => kv(
    `${pairIconHtml(pair, 16)} ${esc(pair.split('/')[0])} · ${s.count} ciclos · ${Math.round((s.wins / s.count) * 100)}% WR`,
    fmtUsd(s.pnl),
    pnlClass(s.pnl),
  )).join('');
}
function historialSkeleton() {
  return `
    <div class="page-title">📜 Historial de Ciclos — Bot 4</div>
    <div class="page-sub">Cada tarjeta es un ciclo completo: todas las compras DCA de un par, cerradas juntas en la misma venta.</div>
    <div class="stat-row">
      ${statBoxHtml('📜 Ciclos cerrados', 'hiTotalCiclos')}
      ${statBoxHtml('🎯 Win Rate', 'hiWinRate')}
      ${statBoxHtml('📈 PnL total', 'hiPnlTotal')}
    </div>
    <div class="card">
      <div class="card-title">📊 Comparativa por cripto</div>
      <div id="hiComparativaPanel"><div class="empty-state">Cargando…</div></div>
    </div>
    <div id="hiErrorBanner"></div>
    <div id="dcaHistory"><div class="empty-state">Cargando…</div></div>
  `;
}
function renderHistorialSkeleton() {
  $('content').innerHTML = historialSkeleton();
  dcaKnownCycleKeys = null;
}
function renderHistorialSummary(cycles) {
  const total = cycles.length;
  const wins = cycles.filter((c) => c.outcome === 'win').length;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
  const pnlTotal = cycles.reduce((s, c) => s + c.pnlTotal, 0);
  $('hiTotalCiclos').textContent = total;
  $('hiWinRate').textContent = `${winRate}%`;
  $('hiPnlTotal').textContent = fmtUsd(pnlTotal);
  $('hiPnlTotal').className = `stat-value ${pnlClass(pnlTotal)}`;
}
async function refreshHistorial() {
  try {
    const cycles = await fetchJson('/api/bot/4/cycles');
    renderHistorialSummary(cycles || []);
    $('hiComparativaPanel').innerHTML = comparativaPorCriptoHtml(cycles);
    renderDcaCyclesIncremental(cycles || []);
    $('hiErrorBanner').innerHTML = '';
  } catch (err) {
    $('hiErrorBanner').innerHTML = '<div class="empty-state">No se pudo cargar el historial.</div>';
  }
}

// =========================================================================
// PÁGINA: MÉTRICAS — calendario de ganancias (mapa de calor) + top trades.
// =========================================================================
const MET_DIAS_SEMANA = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const MET_MESES_LARGOS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function peruNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
}
function peruDateKey(iso) {
  const d = new Date(new Date(iso).getTime() - 5 * 3600000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

let metCalYear = null;
let metCalMonth = null;
let metSelectedFecha = null;
let metDailyMap = {};
let metCyclesCache = [];

function metricasSkeleton() {
  return `
    <div class="page-title">📈 Métricas — Bot 4</div>
    <div class="page-sub">Solo ganancias REALES de trades cerrados (no incluye capital agregado a mano)</div>

    <div class="card">
      <div class="chart-head">
        <div class="card-title" style="margin:0;">📅 Calendario de ganancias</div>
        <div style="display:flex; align-items:center; gap:8px;">
          <button class="period-btn" id="metCalPrev">‹</button>
          <span id="metCalLabel" style="min-width:120px; text-align:center; display:inline-block; font-weight:700; font-size:12.5px;">—</span>
          <button class="period-btn" id="metCalNext">›</button>
        </div>
      </div>
      <div class="metrics-calendar-wrap">
        <div class="metrics-calendar-weekdays">${MET_DIAS_SEMANA.map((d) => `<div class="mc-weekday">${d}</div>`).join('')}</div>
        <div class="metrics-calendar" id="metCalendarGrid"><div class="empty-state">Cargando…</div></div>
      </div>
    </div>

    <div class="card" id="metDayDetailPanel" style="display:none;">
      <div class="card-title" id="metDayDetailTitle">Trades del día</div>
      <div id="metDayDetailBody"></div>
    </div>

    <div class="card">
      <div class="card-title">📊 Ganancias netas por día (USD)</div>
      <div class="chart-el" id="metBarChartContainer"></div>
      <div class="chart-placeholder" id="metBarChartPlaceholder" style="display:none;">Sin trades cerrados todavía.</div>
    </div>

    <div class="section-title">Resumen del mes</div>
    <div class="stat-row" id="metSummaryRow"><div class="empty-state">Cargando…</div></div>

    <div class="section-title">🏆 Top trades del mes</div>
    <div class="two-col">
      <div class="card"><div class="card-title">Mejores 5</div><div id="metTopBest"><div class="empty-state">Cargando…</div></div></div>
      <div class="card"><div class="card-title">Peores 5</div><div id="metTopWorst"><div class="empty-state">Cargando…</div></div></div>
    </div>
  `;
}

function renderMetCalendar() {
  $('metCalLabel').textContent = `${MET_MESES_LARGOS[metCalMonth]} ${metCalYear}`;
  const primerDiaSemana = (new Date(Date.UTC(metCalYear, metCalMonth, 1)).getUTCDay() + 6) % 7;
  const diasEnMes = new Date(Date.UTC(metCalYear, metCalMonth + 1, 0)).getUTCDate();

  // Mapa de calor: intensidad de fondo proporcional al |pnl| del día
  // relativo al mayor |pnl| del mes — un día que ganó/perdió poco casi no
  // se nota, el mejor/peor día del mes se ve bien saturado.
  const maxAbsPnl = Math.max(1, ...Object.values(metDailyMap).map((r) => Math.abs(r.pnl)));
  let html = '';
  for (let i = 0; i < primerDiaSemana; i++) html += '<div class="mc-day empty"></div>';
  for (let dia = 1; dia <= diasEnMes; dia++) {
    const fecha = `${metCalYear}-${String(metCalMonth + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    const row = metDailyMap[fecha];
    const clases = ['mc-day'];
    let heatStyle = '';
    if (row) {
      clases.push(row.pnl >= 0 ? 'pos' : 'neg');
      const intensidad = 0.12 + (Math.abs(row.pnl) / maxAbsPnl) * 0.55;
      const rgb = row.pnl >= 0 ? '22,199,132' : '234,57,67';
      heatStyle = ` style="--mc-heat-bg: rgba(${rgb}, ${intensidad.toFixed(2)});"`;
    }
    if (fecha === metSelectedFecha) clases.push('selected');
    html += `<div class="${clases.join(' ')}" data-fecha="${fecha}"${heatStyle}>
      <span class="mc-day-num">${dia}</span>
      ${row ? `<span class="mc-day-pnl">${row.pnl >= 0 ? '+' : ''}${fmtUsd(row.pnl)}</span>` : ''}
    </div>`;
  }
  $('metCalendarGrid').innerHTML = html;
  $('metCalendarGrid').querySelectorAll('.mc-day[data-fecha]').forEach((el) => {
    el.addEventListener('click', () => {
      metSelectedFecha = metSelectedFecha === el.dataset.fecha ? null : el.dataset.fecha;
      renderMetCalendar();
      renderMetDayDetail();
    });
  });
}

function renderMetDayDetail() {
  const panel = $('metDayDetailPanel');
  if (!metSelectedFecha) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  const [y, m, d] = metSelectedFecha.split('-');
  $('metDayDetailTitle').textContent = `Trades del ${d}/${m}/${y}`;

  const ciclosDelDia = metCyclesCache.filter((c) => peruDateKey(c.cierreTs) === metSelectedFecha);
  $('metDayDetailBody').innerHTML = ciclosDelDia.length === 0
    ? '<div class="empty-state">Sin ciclos cerrados ese día.</div>'
    : ciclosDelDia.map((c) => kv(`${esc(c.par)} · ${c.numCompras} compras · ${formatTimePeruCompact(c.cierreTs)}`, fmtUsd(c.pnlTotal), pnlClass(c.pnlTotal))).join('');
}

function loadMetBarChart(dailyData) {
  if (!dailyData || dailyData.length === 0) {
    $('metBarChartContainer').style.display = 'none';
    $('metBarChartPlaceholder').style.display = 'flex';
    return;
  }
  $('metBarChartContainer').style.display = 'block';
  $('metBarChartPlaceholder').style.display = 'none';
  const points = dailyData
    .map((d) => ({ time: Math.floor(new Date(`${d.fecha}T00:00:00Z`).getTime() / 1000), value: d.pnl, color: d.pnl >= 0 ? '#16c784' : '#ea3943' }))
    .sort((a, b) => a.time - b.time);
  const { chart, series } = ensureHistogramChart('metBarChartContainer');
  series.setData(points);
  chart.timeScale().fitContent();
}

function renderMetSummary(m) {
  if (!m) { $('metSummaryRow').innerHTML = '<div class="empty-state">No se pudo cargar.</div>'; return; }
  $('metSummaryRow').innerHTML = [
    statBoxValueHtml('Días operando', m.diasOperando),
    statBoxValueHtml('Trades cerrados', m.tradesCerrados),
    statBoxValueHtml('Ganancia bruta', `<span class="${pnlClass(m.pnlBruto)}">${fmtUsd(m.pnlBruto)}</span>`),
    statBoxValueHtml('Fees pagados', `<span class="pnl-neg">-${fmtUsd(Math.abs(m.feesTotal))}</span>`),
    statBoxValueHtml('Ganancia NETA', `<span class="${pnlClass(m.pnlNeto)}">${fmtUsd(m.pnlNeto)} ${m.pnlNeto >= 0 ? '✅' : ''}</span>`),
    statBoxValueHtml('Mejor día', `<span class="pnl-pos">${m.mejorDia ? m.mejorDia.fecha : '—'}</span><div class="stat-note">${m.mejorDia ? fmtUsd(m.mejorDia.pnl) : ''}</div>`),
    statBoxValueHtml('Peor día', `<span class="pnl-neg">${m.peorDia ? m.peorDia.fecha : '—'}</span><div class="stat-note">${m.peorDia ? fmtUsd(m.peorDia.pnl) : ''}</div>`),
    statBoxValueHtml('Win Rate del mes', `${m.winRate}%`),
    statBoxValueHtml('Profit Factor', m.profitFactor !== null ? m.profitFactor.toFixed(2) : '∞'),
  ].join('');
}

function renderMetTopTrades(top) {
  const renderList = (list) => (!list || list.length === 0
    ? '<div class="empty-state">Sin trades este mes.</div>'
    : list.map((t) => kv(`${esc(t.pair.split('/')[0])} ${esc(t.horaPeru)}`, fmtUsd(t.pnl), pnlClass(t.pnl))).join(''));
  $('metTopBest').innerHTML = renderList(top && top.mejores);
  $('metTopWorst').innerHTML = renderList(top && top.peores);
}

function renderMetricasSkeleton() {
  const ahora = peruNow();
  metCalYear = ahora.getFullYear();
  metCalMonth = ahora.getMonth();
  metSelectedFecha = null;
  metDailyMap = {};
  metCyclesCache = [];
  $('content').innerHTML = metricasSkeleton();
  $('metCalPrev').addEventListener('click', () => {
    metCalMonth -= 1;
    if (metCalMonth < 0) { metCalMonth = 11; metCalYear -= 1; }
    renderMetCalendar();
  });
  $('metCalNext').addEventListener('click', () => {
    metCalMonth += 1;
    if (metCalMonth > 11) { metCalMonth = 0; metCalYear += 1; }
    renderMetCalendar();
  });
}

async function refreshMetricas() {
  try {
    const [daily, monthly, top, cycles] = await Promise.all([
      fetchJson('/api/metrics/daily'),
      fetchJson('/api/metrics/monthly'),
      fetchJson('/api/metrics/top-trades'),
      fetchJson('/api/bot/4/cycles').catch(() => []),
    ]);
    metDailyMap = {};
    daily.forEach((d) => { metDailyMap[d.fecha] = d; });
    metCyclesCache = cycles || [];
    renderMetCalendar();
    renderMetDayDetail();
    loadMetBarChart(daily);
    renderMetSummary(monthly);
    renderMetTopTrades(top);
  } catch (err) {
    $('metSummaryRow').innerHTML = '<div class="empty-state">No se pudo cargar la información de métricas.</div>';
  }
}

// =========================================================================
// PÁGINA: SETTINGS
// =========================================================================
function settingsSkeleton() {
  return `
    <div class="page-title">⚙️ Settings</div>
    <div class="card">
      <div class="card-title">Estado del bot</div>
      <div id="setStatus"><div class="empty-state">Cargando…</div></div>
    </div>
    <div class="card">
      <div class="card-title">🩺 Salud del sistema</div>
      <div id="setHealth"><div class="empty-state">Cargando…</div></div>
    </div>
    <div class="card">
      <div class="field">
        <label>API base (Cloudflare Tunnel)</label>
        <input type="text" id="apiBaseInput" value="${esc(API_BASE)}">
      </div>
      <button class="btn" id="apiBaseSave">Guardar y recargar</button>
      <div class="stat-note" style="margin-top:8px;">También podés pasar <code>?api=https://tu-url</code> en la URL — se guarda solo para este navegador.</div>
    </div>
    <div class="card">
      <div class="card-title">📝 Borradores Binance Square</div>
      <div class="stat-note" style="margin-bottom:8px;">Generados solos cuando Bot 4 cierra un trade real ganador (+$0.50). No se publican solos — copiá el texto y publicalo vos desde tu cuenta.</div>
      <div id="squarePostsList"><div class="empty-state">Cargando…</div></div>
    </div>
    <div class="card">
      <div class="card-title">Acerca de</div>
      ${kv('Dashboard', 'Nuvera Bot — Bot 4')}
      ${kv('Repositorio bot', '<a href="https://github.com/alexys1/nuvera-trading-bot" target="_blank" rel="noopener">nuvera-trading-bot</a>')}
      ${kv('Repositorio dashboard', '<a href="https://github.com/alexys1/nuvera-dashboard" target="_blank" rel="noopener">nuvera-dashboard</a>')}
    </div>
  `;
}
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
    $('setStatus').innerHTML =
      kv('Estado', data.estado === 'operando' ? '✅ Operando' : '⏸️ Pausado')
      + kv('Modo', data.modo === 'live' ? '🔴 LIVE' : '📄 PAPER')
      + kv('Capital total', fmtUsd(data.capitalTotal));
  } catch (err) {
    $('setStatus').innerHTML = '<div class="empty-state">No se pudo conectar a la API.</div>';
  }
  try {
    const health = await fetchJson('/api/health');
    const svc = (ok, label) => `<span class="pill ${ok ? 'ok' : 'warn'}">${ok ? '✅' : '❌'} ${label}</span>`;
    $('setHealth').innerHTML = `
      <div class="health-row">
        ${svc(health.binance && health.binance.ok, `Binance (${health.binance ? health.binance.ms : '—'}ms)`)}
        ${svc(health.postgresql && health.postgresql.ok, 'PostgreSQL')}
        ${svc(health.ollama && health.ollama.ok, 'Ollama')}
        ${svc(health.cloudflared && health.cloudflared.ok, 'Cloudflare Tunnel')}
      </div>
      ${kv('Errores (24h)', `${health.errores ? health.errores.total24h : 0}${health.errores && health.errores.noResueltos > 0 ? ` (${health.errores.noResueltos} sin resolver)` : ''}`, health.errores && health.errores.total24h > 0 ? 'pnl-neg' : 'pnl-pos')}`;
  } catch (err) {
    $('setHealth').innerHTML = '<div class="empty-state">No se pudo consultar la salud del sistema.</div>';
  }
  try {
    const posts = await fetchJson('/api/square-posts?limit=10');
    $('squarePostsList').innerHTML = posts.length === 0
      ? '<div class="empty-state">Todavía no hay borradores.</div>'
      : posts.map((p) => `
        <div style="padding:8px 0; border-bottom:1px solid var(--border);">
          <div style="font-size:12px;">${esc(p.contenido)}</div>
          <div class="stat-note">${new Date(p.createdAt).toLocaleString()} ${p.publicado ? '· ya marcado como publicado' : ''}</div>
        </div>`).join('');
  } catch (err) {
    $('squarePostsList').innerHTML = '<div class="empty-state">No se pudieron cargar los borradores.</div>';
  }
}

// =========================================================================
// ROUTER
// =========================================================================
const ROUTES = ['inicio', 'posiciones', 'historial', 'metricas', 'settings'];
const ROUTE_RENDER = {
  inicio: renderInicioSkeleton,
  posiciones: renderPosicionesSkeleton,
  historial: renderHistorialSkeleton,
  metricas: renderMetricasSkeleton,
  settings: renderSettingsSkeleton,
};
const ROUTE_REFRESH = {
  inicio: refreshInicio,
  posiciones: refreshPosiciones,
  historial: refreshHistorial,
  metricas: refreshMetricas,
  settings: refreshSettings,
};
let currentRoute = null;
let pollTimer = null;

function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
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
  const route = ROUTES.includes(raw) ? raw : 'inicio';
  currentRoute = route;
  document.querySelectorAll('.nav-item[data-route]').forEach((btn) => btn.classList.toggle('active', btn.dataset.route === route));
  clearAllCharts();
  closeSidebar();
  (ROUTE_RENDER[route] || renderInicioSkeleton)();
  (ROUTE_REFRESH[route] || refreshInicio)();
  startPolling();
}
window.addEventListener('hashchange', applyRoute);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopPolling(); return; }
  const refresh = ROUTE_REFRESH[currentRoute];
  if (refresh) refresh();
  startPolling();
});

function init() {
  if (!window.location.hash) window.location.hash = 'inicio';
  else applyRoute();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
