import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const TTL_SECONDS = 60 * 60 * 24 * 7; // rooms auto-expire after 7 days of inactivity
const ROOM_ID_RE = /^[A-Z0-9_-]{3,32}$/;

function roomKey(id) {
  return 'canopy:room:' + id;
}

function freshState() {
  return {
    board: new Array(30 * 20).fill(null),
    blocks: [],
    scores: { blue: 0, red: 0 },
    currentPlayer: 'blue',
    movesRemaining: 1,
    gameOver: false,
    winner: null,
    lastMoveCells: [],
  };
}

function freshRecord() {
  return {
    version: 1,
    blueClientId: null,
    redClientId: null,
    state: freshState(),
  };
}

async function readRoom(key) {
  const raw = await redis.get(key);
  if (raw === null || raw === undefined) return null;
  // @upstash/redis may hand back an already-parsed object or a raw string
  // depending on SDK version, so handle both.
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function writeRoom(key, record) {
  await redis.set(key, JSON.stringify(record), { ex: TTL_SECONDS });
}

// A plain read-then-write against Redis is not atomic: two requests can both
// read the same version before either writes, and both would then believe
// their update is valid. Wrap the read-modify-write critical sections in a
// short-lived NX lock so only one request at a time can act on a given room.
async function withLock(key, fn) {
  const lockKey = key + ':lock';
  const acquired = await redis.set(lockKey, '1', { nx: true, ex: 5 });
  if (!acquired) {
    const err = new Error('locked');
    err.busy = true;
    throw err;
  }
  try {
    return await fn();
  } finally {
    await redis.del(lockKey).catch(() => {});
  }
}

export default async function handler(req, res) {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return res.status(500).json({
      error: 'Server is missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN. See README.md.',
    });
  }

  try {
    if (req.method === 'GET') {
      const id = normalizeId(req.query.id);
      if (!id) return res.status(400).json({ error: 'missing or invalid room id' });
      const record = await readRoom(roomKey(id));
      if (!record) return res.status(200).json({ exists: false });
      return res.status(200).json({ exists: true, ...record });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const id = normalizeId(body.id);
      if (!id) return res.status(400).json({ error: 'missing or invalid room id' });
      const key = roomKey(id);

      if (body.action === 'create') {
        const existing = await readRoom(key);
        if (existing) return res.status(200).json({ exists: true, ...existing });
        const record = freshRecord();
        await writeRoom(key, record);
        return res.status(200).json({ exists: true, ...record });
      }

      const record = await readRoom(key);
      if (!record) return res.status(404).json({ error: 'room not found' });

      if (body.action === 'claim') {
        const color = body.color;
        const clientId = String(body.clientId || '');
        if ((color !== 'blue' && color !== 'red') || !clientId) {
          return res.status(400).json({ error: 'bad claim request' });
        }
        try {
          const result = await withLock(key, async () => {
            const fresh = await readRoom(key);
            if (!fresh) return null;
            const field = color === 'blue' ? 'blueClientId' : 'redClientId';
            if (!fresh[field] || fresh[field] === clientId) {
              fresh[field] = clientId;
              await writeRoom(key, fresh);
              return { ...fresh, claimed: true };
            }
            return { ...fresh, claimed: false };
          });
          if (!result) return res.status(404).json({ error: 'room not found' });
          return res.status(200).json({ exists: true, ...result });
        } catch (err) {
          if (err && err.busy) return res.status(200).json({ exists: true, busy: true });
          throw err;
        }
      }

      if (body.action === 'update') {
        if (!body.state || typeof body.state !== 'object' || typeof body.expectedVersion !== 'number') {
          return res.status(400).json({ error: 'missing state or expectedVersion' });
        }
        try {
          const result = await withLock(key, async () => {
            const fresh = await readRoom(key);
            if (!fresh) return null;
            if (body.expectedVersion !== fresh.version) {
              return { ...fresh, conflict: true };
            }
            fresh.state = body.state;
            fresh.version += 1;
            await writeRoom(key, fresh);
            return { ...fresh, conflict: false };
          });
          if (!result) return res.status(404).json({ error: 'room not found' });
          return res.status(200).json({ exists: true, ...result });
        } catch (err) {
          if (err && err.busy) return res.status(200).json({ exists: true, busy: true });
          throw err;
        }
      }

      return res.status(400).json({ error: 'unknown action' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
}

function normalizeId(raw) {
  const id = String(raw || '').trim().toUpperCase();
  return ROOM_ID_RE.test(id) ? id : null;
}
