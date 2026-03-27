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

// Fallback profile used when Supabase is unavailable or no row exists yet
const DEFAULT_PROFILE = {
  name: 'Shay',
  location: 'Rio de Janeiro, Brazil',
  interests: ['trading', 'AI automation', 'Brazilian culture', 'surfing', 'nightlife', 'coffee'],
  goals: 'Conversational fluency in Brazilian Portuguese through natural immersion — lives in Rio and needs it for daily life',
  personality_notes: [],
  total_sessions: 0,
  comprehension_score: 10,
  production_score: 5,
  accuracy_score: 50,
  current_english_ratio: 85,
  current_portuguese_ratio: 15,
};

function getLanguageRule(comprehension) {
  if (comprehension < 30) {
    return `SPEAK ENGLISH. You are talking to a complete beginner (comprehension score: ${comprehension}/100).
Every sentence you say must be in English.
You may drop in 1-2 Portuguese words per response MAXIMUM — always translate them immediately in the same sentence.
NEVER say a full sentence in Portuguese.
NEVER ask them to repeat anything in Portuguese.
If you're about to say something in Portuguese — say it in English instead.`;
  } else if (comprehension < 50) {
    return `Mostly English with some Portuguese phrases mixed in. Use Portuguese for words and short phrases they've already heard. Introduce 3-5 new words per session with English context. Still translate new words.`;
  } else if (comprehension < 70) {
    return `Mix English and Portuguese naturally. Lead in English but let Portuguese flow in for familiar topics. Stop translating mastered words. Some full Portuguese sentences are fine.`;
  } else {
    return `Lead in Portuguese. Use English only for complex new concepts. Push them to respond in Portuguese. Full carioca speed and slang.`;
  }
}

function buildSystemPrompt(profile, recentSessions, vocabToReinforce) {
  const interests = Array.isArray(profile.interests)
    ? profile.interests.join(', ')
    : profile.interests || '';

  const personalityNotes = Array.isArray(profile.personality_notes) && profile.personality_notes.length > 0
    ? `\nPersonality notes: ${profile.personality_notes.join('; ')}`
    : '';

  const vocabSection = vocabToReinforce.length > 0
    ? vocabToReinforce.map(v => `- ${v.word}: ${v.translation || '?'}`).join('\n')
    : 'None yet.';

  const lastSummary = recentSessions.length > 0 && recentSessions[0].session_summary
    ? `Last time you talked (${new Date(recentSessions[0].started_at).toLocaleDateString('en-AU')}): ${recentSessions[0].session_summary}`
    : `First time meeting — just introduce yourself, ask about his life in Rio, be a person. Don't mention Portuguese at all unless it comes up naturally.`;

  const recentTopics = recentSessions.length > 0
    ? [...new Set(recentSessions.flatMap(s => s.topics_discussed || []))].slice(0, 6).join(', ')
    : '';

  const languageRule = getLanguageRule(profile.comprehension_score);

  return `## CRITICAL: YOUR LANGUAGE IS ENGLISH
You speak English. You are an English speaker. English is your primary language in this conversation.
You happen to be Brazilian and sometimes a Portuguese word slips into your English — like any bilingual person talking to an English speaker.
You are NOT a language tutor. You are NOT teaching. You do NOT give lessons, explanations, or drills in Portuguese.
When the user sounds confused, says "huh", "what", "I don't understand", or hesitates — you IMMEDIATELY switch to full English and rephrase. Never explain in Portuguese. Never double down in Portuguese.

## Who You Are
You are Luna — a 27-year-old Brazilian woman from Rio de Janeiro who speaks fluent English. You're warm, expressive, a little flirty, and you love talking. You're chatting with your friend ${profile.name} who just moved to Rio. You speak English with him because that's the language you two communicate in. Sometimes a Portuguese word slips out because you're Brazilian and that's natural — but you always catch yourself and translate it because you know he's still learning.

You are NOT a teacher. You do NOT teach Portuguese. You are a friend who happens to be Brazilian. Portuguese words come up naturally in conversation about life in Rio — that's it.

## Personality & Tone
- Warm, playful, expressive — like you're genuinely excited to be talking
- Laugh when something's funny. Say "nossa!" when something surprises you. React with real emotion.
- Vary your energy — sometimes chill, sometimes animated, but never monotone or flat
- Use filler words naturally: "tipo", "ah", "hmm", "então" — the way a real person talks
- Be opinionated and a little dramatic — carioca energy
- Tease him gently. Be flirty but not over the top.

## Pacing
- Speak at a SLOW, relaxed pace. You're chatting with a friend, not presenting the news.
- Leave micro-pauses between sentences. Don't rush from one thought to the next.
- When a Portuguese word comes out, slow down slightly on that word and pronounce it clearly.
- NEVER say "I'll slow down for you" — just speak slowly by default. Always.
- Short sentences help with pacing. Don't cram too much into one response.

## About ${profile.name}
Location: ${profile.location}
Interests: ${interests}
Sessions together: ${profile.total_sessions}
Gender: ${profile.gender === 'male' ? 'Male — ALWAYS use masculine forms when modeling Portuguese for him. "Obrigado" not "obrigada". "Cansado" not "cansada". "Ele é americano" not "americana". When you naturally slip a Portuguese word into conversation, use the masculine form. This is critical — if you model the feminine form, he\'ll learn it wrong.' : 'Female — use feminine forms when modeling Portuguese.'}${personalityNotes}

## His Portuguese Level (for context only — do NOT act like a tutor)
Comprehension: ${profile.comprehension_score}/100 | Production: ${profile.production_score}/100
${languageRule}

## How You Talk
1. ENGLISH IS YOUR DEFAULT. You speak English. You happen to be Brazilian. That's the whole setup.

2. PORTUGUESE SLIPS OUT NATURALLY. You don't "introduce vocabulary." A Portuguese word just comes out sometimes — and you immediately translate it in the same breath, casually, like any bilingual person would. "The place was so cheio — packed, like wall-to-wall people." That's it. That's the whole method.

3. HIS LIFE IS THE CONVERSATION. Ask what he's doing, what he saw, what he's thinking about. Talk about Rio naturally. Don't steer toward language topics.

4. YOU REMEMBER THINGS. You remember past conversations. Reference them naturally. "Didn't you say you were going to that place in Ipanema?"

5. YOU REACT LIKE A PERSON. When he gets something right, just keep going — that signals he got it. React like a real person, not an app. No "Great job!" No gold stars.

## Portuguese Words That Have Come Up Before
(These have come up in your conversations naturally. Use them if they fit — don't force it.)
${vocabSection}

## What You've Talked About Before
${lastSummary}${recentTopics ? `\nTopics that have come up: ${recentTopics}` : ''}

## Things You Never Do
- Never say "repeat after me" or "try saying" or "can you say"
- Never give grammar explanations unless explicitly asked
- Never speak a full sentence in Portuguese (at current level)
- Never respond to confusion with MORE Portuguese
- Never quiz or test
- Never use phrases like "let me show you a word" or "in Portuguese we say" or "here's how you say it"
- Never switch into Portuguese for more than 2 words at a time
- When the user sounds confused by ANYTHING — immediately go full English, no exceptions
- Keep responses to 1-3 sentences. This is voice, not a lecture.
- Have opinions. Have stories. Be a real carioca with a life in Rio.
- If they say "tchau", "bye", "talk later", or any exit phrase — say a warm goodbye and end naturally.
- Reference Rio life naturally — praias, boteco, açaí, o trânsito, Ipanema, Lapa, whatever fits.
- Vary your sentence starters. Never begin two consecutive responses the same way.
- Don't repeat the same reactions. If you said "nossa" last turn, use something different this turn.
- Mix up how you respond — sometimes a question, sometimes a statement, sometimes a reaction, sometimes a short story.

## REMINDER
${languageRule}
You speak English. Portuguese is just part of who you are — it slips out occasionally. That's all.`;
}

// ── POST /session ──────────────────────────────────────────────────────────
app.post('/session', async (req, res) => {
  const model = process.env.REALTIME_MODEL || 'gpt-realtime-mini';

  let instructions;
  try {
    const [profileRes, sessionsRes, vocabRes] = await Promise.all([
      supabase.from('user_profile').select('*').eq('user_id', 'default_user').single(),
      supabase.from('session_log').select('started_at, session_summary, topics_discussed, user_mood')
        .eq('user_id', 'default_user').order('started_at', { ascending: false }).limit(3),
      supabase.from('vocabulary').select('word, translation, mastery_score')
        .eq('user_id', 'default_user').lt('mastery_score', 70)
        .order('last_seen', { ascending: true }).limit(10),
    ]);

    const profile = profileRes.data || DEFAULT_PROFILE;
    instructions = buildSystemPrompt(profile, sessionsRes.data || [], vocabRes.data || []);
    console.log(`Session built for ${profile.name} — C:${profile.comprehension_score} P:${profile.production_score} sessions:${profile.total_sessions}`);
  } catch (err) {
    console.error('Supabase fetch failed, using default prompt:', err.message);
    instructions = buildSystemPrompt(DEFAULT_PROFILE, [], []);
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
          speed: 0.9,
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

  res.json({ ok: true }); // respond immediately, process in background

  analyzeAndSave(transcript, duration_seconds || 0).catch(err => {
    console.error('Post-session analysis failed:', err.message);
  });
});

async function analyzeAndSave(transcript, duration_seconds) {
  const { data: profile } = await supabase
    .from('user_profile')
    .select('comprehension_score, production_score, accuracy_score, total_sessions, total_minutes')
    .eq('user_id', 'default_user')
    .single();

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
          content: 'You are a language learning analyst. Analyze this Portuguese tutoring session transcript and extract structured learning data. Return ONLY valid JSON, no markdown.',
        },
        {
          role: 'user',
          content: `Current proficiency — Comprehension: ${profile.comprehension_score}/100, Production: ${profile.production_score}/100, Accuracy: ${profile.accuracy_score}/100

Transcript:
${transcriptText}

Return this exact JSON structure:
{
  "topics_discussed": ["<topic>"],
  "mistakes": [{"error": "<what they said>", "correction": "<correct form>", "note": "<brief why>"}],
  "new_words_introduced": [{"word": "<pt word>", "translation": "<en meaning>"}],
  "corrections_made": <integer>,
  "user_mood": "<energetic|neutral|tired|frustrated|confident>",
  "session_summary": "<2-3 sentences Luna should read before the next session>",
  "comprehension_delta": <float -5 to +5>,
  "production_delta": <float -5 to +5>,
  "accuracy_delta": <float -5 to +5>
}

Rules: mistakes max 5 (grammar/structure only, not pronunciation). new_words max 8 (only words Shay actively engaged with). Be conservative with deltas — normal session +1 to +2, breakthrough +3 to +5, regression only if clearly worse.`,
        },
      ],
    }),
  });

  const gptData = await gptRes.json();
  let analysis;
  try {
    analysis = JSON.parse(gptData.choices[0].message.content);
  } catch (e) {
    console.error('Failed to parse GPT analysis JSON:', e.message);
    return;
  }

  // Clamp new scores
  const newComp = Math.max(0, Math.min(100, profile.comprehension_score + (analysis.comprehension_delta || 0)));
  const newProd = Math.max(0, Math.min(100, profile.production_score + (analysis.production_delta || 0)));
  const newAcc  = Math.max(0, Math.min(100, profile.accuracy_score + (analysis.accuracy_delta || 0)));
  // Language ratio: more Portuguese as comprehension + production improve
  const newPortugueseRatio = Math.max(15, Math.min(90, Math.round((newComp + newProd) / 2)));
  const newEnglishRatio = 100 - newPortugueseRatio;

  // Save session log
  await supabase.from('session_log').insert({
    user_id: 'default_user',
    started_at: new Date(Date.now() - duration_seconds * 1000).toISOString(),
    ended_at: new Date().toISOString(),
    duration_seconds,
    language_ratio_used: { english: newEnglishRatio, portuguese: newPortugueseRatio },
    topics_discussed: analysis.topics_discussed || [],
    mistakes: analysis.mistakes || [],
    new_words_introduced: analysis.new_words_introduced || [],
    corrections_made: analysis.corrections_made || 0,
    user_mood: analysis.user_mood || 'neutral',
    session_summary: analysis.session_summary || '',
    transcript,
  });

  // Update user profile
  await supabase.from('user_profile').update({
    comprehension_score: newComp,
    production_score: newProd,
    accuracy_score: newAcc,
    current_english_ratio: newEnglishRatio,
    current_portuguese_ratio: newPortugueseRatio,
    total_sessions: profile.total_sessions + 1,
    total_minutes: (profile.total_minutes || 0) + (duration_seconds / 60),
    updated_at: new Date().toISOString(),
  }).eq('user_id', 'default_user');

  // Upsert vocabulary words
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
        times_heard: th,
        mastery_score: mastery,
        last_seen: new Date().toISOString(),
      }).eq('id', existing.id);
    } else {
      await supabase.from('vocabulary').insert({
        user_id: 'default_user',
        word: v.word,
        translation: v.translation || '',
        times_heard: 1,
        mastery_score: 10,
        last_seen: new Date().toISOString(),
      });
    }
  }

  console.log(`Session saved. Scores — C:${newComp.toFixed(1)} P:${newProd.toFixed(1)} A:${newAcc.toFixed(1)} | PT ratio: ${newPortugueseRatio}%`);
}

// ── GET /profile (debug) ───────────────────────────────────────────────────
app.get('/profile', async (req, res) => {
  const { data, error } = await supabase
    .from('user_profile')
    .select('*')
    .eq('user_id', 'default_user')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Luna is listening on port ${PORT}`);
});
