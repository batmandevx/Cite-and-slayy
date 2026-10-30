"use client";

import { useSyncExternalStore } from "react";
import Landing from "@/components/Landing";

const subscribe = () => () => {};

export default function Home() {
  const isClient = useSyncExternalStore(subscribe, () => true, () => false);
  if (!isClient) return <div className="grid min-h-screen place-items-center font-display text-lg font-extrabold">Cite &amp; Slayy</div>;
  return <Landing />;
}
