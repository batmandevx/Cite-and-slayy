/** Business details shown on the legal pages. Razorpay checks these before activating payments: fill in every field. */
export const BUSINESS = {
  brand: "Cite & Slayy",
  operator: "[Your registered business or full legal name]",
  address: "[Registered address, city, state, PIN]",
  email: "slayyhacks@gmail.com",
  phone: "[+91 phone number]",
  gstin: "[GSTIN, if registered]",
  updated: "30 October 2026",
};
export const isPlaceholder = (v: string) => v.startsWith("[");
