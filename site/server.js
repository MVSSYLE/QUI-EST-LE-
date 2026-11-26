'use strict';
/* Qui est le + : serveur sans dépendance (Node 18+).
   État du jeu en mémoire, temps réel par Server-Sent Events.
   Anonymat : le serveur retient QUI a voté, jamais POUR QUI. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const HOST_PIN = String(process.env.HOST_PIN || '1234');
const PUBLIC = path.join(__dirname, 'public');

const PLAYERS = ['Ecta', 'Ilalol', 'Dada', 'Tomlamoula', 'Titi', 'TKNG', 'Massyle', 'Hugo', 'Achille', 'Guigz', 'Flo', 'Noah', 'Charly', 'Lolo', 'Maskadow'];
const WHO = ['moche apte à te tunnel', 'beau', 'intelligent', 'bête', 'drip', 'mal habillé', 'cultivé', 'inculte', 'drôle', 'pas drôle', 'sympa', 'aigri', 'vulgaire', 'radin', 'généreux', 'odorant', 'propre', 'dégueu', 'sexy', 'nonchalant', 'ridicule', 'malin', 'méchant', 'gentil', 'hypocrite', 'calme', 'colérique', 'harceleur', 'faible', 'fort au jeu vidéo', 'nul au jeu vidéo', 'fort', 'fainéant', 'motivé', 'sportif', 'branleur', 'raciste', 'de gauche', 'pédophile', 'woke', 'gay', 'hétéro', 'misogyne', 'mystérieux', 'alcoolique', 'toxico'];
const WITH = ['faire une coloc', 'partir en vacances', 'faire un date', 'se marier', 'jouer au JV', 'rigoler', 'voir un film', 'se plaindre', 'se morfondre', 'se mettre khapta', 'se battre', 'faire l’amour', 'se branler', 'aller au resto', 'se faire tunnel', 'dormir', 'cuisiner', 'cacher un corps', 'braquer une banque', 'faire un attentat', 'voler des bonbecs', 'cracher sur des inconnus', 'hurler dans le métro', 'vomir à Châtelet', 'parler à des randoms', 'casser des trucs'];

function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}
function buildQueue(mode, rounds) {
  let pool = [];
  if (mode !== 'with') pool = pool.concat(WHO.map(t => ({ mode: 'who', text: t })));
  if (mode !== 'who') pool = pool.concat(WITH.map(t => ({ mode: 'with', text: t })));
  pool = shuffle(pool);
  return rounds === 'all' ? pool : pool.slice(0, Math.min(rounds, pool.length));
}

/* ---------- état ---------- */
const claims = new Map();   // blaze -> cid
const hosts = new Set();    // cid des organisateurs
const clients = new Map();  // cid -> Set(res) des connexions SSE
let G = freshGame();

function freshGame() {
  return { phase: 'lobby', mode: 'who', rounds: 20, queue: [], qi: 0, roster: [], voters: [], voted: new Set(), counts: {}, history: [] };
}
function nameOf(cid) {
  for (const [n, c] of claims) if (c === cid) return n;
  return null;
}
function startQuestion() {
  G.phase = 'question';
  G.roster = PLAYERS.filter(p => claims.has(p));
  G.voters = G.roster.slice();
  G.voted = new Set();
  G.counts = {};
  G.roster.forEach(p => { G.counts[p] = 0; });
}

function publicState(cid) {
  const name = nameOf(cid);
  const revealed = G.phase === 'result' || G.phase === 'end';
  return {
    players: PLAYERS.map(n => ({ name: n, taken: claims.has(n) })),
    me: { name, host: hosts.has(cid) },
    phase: G.phase,
    q: G.phase === 'lobby' ? null : { mode: G.queue[G.qi].mode, text: G.queue[G.qi].text, index: G.qi, total: G.queue.length },
    roster: G.phase === 'lobby' ? [] : G.roster,
    voters: G.phase === 'lobby' ? [] : G.voters,
    voted: G.phase === 'lobby' ? [] : [...G.voted],
    canVote: !!name && G.voters.includes(name),
    iVoted: !!name && G.voted.has(name),
    counts: G.phase === 'result' ? G.counts : null, // jamais envoyé avant la révélation
    history: G.phase === 'end' ? G.history : null,
    revealed
  };
}
function send(res, cid) {
  try { res.write('event: state\ndata: ' + JSON.stringify(publicState(cid)) + '\n\n'); } catch (e) { /* connexion fermée */ }
}
function broadcast() {
  for (const [cid, set] of clients) for (const res of set) send(res, cid);
}
setInterval(() => {
  for (const set of clients.values()) for (const res of set) { try { res.write(': ping\n\n'); } catch (e) { /* ignore */ } }
}, 15000).unref();

/* ---------- actions ---------- */
const fails = new Map(); // ip -> {n, until}
function pinOk(ip, pin) {
  const f = fails.get(ip);
  if (f && f.until > Date.now()) return null; // bloqué
  const a = crypto.createHash('sha256').update(String(pin)).digest();
  const b = crypto.createHash('sha256').update(HOST_PIN).digest();
  if (crypto.timingSafeEqual(a, b)) { fails.delete(ip); return true; }
  const n = (f ? f.n : 0) + 1;
  fails.set(ip, { n, until: n >= 5 ? Date.now() + 60000 : 0 });
  if (n >= 5) fails.set(ip, { n: 0, until: Date.now() + 60000 });
  return false;
}

const actions = {
  claim(cid, b) {
    if (!PLAYERS.includes(b.name)) return [400, 'Blaze inconnu.'];
    const owner = claims.get(b.name);
    if (owner && owner !== cid) return [409, 'Ce blaze est déjà pris.'];
    const mine = nameOf(cid);
    if (mine && mine !== b.name) {
      if (G.phase !== 'lobby') return [409, 'Tu ne peux plus changer de blaze en pleine partie.'];
      claims.delete(mine);
    }
    claims.set(b.name, cid);
  },
  release(cid) {
    const mine = nameOf(cid);
    if (!mine) return;
    if (G.phase !== 'lobby') return [409, 'Tu ne peux plus changer de blaze en pleine partie.'];
    claims.delete(mine);
  },
  host(cid, b, ip) {
    const ok = pinOk(ip, b.pin);
    if (ok === null) return [429, 'Trop d’essais. Réessaie dans une minute.'];
    if (!ok) return [403, 'Mauvais code.'];
    hosts.add(cid);
  },
  start(cid, b) {
    if (!hosts.has(cid)) return [403, 'Réservé à l’organisateur.'];
    if (G.phase !== 'lobby') return [409, 'La partie est déjà lancée.'];
    if (!['who', 'with', 'mix'].includes(b.mode)) return [400, 'Mode inconnu.'];
    if (![10, 20, 'all'].includes(b.rounds)) return [400, 'Nombre de questions inconnu.'];
    if (claims.size < 3) return [409, 'Il faut au moins 3 joueurs.'];
    G = freshGame();
    G.mode = b.mode; G.rounds = b.rounds;
    G.queue = buildQueue(b.mode, b.rounds);
    startQuestion();
  },
  vote(cid, b) {
    const name = nameOf(cid);
    if (!name) return [403, 'Choisis ton blaze d’abord.'];
    if (G.phase !== 'question') return [409, 'Pas de vote en cours.'];
    if (!G.voters.includes(name)) return [409, 'Tu rejoins à la prochaine question.'];
    if (G.voted.has(name)) return [409, 'Tu as déjà voté.'];
    if (!G.roster.includes(b.target)) return [400, 'Blaze inconnu.'];
    G.counts[b.target] += 1;   // on retient seulement qui a voté, pas pour qui
    G.voted.add(name);
  },
  reveal(cid) {
    if (!hosts.has(cid)) return [403, 'Réservé à l’organisateur.'];
    if (G.phase !== 'question') return [409, 'Rien à révéler.'];
    G.history.push({ mode: G.queue[G.qi].mode, text: G.queue[G.qi].text, counts: Object.assign({}, G.counts) });
    G.phase = 'result';
  },
  next(cid) {
    if (!hosts.has(cid)) return [403, 'Réservé à l’organisateur.'];
    if (G.phase !== 'result') return [409, 'Révèle d’abord le résultat.'];
    G.qi += 1;
    if (G.qi >= G.queue.length) { G.qi = G.queue.length - 1; G.phase = 'end'; } else startQuestion();
  },
  end(cid) {
    if (!hosts.has(cid)) return [403, 'Réservé à l’organisateur.'];
    if (G.phase !== 'question' && G.phase !== 'result') return [409, 'Pas de partie en cours.'];
    G.phase = 'end';
  },
  reset(cid) {
    if (!hosts.has(cid)) return [403, 'Réservé à l’organisateur.'];
    G = freshGame();
  },
  kick(cid, b) {
    if (!hosts.has(cid)) return [403, 'Réservé à l’organisateur.'];
    if (!PLAYERS.includes(b.name)) return [400, 'Blaze inconnu.'];
    claims.delete(b.name);
  }
};

/* ---------- http ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };
const SEC = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"
};
const validCid = c => typeof c === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(c);
let sseCount = 0;

function sse(req, res, url) {
  const cid = url.searchParams.get('cid');
  if (!validCid(cid)) { res.writeHead(400); return res.end(); }
  if (sseCount >= 300) { res.writeHead(503); return res.end(); }
  res.writeHead(200, Object.assign({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }, SEC));
  res.write('retry: 2000\n\n');
  if (!clients.has(cid)) clients.set(cid, new Set());
  clients.get(cid).add(res);
  sseCount++;
  send(res, cid);
  req.on('close', () => {
    sseCount--;
    const set = clients.get(cid);
    if (set) { set.delete(res); if (!set.size) clients.delete(cid); }
  });
}

function api(req, res, name) {
  const done = (code, obj) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, SEC)); res.end(JSON.stringify(obj)); };
  const fn = Object.prototype.hasOwnProperty.call(actions, name) ? actions[name] : null;
  if (!fn) return done(404, { error: 'Inconnu.' });
  const chunks = []; let n = 0;
  req.on('data', c => { n += c.length; if (n > 4096) req.destroy(); else chunks.push(c); });
  req.on('error', () => {});
  req.on('end', () => {
    let b;
    try { b = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch (e) { return done(400, { error: 'Requête invalide.' }); }
    if (!b || typeof b !== 'object' || !validCid(b.cid)) return done(400, { error: 'Requête invalide.' });
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const r = fn(b.cid, b, ip);
    if (r) return done(r[0], { error: r[1] });
    broadcast();
    done(200, { ok: true });
  });
}

function serveStatic(req, res, pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (p === '/healthz') { res.writeHead(200); return res.end('ok'); }
  const file = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Introuvable'); }
    const ext = path.extname(file).toLowerCase();
    const isHtml = ext === '.html';
    res.writeHead(200, Object.assign({ 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=300' }, SEC));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/events') return sse(req, res, url);
  if (req.method === 'POST' && url.pathname.startsWith('/api/')) return api(req, res, url.pathname.slice(5));
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url.pathname);
  res.writeHead(405); res.end();
});

if (require.main === module) {
  server.listen(PORT, () => console.log('Qui est le + sur le port ' + PORT + (process.env.HOST_PIN ? '' : ' (code organisateur par défaut : 1234, change-le avec HOST_PIN)')));
}
module.exports = { server, PLAYERS };
