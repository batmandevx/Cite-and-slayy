"use client";

import "katex/dist/katex.min.css";
import { useEffect, useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { API } from "@/lib/api";
import { useTheme } from "../theme";

/** Renders a ```mermaid block to SVG (architecture diagrams, flowcharts). */
function Mermaid({ code }: { code: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { theme } = useTheme();
  const [svg, setSvg] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: theme === "dark" ? "dark" : "default", securityLevel: "strict", suppressErrorRendering: true,
          themeVariables: { fontFamily: "inherit", primaryColor: "#ffd23f", primaryBorderColor: "#121212", lineColor: "#121212" } });
        // Validate first: a failed render() can leave error graphics attached to <body>.
        if (!(await mermaid.parse(code, { suppressErrors: true }))) throw new Error("this diagram has a syntax error");
        const rid = `m${id}${Math.random().toString(36).slice(2, 7)}`;
        let out: { svg: string };
        try {
          out = await mermaid.render(rid, code);
        } finally {
          document.getElementById(`d${rid}`)?.remove();   // mermaid's temporary container
        }
        if (alive) { setSvg(out.svg); setErr(null); }
      } catch (e) {
        if (alive) setErr((e as Error).message?.split("\n")[0] ?? "diagram error");
      }
    })();
    return () => { alive = false; };
  }, [code, id, theme]);
  if (err) return (
    <details className="my-3 rounded-xl border-2 border-dashed border-line bg-surface-2 p-3 text-xs text-muted">
      <summary className="cursor-pointer font-bold">Diagram preview unavailable ({err}). Ask for a fix: “redraw the diagram in the Method section”.</summary>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{code}</pre>
    </details>
  );
  return <div className="my-3 flex justify-center overflow-x-auto rounded-xl border-2 border-edge bg-surface p-3" dangerouslySetInnerHTML={{ __html: svg }} />;
}

type MdNode = { type: string; value?: string; children?: MdNode[]; data?: Record<string, unknown> };
const INLINE = /(\+\+[^+\n]+?\+\+|==[^=\n]+?==|\^[^\s^]+?\^)/;
const TAG: Record<string, string> = { "+": "u", "=": "mark", "^": "sup" };

/** Word-style inline marks: ++underline++, ==highlight==, x^2^ superscript (outside code). */
function remarkMarks() {
  const walk = (n: MdNode) => {
    if (!n.children || n.type === "inlineCode" || n.type === "code") return;
    n.children = n.children.flatMap((c) => {
      if (c.type !== "text" || !c.value || !INLINE.test(c.value)) { walk(c); return [c]; }
      return c.value.split(INLINE).filter(Boolean).map((part) => {
        const k = part[0];
        const w = k === "^" ? 1 : 2;
        if (INLINE.test(part) && part.length > w * 2 && part.endsWith(part.slice(0, w)))
          return { type: "emphasis", data: { hName: TAG[k] }, children: [{ type: "text", value: part.slice(w, -w) }] } as MdNode;
        return { type: "text", value: part } as MdNode;
      });
    });
  };
  return (tree: MdNode) => walk(tree);
}

export function RichMarkdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkMarks]} rehypePlugins={[rehypeKatex]}
        components={{
          img(props) {
            const src = typeof props.src === "string" && props.src.startsWith("/api/") ? `${API}${props.src}` : props.src;
            // eslint-disable-next-line @next/next/no-img-element
            return <img src={src} alt={props.alt ?? ""} className="mx-auto my-3 max-h-[420px] rounded-lg border-2 border-edge bg-white p-1" />;
          },
          code(props) {
            const { className, children: c } = props as { className?: string; children?: React.ReactNode };
            if (className?.includes("language-mermaid")) return <Mermaid code={String(c).trim()} />;
            return <code className={className}>{c}</code>;
          },
          pre(props) {
            const child = (props as { children?: { props?: { className?: string } } }).children;
            if (child?.props?.className?.includes("language-mermaid")) return <>{props.children}</>;
            return <pre className="overflow-x-auto rounded-xl border-2 border-edge bg-surface-2 p-3 text-xs">{props.children}</pre>;
          },
        }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
