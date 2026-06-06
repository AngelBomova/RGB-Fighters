# RGB Fighters

RGB Fighters is a React + Vite fighting game with local modes and an online 1v1 mode powered by a Node/Express + Socket.IO backend.

## Requirements

- Node.js 20 or newer recommended
- npm
- Nginx only for Ubuntu production deployment
- PM2 only for keeping the production backend online

## Local Setup

Install everything from the project root:

```bash
npm install
```

Start the full local app:

```bash
npm run dev
```

This starts both:

- Vite frontend on `http://localhost:5173`
- Node online server on `http://localhost:3001`

If Vite uses another port like `5174`, that is okay.

## Useful Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start frontend and backend together |
| `npm run client` | Start only the Vite frontend |
| `npm run server` | Start only the Node online server |
| `npm run build` | Build the production frontend into `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint |

## Environment Variables

For local development, the app can run without a `.env` file.

Optional root `.env` values:

```env
PORT=3001
USE_SQLITE=1
JWT_SECRET=change-this-secret
FRONTEND_URL=http://localhost:5173
VITE_API_BASE=http://localhost:3001/api
VITE_SOCKET_URL=http://localhost:3001
```

Important notes:

- `USE_SQLITE=1` is the easiest local/cheap-server setup.
- If `DATABASE_URL` is set, the server will try to use Postgres.
- If no API URL is set in the frontend build, the browser uses the same origin as the website.
- `dotenv` must be installed in root dependencies because `server/index.js` imports it. If the backend crashes with `Cannot find package 'dotenv'`, run `npm install` or `npm install dotenv`.

## Online 1v1 Health Check

The backend exposes:

```bash
curl http://127.0.0.1:3001/api/health
```

Expected response:

```json
{"ok":true}
```

If this fails, online 1v1, login, signup, matchmaking, and leaderboards will not work.

## Ubuntu + Nginx Deployment

Example Nginx config:

```nginx
server {
    listen 80;
    server_name _;

    root /var/www/rgbfighters;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3001/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Production deploy script:

```bash
cd ~/RGB-Fighters
git pull
npm install
npm run build

sudo rm -rf /var/www/rgbfighters/*
sudo cp -r dist/* /var/www/rgbfighters/

USE_SQLITE=1 pm2 describe rgb-server >/dev/null 2>&1 \
  && USE_SQLITE=1 pm2 restart rgb-server --update-env \
  || USE_SQLITE=1 pm2 start server/index.js --name rgb-server --update-env

pm2 save

sudo nginx -t
sudo systemctl reload nginx

curl http://127.0.0.1:3001/api/health
curl http://YOUR_SERVER_IP/api/health
```

Both curl commands should return:

```json
{"ok":true}
```

Replace `YOUR_SERVER_IP` with your droplet IP.

## PM2 Setup

Install PM2 once on the Ubuntu server:

```bash
npm install -g pm2
pm2 startup
```

After starting `rgb-server`, save it:

```bash
pm2 save
```

Useful PM2 commands:

```bash
pm2 status
pm2 logs rgb-server --lines 80
pm2 restart rgb-server --update-env
pm2 delete rgb-server
```

## Common Production Errors

### Browser shows `Request failed` and Network tab shows `502 Bad Gateway`

Nginx is running, but the Node backend is not reachable.

Check:

```bash
curl http://127.0.0.1:3001/api/health
pm2 status
pm2 logs rgb-server --lines 80
```

Fix:

```bash
cd ~/RGB-Fighters
npm install
USE_SQLITE=1 pm2 restart rgb-server --update-env
```

### `Cannot find package 'dotenv'`

The backend cannot start because the dependency is missing.

Fix:

```bash
cd ~/RGB-Fighters
npm install
```

Emergency fix:

```bash
npm install dotenv
USE_SQLITE=1 pm2 restart rgb-server --update-env
```

Then test:

```bash
curl http://127.0.0.1:3001/api/health
```

### PM2 says `online`, but health check fails

The process may be starting and immediately crashing.

Run:

```bash
pm2 logs rgb-server --lines 80
node server/index.js
```

The direct `node server/index.js` command prints the real crash reason.

### `git pull` says files would be overwritten

The server has local file changes. Commit, stash, or reset them before pulling.

Safe option:

```bash
git status
git stash
git pull
```

## Online 1v1 Notes

- Online 1v1 requires the backend to be running.
- `/api/` must proxy to port `3001`.
- `/socket.io/` must proxy to port `3001` with WebSocket upgrade headers.
- Disconnecting, reloading, or leaving an active online match counts as a loss.
- Not choosing a fighter during character select counts as a loss. If both players do not choose, both receive losses.

## Windows Development

PowerShell sometimes blocks `npm.ps1`. If that happens, use:

```powershell
npm.cmd install
npm.cmd run dev
```
