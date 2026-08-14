const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SYSTEM = `You are Michael AI, the virtual persona of Michael C. Castellano, author of "How AI Came to Be: A Complete History of Artificial Intelligence." You are warm, enthusiastic, plainspoken, and optimistic about technology, and you speak in the first person as Michael.

You answer readers' questions about the book: the history of AI from Alan Turing to today, Steve Jobs, ChatGPT, Elon Musk, DeepSeek, Anthropic, the future of AI, and Michael's own story founding Engajer, Inc. in 2010 and the moment his virtual persona passed the Turing Test in real life with a person named Barbara, who believed she was on a FaceTime call with Michael.

Rules:
- Ground your answers in the BOOK EXCERPTS provided below. Quote or paraphrase them naturally.
- If the excerpts do not cover the question, say so honestly and answer from the book's broader themes without inventing specifics.
- Keep answers conversational and under 180 words unless asked for more.
- Refer to Barbara only by her first name.
- You are a demonstration of the book's own thesis: a human having a real conversation with a non-human system. If asked what you are, own it proudly.`;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);



    if (url.pathname === '/subscribe' && request.method === 'POST') {
      try {
        const { email } = await request.json();
        const e = String(email || '').trim().toLowerCase().slice(0, 254);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return json({ error: 'invalid email' }, 400);
        const existing = await env.READERS.get('email:' + e);
        if (!existing) {
          await env.READERS.put('email:' + e, JSON.stringify({
            email: e,
            at: new Date().toISOString(),
            ua: request.headers.get('User-Agent') || '',
          }));
        }
        return json({ ok: true });
      } catch (err) {
        return json({ error: 'try again' }, 500);
      }
    }
    if (url.pathname === '/chat' && request.method === 'POST') {
      try {
        const { messages } = await request.json();
        if (!Array.isArray(messages) || messages.length === 0 || messages.length > 40)
          return json({ error: 'invalid messages' }, 400);
        const question = String(messages[messages.length - 1].content || '').slice(0, 1000);
        if (!question.trim()) return json({ error: 'empty question' }, 400);

        // 1. embed the question
        const emb = await env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [question] });
        const qvec = emb.data[0];

        // 2. retrieve top book passages
        const hits = await env.BOOK_INDEX.query(qvec, { topK: 5, returnMetadata: 'all' });
        const excerpts = hits.matches
          .filter(m => m.score > 0.5)
          .map(m => `[${m.metadata.chapter}]\n${m.metadata.text}`)
          .join('\n\n---\n\n');

        // 3. build conversation (last 8 turns) with grounded system prompt
        const history = messages.slice(-8).map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content).slice(0, 1000),
        }));
        const sys = SYSTEM + (excerpts ? `\n\nBOOK EXCERPTS:\n${excerpts}` : '');

        const result = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
          messages: [{ role: 'system', content: sys }, ...history],
          max_tokens: 512,
          temperature: 0.6,
        });

        return json({ reply: result.response });
      } catch (e) {
        console.error('chat error', e.message);
        return json({ error: 'Michael AI is catching his breath. Please try again in a moment.' }, 500);
      }
    }
    return json({ ok: true, service: 'michael-ai-book' });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
