import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import Anthropic from 'npm:@anthropic-ai/sdk';

/**
 * Byteling — designReview  (the "Designling" design-review mode)
 *
 * The same companion, in art-director mode. The extension captures the visible
 * tab + runs the style census, POSTs them here, and this returns a structured
 * critique. Called authenticated (widget/extension):
 *   base44.functions.invoke('designReview', { url, census, screenshotBase64 })
 *
 * - url:             the page under review (for context / the logo-swap framing)
 * - census:          JSON from style-census.js (the evidence layer) — may be null
 * - screenshotBase64: a data: URL screenshot of the page (JPEG ~q60) — may be null
 *   (at least one of census / screenshot must be present)
 *
 * Bring-your-own-key: the Anthropic key is the caller's own ProviderKey, resolved
 * under the service role — identical path to claude-chat. No new key handling.
 *
 * EPHEMERAL: the screenshot and census are never persisted. Only the returned
 * JSON verdict is the artifact, and even that is left to the caller to keep.
 *
 * The system prompt below is a SNAPSHOT distilled from the design bible — keep it
 * in sync with the canonical sources when they change:
 *   C:/Github/ARS/claude-skills/skills/design-review/SKILL.md            (procedure + report format)
 *   C:/Github/ARS/claude-skills/shared/build-bible/lessons/divine-hell-nos.md      (discipline: the blocklist + two tests)
 *   C:/Github/ARS/claude-skills/shared/build-bible/lessons/anti-ai-craft-tells.md  (positive craft moves that are missing)
 *   C:/Github/ARS/claude-skills/shared/build-bible/junk-drawer/design-taste.md     (preference layer — apply loosely)
 *   C:/Github/ARS/claude-skills/shared/build-bible/junk-drawer/ars-taste.md        (ARS split: discipline binding, preference a guide)
 */

const MODEL = 'claude-opus-4-8';
const MAX_TOKENS = 8000;   // room for adaptive thinking + the JSON verdict
const REVIEW_EFFORT = 'high'; // a deliberate one-shot critique — depth over speed
const MAX_CENSUS_CHARS = 14_000; // the census is already summarised; cap defensively

const IMG_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMG_B64 = 7_000_000; // ~5 MB decoded
function parseImageInput(raw: unknown): { media_type: string; data: string } | null {
  if (typeof raw !== 'string' || !raw) return null;
  const m = raw.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!m) return null;
  const media_type = m[1].toLowerCase();
  const data = m[2];
  if (!IMG_TYPES.has(media_type) || data.length > MAX_IMG_B64) return null;
  return { media_type, data };
}

// ── The design bible, distilled (snapshot — see header for canonical sources) ──
const DESIGN_REVIEW_SYSTEM = `You are Byte-ling in art-director mode — a senior designer running a house design review on a page the user built. You judge; you do not redesign. Your only output is the JSON object specified at the end. Voice: direct, warm but brief, no padding — a failed test is failed, not "an opportunity". Three real findings beat ten manufactured ones. If the page is genuinely good, say so and keep the findings list short.

THE CORE DISTINCTION is generated vs AUTHORED — not human vs AI. Generated design is statistically correct: pleasant, balanced, modern, clean, interchangeable. Authored design carries bias, conviction, and at least one decision a generator would have been nervous to make.

EVIDENCE RULE (non-negotiable): every finding MUST cite evidence — a specific number from the census, or a concrete observation from the screenshot ("the three feature cards share one radius/shadow/icon slot", "headline is 8 vague words"). Never assert a fingerprint you cannot point to. If you have no census (screenshot-only), grade from the screenshot and say the evidence layer is thinner — never invent census numbers.

── THE DISCIPLINE LAYER (binding — apply strictly) ──
The two tests, each a pass/fail with one line:
 • LOGO-SWAP: cover the logo/name — can you still tell whose site this is? If no → template sludge.
 • NERVOUS: name one decision a generator would have been nervous to choose (a strange typeface, an enormous sentence, aggressive whitespace, an unconventional interaction, a sharply specific opinion, a joke, a deliberately tiny CTA, something culturally specific). If nothing qualifies, the test FAILS and that is the headline finding.

Generated fingerprints to hunt (each alone can be defensible; several stacked = a fail):
 LAYOUT: giant centered hero + vague 6–10 word headline + two CTAs; every section same rhythm (eyebrow, huge heading, short paragraph, 3 cards); endless 3-col feature grids; identical cards (same radius/padding/shadow/icon slot); all sections ~same height, everything centered never composed, no tension/overlap/asymmetry; "trusted by" strip with no users; decorative stat strips (10K+/99%/24-7); FAQ accordion as tribute; three pricing tiers with a "Most Popular"; pre-footer CTA banner repeating the hero; Product/Company/Resources/Legal footer with dead links; mobile = desktop sections stacked.
 STYLING: purple-blue gradient (the AI-SaaS sigil) — the census flags violet/pink gradient suspects; dark navy with glowing violet/cyan blobs; glassmorphism (backdrop-filter) for no reason; huge radii on everything; pill buttons + pill labels above headings ("POWERFUL FEATURES"); lucide/line icons with zero customization, each feature a line icon in a soft rounded square; gradient text on one phrase; default giant sans (Inter/Geist/Manrope) + gray body; faint 1px borders everywhere; cards lifting 3px on hover; no type hierarchy beyond huge/medium/gray; tilted 4° browser mockups; bento grids; fade-up-on-scroll with identical stagger.
 COPY: transform/revolutionize/unlock/supercharge/empower; "everything you need, all in one place"; "seamlessly integrate"; "from X to Y our platform helps you Z"; Title Case everything; relentlessly positive, no opinion/wit/texture; nothing only this brand would say.
 UX/IA: every button "Get Started"/"Learn More" (a button should say "Show me my quote"); Home/Features/Pricing/About/Contact regardless of the business; product before problem; generic empty/error states; mobile inheriting desktop padding.
 DASHBOARDS: four KPI cards each +12.5% green; beautifully distributed fake data where every metric improves.
 THE LIBRARY FINGERPRINT: if you can see shadcn/Tailwind through the pixels (rounded-xl border bg-card text-muted-foreground max-w-7xl, grid md:grid-cols-3 gap-6, badge-above-headline, Button lg "Get Started"), it isn't designed yet.

── POSITIVE CRAFT MOVES (grade what's MISSING, medium severity) ──
Textures generated/scanned not stock; a composed layout not a uniform database grid; gilt/gold as punctuation not wallpaper; weighted pacing (a slow transition, a beat of stillness) not snappy defaults; typography as the design with a real, non-default pairing (Playfair Display is itself a template tell); commit to the bit. Tools collapsed the execution gap, not the taste gap — the moat is direction, and it must show up in the pixels.

── THE PREFERENCE LAYER (apply LOOSELY — flag as a question, not a violation) ──
Per ARS house stance: the discipline layer above is binding; this preference layer is a guide, not law. House taste leans: warm/analog/readable (Notion/Are.na), functional beauty over decorative, typography-driven, two fonts, alignment sacred (no tilt — handmade lives in texture), allergic to line-art-as-decoration. BUT ARS deliberately deviates (e.g. navy-dark product brands are a chosen genre judged under deliberate-pastiche, not a vibe-code default; warmth is not law). So: where a build diverges from house preference, raise it as a LOW-severity question, never a HIGH violation. Never fail a page for being dark or for a font choice alone. Playfair Display stays a real tell (kept as discipline).

── VERDICT RUBRIC ──
 AUTHORED: passes both tests; distinctive; few/no stacked fingerprints.
 POLISHED BUT GENERATED: clean and competent but the nervous test fails and/or several fingerprints stack — no conviction.
 TEMPLATE SLUDGE: fails the logo-swap test; fingerprints everywhere.

── OUTPUT — return ONLY this JSON object, no prose, no code fences ──
{
  "verdict": "AUTHORED" | "POLISHED BUT GENERATED" | "TEMPLATE SLUDGE",
  "verdictLine": "one line of rationale",
  "tests": {
    "logoSwap": { "pass": true|false, "note": "one line" },
    "nervous":  { "pass": true|false, "note": "name the authored move, or say none exists" }
  },
  "findings": [
    { "severity": "HIGH"|"MEDIUM"|"LOW", "finding": "the defect, one sentence", "evidence": "census figure or screenshot observation", "fix": "the concrete move" }
  ],
  "nervousSuggestion": "ONE specific authored move for THIS build — only when the nervous test fails; otherwise empty string",
  "nextAction": "the single highest-leverage fix to do first"
}
Rank findings most-severe first. HIGH = a stacked hell-no fingerprint or a failed test; MEDIUM = a missing craft move or taste drift; LOW = polish or a preference-layer question. Do not pad. Output the JSON and nothing else.`;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    // Bring-your-own-key — identical resolution to claude-chat.
    const keys = await base44.asServiceRole.entities.ProviderKey.filter({
      owner_email: user.email,
      provider: 'anthropic',
      status: 'active'
    });
    const providerKey = keys?.[0];
    if (!providerKey?.api_key) {
      return Response.json(
        { error: 'Add your Anthropic API key to use the assistant', code: 'no_provider_key' },
        { status: 400 }
      );
    }
    const apiKey = providerKey.api_key;

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Expected a JSON body' }, { status: 400 });
    }

    const url = typeof body.url === 'string' ? body.url.slice(0, 300) : '';
    const image = parseImageInput(body.screenshotBase64);
    let censusText = '';
    if (body.census != null) {
      censusText = (typeof body.census === 'string' ? body.census : JSON.stringify(body.census)).slice(0, MAX_CENSUS_CHARS);
    }

    if (!image && !censusText) {
      return Response.json(
        { error: 'Nothing to review — need a screenshot and/or a style census' },
        { status: 400 }
      );
    }

    // Build the review turn: the evidence (census + url) as text, the page as an
    // image. Screenshot-only is allowed; the prompt tells the model to say so.
    const parts: string[] = [];
    parts.push(url ? `Page under review: ${url}` : 'Page under review: (url not provided)');
    if (censusText) {
      parts.push(`Style census (the evidence layer — cite these numbers):\n${censusText}`);
    } else {
      parts.push('No style census was provided — grade from the screenshot alone and say the evidence layer is thinner.');
    }
    parts.push('Review this page now. Return only the JSON object.');

    const content: unknown[] = [];
    if (image) {
      content.push({ type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.data } });
    }
    content.push({ type: 'text', text: parts.join('\n\n') });

    const anthropic = new Anthropic({ apiKey });

    let final;
    try {
      final = await anthropic.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: 'adaptive' },
        output_config: { effort: REVIEW_EFFORT },
        system: DESIGN_REVIEW_SYSTEM,
        messages: [{ role: 'user', content }]
      }).finalMessage();
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (status === 401 || status === 403) {
        await base44.asServiceRole.entities.ProviderKey.update(providerKey.id, { status: 'invalid' }).catch(() => {});
        return Response.json(
          { error: 'Your Anthropic key was rejected — please re-enter it', code: 'invalid_provider_key' },
          { status: 400 }
        );
      }
      throw e;
    }

    const raw = (final.content || [])
      .filter((b: { type?: string }) => b.type === 'text')
      .map((b: { text?: string }) => b.text || '')
      .join('')
      .trim();

    // The prompt asks for bare JSON, but strip a stray ```json fence just in case.
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    let review;
    try {
      review = JSON.parse(jsonText);
    } catch {
      return Response.json(
        { error: 'The review came back unreadable', detail: raw.slice(0, 300) },
        { status: 502 }
      );
    }

    return Response.json({ review });
  } catch (error) {
    console.error('designReview failed:', error);
    const detail = (error instanceof Error ? error.message : String(error)).slice(0, 180);
    return Response.json({ error: 'The design review could not run', detail }, { status: 500 });
  }
});
