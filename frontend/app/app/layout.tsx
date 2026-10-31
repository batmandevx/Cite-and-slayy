import type { Metadata } from "next";

// The signed-in workspace: nothing here for search engines.
export const metadata: Metadata = {
  title: "Workspace",
  robots: { index: false, follow: false },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
