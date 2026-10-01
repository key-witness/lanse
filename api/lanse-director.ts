type RequestLike = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};
type ResponseLike = {
  status: (code: number) => ResponseLike;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

type Beat = 'c4' | 'c11';
type SignalValue = string | boolean;
type DirectorPayload = { beat?: unknown; signals?: unknown };

const MODEL = 'openai/gpt-5.4-mini';
const WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS = 4;
const requests = new Map<string, number[]>();
const responseCache = new Map<string, string>();
function originAllowed(origin: string) {
  if (origin === 'null') return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:'
      && (url.hostname === 'lanse.vercel.app'
        || (url.hostname.startsWith('lanse-') && url.hostname.endsWith('.vercel.app')));
  } catch {
    return false;
  }
}
const options: Record<Beat, readonly string[]> = {
  c4: ['house', 'water', 'voice'],
  c11: ['kin', 'record', 'threshold'],
};

function clientIp(req: RequestLike) {
  const forwarded = req.headers?.['x-forwarded-for'];
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded || 'unknown').split(',')[0].trim();
}

function limited(ip: string) {
  const now = Date.now();
  const recent = (requests.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS) return true;
  recent.push(now);
  requests.set(ip, recent);
  return false;
}

function setCors(req: RequestLike, res: ResponseLike) {
  const rawOrigin = req.headers?.origin;
  const origin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
  if (origin && originAllowed(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Vary', 'Origin');
  return !origin || originAllowed(origin);
}

function parseBody(body: unknown): DirectorPayload | null {
  try {
    return typeof body === 'string' ? JSON.parse(body || '{}') as DirectorPayload : (body || {}) as DirectorPayload;
  } catch {
    return null;
  }
}

function cleanSignals(beat: Beat, input: unknown): Record<string, SignalValue> {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  if (beat === 'c4') {
    const errand = ['held', 'repeated', 'looked'].includes(String(source.errand)) ? String(source.errand) : 'unset';
    const route = ['levee', 'cane'].includes(String(source.route)) ? String(source.route) : 'unset';
    const relic = ['photograph', 'bell', 'fig'].includes(String(source.relic)) ? String(source.relic) : 'unset';
    const eyes = ['mouth', 'window', 'closed'].includes(String(source.eyes)) ? String(source.eyes) : 'unset';
    const thank = ['swallowed', 'half', 'asked'].includes(String(source.thank)) ? String(source.thank) : 'unset';
    return { errand, route, relic, eyes, thank, answeredSmell: source.answeredSmell === true };
  }
  const answer = ['words', 'hands', 'cup'].includes(String(source.answer)) ? String(source.answer) : 'unset';
  const first = ['mama', 'children', 'row'].includes(String(source.first)) ? String(source.first) : 'unset';
  const overheard = ['dream', 'birds', 'man'].includes(String(source.overheard)) ? String(source.overheard) : 'unset';
  return { answer, first, overheard, readChapterFour: source.readChapterFour === true };
}

function remember(cacheKey: string, thread: string) {
  if (responseCache.size >= 128) responseCache.delete(responseCache.keys().next().value as string);
  responseCache.set(cacheKey, thread);
}

export default async function handler(req: RequestLike, res: ResponseLike) {
  res.setHeader('Cache-Control', 'private, max-age=86400');
  if (!setCors(req, res)) return res.status(403).json({ error: 'Origin not allowed.' });
  if (req.method === 'OPTIONS') return res.status(204).json({});
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = parseBody(req.body);
  if (!body) return res.status(400).json({ error: 'Invalid JSON.' });
  const beat: Beat | null = body.beat === 'c4' || body.beat === 'c11' ? body.beat : null;
  if (!beat) return res.status(400).json({ error: 'Unknown story beat.' });
  const signals = cleanSignals(beat, body.signals);
  const cacheKey = `${beat}:${JSON.stringify(signals)}`;
  const cached = responseCache.get(cacheKey);
  if (cached) return res.status(200).json({ thread: cached, cached: true });
  if (limited(clientIp(req))) return res.status(429).json({ error: 'The telling needs a rest.' });

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return res.status(503).json({ error: 'Director is not configured.' });

  const beatGuide = beat === 'c4'
    ? 'house = domestic memory and care; water = boundaries, risk, and crossing; voice = listening, prayer, and what remains unsaid.'
    : 'kin = family and inherited care; record = names, history, and acts of witness; threshold = distance, return, and belonging.';

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://lanse-indol.vercel.app',
        'X-Title': "L'ANSE quiet narrative director",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        max_tokens: 120,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'narrative_direction',
            strict: true,
            schema: {
              type: 'object',
              properties: { thread: { type: 'string', enum: options[beat] } },
              required: ['thread'],
              additionalProperties: false,
            },
          },
        },
        messages: [
          {
            role: 'system',
            content: `You are a silent narrative director for a literary game. Select one authored thematic thread from the allowed enum. Infer the player's dominant mode of attention from the compact choice signals. Do not write prose, explain, moralize, or resolve supernatural ambiguity. ${beatGuide}`,
          },
          { role: 'user', content: JSON.stringify(signals) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
    const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
    const parsed = JSON.parse(payload.choices?.[0]?.message?.content || '{}') as { thread?: unknown };
    const thread = typeof parsed.thread === 'string' && options[beat].includes(parsed.thread) ? parsed.thread : null;
    if (!thread) throw new Error('No valid narrative direction');
    remember(cacheKey, thread);
    return res.status(200).json({ thread });
  } catch (error) {
    console.error('narrative direction failed', error instanceof Error ? error.message : error);
    return res.status(502).json({ error: 'The telling stayed with the written page.' });
  }
}
