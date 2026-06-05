Quick deploy guide (low-cost)
=============================

Overview
--------
This project separates frontend (Vite + React) and backend (Node + Socket.IO). For a low-cost production deploy that supports online 1v1 matches and leaderboards, I recommend:

- Frontend: Vercel (Hobby) — free for most hobby sites
- Backend: Render (Starter) or Fly.io — free/cheap single instance
- Database: Supabase Postgres free tier

Env variables
-------------
- `DATABASE_URL` — Postgres connection string (Supabase)
- `JWT_SECRET` — strong random secret
- `FRONTEND_URL` — e.g. https://your-site.vercel.app

Server Docker
-------------
Build server image and deploy on Render/Fly. A `server/Dockerfile` is included.

Steps (outline)
---------------
1. Create a Supabase project and get the Postgres `DATABASE_URL`.
2. Set `JWT_SECRET` to a long random value.
3. Deploy frontend to Vercel (connect Git repo).
4. Deploy server to Render or Fly and set the env vars.

Notes
-----
- For scaling across multiple server instances you'll need a Redis adapter for Socket.IO. That's optional and only needed if you run more than one socket server.
- Keep `USE_SQLITE=1` only for local dev.
