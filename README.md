# Canopy — online

This is the [Canopy](./index.html) board game with online multiplayer added, ready to
deploy on [Vercel](https://vercel.com). Two players on two different computers can open
a shared room link and play against each other; moves sync automatically every ~1.5s.

It also still has the original **Two players (local hotseat)** and **Computer** (bot,
with Easy/Medium/Hard difficulty) modes — online play is a third option, not a
replacement.

## Why this isn't just a single HTML file

A static page can't sync state between two different people's browsers on its own —
something has to sit in the middle and hold the shared game state. This project adds
the smallest version of that:

- `index.html` — the game itself, unchanged except for a networking layer bolted on.
- `api/room.js` — one small serverless function that creates rooms, lets each player
  claim a color, and relays move updates.
- A Redis database (via [Upstash](https://upstash.com), free tier is plenty) that
  `api/room.js` uses to store each room's state between requests.

The server does **not** re-validate the rules — it trusts whatever state the active
player's browser sends (the same rules engine that already runs the local/bot modes).
That's the right tradeoff for playing with friends; it would not be appropriate for a
competitive product where players don't trust each other.

## 1. Create a free Redis database

1. Go to [upstash.com](https://upstash.com) and sign up (free).
2. Create a new **Redis** database. Any region close to where you and your friends are
   is fine.
3. On the database's page, find the **REST API** section and copy:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

(Vercel used to offer this as a built-in "Vercel KV" product; that's been retired in
favor of the Marketplace, which is powered by Upstash under the hood. Going directly to
Upstash sidesteps whatever the Marketplace UI looks like by the time you read this —
the two environment variable names below are all that matters.)

## 2. Deploy to Vercel

**Option A — via the Vercel dashboard (no terminal needed):**
1. Push this folder to a new GitHub repo (or use Vercel's "Deploy" button flow if you
   have one set up).
2. In Vercel, "Add New Project" → import that repo.
3. Before the first deploy finishes, open **Project Settings → Environment Variables**
   and add:
   - `UPSTASH_REDIS_REST_URL` = (the value you copied above)
   - `UPSTASH_REDIS_REST_TOKEN` = (the value you copied above)
4. Deploy (or redeploy, if it already deployed once before you added the variables).

**Option B — via the CLI:**
```bash
npm install -g vercel   # if you don't have it already
cd canopy-online
vercel                  # follow the prompts to create/link a project
vercel env add UPSTASH_REDIS_REST_URL production
vercel env add UPSTASH_REDIS_REST_TOKEN production
vercel --prod
```

Either way, once deployed you'll get a URL like `https://your-project.vercel.app`.

## 3. Play

1. Open your deployed URL.
2. Under **Opponent**, choose **Online (play a friend)**.
3. Leave the room code blank and click **Join / Create** — this makes a new room and
   updates your address bar with a `?room=XXXXX` link.
4. Click **Copy link** and send it to your friend.
5. Each of you clicks **Play Blue** / **Play Red**. Once both are claimed, play as
   normal — placements sync automatically.
6. **New game** resets the shared room for both of you. **Undo** is disabled in online
   mode, since rewriting a move your opponent already saw wouldn't make sense.

Rooms are stored for 7 days of inactivity and then expire automatically — nothing to
clean up manually.

## Notes / limitations

- No spectator chat, no move history log, no reconnection notifications beyond the
  status line — this is intentionally minimal.
- If your friend's move and yours land at the exact same instant, one of you will see
  "the board just changed, try again" — this is expected and rare in a turn-based game;
  just retry.
- The Redis credentials only ever touch the server-side function (`api/room.js`), never
  the browser, so nothing sensitive is exposed to players.
