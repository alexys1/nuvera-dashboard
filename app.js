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
// Bajado de 30s a 5s el 2026-08-11 (pedido explícito: "trades en vivo,
// polling cada 5 segundos").
const REFRESH_MS = 5000;
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

// ---------- Render: distribución del capital (sección "Mi Capital") ----------
function renderCapitalBreakdown(cb, fondoServidorMeta) {
  $('cb-total').textContent = fmtUsd(cb.total);

  const libreWidth = cb.total > 0 ? Math.min(Math.max((cb.libre / cb.total) * 100, 0), 100) : 0;
  const invertidoWidth = cb.total > 0 ? Math.min(Math.max((cb.invertido / cb.total) * 100, 0), 100) : 0;
  const fondoWidth = fondoServidorMeta > 0 ? Math.min(Math.max((cb.fondoServidor / fondoServidorMeta) * 100, 0), 100) : 0;

  $('cb-bar-libre').style.width = `${libreWidth}%`;
  $('cb-libre').textContent = fmtUsd(cb.libre);
  $('cb-bar-invertido').style.width = `${invertidoWidth}%`;
  $('cb-invertido').textContent = fmtUsd(cb.invertido);
  $('cb-bar-fondo').style.width = `${fondoWidth}%`;
  $('cb-fondo').textContent = fmtUsd(cb.fondoServidor);

  const grid = $('cb-slots');
  grid.innerHTML = '';
  for (const s of cb.slots) {
    const label = s.par ? s.par.split('/')[0] : (s.slotKey === 'OPORTUNISTA' ? 'Oportunista' : s.slotKey);
    const card = document.createElement('div');
    card.className = `cb-slot-card ${s.estado}`;
    const detail = s.estado === 'invertido'
      ? `<strong>${fmtUsd(s.invertido)}</strong> · nivel ${s.niveles.join(',')}`
      : 'libre';
    card.innerHTML = `
      <span class="cb-slot-pair">${s.par ? coinIconHtml(s.par, 18) : '⚡'} ${label}</span>
      <span class="cb-slot-detail">${detail}</span>
    `;
    grid.appendChild(card);
  }
}

// ---------- Render: racha + modo (2026-08-11, pedido explícito) ----------
const MODO_LABELS = { NORMAL: 'NORMAL', RECOVERY: 'RECUPERACIÓN', AGGRESSIVE: 'AGRESIVO' };
function renderRacha(d) {
  $('racha-strip').innerHTML = (d.ultimos5 || [])
    .map((o) => `<span class="racha-dot ${o === 'win' ? 'win' : 'loss'}">${o === 'win' ? '✅' : '❌'}</span>`)
    .join('');
  const tipoTxt = d.tipo === 'wins' ? 'ganancias' : d.tipo === 'losses' ? 'pérdidas' : '—';
  $('racha-texto').textContent = `Racha: ${d.rachaActual} ${tipoTxt} seguidas`;
  $('racha-record').textContent = `Récord de wins seguidos: ${d.recordWins}`;
  $('racha-ultima-perdida').textContent = d.ultimaPerdida ? `Última pérdida: ${d.ultimaPerdida}` : 'Sin pérdidas registradas';

  const modo = d.modo || { nombre: 'NORMAL' };
  const tag = $('modo-tag');
  tag.textContent = MODO_LABELS[modo.nombre] || modo.nombre;
  tag.className = `modo-tag modo-${modo.nombre}`;
  $('modo-razon').textContent = modo.razon
    ? `${modo.razon}${modo.tradesRestantes ? ` · ${modo.tradesRestantes} trades restantes` : ''}${modo.parSugerido ? ` · par sugerido: ${modo.parSugerido}` : ''}`
    : '';
}

// ---------- Render: market mood (2026-08-11, pedido explícito) ----------
function renderMood(d) {
  const badge = $('mood-badge');
  if (d.mood === 'favorable') {
    badge.textContent = '🟢 FAVORABLE';
    badge.className = 'mood-badge favorable';
  } else if (d.mood === 'esperar') {
    badge.textContent = '🟡 ESPERAR';
    badge.className = 'mood-badge esperar';
  } else {
    badge.textContent = '⚪ NEUTRAL';
    badge.className = 'mood-badge neutral';
  }
  $('mood-razon').textContent = d.razon || d.senalClara || 'Sin análisis todavía.';
  $('mood-pares').innerHTML = (d.paresMomentum || []).map((p) => `<span class="chip">${p}</span>`).join('');
  $('mood-meta').textContent = d.actualizado
    ? `Actualizado hace ${d.actualizadoHaceMin} min · próximo análisis en ${d.proximoAnalisisEnMin} min`
    : 'Esperando el primer análisis (cron cada 30 min).';
}

// ---------- Render: 4 estrategias en tiempo real (2026-08-11, pedido explícito) ----------
const STRATEGY_LABELS = { ultraScalping: '⚡ Ultra Scalping', gridScalping: '🔄 Grid Scalping', momentumHunter: '🚀 Momentum Hunter', panicHunter: '😱 Pánico Hunter' };
function renderStrategies(list) {
  $('strategy-list').innerHTML = (list || []).map((s) => {
    const dots = Array.from({ length: s.slotsTotal }, (_, i) => `<span class="slot-dot ${i < s.slotsOcupados ? 'filled' : ''}"></span>`).join('');
    return `<div class="strategy-row">
      <span class="strategy-name">${STRATEGY_LABELS[s.nombre] || s.nombre}</span>
      <span class="slot-dots">${dots}</span>
      <span class="strategy-slots">${s.slotsOcupados}/${s.slotsTotal} · $${s.capitalPorSlot}/slot</span>
    </div>`;
  }).join('');
}

// ---------- Render: capital activo (2026-08-11, pedido explícito) ----------
function renderCapitalActivo(d) {
  renderStrategies(d.estrategias);
}

// ---------- Render: confianza por par (2026-08-11, pedido explícito) ----------
function confColor(v) {
  if (v > 70) return 'var(--accent)';
  if (v >= 50) return 'var(--accent-2)';
  if (v >= 30) return 'var(--warning)';
  return 'var(--critical)';
}
function renderConfidence(rows) {
  const box = $('confidence-list');
  if (!rows || rows.length === 0) { box.innerHTML = '<div class="empty-msg">Todavía sin datos.</div>'; return; }
  box.innerHTML = rows.slice(0, 12).map((r) => `
    <div class="conf-row">
      <span class="conf-pair mono">${r.par.replace('/USDT', '')}</span>
      <span class="conf-bar-bg"><span class="conf-bar-fill" style="width:${r.confianza}%; background:${confColor(r.confianza)}"></span></span>
      <span class="conf-val mono">${r.confianza}/100 ×${r.multiplicadorCapital}</span>
    </div>
  `).join('');
}

// ---------- Render: modelo ML propio (XGBoost, pedido explícito 2026-08-15) ----------
function renderMlModel(data) {
  const empty = !data || !data.disponible;
  $('ml-model-content').style.display = empty ? 'none' : 'block';
  $('ml-model-empty').style.display = empty ? 'block' : 'none';
  if (empty) return;

  $('ml-accuracy').textContent = `${data.accuracy.toFixed(1)}%`;
  $('ml-accuracy').className = `rt-stat-value mono ${data.accuracy > 52 ? 'pnl-pos' : 'pnl-neg'}`;
  $('ml-trades').textContent = data.totalTrades;
  $('ml-trained-at').textContent = data.entrenadoEl || '—';

  const feats = data.featuresPrincipales || [];
  const maxImportancia = Math.max(...feats.map((f) => f.importancia), 0.001);
  $('ml-features-list').innerHTML = feats.length > 0
    ? feats.map((f) => `
      <div class="conf-row">
        <span class="conf-pair mono">${f.nombre}</span>
        <span class="conf-bar-bg"><span class="conf-bar-fill" style="width:${(f.importancia / maxImportancia) * 100}%; background:var(--accent-2)"></span></span>
        <span class="conf-val mono">${(f.importancia * 100).toFixed(1)}%</span>
      </div>
    `).join('')
    : '<div class="empty-msg">Sin datos de importancia.</div>';
}

// ---------- Render: aprendizajes de Ollama (2026-08-11, pedido explícito) ----------
function renderLearnings(rows) {
  const box = $('learnings-list');
  if (!rows || rows.length === 0) { box.innerHTML = '<div class="empty-msg">Todavía sin aprendizajes.</div>'; return; }
  box.innerHTML = rows.map((l) => `
    <div class="learning">
      <div class="learning-head"><span>${l.par} · ${l.outcome === 'win' ? '✅ WIN' : '❌ LOSS'}</span><span>${l.fecha}</span></div>
      <div class="learning-text">📚 ${l.aprendizaje}</div>
    </div>
  `).join('');
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

// ---------- Render: rendimiento por par y hora (todas las estrategias, CAMBIO 6) ----------
function performanceStatusTag(estado) {
  if (estado === 'blacklist') return `<span class="status-tag blacklist">⛔ Blacklist 48h</span>`;
  if (estado === 'bajo_wr') return `<span class="status-tag warn">⚠️ WR bajo</span>`;
  return `<span class="status-tag active">✅ Activo</span>`;
}

function renderPerformanceByPair(rows) {
  const tbody = document.querySelector('#tbl-performance-pair tbody');
  tbody.innerHTML = '';
  $('performance-pair-empty').style.display = rows.length === 0 ? 'block' : 'none';
  document.getElementById('tbl-performance-pair').style.display = rows.length === 0 ? 'none' : 'table';

  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="pair-cell mono">${coinIconHtml(r.par)} ${r.par}</td>
      <td class="mono">${r.trades}</td>
      <td class="mono">${r.winrate}%</td>
      <td class="mono ${pnlClass(r.pnl)}">${fmtUsd(r.pnl)}</td>
      <td>${performanceStatusTag(r.estado)}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderPerformanceByHour(rows) {
  const wrap = $('performance-hour-bars');
  wrap.innerHTML = '';
  const sorted = [...rows].sort((a, b) => a.horaUtc - b.horaUtc);

  for (const r of sorted) {
    const row = document.createElement('div');
    row.className = 'perf-hour-row';
    const good = r.winrate >= 50;
    const evitadaTag = r.estado === 'evitada' ? ' ⛔' : (r.estado === 'bajo_wr' ? ' ⚠️' : '');
    row.innerHTML = `
      <span class="hour-label">${String(r.horaUtc).padStart(2, '0')}h UTC</span>
      <div class="perf-hour-track"><div class="perf-hour-fill ${good ? 'good' : 'bad'}" style="width:${Math.max(2, r.winrate)}%;"></div></div>
      <span class="mono">${r.winrate}% (${r.trades})</span>
      <span class="mono ${pnlClass(r.pnl)}">${fmtUsd(r.pnl)}${evitadaTag}</span>
    `;
    wrap.appendChild(row);
  }
}

// ---------- Render: Diario del bot (estilo Binance Square) ----------
function showSimpleToast(text) {
  const stack = $('toast-stack');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  stack.appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 350);
  }, 3000);
}

function diaryStatRow(label, value) {
  return `<div class="ds-row"><span class="ds-label">${label}</span><span class="ds-value">${value}</span></div>`;
}

let diaryChart = null;
let diaryChartSeries = null;
let diaryChartRenderedFor = null; // "fecha|par" ya dibujado, evita re-fetch/redraw cada 5s

async function drawDiaryChart(pair, entryPrice, entryTimeIso, fecha) {
  const key = `${fecha}|${pair}`;
  if (diaryChartRenderedFor === key) return;
  const container = $('diary-chart');
  if (!pair || typeof LightweightCharts === 'undefined') { container.innerHTML = ''; return; }

  $('diary-chart-label').textContent = `${pair} · 24h`;

  try {
    const symbol = pair.replace('/', '');
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=24`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const klines = await res.json();
    const candles = klines.map((k) => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4] }));

    container.innerHTML = '';
    diaryChart = LightweightCharts.createChart(container, {
      width: container.clientWidth,
      height: 220,
      layout: { background: { color: 'transparent' }, textColor: '#8b949e', fontSize: 11 },
      grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      timeScale: { timeVisible: true, borderColor: 'rgba(255,255,255,0.08)' },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
      crosshair: { mode: 0 },
    });
    diaryChartSeries = diaryChart.addCandlestickSeries({
      upColor: '#00ff88', downColor: '#f85149', borderVisible: false,
      wickUpColor: '#00ff88', wickDownColor: '#f85149',
    });
    diaryChartSeries.setData(candles);

    if (entryPrice && entryTimeIso) {
      const entryTimeSec = Math.floor(new Date(entryTimeIso).getTime() / 1000);
      diaryChartSeries.setMarkers([{
        time: entryTimeSec, position: 'belowBar', color: '#00ff88', shape: 'arrowUp', text: `Entrada $${entryPrice}`,
      }]);
    }

    diaryChart.timeScale().fitContent();
    diaryChartRenderedFor = key;

    window.addEventListener('resize', () => {
      if (diaryChart) diaryChart.applyOptions({ width: container.clientWidth });
    });
  } catch (err) {
    console.error('[nuvera-dashboard] Error dibujando gráfica del diario:', err.message);
    container.innerHTML = '<div class="empty-msg">No se pudo cargar la gráfica.</div>';
  }
}

const DIARY_LIKED_KEY = 'nuvera_diary_liked_date';

function renderDiaryToday(data) {
  if (!data.disponible) {
    $('diary-today-card').style.display = 'none';
    $('diary-empty').style.display = 'block';
    return;
  }
  $('diary-empty').style.display = 'none';
  $('diary-today-card').style.display = 'block';

  const fechaObj = new Date(`${data.fecha}T00:00:00Z`);
  const fechaFmt = fechaObj.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  $('diary-date').textContent = `${fechaFmt} | 12:00 UTC`;
  $('diary-analisis').textContent = data.analisis || '—';
  $('diary-senales').textContent = data.senalesManana || '—';

  const s = data.stats || {};
  const best = data.mejorTrade;
  $('diary-stats').innerHTML = [
    diaryStatRow('Trades', s.total ?? '—'),
    diaryStatRow('Winrate', s.winrate !== undefined ? `${s.winrate}%` : '—'),
    diaryStatRow('PnL', s.pnlTotal !== undefined ? fmtUsd(s.pnlTotal) : '—'),
    diaryStatRow('Capital', s.capitalHoy !== undefined ? fmtUsd(s.capitalHoy) : '—'),
    best ? diaryStatRow('Mejor trade', `${best.pair.split('/')[0]} ${fmtUsd(best.pnl)}`) : '',
    s.worstTrade ? diaryStatRow('Peor trade', `${s.worstTrade.pair.split('/')[0]} ${fmtUsd(s.worstTrade.pnl)}`) : '',
  ].join('');

  const likes = data.likes || 0;
  $('diary-likes').textContent = likes;
  const alreadyLiked = localStorage.getItem(DIARY_LIKED_KEY) === data.fecha;
  $('diary-like-btn').classList.toggle('liked', alreadyLiked);

  drawDiaryChart(data.parGrafica, best ? best.entryPrice : null, best ? best.entryTime : null, data.fecha);

  $('diary-like-btn').onclick = async () => {
    if (localStorage.getItem(DIARY_LIKED_KEY) === data.fecha) return;
    try {
      const res = await fetch(`${API_BASE}/api/diary/like`, { method: 'POST' });
      const json = await res.json();
      if (json.likes !== undefined) {
        $('diary-likes').textContent = json.likes;
        localStorage.setItem(DIARY_LIKED_KEY, data.fecha);
        $('diary-like-btn').classList.add('liked');
      }
    } catch (err) { console.error('[nuvera-dashboard] Error al dar like:', err.message); }
  };

  $('diary-share-btn').onclick = () => {
    const text = `🤖 NUVERA BOT — Análisis del ${fechaFmt}\n\n${data.analisis}\n\n🎯 Para mañana: ${data.senalesManana}`;
    navigator.clipboard.writeText(text).then(() => showSimpleToast('📋 Copiado al portapapeles')).catch(() => showSimpleToast('No se pudo copiar'));
  };
}

function renderDiaryHistory(rows) {
  const list = $('diary-history-list');
  if (rows.length === 0) {
    list.innerHTML = '<div class="empty-msg">Sin historial todavía.</div>';
    return;
  }
  list.innerHTML = rows.map((r) => {
    const fechaObj = new Date(`${r.fecha}T00:00:00Z`);
    const fechaFmt = fechaObj.toLocaleDateString('es', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const s = r.stats || {};
    return `
      <div class="diary-history-item">
        <div class="dh-date">${fechaFmt} — ${s.total ?? '—'} trades, WR ${s.winrate ?? '—'}%, PnL ${s.pnlTotal !== undefined ? fmtUsd(s.pnlTotal) : '—'}</div>
        <div class="dh-text">${(r.analisis || '').slice(0, 220)}${(r.analisis || '').length > 220 ? '…' : ''}</div>
      </div>
    `;
  }).join('');
}

// ---------- Render: mejores/peores pares de HOY (ACCIÓN 5) ----------
function bwRowHtml(r, good) {
  const barPct = Math.min(100, Math.max(2, r.winrate));
  const bloqueadoTag = r.bloqueado
    ? ` <span class="status-tag blacklist">🔴 ${r.tipoBloqueo === 'permanente' ? 'BLOQUEADO' : 'BLOQUEADO 48h'}</span>`
    : '';
  return `
    <div class="bw-row">
      <span class="bw-pair">${coinIconHtml(r.par)} ${r.par.split('/')[0]}</span>
      <div class="bw-track"><div class="bw-fill ${good ? 'good' : 'bad'}" style="width:${barPct}%;"></div></div>
      <span class="mono ${pnlClass(r.pnl)}">${fmtUsd(r.pnl)}</span>
      <span class="mono">${r.winrate}% (${r.trades})</span>
    </div>${bloqueadoTag ? `<div style="margin:-4px 0 6px 96px;">${bloqueadoTag}</div>` : ''}
  `;
}

function renderBestWorstPairsToday(data) {
  const mejores = data.mejores || [];
  const peores = data.peores || [];
  $('best-worst-empty').style.display = (mejores.length === 0 && peores.length === 0) ? 'block' : 'none';

  $('best-pairs-today').innerHTML = mejores.length > 0
    ? mejores.map((r) => bwRowHtml(r, true)).join('')
    : '<div class="empty-msg">Sin datos todavía.</div>';

  $('worst-pairs-today').innerHTML = peores.length > 0
    ? peores.map((r) => bwRowHtml(r, false)).join('')
    : '<div class="empty-msg">Sin datos todavía.</div>';
}

// ---------- Render: bloqueos de IA hoy (CAMBIO 1, dentro del panel de IA) ----------
function renderIaBlocksToday(d) {
  const estadoTxt = { funcionando: '✅ funcionando bien', revisar: '⚠️ revisar (bloquea muy poco)', normal: 'normal', sin_datos: 'sin datos hoy' }[d.estado] || d.estado;
  $('ia-blocks-summary').innerHTML = `
    <span>🛡️ Bloqueados por IA hoy: <strong>${d.bloqueadosHoy}</strong></span>
    <span>Entradas reales: <strong>${d.entradasHoy}</strong></span>
    <span>% bloqueado: <strong>${d.pctBloqueado}%</strong> (${estadoTxt})</span>
  `;
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

// ---------- Render: salud del sistema (sección 13, GET /api/health) ----------
function healthItemHtml(name, value, statusClass) {
  return `<div class="health-item ${statusClass}"><span class="hi-name">${name}</span><span class="hi-value">${value}</span></div>`;
}

function renderHealth(h) {
  const grid = $('health-grid');
  const items = [
    healthItemHtml('Binance API', h.binance.ok ? `✅ OK (${h.binance.ms ?? '—'}ms)` : '❌ FALLA', h.binance.ok ? 'ok' : 'fail'),
    healthItemHtml('PostgreSQL', h.postgresql.ok ? `✅ OK (${h.postgresql.tradesGuardados ?? '—'} trades)` : '❌ FALLA', h.postgresql.ok ? 'ok' : 'fail'),
    healthItemHtml(
      'Ollama',
      h.ollama.deshabilitado ? '⚪ deshabilitado' : (h.ollama.ok ? '✅ OK' : '❌ no responde'),
      h.ollama.deshabilitado ? 'na' : (h.ollama.ok ? 'ok' : 'fail')
    ),
    healthItemHtml('Groq (fallback)', h.groq.configurado ? '✅ configurado' : '⚪ no configurado', h.groq.configurado ? 'ok' : 'na'),
    healthItemHtml('ngrok tunnel', h.ngrok.ok ? '✅ OK' : '❌ caído', h.ngrok.ok ? 'ok' : 'fail'),
  ];

  for (const p of (h.pausasPorEstrategia || [])) {
    const hasta = new Date(p.pausadaHasta);
    items.push(healthItemHtml(`⏸️ ${p.estrategia}`, `pausada hasta ${hasta.toISOString().slice(11, 16)} UTC`, 'fail'));
  }

  grid.innerHTML = items.join('');

  const errBox = $('health-errors');
  const recientes = h.errores?.recientes || [];
  if (recientes.length === 0) {
    errBox.innerHTML = `<div class="health-error-empty">${h.errores?.total24h ? h.errores.total24h : 0} errores en las últimas 24h — todos resueltos automáticamente.</div>`;
    return;
  }
  errBox.innerHTML = recientes.map((e) => `
    <div class="health-error-row ${e.resuelto ? '' : 'unresolved'}">
      <span><strong>${e.tipo}</strong>${e.estrategia ? ` (${e.estrategia})` : ''}: ${e.descripcion}</span>
      <span class="mono">${e.resuelto ? '✅ auto-resuelto' : '🔄 resolviendo'} · ${e.fecha}</span>
    </div>
  `).join('');
}

// ---------- Render: barra de capital desplegado en vivo (sección 14, GET
// /api/capital-activo) — el desglose por estrategia ya lo muestra
// renderCapitalActivo/renderStrategies más arriba, acá solo el % global
// contra el objetivo (>90% siempre trabajando, ver capitalDeployer.js). ----------
function renderCapitalActivoBar(ca) {
  const pct = ca.pct ?? 0;
  const fill = $('capital-activo-progress');
  fill.style.width = `${Math.min(pct, 100).toFixed(1)}%`;
  fill.style.background = pct >= 90 ? 'var(--accent)' : pct >= 60 ? 'var(--warning)' : 'var(--critical)';
  $('capital-activo-detalle').textContent = `${fmtUsd(ca.enTrades)} / ${fmtUsd(ca.total)} (${pct.toFixed(1)}%)`;
}

// ---------- Chart: capital histórico (área, color vs capital inicial, zoom) ----------
let capitalChart = null;
let capitalInicialRef = null;
let currentChartRange = '30d';

// 2026-08-11 (pedido explícito: "gráfica por hora, no por día") — 24h/7d
// usan granularidad horaria (GET /api/capital-history?granularity=hourly),
// 30d/todo se mantienen diarios (mismo endpoint, sin ese parámetro).
function chartUrlForRange(range) {
  if (range === '24h') return '/api/capital-history?granularity=hourly&hours=24';
  if (range === '7d') return '/api/capital-history?granularity=hourly&hours=168';
  if (range === '30d') return '/api/capital-history?days=30';
  return '/api/capital-history?days=3650';
}
function chartLabelFor(range, fecha) {
  // fecha viene ISO completo en horario (24h/7d) o 'YYYY-MM-DD' en diario (30d/todo).
  if (range === '24h' || range === '7d') {
    const d = new Date(fecha);
    return `${String(d.getUTCHours()).padStart(2, '0')}h ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return fecha.slice(5);
}

function renderCapitalChart(history) {
  const ctx = document.getElementById('capital-chart');
  const labels = history.map((h) => chartLabelFor(currentChartRange, h.fecha));
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

async function loadCapitalChart(range) {
  currentChartRange = range;
  try {
    const history = await fetchJson(chartUrlForRange(range));
    renderCapitalChart(history);
  } catch (err) {
    console.error('[nuvera-dashboard] Error cargando historial de capital:', err.message);
  }
}

// Refresca el gráfico con el zoom vigente (currentChartRange) — se llama en
// cada ciclo de refreshAll, no solo al tocar los botones 24h/7d/30d/Todo.
async function refreshCapitalChart() {
  try {
    const history = await fetchJson(chartUrlForRange(currentChartRange));
    renderCapitalChart(history);
  } catch (err) {
    console.error('[nuvera-dashboard] Error refrescando historial de capital:', err.message);
  }
}

// ---------- Chart: capital en tiempo real, estilo Binance (2026-08-15, pedido explícito) ----------
// Distinto del gráfico de arriba (Chart.js, agregado por hora/día): este usa
// Lightweight Charts sobre puntos CRUDOS de capital_log (GET
// /api/capital-chart) + marcadores de wins/losses grandes (GET
// /api/capital-markers), con polling propio cada 30s (spec explícita del
// pedido, distinto de los 5s del resto del dashboard) para que la línea se
// "extienda" sola sin recargar la página.
const RT_CHART_REFRESH_MS = 30000;

let rtChart = null;
let rtSeries = null;
let rtInitialPriceLine = null;
let rtInitialPriceLineValue = null;
let rtCurrentPeriod = '24h';

function rtFmtTime(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
function rtFmtDateTime(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${rtFmtTime(unixSeconds)} UTC · ${dd}/${mo}`;
}

function ensureRtChart() {
  if (rtChart || typeof LightweightCharts === 'undefined') return rtChart;
  const container = $('rt-capital-chart');
  rtChart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: 300,
    layout: { background: { color: 'transparent' }, textColor: '#8b949e', fontSize: 11 },
    grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
    timeScale: {
      timeVisible: true,
      secondsVisible: false,
      borderColor: 'rgba(255,255,255,0.08)',
      tickMarkFormatter: (time) => rtFmtTime(time),
    },
    rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
    crosshair: { mode: 0 },
  });
  rtSeries = rtChart.addAreaSeries({
    lineColor: '#00ff88',
    topColor: 'rgba(0,255,136,0.28)',
    bottomColor: 'rgba(0,255,136,0.02)',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: true,
  });

  // Tooltip flotante propio (estilo Binance: hora exacta + capital al pasar
  // el mouse) — Lightweight Charts no trae uno incorporado, se arma sobre
  // subscribeCrosshairMove, mismo patrón que el resto del dashboard usa
  // divs absolutos sobre un contenedor position:relative.
  const tooltip = document.createElement('div');
  tooltip.className = 'rt-chart-tooltip';
  tooltip.style.display = 'none';
  container.appendChild(tooltip);

  rtChart.subscribeCrosshairMove((param) => {
    if (!param.point || !param.time || param.point.x < 0 || param.point.y < 0 || !rtSeries) {
      tooltip.style.display = 'none';
      return;
    }
    const data = param.seriesData.get(rtSeries);
    if (!data || data.value === undefined) {
      tooltip.style.display = 'none';
      return;
    }
    tooltip.innerHTML = `<div class="rt-tt-time">${rtFmtDateTime(param.time)}</div><div class="rt-tt-value">${fmtUsd(data.value)}</div>`;
    tooltip.style.display = 'block';
    const tooltipWidth = 130;
    let left = param.point.x + 14;
    if (left > container.clientWidth - tooltipWidth) left = param.point.x - tooltipWidth - 4;
    tooltip.style.left = `${Math.max(0, left)}px`;
    tooltip.style.top = `${Math.max(0, param.point.y - 44)}px`;
  });

  window.addEventListener('resize', () => {
    if (rtChart) rtChart.applyOptions({ width: container.clientWidth });
  });

  return rtChart;
}

function updateRtStats(points) {
  const empty = points.length === 0;
  $('rt-chart-empty').style.display = empty ? 'block' : 'none';
  $('rt-capital-chart').style.display = empty ? 'none' : 'block';
  if (empty) {
    ['rt-stat-actual', 'rt-stat-max', 'rt-stat-min', 'rt-stat-var'].forEach((id) => { $(id).textContent = '—'; });
    return;
  }

  let maxPoint = points[0];
  let minPoint = points[0];
  for (const p of points) {
    if (p.value > maxPoint.value) maxPoint = p;
    if (p.value < minPoint.value) minPoint = p;
  }
  const actual = points[points.length - 1].value;
  const primero = points[0].value;
  const variacion = actual - primero;
  const variacionPct = primero !== 0 ? (variacion / primero) * 100 : 0;

  const actualEl = $('rt-stat-actual');
  actualEl.textContent = fmtUsd(actual);
  actualEl.className = `rt-stat-value mono ${capitalInicialRef !== null ? pnlClass(actual - capitalInicialRef) : ''}`;

  $('rt-stat-max').textContent = `${fmtUsd(maxPoint.value)} (${rtFmtDateTime(maxPoint.time)})`;
  $('rt-stat-min').textContent = `${fmtUsd(minPoint.value)} (${rtFmtDateTime(minPoint.time)})`;

  const varEl = $('rt-stat-var');
  varEl.textContent = `${variacion >= 0 ? '+' : ''}${fmtUsd(variacion)} (${fmtPct(variacionPct)})`;
  varEl.className = `rt-stat-value mono ${pnlClass(variacion)}`;
}

function renderRtCapitalChart(points, markers, fit) {
  const chart = ensureRtChart();
  updateRtStats(points);
  if (!chart || !rtSeries) return;
  if (points.length === 0) { rtSeries.setData([]); return; }

  const lastValue = points[points.length - 1].value;
  const trendUp = capitalInicialRef === null || lastValue >= capitalInicialRef;
  const lineColor = trendUp ? '#00ff88' : '#ff4444';
  rtSeries.applyOptions({
    lineColor,
    topColor: trendUp ? 'rgba(0,255,136,0.28)' : 'rgba(255,68,68,0.28)',
    bottomColor: trendUp ? 'rgba(0,255,136,0.02)' : 'rgba(255,68,68,0.02)',
  });

  rtSeries.setData(points);
  rtSeries.setMarkers(markers);

  // Línea horizontal punteada en el capital inicial de referencia (pedido
  // explícito: "$200") — se lee de capitalInicialRef (viene de
  // status.capitalInicial, ver refreshAll) en vez de hardcodearlo, así nunca
  // queda desalineada si el bot arranca con otro capital inicial.
  if (capitalInicialRef !== null && capitalInicialRef !== rtInitialPriceLineValue) {
    if (rtInitialPriceLine) rtSeries.removePriceLine(rtInitialPriceLine);
    rtInitialPriceLine = rtSeries.createPriceLine({
      price: capitalInicialRef,
      color: '#8b949e',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: `Inicial $${capitalInicialRef.toFixed(0)}`,
    });
    rtInitialPriceLineValue = capitalInicialRef;
  }

  if (fit) chart.timeScale().fitContent();
}

async function loadRtCapitalChart(period, fit) {
  rtCurrentPeriod = period;
  try {
    const [points, markers] = await Promise.all([
      fetchJson(`/api/capital-chart?period=${period}`),
      fetchJson(`/api/capital-markers?period=${period}`),
    ]);
    renderRtCapitalChart(points, markers, fit);
  } catch (err) {
    console.error('[nuvera-dashboard] Error cargando capital en tiempo real:', err.message);
  }
}

async function refreshRtCapitalChart() {
  await loadRtCapitalChart(rtCurrentPeriod, false);
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
    const [status, positions, trades, pairs, pairsHistory, blacklist, aiDecisions, system, patterns, capitalBreakdown, capitalActivo, racha, mood, confidence, learnings, health, performanceByPair, performanceByHour, iaBlocksToday, bestWorstToday, diaryToday, diaryHistory, mlModel] = await Promise.all([
      fetchJson('/api/status'),
      fetchJson('/api/positions'),
      fetchJson('/api/trades?limit=200'),
      fetchJson('/api/pairs'),
      fetchJson('/api/pairs-history'),
      fetchJson('/api/blacklist'),
      fetchJson('/api/ai-decisions?limit=5'),
      fetchJson('/api/system'),
      fetchJson('/api/patterns?limit=1'),
      fetchJson('/api/capital-breakdown'),
      fetchJson('/api/capital-activo'),
      fetchJson('/api/racha'),
      fetchJson('/api/market-mood'),
      fetchJson('/api/confidence'),
      fetchJson('/api/learnings?limit=3'),
      fetchJson('/api/health'),
      fetchJson('/api/performance-by-pair'),
      fetchJson('/api/performance-by-hour'),
      fetchJson('/api/ia-blocks-today'),
      fetchJson('/api/best-worst-pairs-today'),
      fetchJson('/api/diary/today'),
      fetchJson('/api/diary/history?days=7'),
      fetchJson('/api/ml-model'),
    ]);

    setConnWarning(false);
    renderStatus(status);
    capitalInicialRef = status.capitalInicial;
    renderCapitalBreakdown(capitalBreakdown, status.fondoServidorMeta);
    renderCapitalActivo(capitalActivo);
    renderCapitalActivoBar(capitalActivo);
    renderRacha(racha);
    renderMood(mood);
    renderConfidence(confidence);
    renderLearnings(learnings);
    renderMlModel(mlModel);
    renderPositions(positions);
    renderActivePairs(pairs);
    renderPairsHistory(pairsHistory);
    renderBlacklistSummary(blacklist);
    renderAiDecisions(aiDecisions);
    renderSystemFooter(system);
    renderPatternsNote(patterns);
    renderHealth(health);
    renderPerformanceByPair(performanceByPair);
    renderPerformanceByHour(performanceByHour);
    renderIaBlocksToday(iaBlocksToday);
    renderBestWorstPairsToday(bestWorstToday);
    renderDiaryToday(diaryToday);
    renderDiaryHistory(diaryHistory);

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
document.getElementById('rt-chart-periods').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-rtperiod]');
  if (!btn) return;
  document.querySelectorAll('#rt-chart-periods .btn-tab').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  loadRtCapitalChart(btn.dataset.rtperiod, true);
});

document.getElementById('chart-zoom-controls').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-chartrange]');
  if (!btn) return;
  document.querySelectorAll('#chart-zoom-controls .btn-tab').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  loadCapitalChart(btn.dataset.chartrange);
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

// Ciclo propio de 30s para el gráfico de capital en tiempo real (pedido
// explícito: "se actualiza cada 30 segundos"), independiente del polling de
// 5s del resto del dashboard — capitalInicialRef ya queda seteado por el
// primer refreshAll() de arriba (ambos arrancan casi en simultáneo).
loadRtCapitalChart(rtCurrentPeriod, true);
setInterval(refreshRtCapitalChart, RT_CHART_REFRESH_MS);
