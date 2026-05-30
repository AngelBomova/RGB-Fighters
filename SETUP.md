# RGB Fighters - Setup Guide

## Backend Setup

1. Navigate to the server directory:
   ```bash
   cd server
   npm install
   ```

2. Create a `.env` file (copy from `.env.example`):
   ```
   PORT=3001
   DATABASE_URL=postgresql://user:password@localhost:5432/rgb_fighters
   JWT_SECRET=your-secret-key-change-this
   FRONTEND_URL=http://localhost:5173
   ```

3. **PostgreSQL Setup** (local development):
   - Install PostgreSQL
   - Create database: `createdb rgb_fighters`
   - Run migrations when server starts (auto-runs on first startup)

4. Start the server:
   ```bash
   node index.js
   ```
   Expected output: `✓ Database initialized` and `RGB Fighters server running on port 3001`

## Frontend Setup

1. In the root directory, install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file:
   ```
   VITE_API_BASE=http://localhost:3001/api
   VITE_SOCKET_URL=http://localhost:3001
   ```

3. Start dev server:
   ```bash
   npm run dev
   ```
   Open http://localhost:5173

## Testing Flow

1. Register two accounts in different browser tabs/windows
2. Go to home screen → see leaderboards with Top 10 by ELO and Top 10 by Wins
3. Try "1v1 Online" mode:
   - Choose a side (left/right/random)
   - Wait in queue
   - When matched, you'll see opponent's name, ELO, wins
   - Character select screen appears with 20-second timer
   - Both select → game starts
4. Complete a match → check leaderboard to see updated ELO
5. Test AI difficulties in Single Player mode

## ELO System

- Win 2-0: +20 ELO
- Win 2-1: +10 ELO
- Lose 1-2: -10 ELO
- Lose 0-2: -20 ELO
- Minimum ELO: 0

## For Cloud Deployment (Render/Railway)

Set environment variables:
- `DATABASE_URL` → your PostgreSQL connection string
- `JWT_SECRET` → strong random secret
- `FRONTEND_URL` → your frontend domain
- `PORT` → usually auto-set by platform

Deploy frontend separately to Vercel/Netlify, pointing to your backend URL.
