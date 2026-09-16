// Dashboard Nuvera Bot (2026-09-16, rediseño: "todo gira en torno a Bot 4")
// — el sistema quedó reducido a un solo bot operando con dinero real
// (Bot 2, Bot 3, Motor A y Motor B fueron desactivados en el backend, ver
// BOT4_LIVE_FOCUS en nuvera-trading-bot/src/core/bot.js), así que este
// dashboard dejó de ser un router de 5 bots en competencia para ser la vista
// de un solo bot: Inicio (capital + gráfica), Posiciones (saldo real
// Binance + accumulation path + qué piensa el bot), Historial (ciclos
// cerrados) y Métricas (calendario/resumen mensual). Vanilla JS, sin
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
  '/api/metrics/daily': CACHE_TTL_GENERAL,
  '/api/metrics/monthly': CACHE_TTL_GENERAL,
  '/api/metrics/top-trades': CACHE_TTL_GENERAL,
};
function resolveTtl(path) {
  const clean = path.split('?')[0];
  if (CACHE_TTL_MS[clean] !== undefined) return CACHE_TTL_MS[clean];
  if (/^\/api\/competition\/bot\/[^/]+$/.test(clean)) return CACHE_TTL_CRITICAL; // header del bot (capital/PnL)
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
function ensureHistogramChart(containerId) {
  if (chartInstances[containerId]) return chartInstances[containerId];
  const container = $(containerId);
  if (!container) return null;
  const chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight || 220,
    layout: { background: { color: 'transparent' }, textColor: '#64748b', fontSize: 11 },
    grid: { vertLines: { visible: false }, horzLines: { color: '#1c1c28' } },
    rightPriceScale: { borderColor: '#2a2a3a' },
    timeScale: { borderColor: '#2a2a3a', timeVisible: false, secondsVisible: false },
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
  return modo === 'live' ? '<span class="pill mode-live">🔴 LIVE</span>' : '<span class="pill mode-paper">○ PAPER</span>';
}
function statusPillHtml(activo) {
  if (activo === false) return '<span class="pill status-inactive"><span class="dot"></span>PAUSADO</span>';
  return '<span class="pill status-active"><span class="dot ok"></span>ACTIVE</span>';
}
// Línea "$X invertido · $Y libre" — reusada en Inicio/Posiciones.
function investedFreeHtml(capitalInvertido, capitalLibre) {
  if (capitalInvertido === undefined || capitalInvertido === null) return '';
  return `${fmtUsd(capitalInvertido)} invertido · ${fmtUsd(capitalLibre)} libre`;
}
// timePeruParts: cálculo compartido de hora servidor (UTC) + hora Perú
// (UTC-5) a partir de un ISO, sin marcado propio, para que cualquier vista
// arme el HTML que le convenga con los mismos dos strings.
function timePeruParts(iso) {
  if (!iso) return null;
  const fecha = new Date(iso);
  const utcStr = fecha.toLocaleString('es-PE', {
    timeZone: 'UTC', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const peruStr = fecha.toLocaleString('es-PE', {
    timeZone: 'America/Lima', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  return { utcStr, peruStr };
}
function formatTimePeruCompact(iso) {
  const parts = timePeruParts(iso);
  if (!parts) return '—';
  return `${parts.utcStr} UTC · ${parts.peruStr} PE`;
}

// =========================================================================
// PÁGINA: INICIO — capital total, PnL, gráfica de capital.
// =========================================================================
function inicioSkeleton() {
  return `
    <div class="page-header card">
      <div class="ph-title">CAPITAL TOTAL — BOT 4</div>
      <div class="ph-value" id="inCapital">—</div>
      <div class="ph-sub">
        <span id="inPnlInline">—</span>
        <span id="inStatusPill"></span>
        ${modePillHtml('live')}
      </div>
    </div>
    <div class="stat-row">
      <div class="stat-box"><div class="stat-label">📈 PnL Total</div><div class="stat-value" id="inPnlTotal">—</div></div>
      <div class="stat-box"><div class="stat-label">🎯 Win Rate (7d)</div><div class="stat-value" id="inWinRate">—</div></div>
      <div class="stat-box"><div class="stat-label">🔄 Trades (hoy / 7d)</div><div class="stat-value" id="inTrades">—</div></div>
    </div>
    <div class="chart-card">
      <div class="chart-card-title">Capital en el tiempo</div>
      <div class="period-selector" id="inPeriodSelector">
        <button class="period-btn" data-period="24h">24H</button>
        <button class="period-btn active" data-period="7d">7D</button>
        <button class="period-btn" data-period="30d">30D</button>
      </div>
      <div id="inChartPlaceholder" class="chart-placeholder">Cargando gráfica…</div>
      <div id="inChartContainer" class="chart-el" style="display:none;"></div>
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
    const { chart, series } = ensureAreaChart('inChartContainer', '#00ff88');
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

async function refreshInicio() {
  try {
    const id = await getBot4Id();
    if (id === null) throw new Error('bot no encontrado');
    const [bot, real] = await Promise.all([
      fetchJson(`/api/competition/bot/${id}`),
      fetchJson('/api/bot/4/balance-real').catch(() => null),
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
  } catch (err) {
    $('inCapital').textContent = '—';
  }
  loadInicioChart(inCurrentPeriod);
}

// =========================================================================
// PÁGINA: POSICIONES — saldo real Binance, qué piensa el bot, accumulation
// path (una tarjeta por par, con anillo de progreso) y config de estrategia.
// =========================================================================
// PAIR_COLORS/PAIR_EMOJI: acento visual por cripto — cualquier par que no
// esté en el mapa (p.ej. un par nuevo activado con /activar por Telegram)
// cae al fallback (verde / ●), nunca rompe el render.
const PAIR_COLORS = { BTC: '#f7931a', ETH: '#8a92b2', BNB: '#f0b90b', SOL: '#14f195' };
const PAIR_EMOJI = { BTC: '₿', ETH: 'Ξ', BNB: '🔶', SOL: '◎' };
function pairColor(pair) { return PAIR_COLORS[pair.split('/')[0]] || 'var(--green)'; }
function pairEmoji(pair) { return PAIR_EMOJI[pair.split('/')[0]] || '●'; }
// pairIconHtml: ícono real de la cripto (cryptocurrency-icons vía jsdelivr,
// CDN público, sin API key). Si el símbolo no está en ese set (par muy
// nuevo/raro activado por Telegram), el onerror esconde el <img> roto y
// muestra el emoji de PAIR_EMOJI como respaldo — nunca se rompe visualmente.
function pairIconHtml(pair, size = 22) {
  const sym = pair.split('/')[0];
  const url = `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${sym.toLowerCase()}.svg`;
  return `<span class="pair-icon" style="width:${size}px;height:${size}px;">` +
    `<img src="${url}" alt="${esc(sym)}" width="${size}" height="${size}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">` +
    `<span class="pair-icon-fallback" style="display:none;width:${size}px;height:${size}px;">${pairEmoji(pair)}</span>` +
    `</span>`;
}
function pairIdPrefix(pair) { return `dca-${pair.split('/')[0].toLowerCase()}`; }

// progressRingSvg/updateProgressRing: anillo circular de "compras/maxCompras"
// — se dibuja una vez con 0% (el skeleton no depende de datos) y cada
// refresh solo mueve stroke-dashoffset + el texto del centro, mismo criterio
// "solo tocar lo que cambió" que el resto del dashboard.
function progressRingSvg(color, size = 56) {
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
        <div class="pair-card-name">${pairIconHtml(pair, 24)} ${esc(pair.split('/')[0])}</div>
        <div class="pair-card-ring" id="${idPrefix}-ring">${progressRingSvg(color)}</div>
      </div>
      <div class="stat-sub" id="${idPrefix}-ciclo" style="margin-bottom:10px;">—</div>
      <div class="kv-row"><span class="label">Avg Entry</span><span class="value" id="${idPrefix}-avg-entry">—</span></div>
      <div class="kv-row"><span class="label">Precio actual</span><span class="value" id="${idPrefix}-precio-actual">—</span></div>
      <div class="kv-row"><span class="label">Invertido</span><span class="value" id="${idPrefix}-capital-invertido">—</span></div>
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
  // TP actual del ciclo / precio de venta — solo se muestra si hay compras
  // abiertas (p.tpPct viene null si el par todavía no tiene ningún trade abierto).
  $(`${idPrefix}-tp-block`).innerHTML = p.tpPct !== null ? `
    <div class="tp-divider"></div>
    <div class="kv-row"><span class="label">🎯 TP actual</span><span class="value">${p.tpPct}%</span></div>
    <div class="kv-row"><span class="label">💰 Vende en</span><span class="value">${fmtUsdPrecise(p.precioVenta)}</span></div>
    <div class="kv-row"><span class="label">📈 Falta subir</span><span class="value pnl-pos">${fmtUsd(p.faltaSubir)} (+${p.faltaPct}%)</span></div>
  ` : '';
  // triggerNote: server.js solo lo manda cuando el ciclo sigue acumulando
  // pero dynamicDropPctForPair no pudo leer el ATR real (cayó al fallback
  // estático) — en ese caso NO llega nextTriggerPrice, se muestra este aviso
  // en vez del mensaje genérico de "esperando caída".
  $(`${idPrefix}-trigger-block`).innerHTML = p.nextTriggerPrice !== null ? `
    <div class="tp-divider"></div>
    <div class="kv-row"><span class="label">Próximo trigger</span><span class="value">${fmtUsdPrecise(p.nextTriggerPrice)}</span></div>
    <div class="kv-row"><span class="label">Drop necesario</span><span class="value pnl-neg">-${p.dropRequiredPct}%</span></div>
  ` : `<div class="tp-divider"></div><div class="stat-sub">${p.triggerNote ? esc(p.triggerNote) : (p.compras >= p.maxCompras ? 'Ciclo completo, esperando Take Profit.' : 'Esperando caída para la próxima compra.')}</div>`;
}
let poPairKeys = null; // set de pares (string) ya renderizado — null fuerza reconstruir
function renderAccumulationPathIncremental(pares) {
  const pairEntries = Object.entries(pares);
  const keys = pairEntries.map(([pair]) => pair).sort().join('|');
  if (keys !== poPairKeys) {
    // Cambió el set de pares (p.ej. se activó uno nuevo con /activar por
    // Telegram) — se reconstruyen las tarjetas. En el uso normal (mismos 3
    // pares en cada refresh) esto no corre, solo updateAccumulationPairBlock.
    poPairKeys = keys;
    $('poPairBlocks').innerHTML = pairEntries.map(([pair]) => accumulationPairBlockSkeleton(pair, pairIdPrefix(pair))).join('');
  }
  pairEntries.forEach(([pair, p]) => updateAccumulationPairBlock(pairIdPrefix(pair), p));
}

// "🧠 Qué está pensando el bot" — GET /api/bot/4/thoughts.
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
// Umbral ±10%: por encima de +10% es sobrecompra de la semana → naranja/
// cautela; por debajo de -10% es una caída fuerte → verde, porque para un
// bot DCA que compra el drop una caída grande es oportunidad, no riesgo (al
// revés del caso positivo). Entre medio, gris/normal.
function cambio7dInfo(pct) {
  if (pct === null || pct === undefined) return { texto: 'N/D', color: 'var(--text-sec)', icon: '' };
  const texto = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  if (pct > 10) return { texto, color: 'var(--yellow)', icon: ' ⚠️' };
  if (pct < -10) return { texto, color: 'var(--green)', icon: ' 🟢' };
  return { texto, color: 'var(--text-sec)', icon: '' };
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
    ? '<div class="stat-sub" style="color:var(--yellow); margin-top:4px;">⚠️ Mercado sobreextendido — bot más cauteloso</div>'
    : conDescuento
      ? '<div class="stat-sub" style="color:var(--green); margin-top:4px;">🟢 Caída fuerte esta semana — posible oportunidad de compra</div>'
      : '';
  return `
    <div class="stat-sub" style="margin-top:10px; border-top:1px solid var(--border); padding-top:8px;">📈 CONTEXTO SEMANAL:</div>
    <div class="kv-row"><span class="label">BTC</span><span class="value" style="color:${btc.color};">${btc.texto} esta semana${btc.icon}</span></div>
    <div class="kv-row"><span class="label">ETH</span><span class="value" style="color:${eth.color};">${eth.texto} esta semana${eth.icon}</span></div>
    <div class="kv-row"><span class="label">BNB</span><span class="value" style="color:${bnb.color};">${bnb.texto} esta semana${bnb.icon}</span></div>
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

// donutChartHtml: distribución del capital por par + libre, con
// conic-gradient (soportado en todo navegador evergreen, sin librería de
// gráficos extra para un solo donut). entries: [{ label, value, color }].
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
      <span class="donut-label">${e.icon || ''} ${esc(e.label)}</span>
      <span class="donut-value">${fmtUsd(e.value)} (${Math.round((e.value / total) * 100)}%)</span>
    </div>`).join('');
  return `
    <div class="donut-wrap">
      <div class="donut-chart" style="background: conic-gradient(${stops});"></div>
      <div class="donut-legend">${legend}</div>
    </div>`;
}

function posicionesSkeleton() {
  return `
    <div class="page-header">
      <div class="ph-title">POSICIONES — BOT 4</div>
    </div>
    <div class="stat-row">
      <div class="stat-box"><div class="stat-label">💰 Capital Total</div><div class="stat-value" id="poCapitalTotal">—</div></div>
      <div class="stat-box"><div class="stat-label">📥 Invertido</div><div class="stat-value" id="poInvertido">—</div></div>
      <div class="stat-box"><div class="stat-label">📤 Libre</div><div class="stat-value" id="poLibre">—</div></div>
    </div>
    <div class="panel">
      <div class="panel-title">🥧 Distribución del capital</div>
      <div id="poDonutPanel"><div class="empty-state skeleton">Cargando…</div></div>
    </div>
    <div id="poErrorBanner"></div>
    <div id="poRealBalancePanel"></div>
    <div id="poThoughtsPanel"></div>
    <div class="section-title">Accumulation Path</div>
    <div class="pair-grid" id="poPairBlocks"><div class="empty-state skeleton">Cargando…</div></div>
    <div class="section-title">Configuración de la estrategia</div>
    <div class="stat-row" id="poConfigStats"><div class="empty-state skeleton">Cargando…</div></div>
    <div class="stat-sub" id="poDropLabel" style="margin-top:10px;"></div>
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
    $('poCapitalTotal').textContent = fmtUsd(bot.capitalActual);
    $('poInvertido').textContent = fmtUsd(bot.capitalInvertido);
    $('poLibre').textContent = fmtUsd(bot.capitalLibre);

    const donutEntries = [
      ...Object.entries(path.pares).map(([pair, p]) => ({ label: pair.split('/')[0], value: p.totalInvested, color: pairColor(pair) })),
      { label: 'Libre', value: bot.capitalLibre, color: 'var(--text-sec)' },
    ];
    $('poDonutPanel').innerHTML = donutChartHtml(donutEntries);

    // Saldo REAL de Binance (2026-09-16, fix: el panel tenía BTC/ETH/BNB
    // hardcodeados a mano — cualquier par nuevo activado con /activar por
    // Telegram no aparecía acá aunque la API ya lo trajera dinámico, ver
    // fetchBot4BalanceReal en server.js). Ahora itera real.posiciones tal
    // cual venga, sin asumir cuáles/cuántos pares hay.
    const posicionesHtml = (real && real.live)
      ? Object.entries(real.posiciones).map(([sym, p]) => `<div class="kv-row"><span class="label" style="display:flex;align-items:center;gap:6px;">${pairIconHtml(`${sym}/USDT`, 16)} ${esc(sym)}</span><span class="value">${p.cantidad.toFixed(6)} (${fmtUsd(p.valorUsd)})</span></div>`).join('')
      : '';
    $('poRealBalancePanel').innerHTML = (real && real.live) ? `
      <div class="panel" style="border:1px solid #ff3b3b55;">
        <div class="panel-title">💰 Saldo real en Binance <span class="pill mode-live">🔴 LIVE</span></div>
        <div class="kv-row"><span class="label">USDT disponible</span><span class="value">${fmtUsd(real.usdtDisponible)}</span></div>
        ${posicionesHtml}
        <div class="kv-row"><span class="label">Capital total real</span><span class="value">${fmtUsd(real.capitalRealTotal)}</span></div>
      </div>` : '';

    $('poThoughtsPanel').innerHTML = thoughts ? renderThoughtsPanel(thoughts) : '';

    renderAccumulationPathIncremental(path.pares);

    $('poConfigStats').innerHTML = `
      <div class="stat-box"><div class="stat-label">Orden por compra</div><div class="stat-value">${path.config.baseOrderUsd !== null ? fmtUsd(path.config.baseOrderUsd) : 'variable'}</div></div>
      <div class="stat-box"><div class="stat-label">Take Profit</div><div class="stat-value">${path.config.tpMinPct}% – ${path.config.tpMaxPct}%</div></div>
      <div class="stat-box"><div class="stat-label">Máx. compras</div><div class="stat-value">${path.config.maxCompras}</div></div>`;
    $('poDropLabel').textContent = `Drop trigger: ${path.config.dropPctLabel}`;
    $('poErrorBanner').innerHTML = '';
  } catch (err) {
    $('poErrorBanner').innerHTML = '<div class="empty-state">No se pudo cargar la información de posiciones.</div>';
  }
}

// =========================================================================
// PÁGINA: HISTORIAL — un ciclo = todas las compras DCA de un par que se
// cerraron JUNTAS en la misma venta (ver sellAll en competitionDcaMotorA.js)
// — tarjeta expandible con el resumen del ciclo y el detalle de cada compra.
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
            <span class="cycle-pair">${pairIconHtml(c.par, 18)} ${esc(c.par)}</span>
            <span class="cycle-time-row">Inicio: ${formatTimePeruCompact(c.inicioTs)}</span>
            <span class="cycle-time-row">Fin: ${formatTimePeruCompact(c.cierreTs)}</span>
            <span class="cycle-meta">(${esc(c.duracion)}) · ${c.numCompras} compras · ${fmtUsd(c.totalInvertido)} invertido</span>
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
let dcaKnownCycleKeys = null; // Set<string> de ciclos ya en la lista — null fuerza reconstruir
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
  // ciclos viene ordenado más nuevo primero — se recorre desde el principio
  // hasta el primer ciclo ya conocido; todo lo anterior es nuevo.
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
function historialSkeleton() {
  return `
    <div class="page-header">
      <div class="ph-title">HISTORIAL DE CICLOS — BOT 4</div>
      <div class="stat-sub" style="margin-top:6px;">Cada tarjeta es un ciclo completo: todas las compras DCA de un par, cerradas juntas en la misma venta.</div>
    </div>
    <div class="stat-row">
      <div class="stat-box"><div class="stat-label">📜 Ciclos cerrados</div><div class="stat-value" id="hiTotalCiclos">—</div></div>
      <div class="stat-box"><div class="stat-label">🎯 Win Rate</div><div class="stat-value" id="hiWinRate">—</div></div>
      <div class="stat-box"><div class="stat-label">📈 PnL total</div><div class="stat-value" id="hiPnlTotal">—</div></div>
    </div>
    <div id="hiErrorBanner"></div>
    <div class="table-wrap" id="dcaHistory"><div class="empty-state skeleton">Cargando…</div></div>
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
    renderDcaCyclesIncremental(cycles || []);
    $('hiErrorBanner').innerHTML = '';
  } catch (err) {
    $('hiErrorBanner').innerHTML = '<div class="empty-state">No se pudo cargar el historial.</div>';
  }
}

// =========================================================================
// PÁGINA: MÉTRICAS — calendario de ganancias + top trades del mes. Todo
// escopeado a Bot 4, solo trades CERRADOS reales (nunca capital agregado a
// mano) — ver GET /api/metrics/daily|monthly|top-trades en
// src/api/server.js del bot.
// =========================================================================
const MET_DIAS_SEMANA = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const MET_MESES_LARGOS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// peruNow/peruDateKey: Perú no tiene horario de verano (siempre UTC-5) — se
// usa el mismo offset fijo que el backend para que las claves "YYYY-MM-DD"
// del calendario coincidan exactamente con el campo `fecha` que ya devuelve
// /api/metrics/daily (que sí se calcula en Postgres con AT TIME ZONE, la
// fuente de verdad).
function peruNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
}
function peruDateKey(iso) {
  const d = new Date(new Date(iso).getTime() - 5 * 3600000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

let metCalYear = null;
let metCalMonth = null; // 0-indexed
let metSelectedFecha = null; // "YYYY-MM-DD" en hora Perú, o null (nada seleccionado)
let metDailyMap = {}; // fecha -> fila de /api/metrics/daily
let metCyclesCache = []; // /api/bot/4/cycles, para el detalle "trades de ese día"

function metricasSkeleton() {
  return `
    <div class="page-header">
      <div class="ph-title">📈 MÉTRICAS — BOT 4</div>
      <div class="ph-sub" style="font-size:13px; font-weight:400; color:var(--text-sec);">Solo ganancias REALES de trades cerrados (no incluye capital agregado a mano)</div>
    </div>

    <div class="chart-card">
      <div class="chart-card-title" style="display:flex; justify-content:space-between; align-items:center;">
        <span>📅 Calendario de ganancias</span>
        <span style="display:flex; align-items:center; gap:10px;">
          <button class="period-btn" id="metCalPrev">‹</button>
          <span id="metCalLabel" style="min-width:130px; text-align:center; display:inline-block; font-weight:700; color:var(--text);">—</span>
          <button class="period-btn" id="metCalNext">›</button>
        </span>
      </div>
      <div class="metrics-calendar-weekdays">${MET_DIAS_SEMANA.map((d) => `<div class="mc-weekday">${d}</div>`).join('')}</div>
      <div class="metrics-calendar" id="metCalendarGrid"><div class="empty-state skeleton">Cargando…</div></div>
    </div>

    <div class="panel" id="metDayDetailPanel" style="display:none;">
      <div class="panel-title" id="metDayDetailTitle">Trades del día</div>
      <div id="metDayDetailBody"></div>
    </div>

    <div class="chart-card">
      <div class="chart-card-title">📊 Ganancias netas por día (USD)</div>
      <div class="chart-el" id="metBarChartContainer"></div>
      <div class="chart-placeholder" id="metBarChartPlaceholder" style="display:none;">Sin trades cerrados todavía.</div>
    </div>

    <div class="section-title">Resumen del mes</div>
    <div class="stat-row" id="metSummaryRow"><div class="empty-state skeleton">Cargando…</div></div>

    <div class="section-title">🏆 Top trades del mes</div>
    <div class="metrics-top-grid">
      <div class="panel">
        <div class="panel-title">Mejores 5</div>
        <div id="metTopBest"><div class="empty-state skeleton">Cargando…</div></div>
      </div>
      <div class="panel">
        <div class="panel-title">Peores 5</div>
        <div id="metTopWorst"><div class="empty-state skeleton">Cargando…</div></div>
      </div>
    </div>
  `;
}

function renderMetCalendar() {
  $('metCalLabel').textContent = `${MET_MESES_LARGOS[metCalMonth]} ${metCalYear}`;
  // primerDiaSemana: 0=lunes...6=domingo (getUTCDay() da 0=domingo, se rota).
  const primerDiaSemana = (new Date(Date.UTC(metCalYear, metCalMonth, 1)).getUTCDay() + 6) % 7;
  const diasEnMes = new Date(Date.UTC(metCalYear, metCalMonth + 1, 0)).getUTCDate();

  let html = '';
  for (let i = 0; i < primerDiaSemana; i++) html += '<div class="mc-day empty"></div>';
  for (let dia = 1; dia <= diasEnMes; dia++) {
    const fecha = `${metCalYear}-${String(metCalMonth + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    const row = metDailyMap[fecha];
    const clases = ['mc-day'];
    if (row) clases.push(row.pnl >= 0 ? 'pos' : 'neg');
    if (fecha === metSelectedFecha) clases.push('selected');
    html += `<div class="${clases.join(' ')}" data-fecha="${fecha}">
      <span class="mc-day-num">${dia}</span>
      ${row ? `<span class="mc-day-pnl">${row.pnl >= 0 ? '+' : ''}${fmtUsd(row.pnl)}</span>` : ''}
    </div>`;
  }
  $('metCalendarGrid').innerHTML = html;
  $('metCalendarGrid').querySelectorAll('.mc-day[data-fecha]').forEach((el) => {
    el.addEventListener('click', () => {
      // Click de nuevo sobre el día ya seleccionado = deseleccionar (cierra el panel).
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
    : ciclosDelDia.map((c) => `
      <div class="kv-row">
        <span class="label">${esc(c.par)} · ${c.numCompras} compras · ${formatTimePeruCompact(c.cierreTs)}</span>
        <span class="value ${pnlClass(c.pnlTotal)}">${fmtUsd(c.pnlTotal)}</span>
      </div>`).join('');
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
    .map((d) => ({
      time: Math.floor(new Date(`${d.fecha}T00:00:00Z`).getTime() / 1000),
      value: d.pnl,
      color: d.pnl >= 0 ? '#00ff88' : '#ff4444',
    }))
    .sort((a, b) => a.time - b.time);
  const { chart, series } = ensureHistogramChart('metBarChartContainer');
  series.setData(points);
  chart.timeScale().fitContent();
}

function renderMetSummary(m) {
  if (!m) { $('metSummaryRow').innerHTML = '<div class="empty-state">No se pudo cargar.</div>'; return; }
  $('metSummaryRow').innerHTML = `
    <div class="stat-box"><div class="stat-label">Días operando</div><div class="stat-value">${m.diasOperando}</div></div>
    <div class="stat-box"><div class="stat-label">Trades cerrados</div><div class="stat-value">${m.tradesCerrados}</div></div>
    <div class="stat-box"><div class="stat-label">Ganancia bruta</div><div class="stat-value ${pnlClass(m.pnlBruto)}">${fmtUsd(m.pnlBruto)}</div></div>
    <div class="stat-box"><div class="stat-label">Fees pagados</div><div class="stat-value pnl-neg">-${fmtUsd(Math.abs(m.feesTotal))}</div></div>
    <div class="stat-box"><div class="stat-label">Ganancia NETA</div><div class="stat-value ${pnlClass(m.pnlNeto)}">${fmtUsd(m.pnlNeto)} ${m.pnlNeto >= 0 ? '✅' : ''}</div></div>
    <div class="stat-box"><div class="stat-label">Mejor día</div><div class="stat-value pnl-pos">${m.mejorDia ? `${m.mejorDia.fecha}` : '—'}</div><div class="stat-sub">${m.mejorDia ? fmtUsd(m.mejorDia.pnl) : ''}</div></div>
    <div class="stat-box"><div class="stat-label">Peor día</div><div class="stat-value pnl-neg">${m.peorDia ? `${m.peorDia.fecha}` : '—'}</div><div class="stat-sub">${m.peorDia ? fmtUsd(m.peorDia.pnl) : ''}</div></div>
    <div class="stat-box"><div class="stat-label">Win Rate del mes</div><div class="stat-value">${m.winRate}%</div></div>
    <div class="stat-box"><div class="stat-label">Profit Factor</div><div class="stat-value">${m.profitFactor !== null ? m.profitFactor.toFixed(2) : '∞'}</div></div>
  `;
}

function renderMetTopTrades(top) {
  const renderList = (list) => (!list || list.length === 0
    ? '<div class="empty-state">Sin trades este mes.</div>'
    : list.map((t) => `
      <div class="kv-row">
        <span class="label">${esc(t.pair.split('/')[0])} ${esc(t.horaPeru)}</span>
        <span class="value ${pnlClass(t.pnl)}">${fmtUsd(t.pnl)}</span>
      </div>`).join(''));
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
        <label>API base (Cloudflare Tunnel)</label>
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
      <div class="kv-row"><span class="label">Dashboard</span><span class="value">Nuvera Bot — Bot 4</span></div>
      <div class="kv-row"><span class="label">Repositorio bot</span><span class="value"><a href="https://github.com/alexys1/nuvera-trading-bot" target="_blank" rel="noopener">nuvera-trading-bot</a></span></div>
      <div class="kv-row"><span class="label">Repositorio dashboard</span><span class="value"><a href="https://github.com/alexys1/nuvera-dashboard" target="_blank" rel="noopener">nuvera-dashboard</a></span></div>
    </div>
  `;
}

// renderSettingsSkeleton/refreshSettings: separar skeleton/refresh evita que
// reconstruir el HTML en cada poll pise <input id="apiBaseInput"> con su
// valor original, borrando lo que el usuario estuviera escribiendo.
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
      <div class="kv-row"><span class="label">Capital total</span><span class="value">${fmtUsd(data.capitalTotal)}</span></div>`;
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
const ROUTES = ['inicio', 'posiciones', 'historial', 'metricas', 'settings'];
// RENDER = construye el HTML de la página (skeleton), UNA sola vez por
// visita a la ruta. REFRESH = pide datos frescos y actualiza SOLO texto/
// clases de elementos ya existentes — es lo único que corre en cada poll, así
// que no hay parpadeo ni salto de scroll en el polling silencioso.
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
// Intervalo base 5s — las llamadas a datos menos urgentes no necesitan un
// setInterval propio: fetchJson ya cachea por endpoint con su propio TTL
// (ver resolveTtl arriba), así que aunque refresh() se llame cada 5s, la red
// solo se golpea con la frecuencia real de cada tipo de dato.
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

// Al volver a la pestaña: solo refresh (sin reconstruir el skeleton), así
// que tampoco pierde scroll acá.
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
