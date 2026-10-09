/* Flow AI on the phone: the shape of what the server sends, plain-words errors, and the light formatting of an answer (bullets, bold). Nothing here talks to the network. */

export type AiStatus = { configured: boolean; enabled: boolean; can_ask: boolean; remaining: number | null; limit: number | null; suggestions: string[] };
export type AiMessage = { role: 'user' | 'assistant'; content: string; tools?: { name: string; label: string }[] | null };
export type AiChat = { conversation_id: number; answer: string; tools_used?: { name: string; label: string }[] };
export type AiConversation = { conversation_id: number; title: string; updated_at: string };

/** Questions to offer when the server has none to suggest (it only suggests what this person is allowed to ask about). */
export const FALLBACK_QUESTIONS = ['How much did I sell today?', 'Which item sells the most?', 'Why are my sales lower this week?', 'How much food did I waste?'];
export const questionsFor = (s: Pick<AiStatus, 'suggestions'> | null): string[] => (s?.suggestions?.length ? s.suggestions.slice(0, 5) : FALLBACK_QUESTIONS);

export const MAX_QUESTION = 1000;
export const askProblem = (text: string): string => (!text.trim() ? '' : text.trim().length > MAX_QUESTION ? 'Keep the question a little shorter' : '');

/** What the person is told when it cannot be asked: no technical words, and what they can do. */
export const unavailable = (s: AiStatus | null): { title: string; body: string } | null => {
  if (!s) return null;
  if (!s.configured) return { title: 'Flow AI is not set up yet', body: 'Whoever looks after FlowXP for you needs to switch it on. Everything else in the app works as usual.' };
  if (!s.enabled) return { title: 'Flow AI is switched off', body: 'An owner can turn it on from the FlowXP website.' };
  if (s.remaining === 0) return { title: 'No questions left this month', body: `You have used all ${s.limit ?? ''} questions on your plan. They come back next month.`.replace('all  ', 'all ') };
  return null;
};

/** Turns what went wrong into a sentence a restaurant owner can act on. */
export const friendlyError = (e: unknown): string => {
  const status = (e as { status?: number })?.status;
  const code = (e as { code?: string })?.code;
  const message = e instanceof Error ? e.message : '';
  if (code === 'AI_NOT_CONFIGURED' || status === 503) return 'Flow AI is not set up yet. Everything else in the app works as usual.';
  if (code === 'AI_DISABLED') return 'Flow AI is switched off for this business.';
  if (code === 'AI_LIMIT' || status === 402) return 'You have used all your questions this month. They come back next month.';
  if (status === 429) return 'That was a lot of questions at once. Wait a minute and try again.';
  if (status === 403) return 'Flow AI is for owners and managers.';
  if (e instanceof Error && e.name === 'NetworkError') return 'Could not connect. Your questions need the internet. Try again when you are online.';
  return message && !/^The server answered/.test(message) ? message : 'Flow AI could not answer just now. Please try again.';
};

/* ── the answer, as blocks the screen can draw ── */
export type Span = { text: string; bold: boolean };
export type Block = { kind: 'p' | 'bullet' | 'number'; spans: Span[]; n?: number };

export const spans = (line: string): Span[] => line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part) => (part.startsWith('**') && part.endsWith('**') ? { text: part.slice(2, -2), bold: true } : { text: part, bold: false }));

export const blocks = (answer: string): Block[] => {
  const out: Block[] = [];
  let n = 0;
  for (const raw of answer.split('\n')) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-•*]\s+(.*)/); const numbered = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (bullet) { n = 0; out.push({ kind: 'bullet', spans: spans(bullet[1]) }); }
    else if (numbered) { n += 1; out.push({ kind: 'number', n, spans: spans(numbered[1]) }); }
    else { n = 0; if (line.trim()) out.push({ kind: 'p', spans: spans(line.replace(/^#+\s*/, '')) }); }
  }
  return out;
};
