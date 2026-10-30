# Cite and Slayy: 3-minute demo script

> **Cite it right. Slay the review.**

**Flow:** pick a field → Gap Radar → choose a gap → open the cached AutoClaw draft → CiteGuard on the draft **and** on a retracted paper → Jury verdict with fixes.

## Before you go on stage (10 minutes earlier)

1. AI setup:
   - Either put an API key in `.env`, **or** keep `ollama serve` running with `qwen3.5:9b` pulled (free, offline).
   - Add `CONTACT_EMAIL` and `S2_API_KEY` if you can, and keep `DEMO_MODE=true`.
2. On a good connection, run `uv run python scripts/slayy_cli.py warm`. It pre-fetches every API response the demo uses and stores real results.
3. Start the app with `./scripts/dev.sh` and open <http://localhost:3000>. That's the landing page: start the demo there, then click **Open the app**.
4. Check the header chips:
   - **LLM** is green.
   - **Demo mode** is shown.
5. Do one dry run of the flow below.
6. Keep two browser tabs ready as fallbacks. These deep links open the stored results instantly:
   - `/?tab=explore` (then pick "parameter-efficient fine-tuning" under *Previous scans*)
   - `/?tab=audit` (then pick a sample paper)
7. Theme: use light mode on projectors, which reads better. The toggle is top right.

## Script

| Time | Screen | Do | Say |
|---|---|---|---|
| 0:00–0:20 | Header | Point at the four steps. | "AutoResearchClaw can write a paper from one sentence. That's the problem: it makes it cheap to produce papers nobody should write, can't trust, or that aren't ready. Cite and Slayy is the decision layer around it. Four steps, each one a question." |
| 0:20–0:55 | **1 · Explore gaps** | Field: *parameter-efficient fine-tuning* → **Scan field**, or pick it from *Previous scans* if time is short. | "We pull ~800 recent papers from OpenAlex and arXiv, embed them and cluster them. Each bubble is a sub-topic: x is growth, y is citations per year, size is volume. Dashed lines are this field's own medians, so the thresholds aren't magic numbers." |
| | | Hover an **Underexplored** bubble, click it. Point at the *Why* line. | "Underexplored means a small cluster that gets more citations than the field median: attention without volume. Here's exactly which rule fired." |
| 0:55–1:15 | Cluster panel | **Generate 3 questions** → point at the evidence links → **Send to AutoClaw** | "The LLM may only cite papers we handed it. If it invents one, we drop the question and say so. One click sends the question to AutoClaw." |
| 1:15–1:35 | **2 · Draft** | **Replay demo run**. The stages tick through. Point at *Provenance*. | "AutoResearchClaw runs its 23-stage pipeline. Live, that takes about an hour, so for the demo we replay a real paper from AutoClaw's own public showcase, and the UI says so." → **Audit this draft with CiteGuard** |
| 1:35–2:05 | **3 · Audit** (GARD) | **Run CiteGuard** (fast from cache). Show the score card, then **References** (all verified), then expand one row to show the evidence and *API response* link. | "Every reference was checked against Crossref, Semantic Scholar and OpenAlex. Each verdict links the exact API response. If an API fails, we say 'could not verify', never 'verified'. AutoClaw's own references check out." |
| 2:05–2:30 | **3 · Audit** (bad paper) | Pick the sample **First Principle Simulation… Hydroxychloroquine** → Run. Red banner: *1 cited work retracted*. Filter **Flagged** → row **[6]** → expand. | "CiteGuard works on any paper. This COVID preprint cites the Gautret hydroxychloroquine study. Crossref, with Retraction Watch data, lists it as retracted, and here is the notice DOI. Notice that a preprint version with the same title isn't retracted. We check every version, so it can't hide." |
| | (optional, 10 s) | Pick **Environmental and Geographical (EG)…** → Run | "And this paper has itself been retracted. Score zero." |
| 2:30–2:55 | **4 · Verdict** | **Convene the jury**. Show the verdict banner, the *Reasoning*, the ranked fix #1 (blocking), the persona cards and the venues. | "Four reviewer personas score methods, novelty, clarity and reproducibility. The verdict is rule-based and shows which rule fired. Any retracted citation forces at least *Revise*, and the fix list puts it first. Below are the venues where the closest real papers were published." |
| 2:55–3:00 | Header **⚡ Slay it** | Press **S**, choose the HCQ paper, then **Slay it**. It finishes instantly from cache → **Open verdict** → **Report** downloads the Markdown. | "And the whole thing is one click: draft, audit, verdict, with a report you can hand to a supervisor. Cite it right, slay the review." |

## If something goes wrong

- **API is slow or rate-limited:** use the stored results. Every tab keeps its last result, and *Previous scans* / sample papers load instantly.
- **Local model is slow:** run the flow once beforehand. All LLM responses are cached, so the live run is instant.
- **No LLM:**
  - the verdict still works on CiteGuard alone, and can be at best *Revise*;
  - research questions need the LLM, so skip that line and type a topic in Draft.
- **Backend offline badge:** restart with `uv run uvicorn backend.app.main:app --port 8000`.
