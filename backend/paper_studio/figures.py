"""Paper figures drawn strictly from real fetched scholarly data (never from model output). 300 DPI publication style."""
from __future__ import annotations

import io
import statistics
from collections import Counter
from datetime import date

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

# Color-vision-deficiency-safe academic palette (Okabe-Ito / IEEE print friendly)
SERIES = ["#1d4ed8", "#d95f02", "#0f766e", "#7c3aed"]
INK, MUTED, GRID, SOFT = "#111827", "#4b5563", "#e5e7eb", "#eff6ff"

_RC = {
    "font.family": "serif",
    "font.serif": ["DejaVu Serif", "Times New Roman", "Georgia", "serif"],
    "axes.edgecolor": "#cbd5e1",
    "axes.linewidth": 0.8,
}


def _style(ax, title: str, xlabel: str, ylabel: str) -> None:
    ax.set_title(title, fontsize=10.5, color=INK, loc="left", pad=10, fontweight="bold")
    ax.set_xlabel(xlabel, fontsize=9, color=INK, labelpad=5)
    ax.set_ylabel(ylabel, fontsize=9, color=INK, labelpad=5)
    ax.tick_params(colors=MUTED, labelsize=8, length=3, color="#cbd5e1")
    ax.grid(axis="y", color=GRID, linewidth=0.7, linestyle="--", alpha=0.85)
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)


def _png(fig) -> bytes:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=300, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return buf.getvalue()


def trend_chart(series: dict[str, dict[int, int]]) -> bytes:
    """Yearly publication counts per phrase. Current (partial) year is drawn hollow and explicitly annotated."""
    this_year = date.today().year
    with matplotlib.rc_context(_RC):
        fig, ax = plt.subplots(figsize=(4.6, 3.0))
        for k, (name, counts) in enumerate(series.items()):
            ys = sorted(y for y in counts if y <= this_year)
            full = [y for y in ys if y < this_year]
            c = SERIES[k % len(SERIES)]
            if full:
                vals = [counts[y] for y in full]
                ax.plot(full, vals, color=c, linewidth=2.1, marker="o", markersize=4.5, label=name)
                if k == 0:
                    ax.fill_between(full, vals, color=c, alpha=0.08)
            if this_year in counts and full:
                ax.plot([full[-1], this_year], [counts[full[-1]], counts[this_year]], color=c, linewidth=1.4, linestyle=":")
                ax.plot([this_year], [counts[this_year]], marker="o", markersize=6,
                        markerfacecolor="white", markeredgewidth=1.6, markeredgecolor=c)
        _style(ax, "Longitudinal Publication Trajectory (OpenAlex)", "Publication Year", "Indexed Works (Title / Abstract)")
        if series:
            ax.legend(frameon=True, facecolor="white", edgecolor=GRID, fontsize=8, loc="upper left")
        ax.annotate(f"Hollow marker = {this_year} (partial year)", xy=(1, 0), xycoords="axes fraction",
                    ha="right", va="bottom", fontsize=7.2, color=MUTED, xytext=(0, 4), textcoords="offset points")
        return _png(fig)


def reference_years_chart(years: list[int]) -> bytes:
    cnt = Counter(y for y in years if y)
    xs = sorted(cnt)
    with matplotlib.rc_context(_RC):
        fig, ax = plt.subplots(figsize=(4.6, 2.6))
        if xs:
            bars = ax.bar(xs, [cnt[x] for x in xs], color=SERIES[0], width=0.68, edgecolor="#1e3a8a", linewidth=0.5, alpha=0.9)
            for b in bars:
                h = b.get_height()
                if h > 0:
                    ax.text(b.get_x() + b.get_width() / 2, h + 0.08, f"{int(h)}", ha="center", va="bottom", fontsize=7.2, color=INK)
            med = statistics.median([y for y in years if y])
            ax.axvline(med, color=SERIES[1], linestyle="--", linewidth=1.2, label=f"Median year ({int(med)})")
            ax.legend(frameon=True, facecolor="white", edgecolor=GRID, fontsize=7.8, loc="upper left")
            ax.set_xticks(xs)
            ax.tick_params(axis="x", rotation=40)
        _style(ax, "Temporal Distribution of Cited Literature", "Publication Year", "Number of Cited Works")
        return _png(fig)


def citation_impact_chart(items: list[tuple[str, int]]) -> bytes:
    """Horizontal bars: citation counts of the most-cited works in the reference list (labels = [n])."""
    items = sorted(items, key=lambda t: t[1])[-12:]
    with matplotlib.rc_context(_RC):
        fig, ax = plt.subplots(figsize=(4.6, max(2.2, 0.30 * len(items) + 0.9)))
        if items:
            max_v = max((t[1] for t in items), default=1) or 1
            ax.barh([t[0] for t in items], [t[1] for t in items], color=SERIES[2], height=0.62, edgecolor="#115e59", linewidth=0.5, alpha=0.92)
            for y, (_, v) in enumerate(items):
                ax.text(v + max_v * 0.012, y, f"{v:,}", va="center", fontsize=7.5, color=INK)
            ax.set_xlim(0, max_v * 1.16)
        _style(ax, "Citation Impact of Anchoring References", "Citations Indexed in OpenAlex", "Reference")
        ax.grid(axis="x", color=GRID, linewidth=0.7, linestyle="--", alpha=0.85)
        ax.grid(axis="y", visible=False)
        return _png(fig)


def venues_chart(venues: list[tuple[str, int]]) -> bytes:
    """Horizontal bars: top peer-reviewed journals & conferences in the retrieved candidate corpus."""
    import textwrap
    rows = [("\n".join(textwrap.wrap(v, 30, max_lines=2, placeholder="…")), n) for v, n in venues[:8] if v and n > 0]
    rows.reverse()  # highest at top
    with matplotlib.rc_context(_RC):
        fig, ax = plt.subplots(figsize=(4.6, max(2.4, 0.42 * len(rows) + 0.9)))
        if rows:
            max_v = max((r[1] for r in rows), default=1) or 1
            ax.barh([r[0] for r in rows], [r[1] for r in rows], color=SERIES[3], height=0.6, edgecolor="#5b21b6", linewidth=0.5, alpha=0.9)
            for y, (_, v) in enumerate(rows):
                ax.text(v + max_v * 0.015, y, f"{v}", va="center", fontsize=7.5, color=INK)
            ax.set_xlim(0, max_v * 1.15)
        _style(ax, "Primary Publication Venues in Retrieved Corpus", "Works in Candidate Pool (OpenAlex)", "")
        ax.grid(axis="x", color=GRID, linewidth=0.7, linestyle="--", alpha=0.85)
        ax.grid(axis="y", visible=False)
        return _png(fig)
