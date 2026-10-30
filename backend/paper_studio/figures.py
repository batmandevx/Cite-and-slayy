"""Paper figures drawn from data we actually fetched (never from model output). PNG bytes, publication style."""
from __future__ import annotations

import io
from collections import Counter
from datetime import date

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

# Categorical order (fixed, never cycled); validated for CVD separation on white.
SERIES = ["#2a6fdb", "#e0682b", "#1f9e6e", "#9b4fd1"]
INK, MUTED, GRID = "#1d1d1f", "#6b6b70", "#e6e6ea"


def _style(ax, title: str, xlabel: str, ylabel: str) -> None:
    ax.set_title(title, fontsize=11, color=INK, loc="left", pad=10, fontweight="bold")
    ax.set_xlabel(xlabel, fontsize=9, color=MUTED)
    ax.set_ylabel(ylabel, fontsize=9, color=MUTED)
    ax.tick_params(colors=MUTED, labelsize=8, length=0)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(GRID)


def _png(fig) -> bytes:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=200, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return buf.getvalue()


def trend_chart(series: dict[str, dict[int, int]]) -> bytes:
    """Yearly publication counts per phrase. The current (partial) year is drawn hollow and labelled."""
    this_year = date.today().year
    fig, ax = plt.subplots(figsize=(6.4, 3.4))
    for k, (name, counts) in enumerate(series.items()):
        ys = sorted(y for y in counts if y <= this_year)
        full = [y for y in ys if y < this_year]
        c = SERIES[k % len(SERIES)]
        ax.plot(full, [counts[y] for y in full], color=c, linewidth=2, marker="o", markersize=4, label=name)
        if this_year in counts and full:
            ax.plot([full[-1], this_year], [counts[full[-1]], counts[this_year]], color=c, linewidth=1.5, linestyle="--")
            ax.plot([this_year], [counts[this_year]], marker="o", markersize=6, markerfacecolor="white", markeredgecolor=c)
    _style(ax, "Publications per year", "Year", "Works (title/abstract match)")
    ax.legend(frameon=False, fontsize=8, loc="upper left")
    ax.annotate(f"{this_year}: partial year", xy=(1, 0), xycoords="axes fraction", ha="right", va="bottom",
                fontsize=7, color=MUTED, xytext=(0, 4), textcoords="offset points")
    return _png(fig)


def reference_years_chart(years: list[int]) -> bytes:
    cnt = Counter(y for y in years if y)
    xs = sorted(cnt)
    fig, ax = plt.subplots(figsize=(6.4, 2.8))
    ax.bar(xs, [cnt[x] for x in xs], color=SERIES[0], width=0.7)
    _style(ax, "Cited works by publication year", "Year", "Cited works")
    ax.set_xticks(xs)
    ax.tick_params(axis="x", rotation=45)
    return _png(fig)


def citation_impact_chart(items: list[tuple[str, int]]) -> bytes:
    """Horizontal bars: citation counts of the most-cited works in the reference list (labels = [n])."""
    items = sorted(items, key=lambda t: t[1])[-10:]
    fig, ax = plt.subplots(figsize=(6.4, 0.32 * len(items) + 0.9))
    ax.barh([t[0] for t in items], [t[1] for t in items], color=SERIES[2], height=0.6)
    for y, (_, v) in enumerate(items):
        ax.text(v, y, f" {v:,}", va="center", fontsize=7, color=INK)
    _style(ax, "Most-cited works in this paper's references", "Citations (OpenAlex)", "")
    ax.grid(axis="x", color=GRID, linewidth=0.8)
    ax.grid(axis="y", visible=False)
    return _png(fig)
