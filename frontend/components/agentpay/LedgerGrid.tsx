"use client";

import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useMemo } from "react";

ModuleRegistry.registerModules([AllCommunityModule]);

export type LedgerRow = {
  id: string; at: string; type: string; amount_cents: number; balance_after_cents: number; detail: string;
  agent?: string; refs?: number; cost_cents?: number; paypal_order?: string; paypal_capture?: string; paypal_refund?: string;
};

const TYPE_LABEL: Record<string, string> = {
  topup: "Top-up (PayPal)", auto_reload: "Auto-reload (PayPal)", charge: "Agent charge", credit: "Credit back",
  withdrawal: "Refund to PayPal", blocked: "Blocked by rules", approval_requested: "Asked for approval",
  approved: "Approved", rejected: "Rejected", insufficient_funds: "Out of funds", mandate: "Rules changed",
  auto_reload_failed: "Auto-reload failed",
};
const TYPE_TONE: Record<string, string> = {
  topup: "#2ea44f", auto_reload: "#2ea44f", credit: "#2ea44f", charge: "#7b5cff", withdrawal: "#0b7fd1",
  blocked: "#d1242f", insufficient_funds: "#d1242f", rejected: "#d1242f", auto_reload_failed: "#d1242f",
  approval_requested: "#bf8700", approved: "#2ea44f", mandate: "#6e7781",
};

const usd = (c?: number) => (c == null ? "" : `${c < 0 ? "-" : c > 0 ? "+" : ""}$${(Math.abs(c) / 100).toFixed(2)}`);

const theme = themeQuartz.withParams({
  backgroundColor: "var(--surface)", foregroundColor: "var(--ink)", borderColor: "var(--edge)",
  headerBackgroundColor: "var(--surface-2)", accentColor: "var(--accent)", fontFamily: "inherit", fontSize: 13,
  wrapperBorderRadius: 14, spacing: 6,
});

/** Every money movement and every decision the mandate made, in one sortable, filterable audit log. */
export function LedgerGrid({ rows }: { rows: LedgerRow[] }) {
  const cols = useMemo<ColDef<LedgerRow>[]>(() => [
    { field: "at", headerName: "When", width: 165, sort: "desc",
      valueFormatter: (p) => new Date(p.value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) },
    { field: "type", headerName: "Event", width: 170, filter: true,
      valueFormatter: (p) => TYPE_LABEL[p.value] ?? p.value,
      cellStyle: (p) => ({ color: TYPE_TONE[p.value] ?? "inherit", fontWeight: 700 }) },
    { field: "agent", headerName: "Agent", width: 120, filter: true },
    { field: "refs", headerName: "Refs", width: 80, type: "numericColumn" },
    { field: "amount_cents", headerName: "Amount", width: 105, type: "numericColumn", valueFormatter: (p) => (p.value ? usd(p.value) : "-"),
      cellStyle: (p) => ({ color: p.value > 0 ? "#2ea44f" : p.value < 0 ? "#d1242f" : "inherit", fontWeight: 700 }) },
    { field: "balance_after_cents", headerName: "Balance", width: 105, type: "numericColumn", valueFormatter: (p) => `$${(p.value / 100).toFixed(2)}` },
    { field: "detail", headerName: "What happened", flex: 1, minWidth: 260, tooltipField: "detail" },
    { headerName: "PayPal ref", width: 150, valueGetter: (p) => p.data?.paypal_refund ?? p.data?.paypal_capture ?? p.data?.paypal_order ?? "",
      cellClass: "font-mono text-[11px]" },
  ], []);
  return (
    <div style={{ height: 420 }}>
      <AgGridReact<LedgerRow> theme={theme} rowData={rows} columnDefs={cols} getRowId={(p) => p.data.id}
        defaultColDef={{ sortable: true, resizable: true }} pagination paginationPageSize={20} paginationPageSizeSelector={[20, 50, 100]}
        overlayNoRowsTemplate="No activity yet: top up and create an agent key." />
    </div>
  );
}
