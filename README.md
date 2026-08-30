# Nuvera Bot — Dashboard web

Dashboard estático (HTML/CSS/JS puro, sin build) que muestra el estado del
bot de trading en tiempo real. Lee datos de la API de solo lectura del bot
(`src/api/server.js`, puerto 3001) expuesta a internet vía **Cloudflare
Tunnel** con HTTPS, y se aloja gratis en GitHub Pages.

La API **solo tiene endpoints GET**. No expone keys de Binance/Telegram/DB,
no permite modificar el bot desde la web.

## Secciones (2026-08-19, rediseño completo: sidebar + vista por bot)

Reemplaza el dashboard de tabs (2026-08-16) por una SPA tipo "institutional
trading terminal": **sidebar fijo** a la izquierda (colapsable con hamburger
en mobile, `style.css`/`app.js` sin build) + **una página dedicada por
bot/estrategia** a la derecha, con router por hash (`#overview`, `#motorb`,
etc.) — cambiar de bot no pega al servidor de más de lo necesario, cada
página cachea sus propios requests (ver `CACHE_TTL_MS` en `app.js`).

Páginas:

1. **Overview** (`#overview`) — portfolio total + PnL de hoy + gráfica de
   capital (24H/7D/30D) + 5 cards de rendimiento diario (uno por bot, con
   sparkline) para Motor B, Motor A, Bot 2 Grid, Bot 3 DCA y Bot 4 DCA. Todo
   sale de un solo request a `/api/overview`.
2. **Motor B** (`#motorb`) — Portfolio/Orders/History como sub-tabs, stats de
   avg profit/trade y max drawdown 24h (`/api/bot/motorb/stats`).
3. **Motor A DCA** (`#motora`) — el DCA REAL del bot principal (smartDCA,
   capital real, NO es un bot de competencia) — antes no tenía página propia
   en el dashboard. Accumulation path BTC/ETH + próximo trigger de compra
   (`/api/bot/motora/stats`).
4. **Bot 2 Grid** (`#bot2`) — niveles de grilla BTC/ETH (`/api/bot/grid/
   levels`) con órdenes BUY/SELL pendientes y el precio actual marcado.
5. **Bot 3 DCA Agresivo** / **Bot 4 DCA BTC/ETH** (`#bot3`/`#bot4`) —
   accumulation path + historial de ejecución (`/api/bot/dca/:id/path`, el
   `:id` se resuelve en runtime vía `/api/competition/ranking`, nunca
   hardcodeado).
6. **Settings** (`#settings`) — override de la URL de la API (mismo mecanismo
   `?api=`/localStorage de siempre) y estado general del bot.

Polling: cada página activa se refresca cada 20s (pausado por completo
cuando la pestaña está en segundo plano, `visibilitychange`); estado de
sub-tab/período seleccionado se preserva entre refreshes.

Endpoints nuevos en `src/api/server.js` (2026-08-19): `/api/overview`,
`/api/bot/motorb/stats`, `/api/bot/grid/levels`, `/api/bot/dca/:id/path`,
`/api/bot/motora/stats` — todos de solo lectura, reusan `metrics`/`smartDCA`/
`hybridAllocation` en vez de recalcular. El resto de las páginas reusa
`/api/competition/bot/:id*` tal cual (con `'motorB'` como id especial para
Motor B, igual que el tab Competencia del diseño anterior).

## Arquitectura actual

```
GitHub Pages (HTTPS)  →  Cloudflare Tunnel (HTTPS, quick tunnel)  →  localhost:3001 (API del bot)
```

- **API**: `pm2` — proceso `nuvera-api`, puerto 3001, solo en `localhost`.
- **Túnel**: `cloudflared.service` (systemd, arranca solo con el servidor)
  expone esa API con un *quick tunnel* (`cloudflared tunnel --url
  http://localhost:3001`, sin dominio propio ni login). Genera una URL
  aleatoria tipo `https://palabras-random.trycloudflare.com` **que cambia
  cada vez que se reinicia el servicio** — a diferencia de ngrok no hay
  dominio fijo en el plan gratis sin cuenta/dominio propio en Cloudflare.
- **Dashboard**: este directorio (`index.html` + `app.js`), servido por
  GitHub Pages, apunta a esa URL de Cloudflare Tunnel.

## Levantar/gestionar la API con PM2

```bash
cd /root/nuvera-trading-bot
pm2 start src/api/server.js --name nuvera-api
pm2 save            # persiste la lista de procesos para pm2 resurrect
pm2 logs nuvera-api  # ver logs
```

La API es un proceso **separado** del bot principal (`nuvera-trading-bot`) y
de `kamino-rust` — reiniciarla/detenerla no afecta a ninguno de los dos.

## Gestionar el túnel de Cloudflare

Corre como servicio systemd (`/etc/systemd/system/cloudflared.service`),
habilitado para arrancar solo con el servidor:

```bash
systemctl status cloudflared    # ver estado
systemctl restart cloudflared   # reiniciar el túnel (¡genera una URL nueva!)
journalctl -u cloudflared -f    # ver logs en vivo
tail -f /root/nuvera-trading-bot/logs/cloudflared.log  # logs del servicio
```

⚠️ **Es un *quick tunnel*** (`cloudflared tunnel --url http://localhost:3001`,
sin `cloudflared tunnel login` ni dominio propio): cada `systemctl restart
cloudflared` genera una URL nueva (`https://palabras-random.trycloudflare.com`).
Después de reiniciar el servicio, sacá la URL nueva del log:

```bash
grep -oE "https://[a-zA-Z0-9-]+\.trycloudflare\.com" /root/nuvera-trading-bot/logs/cloudflared.log | tail -1
```

y actualizala en `app.js` (`DEFAULT_API_BASE`, ver abajo) + push a GitHub —
o pasala como `?api=` mientras tanto (ver sección siguiente).

Si en algún momento se registra un dominio propio en Cloudflare, se puede
migrar a un *named tunnel* (`cloudflared tunnel login` + `create` + `route
dns`) para tener una URL fija que no cambie entre reinicios.

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
https://TU_USUARIO.github.io/nuvera-dashboard/?api=https://nueva-url.trycloudflare.com
```

El navegador la guarda en `localStorage` y las próximas visitas ya no
necesitan el parámetro (mismo navegador/dispositivo).

**b) Editar el valor por defecto** (persistente para cualquier visitante) en
`app.js`:

```js
const DEFAULT_API_BASE = 'https://basketball-date-introducing-est.trycloudflare.com';
```

y hacer commit/push.

## Probar la API directamente

```bash
# Desde el servidor
curl http://localhost:3001/api/status

# Desde cualquier lugar, vía Cloudflare Tunnel
curl https://basketball-date-introducing-est.trycloudflare.com/api/status
```

Debería devolver un JSON como:

```json
{"estado":"operando","capital":200,"fondoServidor":0.1,"fondoServidorMeta":25,"tradesHoy":35,"winsHoy":10,"lossesHoy":25,"winrateHoy":28.6,"pnlHoy":-0.24,"pnlTotal":-0.28,"fearGreed":30,"fearGreedLabel":"Miedo","ultimoTrade":"2026-08-10 16:54 UTC","fondoServidorEtaDias":1730}
```

## Abrir el firewall (solo si no usás el túnel)

Si en algún momento exponés el puerto 3001 directo (sin Cloudflare Tunnel de
por medio), hay que permitirlo en el firewall del servidor:

```bash
sudo ufw allow 3001/tcp
```

Con el túnel de por medio (setup actual) **no hace falta** — sale desde el
servidor hacia afuera, no requiere puertos entrantes abiertos.
