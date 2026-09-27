/**
 * The top models, shown first on the home page (Featured Models) and as the
 * picture strip on the dashboard's Catalog card. Order matters: the first is
 * the home page's lead card. A card's media lives under `${kind}:${name}` in
 * /api/admin/home-cards.
 */
export const FEATURED_MODELS: { name: string; kind: "image" | "video" }[] = [
  { name: "NanoBanana Pro 2", kind: "image" },
  // Portrait (a TALL_CARDS entry): it takes its own two-row column beside the lead.
  { name: "Virtual Try-On", kind: "image" },
  { name: "ChatGPT Images 2.5", kind: "image" },
  { name: "Ideogram v4", kind: "image" },
  { name: "SeeDance 2.0", kind: "video" },
  { name: "Kling 3.0", kind: "video" },
]
