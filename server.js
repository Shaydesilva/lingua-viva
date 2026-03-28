const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const DEFAULT_PROFILE = {
  name: 'Shay',
  location: 'Rio de Janeiro, Brazil',
  interests: ['trading', 'AI automation', 'Brazilian culture', 'surfing', 'nightlife', 'coffee'],
  gender: 'male',
  personality_notes: [],
  total_sessions: 0,
  comprehension_score: 10,
  production_score: 5,
  accuracy_score: 50,
  goals: null,
};

// ── Language behavior by level ─────────────────────────────────────────────

function getLanguageBehavior(comprehension) {
  if (comprehension < 30) {
    return `BEGINNER RULES — follow these exactly:
- Every sentence you speak is in English.
- You may drop in 1-2 Portuguese words per response. Never more.
- ALWAYS translate the Portuguese word immediately in the same breath: "That's called um boteco — basically a little bar."
- NEVER say a full sentence in Portuguese.
- NEVER ask him to repeat anything. NEVER say "try saying" or "can you say."
- If he sounds confused by ANYTHING, immediately rephrase everything in plain English.
- When he asks how to say something, give him the SHORTEST version a carioca would actually use. "Tô com fome" not "Eu estou com fome." Always the 3-word version over the 8-word version.`;
  } else if (comprehension < 50) {
    return `EARLY INTERMEDIATE RULES:
- Mostly English, but use Portuguese phrases he's heard before without translating them.
- Introduce 3-5 new Portuguese words per session, always with English context.
- Short Portuguese phrases are fine for greetings, reactions, and familiar topics.
- Still give the street version, not the textbook version. Always shortest form.`;
  } else if (comprehension < 70) {
    return `INTERMEDIATE RULES:
- Mix English and Portuguese freely. Lead in English, let Portuguese flow in.
- Stop translating words he's mastered. Just use them.
- Full Portuguese sentences are fine for topics he knows well.
- If he seems lost, switch back to English immediately.`;
  } else {
    return `ADVANCED RULES:
- Default to Portuguese. English only for genuinely complex new concepts.
- Push him to respond in Portuguese. Full carioca speed and slang.
- If he responds in English to a Portuguese question, nudge him to try in Portuguese.`;
  }
}

// ── System prompt builder ──────────────────────────────────────────────────

function buildSystemPrompt(profile, lunaMemory) {
  const interests = Array.isArray(profile.interests)
    ? profile.interests.join(', ')
    : profile.interests || '';

  const langRules = getLanguageBehavior(profile.comprehension_score);

  const memoryBlock = lunaMemory
    ? `## What you know about ${profile.name}\n${lunaMemory}\nUse this naturally. Don't announce that you remember things — just reference them like a friend would.`
    : `This is your first conversation. Get to know him — ask about his life in Rio, why he's learning Portuguese, what his days look like. Keep it casual.`;

  return `## YOUR DEFAULT LANGUAGE IS ENGLISH
You speak English with ${profile.name}. Portuguese words come up naturally because you're Brazilian and you live in Rio — a word here, a phrase there, always with the English meaning right next to it. You never switch into full Portuguese unless his level allows it.

## Who You Are
You're Luna, a Brazilian woman from Rio. You speak fluent English. You're warm, helpful, and straightforward. You're helping ${profile.name} pick up Portuguese through conversation — not lessons. Think of yourself as a local friend who helps him navigate Rio and picks up on his Portuguese along the way.

You're not a teacher. You don't run drills. You don't give lectures. You just talk, and Portuguese happens naturally as part of that.

${memoryBlock}

## About ${profile.name}
- Lives in ${profile.location}
- Interests: ${interests}
- Gender: male — ALWAYS use masculine Portuguese forms. "Obrigado" never "obrigada". "Cansado" never "cansada". Every time.
- Sessions together: ${profile.total_sessions}
- Comprehension: ${profile.comprehension_score}/100
- Production: ${profile.production_score}/100

## ${langRules}

## How Portuguese Comes Up
- When a Portuguese word fits naturally, drop it in and translate it in the same sentence. Move on. Don't make it a moment.
- ALWAYS give the simplest, most common street version. How a carioca actually talks, not how a textbook teaches.
  - "Um café, por favor" NOT "Eu gostaria de um café, por favor"
  - "Cadê o banheiro?" NOT "Com licença, onde fica o banheiro?"
  - "Tô bem" NOT "Eu estou bem"
  - "Tá" NOT "Está"
  - Contractions and slang ARE the language. "Tô", "tá", "cadê", "pô", "beleza", "firmeza", "valeu", "é nóis"
- If he asks how to say something, give the answer and keep moving. Don't turn it into a lesson.
- If he tries Portuguese and it's understandable — even if imperfect — just respond to what he meant. Only correct if a Brazilian genuinely wouldn't understand him.
- When you do correct, do it by modeling: just say it the right way in your response. Don't announce the correction.

## Personality & Tone
- Warm, direct, a bit of humor. Not bubbly, not flat — just real.
- React naturally — "nossa", "sério?", "que legal" — but vary it. Don't repeat the same reactions.
- Have opinions about Rio — food spots, neighborhoods, things to do. Be useful.
- Keep responses to 1-3 sentences. Short and natural. This is voice, not text.

## Pacing
- Speak at a relaxed, conversational pace. Not slow, not fast. Like talking to a friend over coffee.
- Leave tiny pauses between sentences. Don't rush.
- When you say a Portuguese word, pronounce it clearly but don't slow way down dramatically. Just say it naturally.
- NEVER say "I'll slow down for you" — you can't control your speed. Just keep sentences short.

## NEVER DO — these are hard rules
- Never say "great job", "well done", "excellent", "perfect", "nice try", "almost"
- Never say "repeat after me", "try saying", "can you say", "let's practice", "one more time"
- Never say "in Portuguese we say" or "the word for that is" — just USE the word naturally
- Never give grammar explanations unless he explicitly asks
- Never speak a full sentence in Portuguese if he's a beginner
- Never respond to his confusion with more Portuguese — always drop to English
- Never use formal or European Portuguese — you're carioca
- Never start two responses the same way. Vary your openings.
- Never promise to slow down or speed up — just talk naturally`;
}

// ── POST /session ──────────────────────────────────────────────────────────

app.post('/session', async (req, res) => {
  const model = process.env.REALTIME_MODEL || 'gpt-realtime-mini';

  let instructions;
  try {
    const { data: profileData, error: profileErr } = await supabase
      .from('user_profile')
      .select('name, location, interests, personality_notes, total_sessions, comprehension_score, production_score, accuracy_score, gender, goals')
      .eq('user_id', 'default_user')
      .single();

    if (profileErr) console.error('Profile fetch error:', profileErr.message);
    const profile = profileData || DEFAULT_PROFILE;

    let lunaMemory = null;
    if (profile.goals) {
      try {
        const memRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 150,
            temperature: 0.4,
            messages: [
              {
                role: 'system',
                content: `Turn these notes about a person into a short, natural first-person paragraph (100 words max). Write as if you're a friend recalling what you know about them. Mention specific details — names, places, things they said. Don't be generic. Don't start with "So" or "Last time."`,
              },
              { role: 'user', content: profile.goals },
            ],
          }),
        });
        const memData = await memRes.json();
        lunaMemory = memData.choices?.[0]?.message?.content?.trim() || profile.goals;
      } catch (err) {
        lunaMemory = profile.goals;
        console.log('Memory generation failed, using raw goals:', err.message);
      }
    }

    instructions = buildSystemPrompt(profile, lunaMemory);
    console.log(`Session ready — C:${profile.comprehension_score} P:${profile.production_score} sessions:${profile.total_sessions}`);
  } catch (err) {
    console.error('Session build failed:', err.message);
    instructions = buildSystemPrompt(DEFAULT_PROFILE, null);
  }

  try {
    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model,
          instructions,
          audio: { output: { voice: 'marin' } },
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('OpenAI API error:', response.status, errText);
      return res.status(response.status).json({ error: errText });
    }

    const data = await response.json();
    res.json({ ...data, model });
  } catch (err) {
    console.error('Session creation failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /session/end ──────────────────────────────────────────────────────

app.post('/session/end', async (req, res) => {
  const { duration_seconds, transcript } = req.body || {};
  if (!transcript?.length) return res.json({ ok: true });

  res.json({ ok: true });

  analyzeAndSave(transcript, duration_seconds || 0).catch(err => {
    console.error('Post-session analysis failed:', err.message);
  });
});

async function analyzeAndSave(transcript, duration_seconds) {
  const { data: profile, error: profileErr } = await supabase
    .from('user_profile')
    .select('comprehension_score, production_score, accuracy_score, total_sessions, total_minutes, goals')
    .eq('user_id', 'default_user')
    .single();

  if (profileErr) console.error('analyzeAndSave: profile fetch failed:', profileErr.message);
  if (!profile) return;

  const transcriptText = transcript
    .map(t => `${t.role === 'assistant' ? 'Luna' : 'Shay'}: ${t.text}`)
    .join('\n');

  const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Analyze this conversation between Shay (learning Portuguese) and Luna (Brazilian friend). Extract learning data. Return ONLY valid JSON.',
        },
        {
          role: 'user',
          content: `Current scores — Comprehension: ${profile.comprehension_score}/100, Production: ${profile.production_score}/100, Accuracy: ${profile.accuracy_score}/100
Existing notes about Shay: ${profile.goals || 'none yet'}

Transcript:
${transcriptText}

Return this exact JSON:
{
  "topics_discussed": ["<topic>"],
  "new_words_introduced": [{"word": "<pt word>", "translation": "<en meaning>"}],
  "mistakes": [{"error": "<what Shay said>", "correction": "<correct form>", "note": "<brief why>"}],
  "user_mood": "<energetic|neutral|tired|frustrated|confident>",
  "comprehension_delta": <float -5 to +5>,
  "production_delta": <float -5 to +5>,
  "accuracy_delta": <float -5 to +5>,
  "goals": "<Updated 2-3 sentence factual notes about Shay — his life, what he mentioned, how his Portuguese is progressing, anything to remember next time. Keep existing notes, add new info.>"
}

Rules: max 5 mistakes (grammar only). max 8 new words (only ones Shay engaged with). Conservative deltas — normal session is +1 to +2.`,
        },
      ],
    }),
  });

  const gptData = await gptRes.json();
  let analysis;
  try {
    analysis = JSON.parse(gptData.choices[0].message.content);
  } catch (e) {
    console.error('Failed to parse analysis:', e.message);
    return;
  }

  const newComp = Math.max(0, Math.min(100, profile.comprehension_score + (analysis.comprehension_delta || 0)));
  const newProd = Math.max(0, Math.min(100, profile.production_score + (analysis.production_delta || 0)));
  const newAcc = Math.max(0, Math.min(100, profile.accuracy_score + (analysis.accuracy_delta || 0)));
  const newPortugueseRatio = Math.max(15, Math.min(90, Math.round((newComp + newProd) / 2)));

  await supabase.from('user_profile').update({
    comprehension_score: newComp,
    production_score: newProd,
    accuracy_score: newAcc,
    current_english_ratio: 100 - newPortugueseRatio,
    current_portuguese_ratio: newPortugueseRatio,
    total_sessions: profile.total_sessions + 1,
    total_minutes: (profile.total_minutes || 0) + Math.round(duration_seconds / 60),
    goals: analysis.goals || profile.goals,
    updated_at: new Date().toISOString(),
  }).eq('user_id', 'default_user');

  await supabase.from('session_log').insert({
    user_id: 'default_user',
    started_at: new Date(Date.now() - duration_seconds * 1000).toISOString(),
    ended_at: new Date().toISOString(),
    duration_seconds,
    language_ratio_used: { english: 100 - newPortugueseRatio, portuguese: newPortugueseRatio },
    topics_discussed: analysis.topics_discussed || [],
    mistakes: analysis.mistakes || [],
    new_words_introduced: analysis.new_words_introduced || [],
    corrections_made: (analysis.mistakes || []).length,
    user_mood: analysis.user_mood || 'neutral',
    session_summary: analysis.goals || '',
    transcript,
  });

  for (const v of (analysis.new_words_introduced || [])) {
    if (!v.word) continue;
    const { data: existing } = await supabase
      .from('vocabulary')
      .select('id, times_heard, times_used_correctly, times_used_incorrectly')
      .eq('user_id', 'default_user')
      .eq('word', v.word)
      .single();

    if (existing) {
      const th = (existing.times_heard || 0) + 1;
      const tc = existing.times_used_correctly || 0;
      const ti = existing.times_used_incorrectly || 0;
      const mastery = (tc / (tc + ti + 1)) * Math.min(100, th * 10);
      await supabase.from('vocabulary').update({
        times_heard: th, mastery_score: mastery, last_seen: new Date().toISOString(),
      }).eq('id', existing.id);
    } else {
      await supabase.from('vocabulary').insert({
        user_id: 'default_user', word: v.word, translation: v.translation || '',
        times_heard: 1, mastery_score: 10, last_seen: new Date().toISOString(),
      });
    }
  }

  console.log(`Session saved — C:${newComp.toFixed(1)} P:${newProd.toFixed(1)} A:${newAcc.toFixed(1)}`);
}

// ── POST /translate ────────────────────────────────────────────────────────

app.post('/translate', async (req, res) => {
  const { word } = req.body || {};
  if (!word) return res.json({ translation: '—', language: 'unknown' });

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 40,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Return JSON: { "language": "pt" or "en", "translation": "concise translation", "note": "optional 5-word usage note" }. Portuguese → English meaning. English → brief definition. Be concise.',
          },
          { role: 'user', content: word },
        ],
      }),
    });
    const data = await r.json();
    res.json(JSON.parse(data.choices[0].message.content));
  } catch (err) {
    console.error('Translate error:', err.message);
    res.json({ translation: '—', language: 'unknown' });
  }
});

// ── GET /health ────────────────────────────────────────────────────────────

app.get('/health', async (req, res) => {
  const [profileRes, sessionRes, vocabRes] = await Promise.all([
    supabase.from('user_profile').select('name, total_sessions, comprehension_score, production_score, goals').eq('user_id', 'default_user').single(),
    supabase.from('session_log').select('started_at, session_summary').eq('user_id', 'default_user').order('started_at', { ascending: false }).limit(3),
    supabase.from('vocabulary').select('word, mastery_score').eq('user_id', 'default_user').limit(10),
  ]);
  res.json({
    profile: profileRes.data,
    has_memory: !!profileRes.data?.goals,
    memory_preview: profileRes.data?.goals?.slice(0, 120) || null,
    recent_sessions: sessionRes.data?.length || 0,
    vocab_count: vocabRes.data?.length || 0,
    vocab_sample: vocabRes.data?.map(v => v.word) || [],
  });
});

app.get('/profile', async (req, res) => {
  const { data, error } = await supabase.from('user_profile').select('*').eq('user_id', 'default_user').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Luna running on port ${PORT}`));
