/** Public business details shown on the policy pages. Only real, confirmed details belong here. */

export interface TeamMember { name: string; role: string; email: string; initials: string; color: string; tagline: string; easterEgg?: boolean | "horse" | "knight" }   // true = "horse"

/** The team shown on the website. Set NEXT_PUBLIC_SITE_TEAM (JSON array) in a private, untracked env file to override. */
function siteTeam(): TeamMember[] {
  try {
    const raw = process.env.NEXT_PUBLIC_SITE_TEAM;
    if (raw) return JSON.parse(raw) as TeamMember[];
  } catch { /* fall back to the default below */ }
  return [{ name: "Ayush Upadhyay", role: "Founder", email: "ayush@citeslayy.com", initials: "AU", color: "bg-pink", tagline: "Creator of Cite & Slayy" }];
}
export const BUSINESS = {
  brand: "Cite & Slayy",
  website: "https://citeslayy.com",
  email: "slayyhacks@gmail.com",          // support
  country: "India",
  updated: "5 November 2026",
  team: siteTeam(),
};
