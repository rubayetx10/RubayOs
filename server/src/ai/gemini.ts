import { AppError } from '../common/errors';
import { env } from '../config/env';
import { logger } from '../config/logger';

export interface AiFile {
  mime: string;
  data: Buffer;
}

/**
 * Asks Gemini to read one file and answer in JSON. The API key stays on the server.
 * Other providers can be added next to this one later; callers only see generateJson().
 */
export async function generateJson(prompt: string, file: AiFile): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    throw new AppError(503, 'AI_NOT_CONFIGURED', 'Reading routines automatically is not set up yet. Add GEMINI_API_KEY in the server settings, or enter the routine by hand.');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: file.mime, data: file.data.toString('base64') } }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
      signal: ctrl.signal,
    });
    if (res.status === 429) throw new AppError(429, 'AI_BUSY', 'The AI service is busy or over its free limit. Please try again in a minute.');
    if (!res.ok) {
      logger.error({ status: res.status, body: (await res.text()).slice(0, 300) }, 'Gemini request failed');
      throw new AppError(502, 'AI_FAILED', 'The AI service could not read this file. Try a clearer file, or enter the routine by hand.');
    }
    const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text.trim()) throw new AppError(502, 'AI_EMPTY', 'The AI service returned nothing for this file. Try a clearer file.');
    return text;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if ((err as { name?: string }).name === 'AbortError') throw new AppError(504, 'AI_TIMEOUT', 'The AI service took too long. Please try again.');
    logger.error({ err: String((err as Error)?.message ?? err) }, 'Gemini call error');
    throw new AppError(502, 'AI_FAILED', 'Could not reach the AI service. Please try again.');
  } finally {
    clearTimeout(timer);
  }
}
