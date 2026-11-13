// api/reading.js — 낭독회: 작품(대본 + 비주얼 노벨) 보관 + 페이지 동기화
// ───────────────────────────────────────────────────────────────────────────
// 참여자는 sub-cal.vercel.app/read/<작품> 으로 접속해 진행자가 넘기는 자리를 따라간다 (전체 대본은 따로 볼 수 있음).
// 저장소: 웹 슬라이드와 같은 Upstash Redis (KV_REST_API_URL / KV_REST_API_TOKEN). 비밀값은 코드에 없다.
// 열쇠·암호는 서버에 해시(sha256)만 둔다.
//   주인 열쇠  X-Slide-Key — 웹 슬라이드와 같은 주인 (CastEdit 앱이 작품·그림·소리를 올릴 때)
//   진행 암호  X-Slide-Key — 작품마다. 넘기기 (주인 열쇠도 된다)
//   참여 암호  X-Read-Pass — 작품마다. 대본·장면·그림·소리 읽기 (진행 암호·주인 열쇠도 된다). 그림·소리는 ?k=
// 읽기(GET)   op=list (제목만, 누구나) · op=state (자리만, 누구나) · op=work|ep (참여) · op=img|snd (참여, ?k=)
// 쓰기(POST)  op=page (진행) · op=work|ep|cues|img|snd|has|remove (주인)
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Slide-Key,X-Read-Pass');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const q = req.query || {};
  const op = String(q.op || '');
  const id = String(q.id || '');
  const key = req.headers['x-slide-key'] || '';
  const pass = req.headers['x-read-pass'] || String(q.k || '');
  try {
    if (!globalThis.__slideStore && !env()) {
      return send(res, 503, { error: '낭독회 저장소가 연결되지 않았다 (Vercel Storage → Upstash Redis)' });
    }
    if (op === 'list' && req.method === 'GET') {
      return send(res, 200, { works: (await getJson('read:index')) || [] }, 'public, s-maxage=5, max-age=0');
    }
    if (!ID_RE.test(id)) return send(res, 400, { error: 'id' });
    const rec = await getJson(`read:work:${id}`);
    const owner = async (claim = false) => {
      const h = sha(key);
      if (!key) return false;
      const cur = await redis(['GET', 'slide:owner']);            // 웹 슬라이드와 같은 주인
      if (cur) return cur === h;
      if (!claim) return false;
      await redis(['SETNX', 'slide:owner', h]);
      return (await redis(['GET', 'slide:owner'])) === h;
    };
    const host = async () => !!key && ((rec && rec.hostHash && rec.hostHash === sha(key)) || (await owner()));
    const viewer = async () => {
      if (!rec) return false;
      if (!rec.viewHash) return true;                              // 참여 암호를 안 정한 작품
      if (pass && (rec.viewHash === sha(pass) || (rec.hostHash && rec.hostHash === sha(pass)))) return true;
      return await host();
    };

    if (req.method === 'GET') {
      if (op === 'state') {
        const st = (await getJson(`read:state:${id}`)) || { ep: rec ? (rec.episodes[0] || {}).no || 0 : 0, beat: 0, t: 0 };
        return send(res, 200, st, 'public, s-maxage=1, max-age=0');   // 참여자가 많아도 1초에 한 번만 저장소를 읽는다
      }
      if (!rec) return send(res, 404, { error: '없는 작품' });
      if (!(await viewer())) return send(res, 403, { error: '참여 암호가 맞지 않다', need: 'pass' });
      if (op === 'work') {
        const { viewHash, hostHash, ...pub } = rec;
        return send(res, 200, { id, ...pub, isHost: await host() });
      }
      if (op === 'ep') {
        const no = parseInt(q.no, 10);
        const ep = await getJson(`read:ep:${id}:${no}`);
        if (!ep) return send(res, 404, { error: '없는 회차' });
        return send(res, 200, ep);
      }
      if (op === 'img' || op === 'snd') {
        const name = String(q.name || '');
        if (!NAME_RE.test(name)) return send(res, 400, { error: 'name' });
        const im = await getJson(`read:${op}:${id}:${name}`);
        if (!im) return send(res, 404, { error: '없는 파일' });
        res.setHeader('Content-Type', im.type || (op === 'img' ? 'image/webp' : 'audio/mpeg'));
        res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');   // 이름에 내용 해시가 들어 있다
        return res.status(200).send(Buffer.from(im.data, 'base64'));
      }
      return send(res, 400, { error: 'op' });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'GET · POST만' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (op === 'page') {
      if (!rec) return send(res, 404, { error: '없는 작품' });
      if (!(await host())) return send(res, 403, { error: '진행 암호가 맞지 않다' });
      const nos = (rec.episodes || []).map((e) => e.no);
      const ep = nos.includes(parseInt(body.ep, 10)) ? parseInt(body.ep, 10) : (nos[0] || 0);
      const st = { ep, beat: Math.max(0, parseInt(body.beat, 10) || 0), t: Date.now() };
      await setJson(`read:state:${id}`, st);
      return send(res, 200, st);
    }
    if (!(await owner(op === 'work'))) return send(res, 403, { error: '주인 열쇠가 맞지 않다' });
    if (op === 'work') {
      const w = body.work;
      if (!w || !Array.isArray(w.episodes)) return send(res, 400, { error: 'work.episodes' });
      const updated = Date.now();
      const keep = (k) => (body[k] === undefined ? (rec && rec[k]) || '' : String(body[k] || ''));   // 안 보내면 그대로, ''면 지움
      await setJson(`read:work:${id}`, { ...w, viewHash: keep('viewHash'), hostHash: keep('hostHash'), updated });
      const index = ((await getJson('read:index')) || []).filter((d) => d.id !== id);
      index.unshift({ id, title: String(w.title || id), kind: String(w.kind || ''), episodes: w.episodes.length, updated });
      await setJson('read:index', index.slice(0, 200));
      return send(res, 200, { ok: true, id, updated });
    }
    if (op === 'ep') {
      const no = parseInt(body.no, 10);
      if (!Number.isFinite(no) || !Array.isArray(body.beats)) return send(res, 400, { error: 'no · beats' });
      const s = JSON.stringify(body);
      if (s.length > 4_000_000) return send(res, 413, { error: '회차가 너무 크다' });
      await redis(['SET', `read:ep:${id}:${no}`, s]);
      return send(res, 200, { ok: true, no });
    }
    if (op === 'cues') {                                             // 장면·연출만 바꿈 (본문은 그대로 — 앱 자동 올리기)
      const no = parseInt(body.no, 10);
      const ep = await getJson(`read:ep:${id}:${no}`);
      if (!ep) return send(res, 404, { error: '없는 회차' });
      ep.cues = Array.isArray(body.cues) ? body.cues : [];
      await setJson(`read:ep:${id}:${no}`, ep);
      return send(res, 200, { ok: true, no });
    }
    if (op === 'img' || op === 'snd') {
      const name = String(q.name || '');
      if (!NAME_RE.test(name) || !body.data) return send(res, 400, { error: 'name · data' });
      if (body.data.length > 1_300_000) return send(res, 413, { error: '파일이 너무 크다 (1MB 이하로)' });
      await setJson(`read:${op}:${id}:${name}`, { type: String(body.type || ''), data: body.data });
      return send(res, 200, { ok: true, name });
    }
    if (op === 'has') {                                             // 이미 올린 그림·소리는 다시 안 올리게
      const kind = body.kind === 'snd' ? 'snd' : 'img';
      const names = (Array.isArray(body.names) ? body.names : []).filter((n) => NAME_RE.test(n)).slice(0, 500);
      const have = [];
      for (const n of names) if (await redis(['EXISTS', `read:${kind}:${id}:${n}`])) have.push(n);
      return send(res, 200, { have });
    }
    if (op === 'remove') {                                          // 작품 내리기 (본문이 서버에 남지 않게)
      const keys = [`read:work:${id}`, `read:state:${id}`];
      for (const e of (rec && rec.episodes) || []) keys.push(`read:ep:${id}:${e.no}`);
      for (const n of (rec && rec.files && rec.files.img) || []) keys.push(`read:img:${id}:${n}`);
      for (const n of (rec && rec.files && rec.files.snd) || []) keys.push(`read:snd:${id}:${n}`);
      await redis(['DEL', ...keys]);
      const index = ((await getJson('read:index')) || []).filter((d) => d.id !== id);
      await setJson('read:index', index);
      return send(res, 200, { ok: true });
    }
    return send(res, 400, { error: 'op' });
  } catch (e) {
    return send(res, e.code || 500, { error: e.code === 503 ? '낭독회 저장소가 연결되지 않았다' : String(e.message || e) });
  }
}
