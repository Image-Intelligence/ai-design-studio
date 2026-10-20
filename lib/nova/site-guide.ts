/**
 * Prism's site knowledge (2026-10-20): what the old AI Guide pasted into
 * every request as one long, hand-written prompt (its prices had drifted far
 * from the real ones). Now it is a tool Prism calls per topic, so a question
 * only pays for the part it needs - and the money facts are read from the
 * same configs the checkout uses, so they cannot drift again. Model prices
 * are never written here: browse_models reads them live.
 */
import { CCBILL_PLANS } from '@/lib/dev-tier-plans'
import { TICKET_PACKAGES } from '@/lib/ticket-pricing'
import { ENHANCE_LIMITS } from '@/lib/prompt-enhance'

export const SITE_TOPICS = ['navigation', 'tickets', 'plans', 'studios', 'library', 'references', 'uploads', 'troubleshooting', 'prism', 'chatgpt-claude'] as const
export type SiteTopic = typeof SITE_TOPICS[number]

const money = (n: number) => `$${n.toFixed(2)}`

const TOPICS: Record<SiteTopic, () => string> = {
  navigation: () => [
    'The main page (the portal) has a taskbar along the top. The site logo menu (top left) goes Home - the landing view with section cards for images, video, audio, studios, the shop and news - or back to the feed.',
    '- Studios: workspaces built for one job each (see the studios topic).',
    '- Image / Video / Audio: pick a model from the dropdown, write a prompt in the prompt box, add references, press Generate. Results land in the feed.',
    '- Text: the prompt helper - an idea box that writes or improves prompts (the ✨ buttons do it right in the prompt box).',
    '- Refs: the user\'s reference library (pictures used as references in prompts) - see the references topic.',
    '- Shop: buy ticket packs and plans.',
    '- Select: select several feed items to download, move to a folder, hide or delete them.',
    '- Feed: the feed\'s view options (filters, what is shown) and per-account switches, including showing or hiding Prism.',
    'Other pages: My Generations (/my-generations - everything the account made, in folders), Buy tickets (/buy-tickets), Plans (/prompting-studio/subscribe), Purchase history (/purchase-history), Subscriptions (/subscriptions), Report content (/report), Terms (/terms), Privacy (/privacy).',
    'The profile bubble (top right) opens the account menu: profile picture, plan, sign out. The ticket balance sits beside it.',
  ].join('\n'),
  tickets: () => [
    'Tickets are the site\'s currency: every generation costs tickets; the price shows on the Generate button before anything is spent, and a failed generation is refunded automatically.',
    'Ticket packs (pack tickets never expire):',
    ...TICKET_PACKAGES.map(p => `- ${p.tickets} tickets${p.name ? ` (${p.name})` : ''}: ${money(p.freeTierPrice)}`),
    `Plan members get ${CCBILL_PLANS.map(p => `${p.packDiscountPct}% (${p.name})`).join(' / ')} off every pack.`,
    'Buy at /buy-tickets or from the Shop. The balance is shown top right.',
    `Free AI text actions each day (prompt enhance, Storyboard drafts, quick questions to Prism): ${ENHANCE_LIMITS.free} free on no plan, ${CCBILL_PLANS.map(p => `${ENHANCE_LIMITS[p.id]} on ${p.name}`).join(', ')}. After that each costs a ticket or so.`,
  ].join('\n'),
  plans: () => [
    'Plans (monthly, /prompting-studio/subscribe):',
    ...CCBILL_PLANS.map(p => `- ${p.name}: ${money(p.price)}/month - refills the account up to ${p.tickets} plan tickets each month, ${p.packDiscountPct}% off ticket packs, ${ENHANCE_LIMITS[p.id]} free AI text actions a day.`),
    'Plan tickets are a monthly bar, not a pile: each renewal tops the account back up to the plan\'s number, and plan tickets end with the plan. Pack tickets never expire.',
    'Every plan includes more generations at once, a bigger reference library and every studio. Plans are managed at /subscriptions.',
  ].join('\n'),
  studios: () => [
    'Studios (taskbar -> Studios), each built for one job:',
    '- Image Studio: a Photoshop-style editor in the browser - layers, masks, AI edits (layer tools need a plan). Also opens from "Edit image" on any picture.',
    '- Storyboard: plan a film shot by shot - stills, shot prompts, an AI draft, an audio lane, then shoot the shots and cut them into a film.',
    '- Frames: pull the best stills out of any video.',
    'Prism (that is you) can do most of what these do from the chat: make images, video, audio and 3D, edit, organise and cut - just ask.',
  ].join('\n'),
  library: () => [
    'My Generations (/my-generations and the feed) keeps everything the account made, in folders the user makes. Prism files what it makes in a "Prism" folder.',
    'Assets (My Generations -> Assets) are named characters, products and places with several pictures and notes - the way to keep a character the same across many pictures. Prism can save, read and use them.',
    'Hidden items are only hidden from the feed; deleted ones are gone.',
  ].join('\n'),
  references: () => [
    'References are pictures a model uses to match a character, product, style or place. In the prompt box, add them with the reference button (from Refs, My Generations or an upload); how many a model takes is shown on it.',
    'Refs (taskbar) is the account\'s reference library; plans get a larger one.',
    'For a character that must stay the same across many pictures, an Asset with several pictures works best.',
  ].join('\n'),
  uploads: () => [
    'Uploading anything (a reference, a picture to edit, a clip) needs a one-time ID check (age 18+), which opens from the first upload button pressed. Afterwards uploads just work.',
    'Pictures already in My Generations never need uploading - pick them from the library instead.',
  ].join('\n'),
  troubleshooting: () => [
    '- A generation failed or timed out: its tickets come back automatically. Try again, simplify the prompt, or pick another model.',
    '- A refusal: the site and the models have content rules (no sexual content, no minors, no real people\'s likeness without consent). Rephrase.',
    '- Something stuck on loading: refresh - finished work still lands in the feed and My Generations.',
    '- Billing questions or a problem Prism cannot fix: the Contact page (/contact).',
  ].join('\n'),
  'chatgpt-claude': () => [
    'AI Design Studio works inside ChatGPT and Claude (the connector): connect the account once, then ask in those apps for images, edits and videos - they are made on the user\'s account, cost the same tickets, show in the chat and are saved to My Generations.',
    '- How to connect, the connector address and the list of connected apps (with Disconnect): /connect (also in the profile menu: "Use in ChatGPT & Claude").',
    '- ChatGPT: Apps -> AI Design Studio -> Connect (or developer mode with the address). Claude: Settings -> Connectors -> Add custom connector with the address.',
    '- Requests there follow all-ages content rules, stricter than the site. Tickets are bought on the site.',
  ].join('\n'),
  prism: () => [
    'Prism is the site\'s guide: one ongoing chat per account that answers questions and makes things.',
    '- Quick questions are free from the daily AI text allowance; making things costs the generations\' tickets plus a small amount for Prism\'s thinking (shown on every reply).',
    '- The budget in Prism\'s prompt box is how much one request may spend without asking; bigger jobs come as a plan to approve. Limits per day / month live in Budget.',
    '- Prism remembers lasting preferences (Memory in the menu) and keeps a short summary of the conversation. "Compact" folds the conversation into that summary; "Clear context" starts fresh - both make the next replies cheaper. Remembered preferences stay either way.',
    '- Prism can be hidden from the Feed menu (per account) or from its own menu, and opened again from the same place.',
  ].join('\n'),
}

export function siteGuide(topic: string): string {
  const t = (SITE_TOPICS as readonly string[]).includes(topic) ? topic as SiteTopic : null
  return t ? TOPICS[t]() : `Unknown topic. Topics: ${SITE_TOPICS.join(', ')}.`
}
