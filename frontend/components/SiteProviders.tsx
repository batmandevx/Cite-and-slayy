"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { CookieConsent } from "./CookieConsent";

/** Site-wide client wrappers: every motion animation follows the visitor's reduced-motion setting, plus the cookie banner. */
export function SiteProviders({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      {children}
      <CookieConsent />
    </MotionConfig>
  );
}
