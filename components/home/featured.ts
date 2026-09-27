/**
 * The top models, shown first on the home page (Featured Models) and as the
 * picture strip on the dashboard's Catalog card. Order matters: the first is
 * the home page's lead card. A card's media lives under `${kind}:${name}` in
 * /api/admin/home-cards.
 */
export const FEATURED_MODELS: { name: string; kind: "image" | "video" }[] = [
  { name: "NanoBanana Pro 2", kind: "image" },
  // Portrait cards (TALL_CARDS) get full-height columns; the rest stack in one.
  { name: "Virtual Try-On", kind: "image" },
  { name: "ChatGPT Images 2.5", kind: "image" },
  { name: "Ideogram v4", kind: "image" },
  { name: "Pixelcut Product Photo", kind: "image" },
  { name: "Kling V3 Motion", kind: "video" },
  { name: "LTX 2.5 Pro", kind: "video" },
  { name: "SeeDance 2.5", kind: "video" },
]
