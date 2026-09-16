// Dashboard Nuvera Bot (2026-09-16, 4to rediseño: migración a Bootstrap 5)
// — el sistema quedó reducido a un solo bot operando con dinero real
// (Bot 2, Bot 3, Motor A y Motor B fueron desactivados en el backend, ver
// BOT4_LIVE_FOCUS en nuvera-trading-bot/src/core/bot.js). Pedido explícito:
// "no hay como usar bootstrap, diseños pre establecidos" — en vez de seguir
// afinando CSS a mano (sin poder ver el resultado renderizado), el layout
// ahora se apoya en componentes de Bootstrap 5.3 (cards, grid, badges,
// accordion, offcanvas para el sidebar mobile, tema oscuro nativo vía
// data-bs-theme) vía CDN — solo quedan a medida las piezas que Bootstrap no
// tiene: colores por cripto, anillo de progreso SVG, donut de capital,
// calendario de métricas. Sin build step (se sirve tal cual desde GitHub
// Pages).

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
// pnlClass: clases semánticas de Bootstrap (text-success/text-danger) en vez
// de clases propias — se usan tal cual en cualquier template de acá abajo.
const pnlClass = (n) => (n === null || n === undefined ? '' : (n >= 0 ? 'text-success' : 'text-danger'));
const esc = (s) => String(s ?? '').replace(/</g, '&lt;');

// ---------- Helpers de markup Bootstrap reusados en todas las páginas ----------
// statBoxHtml: card de stat con id vacío (lo llena refreshX() en cada poll).
function statBoxHtml(label, id) {
  return `<div class="col"><div class="card h-100"><div class="card-body py-2 px-3">
    <div class="text-body-secondary small text-uppercase fw-bold">${label}</div>
    <div class="fs-5 fw-bold" id="${id}">—</div>
  </div></div></div>`;
}
// statBoxValueHtml: mismo card pero con el valor ya resuelto (para bloques
// que se reconstruyen enteros en cada refresh, como Métricas).
function statBoxValueHtml(label, valueHtml) {
  return `<div class="col"><div class="card h-100"><div class="card-body py-2 px-3">
    <div class="text-body-secondary small text-uppercase fw-bold">${label}</div>
    <div class="fs-5 fw-bold">${valueHtml}</div>
  </div></div></div>`;
}
// kv: fila "label: valor" — reemplaza el viejo .kv-row a mano, con
// utilidades de Bootstrap (d-flex/justify-content-between) en vez de CSS
// propio.
function kv(label, valueHtml, valueClass = '') {
  return `<div class="d-flex justify-content-between align-items-baseline py-1 small border-bottom border-secondary-subtle">
    <span class="text-body-secondary">${label}</span>
    <span class="fw-bold ${valueClass}">${valueHtml}</span>
  </div>`;
}
// cardHtml: panel genérico título + cuerpo.
function cardHtml(titleHtml, bodyHtml, extraClass = '') {
  return `<div class="card mb-3 ${extraClass}"><div class="card-body">
    <div class="card-title text-uppercase text-body-secondary small fw-bold mb-2">${titleHtml}</div>
    ${bodyHtml}
  </div></div>`;
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

// ---------- Sidebar (Bootstrap Offcanvas, ver index.html #sidebar) ----------
document.querySelectorAll('.nav-link[data-route]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (window.location.hash === `#${btn.dataset.route}`) return;
    window.location.hash = btn.dataset.route;
  });
});
function closeMobileSidebar() {
  const el = $('sidebar');
  const oc = bootstrap.Offcanvas.getInstance(el);
  if (oc) oc.hide();
}

// ---------- Lightweight Charts: helper genérico ----------
// Colores de grilla/eje en rgba(255,255,255,x) en vez de hex fijos: quedan
// legibles sobre cualquier tono oscuro de Bootstrap sin tener que leer sus
// custom properties en runtime (Canvas no resuelve var(--bs-...) directo).
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
    layout: { background: { color: 'transparent' }, textColor: '#8b949e', fontSize: 11 },
    grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(255,255,255,0.06)' } },
    rightPriceScale: { borderColor: 'rgba(255,255,255,0.15)' },
    timeScale: { borderColor: 'rgba(255,255,255,0.15)', timeVisible: true, secondsVisible: false },
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
    layout: { background: { color: 'transparent' }, textColor: '#8b949e', fontSize: 11 },
    grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(255,255,255,0.06)' } },
    rightPriceScale: { borderColor: 'rgba(255,255,255,0.15)' },
    timeScale: { borderColor: 'rgba(255,255,255,0.15)', timeVisible: false, secondsVisible: false },
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
  return modo === 'live' ? '<span class="badge rounded-pill text-bg-danger">🔴 LIVE</span>' : '<span class="badge rounded-pill text-bg-secondary">○ PAPER</span>';
}
function statusPillHtml(activo) {
  if (activo === false) return '<span class="badge rounded-pill text-bg-secondary">PAUSADO</span>';
  return '<span class="badge rounded-pill text-bg-success">ACTIVE</span>';
}
// Línea "$X invertido · $Y libre" — reusada donde hace falta un resumen corto.
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
    <div class="card mb-3 shadow-sm">
      <div class="card-body">
        <div class="text-uppercase text-body-secondary small fw-bold">Capital Total — Bot 4</div>
        <div class="display-5 fw-bold" id="inCapital">—</div>
        <div class="d-flex align-items-center gap-2 mt-2 flex-wrap">
          <span id="inPnlInline">—</span>
          <span id="inStatusPill"></span>
          ${modePillHtml('live')}
        </div>
      </div>
    </div>
    <div class="row row-cols-1 row-cols-md-3 g-2 mb-3">
      ${statBoxHtml('📈 PnL Total', 'inPnlTotal')}
      ${statBoxHtml('🎯 Win Rate (7d)', 'inWinRate')}
      ${statBoxHtml('🔄 Trades (hoy / 7d)', 'inTrades')}
    </div>
    <div class="card mb-3">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
          <div class="card-title text-uppercase text-body-secondary small fw-bold mb-0">Capital en el tiempo</div>
          <div class="btn-group" id="inPeriodSelector">
            <button class="btn btn-sm btn-outline-secondary period-btn" data-period="24h">24H</button>
            <button class="btn btn-sm btn-outline-secondary period-btn active" data-period="7d">7D</button>
            <button class="btn btn-sm btn-outline-secondary period-btn" data-period="30d">30D</button>
          </div>
        </div>
        <div id="inChartPlaceholder" class="text-center text-body-secondary py-5">Cargando gráfica…</div>
        <div id="inChartContainer" style="height:220px; display:none;"></div>
      </div>
    </div>
    <div class="card mb-3" id="inRachaCard" style="display:none;"></div>
    <div class="card">
      <div class="card-body">
        <div class="card-title text-uppercase text-body-secondary small fw-bold mb-2">🕒 Actividad reciente</div>
        <div id="inActivityFeed"><div class="text-center text-body-secondary py-3">Cargando…</div></div>
      </div>
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

// renderRachaCard: /api/racha — técnicamente no filtra por bot_instance_id
// (cuenta los últimos trades cerrados de TODA la base), pero con
// BOT4_LIVE_FOCUS=true ningún otro bot cierra trades nuevos, así que en la
// práctica de hoy es 100% la racha de Bot 4. Si algún día se reactivan los
// otros 4 bots (BOT4_LIVE_FOCUS=false) este endpoint dejaría de ser
// confiable acá y habría que pedir uno escopeado por bot.
function renderRachaCard(racha) {
  const el = $('inRachaCard');
  if (!racha || !racha.rachaActual) { el.style.display = 'none'; return; }
  const esWin = racha.tipo === 'wins';
  const modoNombre = racha.modo && racha.modo.nombre;
  const modoBadge = modoNombre && modoNombre !== 'NORMAL'
    ? `<span class="badge rounded-pill ${modoNombre === 'AGGRESSIVE' ? 'text-bg-warning' : 'text-bg-info'}">${modoNombre === 'AGGRESSIVE' ? '⚡ AGGRESSIVE' : `🛡️ ${esc(modoNombre)}`}</span>`
    : '';
  const ultimos5Html = (racha.ultimos5 || []).map((r) => (r === 'win' ? '<span class="text-success">●</span>' : '<span class="text-danger">●</span>')).join(' ');
  el.style.display = 'block';
  el.innerHTML = `
    <div class="card-body d-flex justify-content-between align-items-center flex-wrap gap-3">
      <div>
        <div class="text-uppercase text-body-secondary small fw-bold">Racha actual</div>
        <div class="fs-4 fw-bold ${esWin ? 'text-success' : 'text-danger'}">${esWin ? '🔥' : '❄️'} ${racha.rachaActual} ${esWin ? 'ganancias' : 'pérdidas'} seguidas</div>
        <div class="small text-body-secondary mt-1">Últimas 5: ${ultimos5Html || '—'} · Récord: ${racha.recordWins} wins seguidos</div>
      </div>
      <div class="text-end">
        ${modoBadge}
        ${racha.modo && racha.modo.razon ? `<div class="small text-body-secondary mt-1">${esc(racha.modo.razon)}</div>` : ''}
      </div>
    </div>`;
}

// renderActivityFeed: combina posiciones abiertas (= compras en curso, con
// createdAt exacto) y ciclos cerrados (= venta, con cierreTs) en una sola
// línea de tiempo. No incluye cambios de configuración (/drop, /tp, etc. por
// Telegram) — el backend no guarda un historial de esos cambios, solo el
// valor vigente, así que no hay de dónde sacar ese dato todavía.
function activityEventHtml(e) {
  const time = relativeTimeEs(e.ts);
  if (e.type === 'buy') {
    return `<div class="d-flex justify-content-between align-items-center py-2 border-bottom border-secondary-subtle">
      <div class="d-flex align-items-center gap-2">
        <span class="badge rounded-pill text-bg-success">COMPRA</span>
        ${pairIconHtml(e.pair, 18)}
        <span class="fw-bold">${esc(e.pair.split('/')[0])}</span>
        <span class="text-body-secondary small">${fmtUsd(e.sizeUsdt)} @ ${fmtUsdPrecise(e.entryPrice, e.entryPrice < 10 ? 4 : 2)}</span>
      </div>
      <span class="text-body-secondary small">${time}</span>
    </div>`;
  }
  return `<div class="d-flex justify-content-between align-items-center py-2 border-bottom border-secondary-subtle">
    <div class="d-flex align-items-center gap-2">
      <span class="badge rounded-pill ${e.outcome === 'win' ? 'text-bg-success' : 'text-bg-danger'}">CICLO CERRADO</span>
      ${pairIconHtml(e.pair, 18)}
      <span class="fw-bold">${esc(e.pair.split('/')[0])}</span>
      <span class="${pnlClass(e.pnl)} small fw-bold">${fmtUsd(e.pnl)}</span>
    </div>
    <span class="text-body-secondary small">${time}</span>
  </div>`;
}
function renderActivityFeed(positions, cycles) {
  const events = [
    ...(positions || []).map((p) => ({ type: 'buy', pair: p.pair, ts: p.createdAt, sizeUsdt: p.sizeUsdt, entryPrice: p.entryPrice })),
    ...(cycles || []).map((c) => ({ type: 'close', pair: c.par, ts: c.cierreTs, pnl: c.pnlTotal, outcome: c.outcome })),
  ].filter((e) => e.ts).sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 12);
  $('inActivityFeed').innerHTML = events.length === 0
    ? '<div class="text-center text-body-secondary py-3">Sin actividad todavía.</div>'
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
    $('inPnlTotal').className = `fs-5 fw-bold ${pnlClass(pnlUsd)}`;
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
// PÁGINA: POSICIONES — saldo real Binance, qué piensa el bot, accumulation
// path (una tarjeta por par, con anillo de progreso) y config de estrategia.
// =========================================================================
// PAIR_COLORS/PAIR_EMOJI: acento visual por cripto — cualquier par que no
// esté en el mapa (p.ej. un par nuevo activado con /activar por Telegram)
// cae al fallback (verde de Bootstrap / ●), nunca rompe el render.
const PAIR_COLORS = { BTC: '#f7931a', ETH: '#8a92b2', BNB: '#f0b90b', SOL: '#14f195' };
const PAIR_EMOJI = { BTC: '₿', ETH: 'Ξ', BNB: '🔶', SOL: '◎' };
function pairColor(pair) { return PAIR_COLORS[pair.split('/')[0]] || 'var(--bs-success)'; }
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
// refresh solo mueve stroke-dashoffset + el texto del centro.
function progressRingSvg(color, size = 56) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--bs-border-color)" stroke-width="${stroke}"/>
      <circle class="ring-fill" data-circumference="${c.toFixed(2)}" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${c.toFixed(2)}" stroke-linecap="round" transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <text class="ring-text" x="50%" y="50%" text-anchor="middle" dy="0.35em" fill="var(--bs-body-color)">0%</text>
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
    <div class="col">
      <div class="card h-100" style="border-top: 3px solid ${color};">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-start mb-1">
            <div class="fw-bold d-flex align-items-center gap-2">${pairIconHtml(pair, 24)} ${esc(pair.split('/')[0])}</div>
            <div id="${idPrefix}-ring">${progressRingSvg(color)}</div>
          </div>
          <div class="small text-body-secondary mb-2" id="${idPrefix}-ciclo">—</div>
          ${kv('Avg Entry', `<span id="${idPrefix}-avg-entry">—</span>`)}
          ${kv('Precio actual', `<span id="${idPrefix}-precio-actual">—</span>`)}
          ${kv('Invertido', `<span id="${idPrefix}-capital-invertido">—</span>`)}
          <div id="${idPrefix}-tp-block"></div>
          <div id="${idPrefix}-trigger-block"></div>
        </div>
      </div>
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
    <hr class="my-2">
    ${kv('🎯 TP actual', `${p.tpPct}%`)}
    ${kv('💰 Vende en', fmtUsdPrecise(p.precioVenta))}
    ${kv('📈 Falta subir', `${fmtUsd(p.faltaSubir)} (+${p.faltaPct}%)`, 'text-success')}
  ` : '';
  // triggerNote: server.js solo lo manda cuando el ciclo sigue acumulando
  // pero dynamicDropPctForPair no pudo leer el ATR real (cayó al fallback
  // estático) — en ese caso NO llega nextTriggerPrice, se muestra este aviso
  // en vez del mensaje genérico de "esperando caída".
  $(`${idPrefix}-trigger-block`).innerHTML = p.nextTriggerPrice !== null ? `
    <hr class="my-2">
    ${kv('Próximo trigger', fmtUsdPrecise(p.nextTriggerPrice))}
    ${kv('Drop necesario', `-${p.dropRequiredPct}%`, 'text-danger')}
  ` : `<hr class="my-2"><div class="small text-body-secondary">${p.triggerNote ? esc(p.triggerNote) : (p.compras >= p.maxCompras ? 'Ciclo completo, esperando Take Profit.' : 'Esperando caída para la próxima compra.')}</div>`;
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
// Umbral ±10%: por encima de +10% es sobrecompra de la semana → cautela;
// por debajo de -10% es una caída fuerte → verde, porque para un bot DCA que
// compra el drop una caída grande es oportunidad, no riesgo (al revés del
// caso positivo). Entre medio, gris/normal.
function cambio7dInfo(pct) {
  if (pct === null || pct === undefined) return { texto: 'N/D', cls: 'text-body-secondary', icon: '' };
  const texto = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  if (pct > 10) return { texto, cls: 'text-warning', icon: ' ⚠️' };
  if (pct < -10) return { texto, cls: 'text-success', icon: ' 🟢' };
  return { texto, cls: 'text-body-secondary', icon: '' };
}
function renderContextoSemanal(contextoSemanal) {
  if (!contextoSemanal) return '';
  // BNB agregado (2026-08-27, tercer par de Bot 4) — mismo criterio que
  // btc/ethCambio7d, ver GET /api/bot/4/thoughts en server.js.
  const { btcCambio7d, ethCambio7d, bnbCambio7d } = contextoSemanal;
  const btc = cambio7dInfo(btcCambio7d);
  const eth = cambio7dInfo(ethCambio7d);
  const bnb = cambio7dInfo(bnbCambio7d);
  const cambios = [btcCambio7d, ethCambio7d, bnbCambio7d];
  const sobreextendido = cambios.some((c) => c !== null && c !== undefined && c > 10);
  const conDescuento = !sobreextendido && cambios.some((c) => c !== null && c !== undefined && c < -10);
  const resumen = sobreextendido
    ? '<div class="small text-warning mt-1">⚠️ Mercado sobreextendido — bot más cauteloso</div>'
    : conDescuento
      ? '<div class="small text-success mt-1">🟢 Caída fuerte esta semana — posible oportunidad de compra</div>'
      : '';
  return `
    <div class="small text-body-secondary mt-2 pt-2 border-top border-secondary-subtle">📈 CONTEXTO SEMANAL:</div>
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
    ? '<div class="small text-body-secondary">El bot todavía no registró ninguna decisión.</div>'
    : pensamientos.map((p) => `
      <div class="border-bottom border-secondary-subtle pb-2 mb-2">
        <div class="fw-bold small">${esc(p.par)}</div>
        <div class="small fst-italic">💭 "${esc(p.razon || p.accion || 'sin detalle')}"</div>
        <div class="small text-body-secondary">Confianza actual: ${p.confianza}% | Necesita: ${data.confianzaMinima}%</div>
      </div>`).join('');
  return cardHtml(
    '🧠 Qué está pensando el bot',
    `<div class="small text-body-secondary mb-2">Actualizado ${relativeTimeEs(masReciente && masReciente.timestamp)}</div>
     ${cuerpo}
     ${kv('Estado general', `${estado.icon} ${estado.label}`)}
     <div class="small text-body-secondary">${esc(estado.sub)}</div>
     ${renderContextoSemanal(data.contextoSemanal)}`,
    'border-warning-subtle',
  );
}

// donutChartHtml: distribución del capital por par + libre, con
// conic-gradient (soportado en todo navegador evergreen, sin librería de
// gráficos extra para un solo donut).
function donutChartHtml(entries) {
  const total = entries.reduce((s, e) => s + e.value, 0);
  if (total <= 0) return '<div class="text-center text-body-secondary py-3">Sin capital para distribuir todavía.</div>';
  let acc = 0;
  const stops = entries.filter((e) => e.value > 0).map((e) => {
    const start = (acc / total) * 360;
    acc += e.value;
    const end = (acc / total) * 360;
    return `${e.color} ${start.toFixed(1)}deg ${end.toFixed(1)}deg`;
  }).join(', ');
  const legend = entries.map((e) => `
    <div class="d-flex align-items-center gap-2 small mb-1">
      <span class="donut-dot" style="background:${e.color}"></span>
      <span class="text-body-secondary flex-grow-1">${esc(e.label)}</span>
      <span class="fw-bold">${fmtUsd(e.value)} (${Math.round((e.value / total) * 100)}%)</span>
    </div>`).join('');
  return `
    <div class="d-flex align-items-center gap-4 flex-wrap">
      <div class="donut-chart" style="background: conic-gradient(${stops});"></div>
      <div class="flex-grow-1" style="min-width:160px;">${legend}</div>
    </div>`;
}

// comparativaHtml: barras divergentes — % de cambio del precio actual vs el
// precio promedio de entrada de cada par, para ver de un vistazo cuál está
// más lejos/cerca de su Take Profit sin entrar a cada tarjeta. Ordenado de
// mejor a peor.
function comparativaHtml(pares) {
  const rows = Object.entries(pares)
    .filter(([, p]) => p.avgEntry !== null && p.currentPrice !== null)
    .map(([pair, p]) => ({ pair, pct: ((p.currentPrice - p.avgEntry) / p.avgEntry) * 100 }))
    .sort((a, b) => b.pct - a.pct);
  if (rows.length === 0) return '<div class="text-center text-body-secondary py-3">Sin posiciones abiertas para comparar.</div>';
  const maxAbs = Math.max(0.5, ...rows.map((r) => Math.abs(r.pct)));
  return rows.map((r) => `
    <div class="d-flex align-items-center gap-2 mb-2">
      <div class="d-flex align-items-center gap-1" style="width:64px;">${pairIconHtml(r.pair, 16)}<span class="small fw-bold">${esc(r.pair.split('/')[0])}</span></div>
      <div class="position-relative flex-grow-1" style="height:16px; background: var(--bs-tertiary-bg); border-radius:4px;">
        <div class="position-absolute top-0 bottom-0" style="left:1px; right:1px; width:1px; background:var(--bs-border-color);"></div>
        <div class="position-absolute top-0 bottom-0" style="${r.pct >= 0 ? 'left:50%' : 'right:50%'}; width:${(Math.abs(r.pct) / maxAbs * 50).toFixed(1)}%; background:${r.pct >= 0 ? 'var(--bs-success)' : 'var(--bs-danger)'}; border-radius:3px;"></div>
      </div>
      <div class="small fw-bold ${pnlClass(r.pct)}" style="width:56px; text-align:right;">${fmtPct(r.pct)}</div>
    </div>`).join('');
}

function posicionesSkeleton() {
  return `
    <h4 class="mb-3">💰 Posiciones — Bot 4</h4>
    <div class="row row-cols-1 row-cols-md-3 g-2 mb-3">
      ${statBoxHtml('💰 Capital Total', 'poCapitalTotal')}
      ${statBoxHtml('📥 Invertido', 'poInvertido')}
      ${statBoxHtml('📤 Libre', 'poLibre')}
    </div>
    <div class="row row-cols-1 row-cols-lg-2 g-3 mb-3">
      <div class="col">
        <div class="card h-100">
          <div class="card-body">
            <div class="card-title text-uppercase text-body-secondary small fw-bold mb-2">🥧 Distribución del capital</div>
            <div id="poDonutPanel" class="text-center text-body-secondary py-3">Cargando…</div>
          </div>
        </div>
      </div>
      <div class="col">
        <div class="card h-100">
          <div class="card-body">
            <div class="card-title text-uppercase text-body-secondary small fw-bold mb-2">⚖️ Comparativa — quién va mejor ahora</div>
            <div id="poComparativaPanel" class="text-center text-body-secondary py-3">Cargando…</div>
          </div>
        </div>
      </div>
    </div>
    <div id="poErrorBanner"></div>
    <div id="poRealBalancePanel"></div>
    <div id="poThoughtsPanel"></div>
    <h6 class="text-uppercase text-body-secondary fw-bold mt-4 mb-2">Accumulation Path</h6>
    <div class="row row-cols-1 row-cols-md-2 row-cols-xl-3 g-3 mb-2" id="poPairBlocks"><div class="col"><div class="text-center text-body-secondary py-3">Cargando…</div></div></div>
    <h6 class="text-uppercase text-body-secondary fw-bold mt-4 mb-2">Configuración de la estrategia</h6>
    <div class="row row-cols-1 row-cols-md-3 g-2 mb-1" id="poConfigStats"></div>
    <div class="small text-body-secondary" id="poDropLabel"></div>
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
      { label: 'Libre', value: bot.capitalLibre, color: 'var(--bs-secondary-color)' },
    ];
    $('poDonutPanel').innerHTML = donutChartHtml(donutEntries);
    $('poComparativaPanel').innerHTML = comparativaHtml(path.pares);

    // Saldo REAL de Binance (2026-09-16, fix: el panel tenía BTC/ETH/BNB
    // hardcodeados a mano — cualquier par nuevo activado con /activar por
    // Telegram no aparecía acá aunque la API ya lo trajera dinámico, ver
    // fetchBot4BalanceReal en server.js). Ahora itera real.posiciones tal
    // cual venga, sin asumir cuáles/cuántos pares hay.
    const posicionesHtml = (real && real.live)
      ? Object.entries(real.posiciones).map(([sym, p]) => kv(`${pairIconHtml(`${sym}/USDT`, 16)} ${esc(sym)}`, `${p.cantidad.toFixed(6)} (${fmtUsd(p.valorUsd)})`)).join('')
      : '';
    $('poRealBalancePanel').innerHTML = (real && real.live) ? cardHtml(
      `💰 Saldo real en Binance ${modePillHtml('live')}`,
      kv('USDT disponible', fmtUsd(real.usdtDisponible)) + posicionesHtml + kv('Capital total real', fmtUsd(real.capitalRealTotal)),
      'border-danger-subtle',
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
    $('poErrorBanner').innerHTML = '<div class="alert alert-secondary">No se pudo cargar la información de posiciones.</div>';
  }
}

// =========================================================================
// PÁGINA: HISTORIAL — un ciclo = todas las compras DCA de un par que se
// cerraron JUNTAS en la misma venta (ver sellAll en competitionDcaMotorA.js)
// — acordeón de Bootstrap con el resumen del ciclo y el detalle de cada compra.
// =========================================================================
function cycleKey(c) { return `${c.par}|${c.cierreTs}`; }
// cycleDomId: id de DOM válido para el accordion (data-bs-target) a partir
// de la misma clave única que ya usaba el render incremental.
function cycleDomId(c) { return `cyc-${cycleKey(c).replace(/[^a-zA-Z0-9_-]/g, '-')}`; }
function cycleCardHtml(c, extraClass = '') {
  const domId = cycleDomId(c);
  const comprasHtml = c.compras.map((b) => `
    <tr>
      <td>${fmtUsdPrecise(b.precio, b.precio < 10 ? 4 : 2)}</td>
      <td>${fmtUsd(b.monto)}</td>
      <td class="${pnlClass(b.pnl)}">${fmtUsd(b.pnl)}</td>
    </tr>`).join('');
  return `
    <div class="accordion-item ${extraClass}" style="border-left: 3px solid ${pairColor(c.par)};">
      <h2 class="accordion-header">
        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#${domId}" aria-expanded="false" aria-controls="${domId}">
          <div class="d-flex justify-content-between align-items-center w-100 me-2 flex-wrap gap-2">
            <div>
              <div class="fw-bold">${pairIconHtml(c.par, 18)} ${esc(c.par)}</div>
              <div class="small text-body-secondary">Inicio: ${formatTimePeruCompact(c.inicioTs)} · Fin: ${formatTimePeruCompact(c.cierreTs)}</div>
              <div class="small text-body-secondary">(${esc(c.duracion)}) · ${c.numCompras} compras · ${fmtUsd(c.totalInvertido)} invertido</div>
            </div>
            <div class="fw-bold ${pnlClass(c.pnlTotal)}">${c.outcome === 'win' ? '✅' : '❌'} ${fmtUsd(c.pnlTotal)}</div>
          </div>
        </button>
      </h2>
      <div id="${domId}" class="accordion-collapse collapse">
        <div class="accordion-body">
          ${kv('Precio promedio', fmtUsdPrecise(c.precioPromedio, c.precioPromedio < 10 ? 4 : 2))}
          ${kv('Precio de salida', fmtUsdPrecise(c.precioSalida, c.precioSalida < 10 ? 4 : 2))}
          <div class="table-responsive mt-2">
            <table class="table table-sm mb-0">
              <thead><tr><th>Precio</th><th>Monto</th><th>PnL</th></tr></thead>
              <tbody>${comprasHtml}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}
let dcaKnownCycleKeys = null; // Set<string> de ciclos ya en la lista — null fuerza reconstruir
function renderDcaCyclesIncremental(ciclos) {
  const list = dcaKnownCycleKeys !== null ? $('dcaCyclesList') : null;
  if (!list) {
    // Primera carga de esta visita a la ruta: arma todas las tarjetas de una,
    // sin animación de "nuevo".
    dcaKnownCycleKeys = new Set(ciclos.map(cycleKey));
    $('dcaHistory').innerHTML = ciclos.length === 0
      ? '<div class="text-center text-body-secondary py-4">Sin ciclos cerrados todavía.</div>'
      : `<div class="accordion accordion-flush" id="dcaCyclesList">${ciclos.map((c) => cycleCardHtml(c)).join('')}</div>`;
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
    list.insertAdjacentHTML('afterbegin', cycleCardHtml(nuevos[i], 'cycle-new'));
  }
}
function historialSkeleton() {
  return `
    <h4 class="mb-1">📜 Historial de Ciclos — Bot 4</h4>
    <div class="small text-body-secondary mb-3">Cada tarjeta es un ciclo completo: todas las compras DCA de un par, cerradas juntas en la misma venta.</div>
    <div class="row row-cols-1 row-cols-md-3 g-2 mb-3">
      ${statBoxHtml('📜 Ciclos cerrados', 'hiTotalCiclos')}
      ${statBoxHtml('🎯 Win Rate', 'hiWinRate')}
      ${statBoxHtml('📈 PnL total', 'hiPnlTotal')}
    </div>
    <div class="card mb-3">
      <div class="card-body">
        <div class="card-title text-uppercase text-body-secondary small fw-bold mb-2">📊 Comparativa por cripto</div>
        <div id="hiComparativaPanel" class="text-center text-body-secondary py-3">Cargando…</div>
      </div>
    </div>
    <div id="hiErrorBanner"></div>
    <div id="dcaHistory"><div class="text-center text-body-secondary py-4">Cargando…</div></div>
  `;
}
// comparativaPorCriptoHtml: agrupa los ciclos cerrados por par — cuántos
// ciclos, win rate y PnL total de cada uno, ordenado de mejor a peor. Mismo
// dato que ya se ve en las tarjetas de Historial, pero uno al lado del otro
// en vez de tener que sumarlo a mano.
function comparativaPorCriptoHtml(cycles) {
  const byPair = {};
  (cycles || []).forEach((c) => {
    if (!byPair[c.par]) byPair[c.par] = { count: 0, wins: 0, pnl: 0 };
    byPair[c.par].count += 1;
    if (c.outcome === 'win') byPair[c.par].wins += 1;
    byPair[c.par].pnl += c.pnlTotal;
  });
  const rows = Object.entries(byPair).sort((a, b) => b[1].pnl - a[1].pnl);
  if (rows.length === 0) return '<div class="text-center text-body-secondary py-2">Sin ciclos cerrados todavía.</div>';
  return rows.map(([pair, s]) => kv(
    `${pairIconHtml(pair, 18)} ${esc(pair.split('/')[0])} · ${s.count} ciclos · ${Math.round((s.wins / s.count) * 100)}% WR`,
    fmtUsd(s.pnl),
    pnlClass(s.pnl),
  )).join('');
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
  $('hiPnlTotal').className = `fs-5 fw-bold ${pnlClass(pnlTotal)}`;
}
async function refreshHistorial() {
  try {
    const cycles = await fetchJson('/api/bot/4/cycles');
    renderHistorialSummary(cycles || []);
    $('hiComparativaPanel').innerHTML = comparativaPorCriptoHtml(cycles);
    renderDcaCyclesIncremental(cycles || []);
    $('hiErrorBanner').innerHTML = '';
  } catch (err) {
    $('hiErrorBanner').innerHTML = '<div class="alert alert-secondary">No se pudo cargar el historial.</div>';
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
    <h4 class="mb-1">📈 Métricas — Bot 4</h4>
    <div class="small text-body-secondary mb-3">Solo ganancias REALES de trades cerrados (no incluye capital agregado a mano)</div>

    <div class="card mb-3">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
          <div class="card-title mb-0">📅 Calendario de ganancias</div>
          <div class="d-flex align-items-center gap-2">
            <button class="btn btn-sm btn-outline-secondary" id="metCalPrev">‹</button>
            <span id="metCalLabel" class="fw-bold" style="min-width:130px; text-align:center; display:inline-block;">—</span>
            <button class="btn btn-sm btn-outline-secondary" id="metCalNext">›</button>
          </div>
        </div>
        <div class="metrics-calendar-weekdays">${MET_DIAS_SEMANA.map((d) => `<div class="mc-weekday">${d}</div>`).join('')}</div>
        <div class="metrics-calendar" id="metCalendarGrid"><div class="text-center text-body-secondary py-3">Cargando…</div></div>
      </div>
    </div>

    <div class="card mb-3" id="metDayDetailPanel" style="display:none;">
      <div class="card-body">
        <div class="card-title" id="metDayDetailTitle">Trades del día</div>
        <div id="metDayDetailBody"></div>
      </div>
    </div>

    <div class="card mb-3">
      <div class="card-body">
        <div class="card-title mb-2">📊 Ganancias netas por día (USD)</div>
        <div id="metBarChartContainer" style="height:220px;"></div>
        <div class="text-center text-body-secondary py-5" id="metBarChartPlaceholder" style="display:none;">Sin trades cerrados todavía.</div>
      </div>
    </div>

    <h6 class="text-uppercase text-body-secondary fw-bold mt-4 mb-2">Resumen del mes</h6>
    <div class="row row-cols-2 row-cols-md-3 g-2 mb-3" id="metSummaryRow"><div class="col"><div class="text-center text-body-secondary py-3">Cargando…</div></div></div>

    <h6 class="text-uppercase text-body-secondary fw-bold mt-4 mb-2">🏆 Top trades del mes</h6>
    <div class="row row-cols-1 row-cols-md-2 g-3">
      <div class="col"><div class="card h-100"><div class="card-body"><div class="card-title">Mejores 5</div><div id="metTopBest"><div class="small text-body-secondary">Cargando…</div></div></div></div></div>
      <div class="col"><div class="card h-100"><div class="card-body"><div class="card-title">Peores 5</div><div id="metTopWorst"><div class="small text-body-secondary">Cargando…</div></div></div></div></div>
    </div>
  `;
}

function renderMetCalendar() {
  $('metCalLabel').textContent = `${MET_MESES_LARGOS[metCalMonth]} ${metCalYear}`;
  // primerDiaSemana: 0=lunes...6=domingo (getUTCDay() da 0=domingo, se rota).
  const primerDiaSemana = (new Date(Date.UTC(metCalYear, metCalMonth, 1)).getUTCDay() + 6) % 7;
  const diasEnMes = new Date(Date.UTC(metCalYear, metCalMonth + 1, 0)).getUTCDate();

  // Mapa de calor (2026-09-16): intensidad de fondo proporcional al pnl del
  // día relativo al mayor |pnl| del mes — un día que ganó/perdió poco casi
  // no se nota, el mejor/peor día del mes se ve bien saturado. Mismo
  // concepto de calendario que antes, solo cambia cómo se lee de un vistazo.
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
      const rgb = row.pnl >= 0 ? 'var(--bs-success-rgb)' : 'var(--bs-danger-rgb)';
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
    ? '<div class="small text-body-secondary">Sin ciclos cerrados ese día.</div>'
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
  if (!m) { $('metSummaryRow').innerHTML = '<div class="col"><div class="small text-body-secondary">No se pudo cargar.</div></div>'; return; }
  $('metSummaryRow').innerHTML = [
    statBoxValueHtml('Días operando', m.diasOperando),
    statBoxValueHtml('Trades cerrados', m.tradesCerrados),
    statBoxValueHtml('Ganancia bruta', `<span class="${pnlClass(m.pnlBruto)}">${fmtUsd(m.pnlBruto)}</span>`),
    statBoxValueHtml('Fees pagados', `<span class="text-danger">-${fmtUsd(Math.abs(m.feesTotal))}</span>`),
    statBoxValueHtml('Ganancia NETA', `<span class="${pnlClass(m.pnlNeto)}">${fmtUsd(m.pnlNeto)} ${m.pnlNeto >= 0 ? '✅' : ''}</span>`),
    statBoxValueHtml('Mejor día', `<span class="text-success">${m.mejorDia ? m.mejorDia.fecha : '—'}</span><div class="small text-body-secondary">${m.mejorDia ? fmtUsd(m.mejorDia.pnl) : ''}</div>`),
    statBoxValueHtml('Peor día', `<span class="text-danger">${m.peorDia ? m.peorDia.fecha : '—'}</span><div class="small text-body-secondary">${m.peorDia ? fmtUsd(m.peorDia.pnl) : ''}</div>`),
    statBoxValueHtml('Win Rate del mes', `${m.winRate}%`),
    statBoxValueHtml('Profit Factor', m.profitFactor !== null ? m.profitFactor.toFixed(2) : '∞'),
  ].join('');
}

function renderMetTopTrades(top) {
  const renderList = (list) => (!list || list.length === 0
    ? '<div class="small text-body-secondary">Sin trades este mes.</div>'
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
    $('metSummaryRow').innerHTML = '<div class="col"><div class="small text-body-secondary">No se pudo cargar la información de métricas.</div></div>';
  }
}

// =========================================================================
// PÁGINA: SETTINGS
// =========================================================================
function settingsSkeleton() {
  return `
    <h4 class="mb-3">⚙️ Settings</h4>
    <div class="card mb-3">
      <div class="card-body">
        <div class="card-title">Estado del bot</div>
        <div id="setStatus"><div class="small text-body-secondary">Cargando…</div></div>
      </div>
    </div>
    <div class="card mb-3">
      <div class="card-body">
        <div class="card-title">🩺 Salud del sistema</div>
        <div id="setHealth"><div class="small text-body-secondary">Cargando…</div></div>
      </div>
    </div>
    <div class="card mb-3">
      <div class="card-body">
        <div class="mb-3">
          <label class="form-label small text-uppercase fw-bold text-body-secondary">API base (Cloudflare Tunnel)</label>
          <input type="text" class="form-control" id="apiBaseInput" value="${esc(API_BASE)}">
        </div>
        <button class="btn btn-primary" id="apiBaseSave">Guardar y recargar</button>
        <div class="form-text mt-2">También podés pasar <code>?api=https://tu-url</code> en la URL — se guarda solo para este navegador.</div>
      </div>
    </div>
    <div class="card mb-3">
      <div class="card-body">
        <div class="card-title">📝 Borradores Binance Square</div>
        <div class="small text-body-secondary mb-2">Generados solos cuando Bot 4 cierra un trade real ganador (+$0.50). No se publican solos — copiá el texto y publicalo vos desde tu cuenta.</div>
        <div id="squarePostsList"><div class="small text-body-secondary">Cargando…</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-body">
        <div class="card-title">Acerca de</div>
        ${kv('Dashboard', 'Nuvera Bot — Bot 4')}
        ${kv('Repositorio bot', '<a href="https://github.com/alexys1/nuvera-trading-bot" target="_blank" rel="noopener">nuvera-trading-bot</a>')}
        ${kv('Repositorio dashboard', '<a href="https://github.com/alexys1/nuvera-dashboard" target="_blank" rel="noopener">nuvera-dashboard</a>')}
      </div>
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
    $('setStatus').innerHTML =
      kv('Estado', data.estado === 'operando' ? '✅ Operando' : '⏸️ Pausado')
      + kv('Modo', data.modo === 'live' ? '🔴 LIVE' : '📄 PAPER')
      + kv('Capital total', fmtUsd(data.capitalTotal));
  } catch (err) {
    $('setStatus').innerHTML = '<div class="alert alert-secondary">No se pudo conectar a la API.</div>';
  }
  try {
    const health = await fetchJson('/api/health');
    const svc = (ok, label) => `<span class="badge rounded-pill ${ok ? 'text-bg-success' : 'text-bg-danger'} me-1 mb-1">${ok ? '✅' : '❌'} ${label}</span>`;
    $('setHealth').innerHTML = `
      <div class="mb-2">
        ${svc(health.binance && health.binance.ok, `Binance (${health.binance ? health.binance.ms : '—'}ms)`)}
        ${svc(health.postgresql && health.postgresql.ok, 'PostgreSQL')}
        ${svc(health.ollama && health.ollama.ok, 'Ollama')}
        ${svc(health.cloudflared && health.cloudflared.ok, 'Cloudflare Tunnel')}
      </div>
      ${kv('Errores (24h)', `${health.errores ? health.errores.total24h : 0}${health.errores && health.errores.noResueltos > 0 ? ` (${health.errores.noResueltos} sin resolver)` : ''}`, health.errores && health.errores.total24h > 0 ? 'text-warning' : 'text-success')}`;
  } catch (err) {
    $('setHealth').innerHTML = '<div class="alert alert-secondary">No se pudo consultar la salud del sistema.</div>';
  }
  try {
    const posts = await fetchJson('/api/square-posts?limit=10');
    $('squarePostsList').innerHTML = posts.length === 0
      ? '<div class="small text-body-secondary">Todavía no hay borradores.</div>'
      : posts.map((p) => `
        <div class="border-bottom border-secondary-subtle py-2">
          <div class="small">${esc(p.contenido)}</div>
          <div class="text-body-secondary" style="font-size:11px;">${new Date(p.createdAt).toLocaleString()} ${p.publicado ? '· ya marcado como publicado' : ''}</div>
        </div>`).join('');
  } catch (err) {
    $('squarePostsList').innerHTML = '<div class="small text-body-secondary">No se pudieron cargar los borradores.</div>';
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
  document.querySelectorAll('.nav-link[data-route]').forEach((btn) => btn.classList.toggle('active', btn.dataset.route === route));
  clearAllCharts();
  closeMobileSidebar();
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
