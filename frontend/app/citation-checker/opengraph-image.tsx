import { ogCard } from "@/lib/ogImage";

export const alt = "Cite & Slayy · Citation checker: Catch fake and retracted references.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return ogCard({"kicker": "Citation checker", "title": "Catch fake and", "highlight": "retracted references.", "sub": "Every reference checked against OpenAlex, Crossref and Retraction Watch before you submit.", "color": "#ffd23f", "chips": [["DOI check", "#c6f432"], ["Retractions", "#ff5fa2"], ["Fixes suggested", "#ffffff"]]});
}
