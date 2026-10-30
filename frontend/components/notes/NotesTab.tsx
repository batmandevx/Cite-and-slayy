"use client";

import clsx from "clsx";
import {
  CheckSquare, Code2, Download, FileText, FileType2, Image as ImageIcon, LayoutGrid, ListTodo, Network, Plus, Printer, Sigma,
  Table2, Trash2, Workflow,
} from "lucide-react";
import { AnimatePresence, motion, Reorder } from "motion/react";
import { useRef, useState } from "react";
import { api, usePersistent, apiFetch } from "@/lib/api";
import { Button, Card, Select } from "../ui";
import { RichMarkdown } from "./RichMarkdown";
import { StickyBoard } from "./Stickies";
import { TodoList } from "./Todos";
import { useWorkspace } from "./useWorkspace";
import { AssistMenu } from "../AssistMenu";
import { exportPaper, printPdf as printDoc, type ExportFormat } from "@/lib/paperExport";

const uid = () => Math.random().toString(36).slice(2, 10);

// ---------- pages ----------
interface Page { id: string; title: string; md: string; template: "ieee" | "springer" | "plain"; updated: number; emoji: string }

const SNIPPETS: { icon: typeof Table2; label: string; text: string }[] = [
  { icon: FileText, label: "Heading", text: "\n## Section title\n" },
  { icon: Table2, label: "Table", text: "\nTable: Main results\n| Method | Metric A | Metric B |\n|---|---|---|\n| Baseline | ... | ... |\n| Ours | ... | ... |\n" },
  { icon: Sigma, label: "Equation", text: "\n$$E = mc^2$$\n" },
  { icon: Workflow, label: "Flowchart", text: "\nFigure: Workflow\n```mermaid\nflowchart TD\n  A[Start] --> B{Decision}\n  B -- yes --> C[Do this]\n  B -- no --> D[Do that]\n```\n" },
  { icon: Network, label: "Architecture", text: "\nFigure: System architecture\n```mermaid\nflowchart LR\n  UI[Frontend] --> API[Backend API]\n  API --> DB[(Database)]\n  API --> LLM[LLM service]\n```\n" },
  { icon: CheckSquare, label: "Checklist", text: "\n- [ ] First task\n- [ ] Second task\n" },
  { icon: ImageIcon, label: "Image", text: "\n![Figure caption](figure.png)\n" },
  { icon: Code2, label: "Code", text: "\n```python\nprint('hello')\n```\n" },
];


function PagesView() {
  const [pages, update] = useWorkspace<Page>("pages");
  const [activeId, setActiveId] = usePersistent<string | null>("notesActive", null);
  const [view, setView] = useState<"split" | "write" | "preview">("split");
  const [author, setAuthor] = usePersistent<string>("paperAuthor", "Ayush");
  const [affil, setAffil] = usePersistent<string>("paperAffil", "Asia Pacific University");
  const ta = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const page = pages?.find((p) => p.id === activeId) ?? pages?.[0] ?? null;

  const create = async (kind: "blank" | "paper") => {
    let md = "# Untitled\n\nStart writing… use the toolbar for tables, equations and diagrams.";
    if (kind === "paper") md = (await api.get<{ markdown: string }>("/api/export/paper-template")).markdown;
    const p: Page = { id: uid(), title: kind === "paper" ? "My research paper" : "Untitled page", md, template: "ieee", updated: Date.now(), emoji: kind === "paper" ? "📄" : "📝" };
    update((xs) => [p, ...xs]); setActiveId(p.id);
  };
  const edit = (patch: Partial<Page>) => page && update((xs) => xs.map((x) => (x.id === page.id ? { ...x, ...patch, updated: Date.now() } : x)));
  const insert = (text: string) => {
    if (!page) return;
    const el = ta.current; const pos = el?.selectionStart ?? page.md.length;
    edit({ md: page.md.slice(0, pos) + text + page.md.slice(pos) });
    setTimeout(() => { el?.focus(); el?.setSelectionRange(pos + text.length, pos + text.length); }, 0);
  };
  const doc = () => ({ title: page!.title, markdown: page!.md, template: page!.template, author, affiliation: affil });
  const exportAs = (fmt: ExportFormat) => page && exportPaper(fmt, doc());
  const overleaf = async () => {
    if (!page) return;
    const r = await apiFetch(`/api/export/latex`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: page.title, markdown: page.md, template: page.template, author, affiliation: affil }) });
    const tex = await r.text();
    const f = document.createElement("form");
    f.method = "POST"; f.action = "https://www.overleaf.com/docs"; f.target = "_blank";
    const i = document.createElement("input"); i.type = "hidden"; i.name = "encoded_snip"; i.value = encodeURIComponent(tex);
    f.appendChild(i); document.body.appendChild(f); f.submit(); f.remove();
  };
  const printPdf = () => {
    if (!previewRef.current || !page) return;
    printDoc(page.title, [author, affil].filter(Boolean).join(" · "), previewRef.current.innerHTML, page.template);
  };

  if (!pages) return <div className="shimmer h-80 rounded-2xl" />;
  return (
    <div className="grid gap-5 lg:grid-cols-[250px_1fr]">
      <Card className="h-fit p-3">
        <div className="mb-2 grid grid-cols-2 gap-2">
          <Button variant="lime" className="!px-2 !py-2 text-xs" onClick={() => create("blank")}><Plus className="size-3.5" />Page</Button>
          <Button variant="primary" className="!px-2 !py-2 text-xs" onClick={() => create("paper")}><FileText className="size-3.5" />Paper</Button>
        </div>
        <Reorder.Group axis="y" values={pages} onReorder={(v) => update(() => v)} className="space-y-1.5">
          {pages.map((p) => (
            <Reorder.Item key={p.id} value={p} whileDrag={{ scale: 1.03, rotate: -1 }}
              className={clsx("group flex cursor-pointer items-center gap-2 rounded-xl border-2 px-2.5 py-2 text-sm",
                page?.id === p.id ? "border-edge bg-yellow text-[#121212] shadow-[3px_3px_0_var(--shadow-c)]" : "border-transparent hover:border-edge hover:bg-surface-2")}
              onClick={() => setActiveId(p.id)}>
              <span>{p.emoji}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{p.title || "Untitled"}</span>
              <button onClick={(e) => { e.stopPropagation(); update((xs) => xs.filter((x) => x.id !== p.id)); }}
                className="opacity-0 transition group-hover:opacity-70" title="Delete"><Trash2 className="size-3.5" /></button>
            </Reorder.Item>
          ))}
        </Reorder.Group>
        {pages.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted">No pages yet. Start a blank page or a full paper template.</p>}
      </Card>

      {page ? (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b-[2.5px] border-edge bg-surface-2 px-4 py-3">
            <input value={page.emoji} onChange={(e) => edit({ emoji: e.target.value.slice(0, 2) })} className="w-9 rounded-lg bg-transparent text-center text-2xl outline-none" />
            <input value={page.title} onChange={(e) => edit({ title: e.target.value })} placeholder="Page title"
              className="min-w-40 flex-1 bg-transparent font-display text-2xl font-extrabold outline-none" />
            <div className="flex rounded-xl border-2 border-edge bg-surface p-0.5 text-xs font-bold">
              {(["write", "split", "preview"] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} className={clsx("rounded-lg px-2.5 py-1 capitalize", view === v && "bg-pink text-[#121212]")}>{v}</button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 border-b-2 border-dashed border-line px-4 py-2">
            {SNIPPETS.map((s) => (
              <motion.button key={s.label} whileHover={{ y: -2 }} whileTap={{ scale: 0.92 }} onClick={() => insert(s.text)}
                className="inline-flex items-center gap-1 rounded-lg border-2 border-edge bg-surface px-2 py-1 text-[11px] font-bold">
                <s.icon className="size-3.5" />{s.label}
              </motion.button>
            ))}
            <AssistMenu className="ml-auto" actions={["continue", "improve", "summarize", "outline", "explain"]}
              getText={() => { const el = ta.current; const sel = el && el.selectionEnd > el.selectionStart ? el.value.slice(el.selectionStart, el.selectionEnd) : ""; return sel || page.md.slice(-4000); }}
              onResult={(t, a) => {
                const el = ta.current;
                const hasSel = !!el && el.selectionEnd > el.selectionStart;
                if (a === "improve" && hasSel && el) { edit({ md: page.md.slice(0, el.selectionStart) + t + page.md.slice(el.selectionEnd) }); return; }
                const label = { continue: "", summarize: "\n**Summary**\n", outline: "\n", explain: "\n> **Explained simply:** ", improve: "\n" }[a as "continue"] ?? "\n";
                insert(`\n${label}${t}\n`);
              }} />
          </div>
          <div className={clsx("grid min-h-[520px]", view === "split" && "lg:grid-cols-2")}>
            {view !== "preview" && (
              <textarea ref={ta} value={page.md} onChange={(e) => edit({ md: e.target.value })} spellCheck
                className="min-h-[520px] w-full resize-none border-edge bg-surface p-5 font-mono text-[13px] leading-relaxed outline-none lg:border-r-2" />
            )}
            {view !== "write" && <div ref={previewRef} className="max-h-[720px] overflow-y-auto bg-surface p-6"><RichMarkdown>{page.md}</RichMarkdown></div>}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t-[2.5px] border-edge bg-surface-2 px-4 py-3">
            <span className="font-display text-xs font-extrabold uppercase tracking-wider text-muted">Export</span>
            <Select value={page.template} onChange={(e) => edit({ template: e.target.value as Page["template"] })} className="!w-auto !py-1.5 text-xs">
              <option value="ieee">IEEE (IEEEtran)</option>
              <option value="springer">Springer (LNCS)</option>
              <option value="plain">Plain article</option>
            </Select>
            <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Author" className="w-28 rounded-lg border-2 border-edge bg-surface px-2 py-1.5 text-xs" />
            <input value={affil} onChange={(e) => setAffil(e.target.value)} placeholder="Affiliation" className="w-40 rounded-lg border-2 border-edge bg-surface px-2 py-1.5 text-xs" />
            <div className="ml-auto flex flex-wrap gap-2">
              <Button className="!py-1.5 text-xs" onClick={printPdf} disabled={view === "write"} title={view === "write" ? "Switch to split or preview first" : ""}><Printer className="size-3.5" />PDF</Button>
              <Button className="!py-1.5 text-xs" onClick={() => exportAs("docx")}><FileType2 className="size-3.5" />Word</Button>
              <Button className="!py-1.5 text-xs" onClick={() => exportAs("latex-zip")}><Download className="size-3.5" />LaTeX .zip</Button>
              <Button variant="lime" className="!py-1.5 text-xs" onClick={overleaf}>Open in Overleaf</Button>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="grid place-items-center p-16 text-center">
          <div>
            <div className="mb-3 text-5xl">📝</div>
            <div className="font-display text-xl font-extrabold">Create your first page</div>
            <p className="mt-1 text-sm text-ink-2">The paper template comes with sections, an equation, a results table, an architecture diagram and a flowchart.</p>
          </div>
        </Card>
      )}
    </div>
  );
}

export function NotesTab() {
  const [view, setView] = usePersistent<"pages" | "stickies" | "todos">("notesView", "pages");
  const tabs = [
    { id: "pages", label: "Pages", icon: FileText, color: "bg-yellow" },
    { id: "stickies", label: "Sticky board", icon: LayoutGrid, color: "bg-pink" },
    { id: "todos", label: "To-dos", icon: ListTodo, color: "bg-lime" },
  ] as const;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <motion.button key={t.id} whileTap={{ scale: 0.95 }} onClick={() => setView(t.id)}
            className={clsx("btn-brut inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 font-display font-extrabold", view === t.id ? `${t.color} text-[#121212]` : "bg-surface")}>
            <t.icon className="size-4" />{t.label}
          </motion.button>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={view} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
          {view === "pages" && <PagesView />}
          {view === "stickies" && <StickyBoard />}
          {view === "todos" && <TodoList />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
