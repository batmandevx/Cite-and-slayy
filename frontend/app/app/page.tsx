"use client";

import { AppShellSkeleton } from "@/components/ui/States";
import { useSyncExternalStore } from "react";
import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";
import { LoginScreen } from "@/components/auth/LoginScreen";
import DashboardApp from "@/components/Dashboard";

const subscribe = () => () => {};

function Gate() {
  const { loading, config, me } = useAuth();
  if (loading || !config) return <AppShellSkeleton />;
  if (config.auth_required && !me) return <LoginScreen />;
  return <DashboardApp />;
}

// The app reads localStorage and talks to the API from the browser, so it renders after mounting.
export default function AppPage() {
  const isClient = useSyncExternalStore(subscribe, () => true, () => false);
  if (!isClient) return <AppShellSkeleton />;
  return <AuthProvider><Gate /></AuthProvider>;
}
