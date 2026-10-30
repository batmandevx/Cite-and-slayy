"use client";

import { lazy, Suspense } from "react";
import type { Cluster, GapClass, GapRadarResult } from "@/lib/types";
import { useTheme } from "./theme";

const LazyECharts = lazy(() => import("echarts-for-react"));

export function ReactECharts(props: React.ComponentProps<typeof LazyECharts>) {
  return (
    <Suspense fallback={<div className="shimmer rounded-xl" style={{ height: (props.style as { height?: number })?.height ?? 300 }} />}>
      <LazyECharts {...props} />
    </Suspense>
  );
}

// Validated (dataviz validator, --pairs all, both modes): slots 1-3 of the reference categorical palette.
// "Unclassified" is drawn hollow (outline only) so it is never separated by hue alone.
export const CLASS_COLORS: Record<"light" | "dark", Record<GapClass, string>> = {
  light: { underexplored: "#2a78d6", rising: "#eb6834", saturated: "#1baf7a", unclassified: "#898781" },
  dark: { underexplored: "#3987e5", rising: "#d95926", saturated: "#199e70", unclassified: "#898781" },
};
export const CLASS_LABEL: Record<GapClass, string> = {
  underexplored: "Underexplored", rising: "Rising", saturated: "Saturated", unclassified: "Unclassified",
};
const ORDER: GapClass[] = ["underexplored", "rising", "saturated", "unclassified"];

export function chrome(theme: "light" | "dark") {
  return theme === "dark"
    ? { surface: "#1e1b17", ink: "#fff5e6", ink2: "#d9cfbf", muted: "#9a8f7f", grid: "rgba(255,245,230,0.12)", axis: "#fff5e6", ring: "#1e1b17" }
    : { surface: "#ffffff", ink: "#121212", ink2: "#3b3833", muted: "#7c7468", grid: "rgba(18,18,18,0.10)", axis: "#121212", ring: "#ffffff" };
}

export function tooltipBase(c: ReturnType<typeof chrome>) {
  return {
    backgroundColor: c.surface, borderColor: c.axis, borderWidth: 2, padding: [8, 10],
    textStyle: { color: c.ink, fontSize: 12 }, extraCssText: "border-radius:12px;box-shadow:4px 4px 0 #121212;",
  };
}

const short = (s: string, n = 26) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function BubbleChart({ run, selected, onSelect }: { run: GapRadarResult; selected: number | null; onSelect: (id: number) => void }) {
  const { theme } = useTheme();
  const c = chrome(theme);
  const colors = CLASS_COLORS[theme];
  const maxSize = Math.max(1, ...run.clusters.map((k) => k.size));
  const series = ORDER.filter((cls) => run.clusters.some((k) => k.classification === cls)).map((cls) => {
    const hollow = cls === "unclassified";
    return {
      name: CLASS_LABEL[cls],
      type: "scatter",
      data: run.clusters
        .filter((k) => k.classification === cls)
        .map((k) => ({
          value: [+(k.growth * 100).toFixed(1), k.cites_per_year, k.size],
          name: k.label,
          cluster: k,
          itemStyle: k.cluster_id === selected ? { borderColor: c.ink, borderWidth: 3 } : undefined,
        })),
      symbolSize: (v: number[]) => 14 + 46 * Math.sqrt(v[2] / maxSize),
      itemStyle: hollow
        ? { color: "transparent", borderColor: colors[cls], borderWidth: 2, borderType: "dashed" }
        : { color: colors[cls], opacity: 0.88, borderColor: c.ring, borderWidth: 2 },
      label: {
        show: true, position: "right", distance: 6, color: c.ink2, fontSize: 11,
        formatter: (p: { data: { cluster: Cluster } }) => short(p.data.cluster.label),
      },
      labelLayout: { hideOverlap: true },
      emphasis: { focus: "self", scale: 1.06, label: { color: c.ink, fontWeight: 600 } },
    };
  });
  const base = run.field_baseline;
  const option = {
    animationDuration: 600,
    grid: { left: 56, right: 150, top: 36, bottom: 48, containLabel: false },
    legend: {
      top: 0, left: 0, itemWidth: 10, itemHeight: 10, icon: "circle",
      textStyle: { color: c.ink2, fontSize: 12 }, data: series.map((s) => s.name),
    },
    tooltip: {
      ...tooltipBase(c), trigger: "item",
      formatter: (p: { data: { cluster: Cluster } }) => {
        const k = p.data.cluster;
        return `<div style="max-width:280px;white-space:normal"><b>${k.label}</b><br/>
          <span style="color:${c.ink2}">${CLASS_LABEL[k.classification]} · ${k.size} papers</span><br/>
          Growth (CAGR): <b>${(k.growth * 100).toFixed(0)}%</b><br/>
          Citations / yr (mean): <b>${k.cites_per_year.toFixed(1)}</b><br/>
          Last 12 months: <b>${(k.recency_share * 100).toFixed(0)}%</b></div>`;
      },
    },
    xAxis: {
      name: "Growth (CAGR, %)", nameLocation: "middle", nameGap: 30, nameTextStyle: { color: c.muted, fontSize: 11 },
      axisLine: { lineStyle: { color: c.axis } }, axisLabel: { color: c.muted, fontSize: 11 },
      splitLine: { lineStyle: { color: c.grid } },
    },
    yAxis: {
      name: "Citations / year (mean)", nameLocation: "middle", nameGap: 40, nameTextStyle: { color: c.muted, fontSize: 11 },
      axisLine: { show: false }, axisLabel: { color: c.muted, fontSize: 11 }, splitLine: { lineStyle: { color: c.grid } },
    },
    series: [
      ...series,
      {
        type: "scatter", data: [], silent: true,
        markLine: {
          silent: true, symbol: "none", lineStyle: { color: c.muted, type: "dashed", width: 1 },
          label: { color: c.muted, fontSize: 10, formatter: "{b}", position: "insideEndTop" },
          data: [
            { name: "median growth", xAxis: +(base.median_growth * 100).toFixed(1) },
            { name: "median cites/yr", yAxis: base.median_cites_per_year },
          ],
        },
      },
    ],
  };
  return (
    <ReactECharts
      option={option}
      notMerge
      style={{ height: 420, width: "100%" }}
      onEvents={{ click: (p: { data?: { cluster?: Cluster } }) => p.data?.cluster && onSelect(p.data.cluster.cluster_id) }}
    />
  );
}

export function YearHeatmap({ run, selected, onSelect }: { run: GapRadarResult; selected: number | null; onSelect: (id: number) => void }) {
  const { theme } = useTheme();
  const c = chrome(theme);
  const years = run.years.map(String);
  const clusters = run.clusters;
  const data: [number, number, number][] = [];
  clusters.forEach((k, yi) => years.forEach((y, xi) => data.push([xi, yi, k.counts_by_year[y] ?? 0])));
  const max = Math.max(1, ...data.map((d) => d[2]));
  // Sequential single hue (blue); low end recedes toward the surface in each mode.
  const ramp = theme === "dark"
    ? ["#1d2633", "#184f95", "#2a78d6", "#6da7ec", "#cde2fb"]
    : ["#f1f5fb", "#b7d3f6", "#6da7ec", "#2a78d6", "#104281"];
  const option = {
    animationDuration: 500,
    grid: { left: 190, right: 16, top: 8, bottom: 56 },
    tooltip: {
      ...tooltipBase(c), position: "top",
      formatter: (p: { data: number[] }) => `<b>${clusters[p.data[1]].label}</b><br/>${years[p.data[0]]}: <b>${p.data[2]}</b> papers`,
    },
    xAxis: { type: "category", data: years, axisLine: { lineStyle: { color: c.axis } }, axisTick: { show: false }, axisLabel: { color: c.muted, fontSize: 11 }, splitArea: { show: false } },
    yAxis: {
      type: "category", data: clusters.map((k) => short(k.label, 28)), inverse: true,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: {
        fontSize: 11,
        color: (_v: string, i: number) => (clusters[i]?.cluster_id === selected ? c.ink : c.ink2),
        fontWeight: (_v: string, i: number) => (clusters[i]?.cluster_id === selected ? 600 : 400),
      },
    },
    visualMap: {
      min: 0, max, calculable: false, orient: "horizontal", left: "center", bottom: 4, itemHeight: 140, itemWidth: 10,
      text: [`${max}`, "0 papers"], textStyle: { color: c.muted, fontSize: 10 }, inRange: { color: ramp },
    },
    series: [{
      type: "heatmap", data,
      itemStyle: { borderColor: c.surface, borderWidth: 2, borderRadius: 3 },
      emphasis: { itemStyle: { borderColor: c.ink, borderWidth: 1 } },
    }],
  };
  return (
    <ReactECharts
      option={option}
      notMerge
      style={{ height: Math.max(220, clusters.length * 30 + 70), width: "100%" }}
      onEvents={{ click: (p: { data?: number[] }) => p.data && onSelect(clusters[p.data[1]].cluster_id) }}
    />
  );
}
