// app/api/prompting-studio/generate-single/route.ts
// Generates ONE optimized image prompt for a FICTIONAL character or original
// subject. Real, identifiable people are rejected by the content filter before
// any prompt is written — fictional characters (movies, games, anime, books)
// and original creations are allowed.

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { cookies } from 'next/headers';
import { getUserFromSession } from '@/lib/auth';
import { enforceContentFilter } from '@/lib/content-filter';
import { resolvePromptModel } from '@/lib/prompt-models';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function POST(req: NextRequest) {
  try {
    // This endpoint spends Gemini tokens — signed-in users only
    const token = (await cookies()).get('session')?.value;
    const user = token ? await getUserFromSession(token) : null;
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await req.json();
    // `subject` is the field; `celebrity` accepted as a legacy alias from old clients
    const subject: string = String(body.subject ?? body.celebrity ?? '').trim();
    const { baseStyle, promptModel } = body;
    /*
     * The prompt already in the target slot, if any.
     *
     * Present means REWRITE: the slot's text is the thing being changed and
     * the inputs are direction for how to change it. Absent means COMPOSE from
     * the inputs alone. One route, because the difference is a prompt, not a
     * pipeline.
     */
    const existing: string = String(body.existing ?? '').trim();

    if (!subject && !existing) {
      return NextResponse.json({ error: 'Subject or character name required' }, { status: 400 });
    }

    // Content filter — real people's names are rejected here (fictional
    // characters pass). Same policy as every generation route.
    const cf = await enforceContentFilter(subject, user.email);
    if (!cf.ok) {
      return NextResponse.json({ error: cf.reason }, { status: 400 });
    }

    /*
     * The id IS the API's id now.
     *
     * There used to be a translation table here mapping four UI names onto
     * Gemini names, two of which pointed at models that no longer exist and
     * silently resolved to 2.5 — so picking them changed nothing and reported
     * nothing. lib/prompt-models.ts is enumerated from the live ListModels
     * endpoint, and anything not in it falls back explicitly.
     */
    const actualModelName = resolvePromptModel(promptModel);

    const rewritePrompt = `You are an expert AI image prompt engineer. Below is an EXISTING image prompt, and a note on how the user wants it changed. Rewrite the prompt so it incorporates the direction.

EXISTING PROMPT:
${existing}

DIRECTION FROM THE USER:
${[subject && `Subject / characters: ${subject}`, baseStyle && `Style and treatment: ${baseStyle}`].filter(Boolean).join('\n') || 'Improve it: sharper, more specific, better image-model tokens.'}

CRITICAL RULES:
1. This is a REWRITE. Keep what the existing prompt already establishes unless the direction changes it — you are editing, not starting over.
2. Treat any named person as a FICTIONAL character or original creation — never reference a real person, actor or celebrity.
3. Keep the high-quality tokens (photorealistic, 4k, detailed) and add any that are missing.
4. Keep it under 120 words.
5. NO explicit content.

Respond with ONLY the rewritten prompt text, no commentary, no preamble, no quotes.`;

    const composePrompt = `You are an expert AI image prompt engineer. Generate ONE optimized prompt for the fictional character or subject "${subject}" with the following requirements:

CRITICAL RULES:
1. The subject must be treated as a FICTIONAL character or original creation — never reference any real person, actor, or celebrity
2. Include high-quality tokens (photorealistic, 4k, high quality, detailed, etc.)
3. Include style: ${baseStyle}
4. Add appropriate lighting, atmosphere, and technical details
5. Keep it under 100 words
6. NO explicit content — focus on artistic/professional qualities

Respond with ONLY the prompt text, no other commentary or formatting.`;

    const systemPrompt = existing ? rewritePrompt : composePrompt;

    const aiModel = genAI.getGenerativeModel({
      model: actualModelName,
      generationConfig: { temperature: 0.7 }
    });

    const result = await aiModel.generateContent(systemPrompt);
    const prompt = result.response.text().trim();

    // The generated prompt itself must also pass the filter before it's handed
    // back for one-click generation
    const outCf = await enforceContentFilter(prompt, user.email);
    if (!outCf.ok) {
      return NextResponse.json({ error: outCf.reason }, { status: 400 });
    }

    return NextResponse.json({ success: true, prompt });
  } catch (error) {
    console.error('Prompt generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate prompt' },
      { status: 500 }
    );
  }
}
