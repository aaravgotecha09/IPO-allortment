# IPO Share Allotment System

Full-stack version of the C IPO allotment program.

```
Browser (Vercel, static)  --HTTPS/JSON-->  Node API (Render, Docker)  --stdin/stdout-->  ipo.c (your C code)
```

| Folder | What it is | Deploys to |
|---|---|---|
| `frontend/` | Static HTML, CSS, JS (no build step) | Vercel |
| `backend/` | Express API + the original `c/ipo.c` | Render (Docker) |

`backend/c/ipo.c` is the original program, unchanged. The API starts one copy per browser session, types the menu choices into it and turns the printed output into JSON. `c/unbuf.c` only makes stdout unbuffered so the API can read prompts instantly.

## Run locally

```bash
cd backend
npm install
npm test            # compiles the C code and runs the end-to-end tests
npm run dev         # API on http://localhost:10000
```

Open `frontend/index.html` in a browser (or `npx serve frontend`). On localhost it automatically talks to `http://localhost:10000`.

## Deploy

1. **Push to GitHub** (this whole folder as one repo).
2. **Backend on Render**: New > Blueprint > pick the repo (it reads `render.yaml`). Or New > Web Service > Docker with Dockerfile path `./backend/Dockerfile`, build context `./backend`, health check `/api/health`. Copy the service URL.
3. **Frontend on Vercel**: Import the repo, set **Root Directory** to `frontend`, framework preset **Other**, no build command. Before deploying, put the Render URL in `frontend/config.js` (`API_BASE`) and commit.
4. Optional: on Render set `ALLOWED_ORIGINS` to your Vercel URL to restrict CORS.

The Render free plan sleeps after inactivity, so the first load can take about a minute (the page shows "Waking up server"). Sessions live in memory and are cleared after 15 minutes idle or on restart.

## API

All requests need an `X-Session-Id` header (the frontend creates one).

| Method | Path | Does |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/state` | Current IPO, application count |
| POST | `/api/setup` | `{totalShares, lotSize, quotas:[retail,sNII,bNII,QIB]}` |
| POST | `/api/applications` | `{pan, category 1-4, shares}` |
| GET | `/api/applications` | List applications |
| GET | `/api/search?appNo=N` | Binary search by application number |
| POST | `/api/allot` | Run the allotment |
| GET | `/api/results` | Last allotment result |
| POST | `/api/reset` | Fresh session |

Inputs are validated as whole numbers before they reach the C program, because a non-numeric entry would make its `scanf` menu exit.
