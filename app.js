// Dashboard vanilla JS — sin frameworks. Lee la API de solo lectura del bot
// (src/api/server.js) y refresca cada 30s. Todo el estado vive en el DOM,
// no hay build step: este archivo se sirve tal cual desde GitHub Pages.

// ---------- Config ----------
// Cambiá esto por la IP/dominio real del servidor (ver README.md). Se puede
// sobreescribir sin editar el archivo agregando ?api=http://IP:3001 a la URL,
// o guardando una vez en localStorage con localStorage.setItem('nuvera_api', '...').
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
const REFRESH_MS = 30000;
const TRADES_PAGE_SIZE = 20;

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const fmtUsd = (n) => (n === null || n === undefined ? '—' : `$${n.toFixed(2)}`);
const fmtPct = (n, digits = 1) => (n === null || n === undefined ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`);
const pnlClass = (n) => (n >= 0 ? 'pnl-pos' : 'pnl-neg');

async function fetchJson(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    cache: 'no-store',
    // Evita la página de advertencia HTML que ngrok inyecta en tunnels free
    // cuando detecta un user-agent de navegador (rompería el fetch de JSON).
    headers: { 'ngrok-skip-browser-warning': 'true' },
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

function setConnWarning(show) {
  $('conn-warning').style.display = show ? 'block' : 'none';
}

// ---------- Iconos de crypto ----------
// cryptoicons.org (pedido originalmente) está caído (404 en todos los
// símbolos al día de este cambio) — se usa en su lugar el set estático de
// spothq/cryptocurrency-icons servido por jsdelivr, que sí responde. Si un
// símbolo tampoco está ahí (p.ej. listados muy nuevos), cae a un círculo con
// las primeras letras en vez de un ícono roto.
const ICON_CDN = 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/32/color';
function symbolOf(pair) { return (pair || '').split('/')[0].toLowerCase(); }
function coinIconHtml(pair, size = 20) {
  const sym = symbolOf(pair);
  const shortLabel = sym.slice(0, 4).toUpperCase();
  return `<img src="${ICON_CDN}/${sym}.png" width="${size}" height="${size}" class="coin-icon" alt="${sym}" `
    + `onerror="this.onerror=null;this.outerHTML='<span class=&quot;coin-fallback&quot; style=&quot;width:${size}px;height:${size}px;&quot;>${shortLabel}</span>';">`;
}

function humanizeMs(ms) {
  if (ms === null || ms === undefined || ms < 0) return '—';
  const totalMin = Math.round(ms / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}min`;
  if (hours > 0) return `${hours}h ${mins}min`;
  return `${mins}min`;
}

function humanizeMin(min) {
  if (min === null || min === undefined) return '—';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

// ---------- "Última actualización: hace Xs" ----------
let lastUpdateAt = null;
function tickLastUpdate() {
  const el = $('last-update');
  if (!lastUpdateAt) { el.textContent = 'actualizando…'; return; }
  const secs = Math.round((Date.now() - lastUpdateAt) / 1000);
  if (secs < 3) el.textContent = 'actualizado justo ahora';
  else if (secs < 60) el.textContent = `hace ${secs} segundos`;
  else el.textContent = `hace ${Math.round(secs / 60)} min`;
}
setInterval(tickLastUpdate, 1000);

// ---------- Render: header + stat cards ----------
function renderStatus(s) {
  const paused = s.estado !== 'operando';
  const dot = $('status-dot');
  const badge = $('status-badge');
  dot.classList.toggle('paused', paused);
  dot.style.background = paused ? 'var(--critical)' : 'var(--accent)';
  dot.style.boxShadow = paused ? '0 0 8px var(--critical)' : '0 0 8px var(--accent)';
  badge.textContent = paused ? '⏸️ PAUSADO' : '✅ OPERANDO';
  badge.className = `badge ${paused ? 'paused' : 'ok'}`;

  const modeBadge = $('mode-badge');
  modeBadge.style.display = 'inline-flex';
  modeBadge.textContent = s.modo === 'live' ? '🔴 LIVE' : '📝 PAPER';
  modeBadge.className = `badge ${s.modo === 'live' ? 'mode-live' : 'mode-paper'}`;

  $('hdr-capital').textContent = fmtUsd(s.capital);
  const varHoyPct = s.capital ? (s.pnlHoy / s.capital) * 100 : 0;
  const varEl = $('hdr-var');
  varEl.textContent = `${fmtUsd(s.pnlHoy)} (${fmtPct(varHoyPct, 2)})`;
  varEl.className = `value mono ${pnlClass(s.pnlHoy)}`;

  $('hdr-fng').textContent = s.fearGreed !== null ? `${s.fearGreed} ${fngEmoji(s.fearGreed)} ${s.fearGreedLabel}` : 'N/A';

  // Cards principales
  $('stat-capital').textContent = fmtUsd(s.capital);
  $('stat-capital-sub').textContent = `${s.pnlHoy >= 0 ? '+' : ''}${fmtUsd(s.pnlHoy)} hoy`;
  $('stat-capital-sub').className = `sub mono ${pnlClass(s.pnlHoy)}`;

  const pnlEl = $('stat-pnl-hoy');
  pnlEl.textContent = fmtUsd(s.pnlHoy);
  pnlEl.className = `value mono ${pnlClass(s.pnlHoy)}`;

  $('stat-winrate').textContent = `${s.winrateHoy?.toFixed(0) ?? '0'}%`;
  const wrBar = $('stat-winrate-bar');
  wrBar.style.width = `${Math.min(Math.max(s.winrateHoy ?? 0, 0), 100)}%`;
  wrBar.style.background = (s.winrateHoy ?? 0) >= 50 ? 'var(--accent)' : (s.winrateHoy ?? 0) >= 30 ? 'var(--warning)' : 'var(--critical)';

  const fondoPct = s.fondoServidorMeta > 0 ? (s.fondoServidor / s.fondoServidorMeta) * 100 : 0;
  $('stat-fondo').textContent = `${fmtUsd(s.fondoServidor)}/${fmtUsd(s.fondoServidorMeta)}`;

  $('stat-trades-hoy').textContent = s.tradesHoy;
  $('stat-trades-hoy-sub').textContent = `${s.posicionesAbiertas ?? 0} abierto${(s.posicionesAbiertas ?? 0) === 1 ? '' : 's'}`;

  // Progress bar fondo servidor (sección 10) + confetti si llegó a la meta
  $('fondo-progress').style.width = `${Math.min(fondoPct, 100).toFixed(1)}%`;
  $('fondo-detalle').textContent = `${fmtUsd(s.fondoServidor)} / ${fmtUsd(s.fondoServidorMeta)} (${fondoPct.toFixed(1)}%)`;
  $('fondo-eta').textContent = s.fondoServidorEtaDias !== null && s.fondoServidorEtaDias !== undefined
    ? `Estimado: ~${s.fondoServidorEtaDias} días para completar`
    : 'Estimado: calculando (sin datos de la última semana)';
  maybeFireConfetti(fondoPct);

  // Fear & Greed — medidor (sección 9)
  renderFngGauge(s.fearGreed, s.fearGreedLabel);

  return s; // se reusa el capitalInicial para el gráfico
}

function fngEmoji(value) {
  if (value === null || value === undefined) return '';
  if (value < 20) return '🔴';
  if (value < 35) return '🟠';
  if (value <= 65) return '🟡';
  if (value <= 80) return '🟢';
  return '🟢';
}

// ---------- Render: medidor Fear & Greed (velocímetro) ----------
function renderFngGauge(value, label) {
  $('fng-value').textContent = value !== null && value !== undefined ? value : '—';
  $('fng-label').textContent = value !== null && value !== undefined ? label : 'sin dato';
  const pct = value !== null && value !== undefined ? Math.min(Math.max(value, 0), 100) : 50;
  // El arco va de -90deg (izquierda, miedo extremo) a +90deg (derecha, codicia extrema).
  const angle = -90 + (pct / 100) * 180;
  $('fng-needle').setAttribute('transform', `rotate(${angle} 110 110)`);
}

// ---------- Confetti al llegar al 100% del fondo servidor ----------
let confettiFired = false;
function maybeFireConfetti(fondoPct) {
  if (fondoPct >= 100 && !confettiFired && typeof confetti === 'function') {
    confettiFired = true;
    confetti({ particleCount: 160, spread: 90, origin: { y: 0.6 }, colors: ['#00ff88', '#58a6ff', '#f0a020'] });
  }
  if (fondoPct < 100) confettiFired = false;
}

// ---------- Render: pares activos (cards visuales, sección 4) ----------
function renderActivePairs(pairs) {
  const grid = $('active-pair-grid');
  grid.innerHTML = '';
  $('active-pairs-empty').style.display = pairs.length === 0 ? 'block' : 'none';

  for (const p of pairs) {
    const totalHoy = (p.winsHoy ?? 0) + (p.lossesHoy ?? 0);
    const starsFilled = Math.round(Math.min(Math.max(p.salud ?? 0, 0), 150) / 30); // 0-150 -> 0-5 estrellas
    const stars = '★'.repeat(starsFilled) + '☆'.repeat(5 - starsFilled);
    const levelBars = Array.from({ length: p.nivelesMax ?? 3 }, (_, i) =>
      `<span class="lvl${i < (p.nivelesOcupados ?? 0) ? ' filled' : ''}"></span>`).join('');

    const card = document.createElement('div');
    card.className = 'active-pair-card';
    card.innerHTML = `
      <div class="head">
        <span class="pair-name">${coinIconHtml(p.par, 22)} ${p.par}</span>
        <span class="fng-tag">${p.fngModo ?? '—'}</span>
      </div>
      <div class="price-row">
        <span class="price mono">${p.precio !== null ? '$' + p.precio.toLocaleString('en-US', { maximumFractionDigits: 8 }) : '—'}</span>
        <span class="change mono ${pnlClass(p.cambio1h ?? 0)}">${p.cambio1h !== null ? (p.cambio1h >= 0 ? '▲' : '▼') + ' ' + fmtPct(p.cambio1h, 2) + ' 1h' : '—'}</span>
      </div>
      <div class="row"><span>Grid</span><span class="grid-levels">${levelBars}</span><span class="mono">${p.nivelesOcupados ?? 0}/${p.nivelesMax ?? 3}</span></div>
      <div class="row"><span>Salud</span><span class="mono">${p.salud ?? 0}/150</span><span class="stars">${stars}</span></div>
      <div class="row"><span>WR hoy</span><span class="mono">${p.winsHoy ?? 0}W ${p.lossesHoy ?? 0}L (${totalHoy > 0 ? p.winrateHoy + '%' : '—'})</span></div>
      <div class="row"><span>ATR: ${p.atr ?? '—'}</span><span>Modo: ${p.fngModo ?? '—'}</span></div>
    `;
    grid.appendChild(card);
  }
}

// ---------- Render: posiciones abiertas ----------
function renderPositions(positions) {
  const tbody = document.querySelector('#tbl-positions tbody');
  tbody.innerHTML = '';
  $('positions-empty').style.display = positions.length === 0 ? 'block' : 'none';
  document.getElementById('tbl-positions').style.display = positions.length === 0 ? 'none' : 'table';

  for (const p of positions) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="pair-cell mono">${coinIconHtml(p.par)} ${p.par}</td>
      <td class="mono">${p.nivel ?? '—'}</td>
      <td class="mono">${p.precioEntrada ?? '—'}</td>
      <td class="mono">${p.precioActual ?? '—'}</td>
      <td class="mono ${pnlClass(p.pnlActual ?? 0)}">${p.pnlActual !== null ? fmtUsd(p.pnlActual) : '—'}</td>
      <td class="mono ${pnlClass(p.pnlPct ?? 0)}">${p.pnlPct !== null ? fmtPct(p.pnlPct, 2) : '—'}</td>
      <td class="mono">${p.tiempoAbierto ?? '—'}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ---------- Render: tabla de trades (búsqueda + filtro + paginación + CSV) ----------
let allTrades = [];
let tradesRangeFilter = 'all';
let tradesSearchTerm = '';
let tradesPage = 1;

function tradesMatchingFilters() {
  const now = Date.now();
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  const weekStart = now - 7 * 24 * 60 * 60 * 1000;

  return allTrades.filter((t) => {
    if (tradesSearchTerm && !t.par.toLowerCase().includes(tradesSearchTerm)) return false;
    if (tradesRangeFilter === 'today' && new Date(t.fechaIso).getTime() < todayStart.getTime()) return false;
    if (tradesRangeFilter === 'week' && new Date(t.fechaIso).getTime() < weekStart) return false;
    return true;
  });
}

function renderTradesTable() {
  const filtered = tradesMatchingFilters();
  const totalPages = Math.max(1, Math.ceil(filtered.length / TRADES_PAGE_SIZE));
  tradesPage = Math.min(tradesPage, totalPages);
  const pageItems = filtered.slice((tradesPage - 1) * TRADES_PAGE_SIZE, tradesPage * TRADES_PAGE_SIZE);

  const tbody = document.querySelector('#tbl-trades tbody');
  tbody.innerHTML = '';
  $('trades-empty').style.display = filtered.length === 0 ? 'block' : 'none';
  document.getElementById('tbl-trades').style.display = filtered.length === 0 ? 'none' : 'table';

  for (const t of pageItems) {
    const tr = document.createElement('tr');
    const isWin = t.outcome === 'win';
    tr.innerHTML = `
      <td class="pair-cell mono">${coinIconHtml(t.par)} ${t.par}</td>
      <td class="mono">${t.tipo ?? '—'}</td>
      <td class="mono">${t.entrada ?? '—'}</td>
      <td class="mono">${t.salida ?? '—'}</td>
      <td class="mono ${pnlClass(t.pnl)}">${fmtUsd(t.pnl)} <span class="outcome-tag ${isWin ? 'win' : 'loss'}">${isWin ? 'WIN' : 'LOSS'}</span></td>
      <td class="mono">${t.duracion ?? '—'}</td>
      <td class="mono">${t.fecha ?? '—'}</td>
    `;
    tbody.appendChild(tr);
  }

  const pag = $('trades-pagination');
  pag.innerHTML = '';
  if (filtered.length > TRADES_PAGE_SIZE) {
    const prev = document.createElement('button');
    prev.className = 'btn-icon'; prev.textContent = '‹ Anterior'; prev.disabled = tradesPage <= 1;
    prev.onclick = () => { tradesPage--; renderTradesTable(); };
    const next = document.createElement('button');
    next.className = 'btn-icon'; next.textContent = 'Siguiente ›'; next.disabled = tradesPage >= totalPages;
    next.onclick = () => { tradesPage++; renderTradesTable(); };
    const info = document.createElement('span');
    info.textContent = `Página ${tradesPage} de ${totalPages} (${filtered.length} trades)`;
    pag.append(prev, info, next);
  }
}

function exportTradesCsv() {
  const filtered = tradesMatchingFilters();
  const header = ['Par', 'Tipo', 'Entrada', 'Salida', 'PnL', 'Resultado', 'Duración', 'Hora (UTC)'];
  const rows = filtered.map((t) => [t.par, t.tipo, t.entrada, t.salida, t.pnl, t.outcome, t.duracion, t.fecha]);
  const csv = [header, ...rows].map((row) => row.map((v) => `"${(v ?? '').toString().replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nuvera-trades-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------- Render: estadísticas por par (histórico, sección 7) ----------
function renderPairsHistory(rows) {
  const tbody = document.querySelector('#tbl-pairs-history tbody');
  tbody.innerHTML = '';
  $('pairs-history-empty').style.display = rows.length === 0 ? 'block' : 'none';
  document.getElementById('tbl-pairs-history').style.display = rows.length === 0 ? 'none' : 'table';

  for (const r of rows) {
    const tr = document.createElement('tr');
    const estadoHtml = r.estado === 'blacklist'
      ? `<span class="status-tag blacklist">⛔ Blacklist ${humanizeMin(r.blacklistRestanteMin)}</span>`
      : `<span class="status-tag active">✅ Activo</span>`;
    tr.innerHTML = `
      <td class="pair-cell mono">${coinIconHtml(r.par)} ${r.par}</td>
      <td class="mono">${r.trades}</td>
      <td class="mono">${r.winrate}%</td>
      <td class="mono ${pnlClass(r.pnl)}">${fmtUsd(r.pnl)}</td>
      <td class="mono">${r.mejorHora !== null ? String(r.mejorHora).padStart(2, '0') + 'h UTC' : '—'}</td>
      <td>${estadoHtml}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderBlacklistSummary(list) {
  $('blacklist-summary').textContent = list.length > 0
    ? `⛔ ${list.length} par${list.length === 1 ? '' : 'es'} en blacklist temporal`
    : '';
}

// ---------- Render: IA (sección 8) ----------
function renderAiDecisions(data) {
  const decisions = data.decisiones || [];
  $('ai-empty').style.display = decisions.length === 0 ? 'block' : 'none';
  $('ai-card').style.display = decisions.length === 0 ? 'none' : 'flex';
  if (decisions.length === 0) return;

  const d = decisions[0];
  $('ai-meta').textContent = `hace ${d.haceMin} min${d.par ? ` · ${d.par}` : ''}`;
  // `razon` (texto libre, sin límite) explica mejor la decisión que
  // `decision` (categoría corta, truncada a 20 chars en la base de datos).
  $('ai-text').textContent = d.razon || d.decision || 'Sin detalle disponible.';
  $('ai-confidence-label').textContent = `Confianza: ${d.confianza !== null ? d.confianza + '%' : '—'}`;
  $('ai-confidence-fill').style.width = `${d.confianza ?? 0}%`;
  $('ai-hits').textContent = `Acertó: ${data.aciertosRecientes ?? '—'}`;
}

// ---------- Render: patrones (nota compacta, endpoint /api/patterns) ----------
function renderPatternsNote(data) {
  const existing = document.getElementById('patterns-note');
  const text = `🧩 ${data.total} patrones detectados en total (hora/par/F&G/ATR — ver reporte semanal por Telegram)`;
  if (existing) { existing.textContent = text; return; }
  const note = document.createElement('div');
  note.id = 'patterns-note';
  note.style.cssText = 'font-size:12px;color:var(--text-muted);margin-top:12px;';
  note.textContent = text;
  const aiSection = document.getElementById('ai-card').closest('section');
  aiSection.appendChild(note);
}

// ---------- Render: footer (sección 12, GET /api/system) ----------
function renderSystemFooter(sys) {
  const footer = $('system-footer');
  footer.innerHTML = `
    <span>Servidor: <strong>${sys.os ?? '—'}</strong></span>
    <span>RAM: <strong>${sys.ramUsadoPct ?? '—'}%</strong> usado (${sys.ramTotalGb ?? '—'} GB total)</span>
    <span>Bot uptime: <strong>${humanizeMs(sys.botUptimeMs)}</strong></span>
    <span>DB: <strong>${sys.dbTradesGuardados ?? '—'}</strong> trades guardados</span>
    <span>Próximo rebalanceo: <strong>${sys.proximoRebalanceMin !== null ? 'en ' + humanizeMin(sys.proximoRebalanceMin) : '—'}</strong></span>
    <span>Próxima decisión IA: <strong>en ${humanizeMin(sys.proximaDecisionIaMin)}</strong></span>
  `;
}

// ---------- Chart: capital histórico (área, color vs capital inicial, zoom) ----------
let capitalChart = null;
let capitalInicialRef = null;
let currentChartDays = 30;

function renderCapitalChart(history) {
  const ctx = document.getElementById('capital-chart');
  const labels = history.map((h) => h.fecha.slice(5)); // MM-DD
  const values = history.map((h) => h.capital);
  const lastValue = values.length > 0 ? values[values.length - 1] : null;
  const trendUp = capitalInicialRef !== null && lastValue !== null ? lastValue >= capitalInicialRef : true;
  const lineColor = trendUp ? '#00ff88' : '#f85149';

  const cssRoot = getComputedStyle(document.documentElement);
  const gridColor = cssRoot.getPropertyValue('--grid-line').trim() || 'rgba(255,255,255,0.06)';
  const textMuted = cssRoot.getPropertyValue('--text-muted').trim() || '#6e7681';

  const data = {
    labels,
    datasets: [{
      label: 'Capital',
      data: values,
      borderColor: lineColor,
      backgroundColor: trendUp ? 'rgba(0,255,136,0.12)' : 'rgba(248,81,73,0.12)',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: lineColor,
      pointHitRadius: 12,
      tension: 0.25,
      fill: true,
    }],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1c2330',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        titleColor: '#e6edf3',
        bodyColor: '#e6edf3',
        padding: 10,
        callbacks: {
          title: (items) => history[items[0].dataIndex]?.fecha ?? '',
          label: (item) => `Capital: $${item.parsed.y.toFixed(2)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: gridColor, drawTicks: false },
        ticks: { color: textMuted, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
        border: { color: gridColor },
      },
      y: {
        grid: { color: gridColor, drawTicks: false },
        ticks: { color: textMuted, callback: (v) => `$${v}` },
        border: { display: false },
      },
    },
  };

  if (capitalChart) {
    capitalChart.data = data;
    capitalChart.options = options;
    capitalChart.update();
  } else {
    capitalChart = new Chart(ctx, { type: 'line', data, options });
  }
}

async function loadCapitalChart(days) {
  currentChartDays = days;
  try {
    const history = await fetchJson(`/api/capital-history?days=${days}`);
    renderCapitalChart(history);
  } catch (err) {
    console.error('[nuvera-dashboard] Error cargando historial de capital:', err.message);
  }
}

// Refresca el gráfico con el zoom vigente (currentChartDays) — se llama en
// cada ciclo de refreshAll, no solo al tocar los botones 7d/30d/Todo.
async function refreshCapitalChart() {
  try {
    const history = await fetchJson(`/api/capital-history?days=${currentChartDays}`);
    renderCapitalChart(history);
  } catch (err) {
    console.error('[nuvera-dashboard] Error refrescando historial de capital:', err.message);
  }
}

// ---------- Alertas en vivo (sección 11) ----------
let lastSeenTradeIso = null;
let firstTradesLoad = true;

function showToast(trade) {
  const stack = $('toast-stack');
  const isWin = trade.outcome === 'win';
  const el = document.createElement('div');
  el.className = `toast ${isWin ? 'win' : 'loss'}`;
  el.textContent = `${isWin ? '✅' : '❌'} ${trade.par} cerrado ${trade.pnl >= 0 ? '+' : ''}${fmtUsd(trade.pnl)}`;
  stack.appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 350);
  }, 6000);
}

function checkForNewTrades(trades) {
  if (trades.length === 0) return;
  const newest = trades[0];
  if (firstTradesLoad) {
    lastSeenTradeIso = newest.fechaIso;
    firstTradesLoad = false;
    return;
  }
  const newOnes = trades.filter((t) => new Date(t.fechaIso).getTime() > new Date(lastSeenTradeIso).getTime());
  for (const t of newOnes.reverse()) showToast(t); // más viejo primero, así el más nuevo queda arriba
  if (newOnes.length > 0) lastSeenTradeIso = newest.fechaIso;
}

// ---------- Main loop ----------
async function refreshAll() {
  try {
    const [status, positions, trades, pairs, pairsHistory, blacklist, aiDecisions, system, patterns] = await Promise.all([
      fetchJson('/api/status'),
      fetchJson('/api/positions'),
      fetchJson('/api/trades?limit=200'),
      fetchJson('/api/pairs'),
      fetchJson('/api/pairs-history'),
      fetchJson('/api/blacklist'),
      fetchJson('/api/ai-decisions?limit=5'),
      fetchJson('/api/system'),
      fetchJson('/api/patterns?limit=1'),
    ]);

    setConnWarning(false);
    renderStatus(status);
    capitalInicialRef = status.capitalInicial;
    renderPositions(positions);
    renderActivePairs(pairs);
    renderPairsHistory(pairsHistory);
    renderBlacklistSummary(blacklist);
    renderAiDecisions(aiDecisions);
    renderSystemFooter(system);
    renderPatternsNote(patterns);

    checkForNewTrades(trades);
    allTrades = trades;
    renderTradesTable();

    await refreshCapitalChart();

    lastUpdateAt = Date.now();
    tickLastUpdate();
  } catch (err) {
    console.error('[nuvera-dashboard] Error actualizando datos:', err.message);
    setConnWarning(true);
  }
}

// ---------- Listeners de controles ----------
document.getElementById('chart-zoom-controls').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-days]');
  if (!btn) return;
  document.querySelectorAll('#chart-zoom-controls .btn-tab').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  loadCapitalChart(parseInt(btn.dataset.days, 10));
});

document.querySelectorAll('button[data-range]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('button[data-range]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    tradesRangeFilter = btn.dataset.range;
    tradesPage = 1;
    renderTradesTable();
  });
});

$('trades-search').addEventListener('input', (e) => {
  tradesSearchTerm = e.target.value.trim().toLowerCase();
  tradesPage = 1;
  renderTradesTable();
});

$('btn-export-csv').addEventListener('click', exportTradesCsv);

refreshAll();
setInterval(refreshAll, REFRESH_MS);
