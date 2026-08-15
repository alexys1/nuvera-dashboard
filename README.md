# Nuvera Bot — Dashboard web

Dashboard estático (HTML/CSS/JS puro, sin build) que muestra el estado del
bot de trading en tiempo real. Lee datos de la API de solo lectura del bot
(`src/api/server.js`, puerto 3001) expuesta a internet vía **ngrok** con
HTTPS, y se aloja gratis en GitHub Pages.

La API **solo tiene endpoints GET**. No expone keys de Binance/Telegram/DB,
no permite modificar el bot desde la web.

## Secciones (2026-08-16, rediseño completo)

Rediseño de arriba a abajo enfocado en rendimiento móvil (carga lenta, datos
duplicados, gráfica lenta y bugs al refrescar en celular eran los problemas
del diseño anterior). 4 secciones:

1. **Header fijo** (capital, PnL de hoy, Fear&Greed, estado/modo) — se pinta
   en menos de 1 segundo, antes que cualquier otra cosa.
2. **Gráfica de capital** (Lightweight Charts) — carga 500ms DESPUÉS del
   header/cards (lazy), período default 24H (antes era 1H), máximo 200
   puntos en pantalla (se promedia si la API devuelve más), sin marcadores
   de trades individuales.
3. **3 cards**: HOY (PnL/trades/WR/PF), CAPITAL (total/en trades/libre) e
   INTELIGENCIA (Ollama en RAM/XGBoost/aprendizajes de hoy) — las 3 salen de
   un solo request a `/api/dashboard-summary`.
4. **4 tabs** (Posiciones / Estrategias / Análisis / Sistema) — cambio de tab
   instantáneo (sin petición), cada tab carga sus datos una sola vez la
   primera vez que se abre y después se cachea.

**Caché por tipo de dato** (evita pedir de nuevo antes de que venza): capital
10s, posiciones 30s, estrategias 60s, análisis diario 30min, sistema 60s.
Polling de fondo: header/cards cada 15s, tab activa cada 60s, gráfica cada
60s — se pausa por completo cuando la pestaña del navegador está en segundo
plano (`visibilitychange`) para no acumular fetches atrasados al volver
(causa típica de "se bugea al refrescar" en móvil).

Se eliminaron del inicio (siguen existiendo, pero movidas a una tab o
directamente retiradas por ser redundantes): distribución de capital
separada, racha aparte, Market Mood aparte, decisiones autónomas aparte,
tabla de trades históricos, cooldowns aparte, y los botones de like/compartir
del diario (ahora solo en la tab Análisis).

Endpoints nuevos en `src/api/server.js`: `/api/dashboard-summary` (header +
3 cards en un solo request) y `/api/strategies-today` (tab Estrategias, PF
real de hoy por estrategia incluyendo capitalDeployer).

## Arquitectura actual

```
GitHub Pages (HTTPS)  →  ngrok (HTTPS, dominio fijo)  →  localhost:3001 (API del bot)
```

- **API**: `pm2` — proceso `nuvera-api`, puerto 3001, solo en `localhost`.
- **Túnel**: `ngrok.service` (systemd, arranca solo con el servidor) expone
  esa API en `https://shorter-sprung-process.ngrok-free.dev`.
- **Dashboard**: este directorio (`index.html` + `app.js`), servido por
  GitHub Pages, apunta a esa URL fija de ngrok.

## Levantar/gestionar la API con PM2

```bash
cd /root/nuvera-trading-bot
pm2 start src/api/server.js --name nuvera-api
pm2 save            # persiste la lista de procesos para pm2 resurrect
pm2 logs nuvera-api  # ver logs
```

La API es un proceso **separado** del bot principal (`nuvera-trading-bot`) y
de `kamino-rust` — reiniciarla/detenerla no afecta a ninguno de los dos.

## Gestionar el túnel de ngrok

Corre como servicio systemd (`/etc/systemd/system/ngrok.service`), habilitado
para arrancar solo con el servidor:

```bash
systemctl status ngrok    # ver estado
systemctl restart ngrok   # reiniciar el túnel
journalctl -u ngrok -f    # ver logs en vivo
```

El dominio (`shorter-sprung-process.ngrok-free.dev`) es un **dominio
estático reservado** en el panel de ngrok (Cloud Edge → Domains) — no cambia
entre reinicios, a diferencia de un túnel `ngrok http 3001` sin `--url`.

⚠️ Si alguna vez el túnel falla con `ERR_NGROK_334` ("endpoint already
online"), significa que hay otra sesión de ngrok activa en la misma cuenta
(otro server, tu PC, etc). Revisá `dashboard.ngrok.com` → Agents/Endpoints y
cerrala ahí — no se puede desde este servidor.

## Publicar/actualizar el dashboard en GitHub Pages

```bash
cd /root/nuvera-dashboard
git add index.html app.js README.md
git commit -m "..."
git push
```

GitHub Pages redeploya solo en 1-2 min tras cada push a `main`.

**Settings → Pages** en el repo: Source = "Deploy from a branch", branch
`main`, carpeta `/ (root)`.

## Apuntar el dashboard a otra API (opcional)

Si en algún momento cambiás de túnel/dominio, hay 3 formas de actualizar la
URL que usa el dashboard, de más a menos cómoda:

**a) Parámetro en la URL (no toca archivos, para probar rápido):**

```
https://TU_USUARIO.github.io/nuvera-dashboard/?api=https://nueva-url.ngrok-free.dev
```

El navegador la guarda en `localStorage` y las próximas visitas ya no
necesitan el parámetro (mismo navegador/dispositivo).

**b) Editar el valor por defecto** (persistente para cualquier visitante) en
`app.js`:

```js
const DEFAULT_API_BASE = 'https://shorter-sprung-process.ngrok-free.dev';
```

y hacer commit/push.

## Nota técnica: header de ngrok

Los túneles gratis de ngrok muestran una página HTML de advertencia ante
requests con user-agent de navegador (para evitar que bots anónimos abusen
del túnel) — eso rompería el `fetch()` del dashboard si no se avisa. Por eso
`app.js` manda el header `ngrok-skip-browser-warning: true` en cada request;
si armás tu propio cliente contra esta API detrás de ngrok, hace falta ese
mismo header.

## Probar la API directamente

```bash
# Desde el servidor
curl http://localhost:3001/api/status

# Desde cualquier lugar, vía ngrok
curl -H "ngrok-skip-browser-warning: true" https://shorter-sprung-process.ngrok-free.dev/api/status
```

Debería devolver un JSON como:

```json
{"estado":"operando","capital":200,"fondoServidor":0.1,"fondoServidorMeta":25,"tradesHoy":35,"winsHoy":10,"lossesHoy":25,"winrateHoy":28.6,"pnlHoy":-0.24,"pnlTotal":-0.28,"fearGreed":30,"fearGreedLabel":"Miedo","ultimoTrade":"2026-08-10 16:54 UTC","fondoServidorEtaDias":1730}
```

## Abrir el firewall (solo si no usás ngrok)

Si en algún momento exponés el puerto 3001 directo (sin ngrok de por medio),
hay que permitirlo en el firewall del servidor:

```bash
sudo ufw allow 3001/tcp
```

Con ngrok de por medio (setup actual) **no hace falta** — el túnel sale
desde el servidor hacia afuera, no requiere puertos entrantes abiertos.
