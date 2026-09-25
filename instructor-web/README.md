# instructor-web

The NACOLM CBT instructor portal: sign-in, exam sessions, the new-session wizard, draft review with marking schemes, coverage and freeze, question bank, study material and results. Next.js (App Router) + Tailwind, styled with the NACOLM CBT design system (army green and red, Archivo, tokens in `src/app/globals.css`).

## Run it

```bash
# 1. The API (see ../instructor-api), with a database and at least one user:
cd ../instructor-api
npm install
npx prisma migrate deploy
node scripts/create-user.mjs --service NA/19/4411 --rank Capt --name "O. Nwosu" --role INSTRUCTOR
node scripts/create-user.mjs --service NA/12/2087 --rank Maj --name "A. Bello" --role EXAM_OFFICER
node scripts/seed-demo.mjs        # optional demo course, past years and drafts
npm run start:dev                 # http://localhost:8020

# 2. The portal:
cd ../instructor-web
npm install
npm run dev                       # http://localhost:3000
```

`create-user.mjs` prints a generated password when you leave out `--password`.

## Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `INSTRUCTOR_API_URL` | `http://localhost:8020` | Where `/api/*` is forwarded, and where the portal checks the session. |

The browser only ever talks to this app: `/api/*` is rewritten to instructor-api, so the `nacolm_session` cookie stays first-party and there's no CORS. In production, serve both behind HTTPS and set `NODE_ENV=production` (or `COOKIE_SECURE=true`) on the API so the cookie is `Secure`.

## How it's put together

- `src/proxy.ts` sends anyone without a session cookie to `/login` (an optimistic check). `src/app/(portal)/layout.tsx` does the real check against `GET /auth/me` on every page; the API guard checks every request.
- `src/components/nc/` are the design-system components as typed React. `src/components/shell/` is the header, side menu (desktop) and bottom tabs (below 1024px).
- The marking-scheme "test your scheme" box calls the API's scorer (`POST /question-bank/:id/marking-scheme/test`), the same rules as `local-exam-server/internal/marking/keyword.go`. There's no second copy of the marking rules in the frontend.
- Brand images are in `public/brand/`. The Archivo font file is in `src/app/fonts/` so the portal makes no call to Google Fonts.

## Not connected yet

- **Results.** Candidate submissions arrive when exam centres sync after an exam; that sync isn't built, so real papers show an empty state. "Preview this screen with sample data" shows the design with labelled sample data.
- **Packaging a frozen paper for exam centres** runs in central-api and isn't triggered from the portal yet.
- **Past-paper extraction.** Uploading a past paper stores the file; its questions enter the bank when they're entered and approved (`POST /question-bank`). Study material is indexed for AI drafting by central-api when it's reachable.
- **Difficulty balancing.** The wizard records the easy/moderate/hard split on the blueprint, but generation doesn't balance to it yet.
