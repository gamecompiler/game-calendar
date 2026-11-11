// api/slide.js — 웹 슬라이드 (설명회·토론회): 덱 보관 + 페이지 동기화
// ───────────────────────────────────────────────────────────────────────────
// 손님은 sub-cal.vercel.app/slide/<덱> 으로 접속해 호스트가 넘기는 페이지를 따라간다.
// 저장소: Upstash Redis (Vercel Storage로 연결하면 KV_REST_API_URL / KV_REST_API_TOKEN 이 환경변수로 들어온다).
// 비밀값은 코드에 없다. 열쇠는 요청 헤더 X-Slide-Key 로 오고, 서버에는 그 해시(sha256)만 둔다.
//   주인 열쇠  덱 올리기·그림 올리기 (앱이 처음 올릴 때 정해진다: 먼저 올린 사람이 주인 — 이후로는 같은 열쇠만)
//   호스트 암호 덱마다. 페이지 넘기기 · 대본 읽기 (게임컴 브라우저·송출컴 대본 화면에서 입력)
// 읽기(GET)   op=deck|state|img|list (누구나) · op=notes (호스트)
// 쓰기(POST)  op=page (호스트) · op=deck|img|remove (주인)
// 로컬에서는 proxy.py 가 같은 주소·같은 응답으로 동작한다 (파일 저장소).
import { createHash } from 'node:crypto';

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const sha = (s) => createHash('sha256').update(String(s || ''), 'utf8').digest('hex');

function env() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

// Upstash REST: 명령을 JSON 배열로 보낸다. 테스트에서는 globalThis.__slideStore 로 가짜 저장소를 끼운다.
async function redis(cmd) {
  if (globalThis.__slideStore) return globalThis.__slideStore(cmd);
  const e = env();
  if (!e) throw Object.assign(new Error('no store'), { code: 503 });
  const r = await fetch(e.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${e.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw Object.assign(new Error(j.error || `store ${r.status}`), { code: 502 });
  return j.result;
}
const getJson = async (key) => { const v = await redis(['GET', key]); return v ? JSON.parse(v) : null; };
const setJson = (key, v) => redis(['SET', key, JSON.stringify(v)]);

function send(res, code, body, cache) {
  res.setHeader('Cache-Control', cache || 'no-store');
  return res.status(code).json(body);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Slide-Key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const q = req.query || {};
  const op = String(q.op || '');
  const id = String(q.id || '');
  const key = req.headers['x-slide-key'] || '';
  try {
    if (!globalThis.__slideStore && !env()) {
      return send(res, 503, { error: '슬라이드 저장소가 연결되지 않았다 (Vercel Storage → Upstash Redis)' });
    }
    if (op === 'list' && req.method === 'GET') {
      return send(res, 200, { decks: (await getJson('slide:index')) || [] }, 'public, s-maxage=5, max-age=0');
    }
    if (!ID_RE.test(id)) return send(res, 400, { error: 'id' });
    const rec = op === 'img' && req.method === 'GET' ? null : await getJson(`slide:deck:${id}`);
    const owner = async (claim = false) => {
      const h = sha(key);
      if (!key) return false;
      const cur = await redis(['GET', 'slide:owner']);
      if (cur) return cur === h;
      if (!claim) return false;                                 // 주인 자리는 덱·그림을 올릴 때만 정해진다
      await redis(['SETNX', 'slide:owner', h]);                 // 처음 올리는 사람이 주인
      return (await redis(['GET', 'slide:owner'])) === h;
    };
    const host = async () => !!key && ((rec && rec.hostHash === sha(key)) || (await owner()));

    if (req.method === 'GET') {
      if (op === 'deck') {
        if (!rec) return send(res, 404, { error: '없는 덱' });
        return send(res, 200, { id, deck: rec.deck, updated: rec.updated }, 'public, s-maxage=2, max-age=0');
      }
      if (op === 'state') {
        const st = (await getJson(`slide:state:${id}`)) || { page: 0, t: 0 };
        return send(res, 200, st, 'public, s-maxage=1, max-age=0');   // 손님이 많아도 1초에 한 번만 저장소를 읽는다
      }
      if (op === 'notes') {
        if (!(await host())) return send(res, 403, { error: '호스트 암호가 맞지 않다' });
        return send(res, 200, { notes: (await getJson(`slide:notes:${id}`)) || [] });
      }
      if (op === 'img') {
        const name = String(q.name || '');
        if (!NAME_RE.test(name)) return send(res, 400, { error: 'name' });
        const im = await getJson(`slide:img:${id}:${name}`);
        if (!im) return send(res, 404, { error: '없는 그림' });
        res.setHeader('Content-Type', im.type || 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');   // 이름에 내용 해시가 들어 있다
        return res.status(200).send(Buffer.from(im.data, 'base64'));
      }
      return send(res, 400, { error: 'op' });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'GET · POST만' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (op === 'page') {
      if (!rec) return send(res, 404, { error: '없는 덱' });
      if (!(await host())) return send(res, 403, { error: '호스트 암호가 맞지 않다' });
      const n = (rec.deck.pages || []).length;
      const page = Math.max(0, Math.min(Math.max(0, n - 1), parseInt(body.page, 10) || 0));
      const st = { page, t: Date.now() };
      await setJson(`slide:state:${id}`, st);
      return send(res, 200, st);
    }
    if (!(await owner(op === 'deck' || op === 'img'))) return send(res, 403, { error: '주인 열쇠가 맞지 않다' });
    if (op === 'deck') {
      if (!body.deck || !Array.isArray(body.deck.pages)) return send(res, 400, { error: 'deck.pages' });
      const updated = Date.now();
      const hostHash = body.hostHash || (rec && rec.hostHash) || '';
      await setJson(`slide:deck:${id}`, { deck: body.deck, hostHash, updated });
      await setJson(`slide:notes:${id}`, Array.isArray(body.notes) ? body.notes : []);
      const index = ((await getJson('slide:index')) || []).filter((d) => d.id !== id);
      index.unshift({ id, title: String(body.deck.title || id), updated });
      await setJson('slide:index', index.slice(0, 200));
      return send(res, 200, { ok: true, id, updated, pages: body.deck.pages.length });
    }
    if (op === 'img') {
      const name = String(q.name || '');
      if (!NAME_RE.test(name) || !body.data) return send(res, 400, { error: 'name · data' });
      if (body.data.length > 1_300_000) return send(res, 413, { error: '그림이 너무 크다 (1MB 이하로 줄여서)' });
      await setJson(`slide:img:${id}:${name}`, { type: String(body.type || 'image/webp'), data: body.data });
      return send(res, 200, { ok: true, name });
    }
    if (op === 'has') {                                         // 이미 올린 그림은 다시 안 올리게
      const names = (Array.isArray(body.names) ? body.names : []).filter((n) => NAME_RE.test(n)).slice(0, 300);
      const have = [];
      for (const n of names) if (await redis(['EXISTS', `slide:img:${id}:${n}`])) have.push(n);
      return send(res, 200, { have });
    }
    if (op === 'remove') {
      await redis(['DEL', `slide:deck:${id}`, `slide:notes:${id}`, `slide:state:${id}`]);
      const index = ((await getJson('slide:index')) || []).filter((d) => d.id !== id);
      await setJson('slide:index', index);
      return send(res, 200, { ok: true });
    }
    return send(res, 400, { error: 'op' });
  } catch (e) {
    return send(res, e.code || 500, { error: e.code === 503 ? '슬라이드 저장소가 연결되지 않았다' : String(e.message || e) });
  }
}
