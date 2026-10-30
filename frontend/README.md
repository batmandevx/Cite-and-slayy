# Cite and Slayy frontend

Next.js 16 (App Router) + Tailwind CSS 4 + ECharts. It's a single dashboard (`app/page.tsx` → `components/Dashboard.tsx`) with one component per tab.

```bash
npm install
npm run dev        # http://localhost:3000, expects the backend on http://localhost:8000
```

Set `NEXT_PUBLIC_API_URL` (see `.env.example`) if the backend runs elsewhere. The types in `lib/types.ts` mirror `backend/common/schemas.py`.

Chart colours come from a validated palette: the first three categorical slots pass the colour-vision-deficiency (CVD) and contrast checks in both themes. "Unclassified" is drawn hollow, so colour is never the only cue. See `components/charts.tsx`.
