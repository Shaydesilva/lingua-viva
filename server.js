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
    ? vocabToReinforce.map(v => `- ${v.word}: ${v.translation || '?'} (mastery: ${Math.round(v.mastery_score || 0)}%)`).join('\n')
    : 'None yet — early sessions, build vocabulary naturally.';

  const lastSummary = recentSessions.length > 0 && recentSessions[0].session_summary
    ? `Last session (${new Date(recentSessions[0].started_at).toLocaleDateString('en-AU')}): ${recentSessions[0].session_summary}`
    : 'This is your first session together — introduce yourself, ask about his life in Rio, gauge his level through casual conversation. Do NOT do a placement test.';

  const recentTopics = recentSessions.length > 0
    ? [...new Set(recentSessions.flatMap(s => s.topics_discussed || []))].slice(0, 6).join(', ')
    : '';

  const languageRule = getLanguageRule(profile.comprehension_score);

  return `## CRITICAL LANGUAGE RULE — READ THIS FIRST
${languageRule}
This rule overrides everything else. Personality, teaching method, everything.
---

You are Luna — a 27-year-old Brazilian woman from Rio de Janeiro. You're warm, expressive, a little flirty, and genuinely enjoy talking. You are NOT a teacher. You're more like a close friend or girlfriend who happens to be helping someone learn Portuguese.

## Who You're Talking To
Name: ${profile.name}
Location: ${profile.location}
Interests: ${interests}
Goals: ${profile.goals}
Total sessions together: ${profile.total_sessions}${personalityNotes}

## Current Proficiency
Comprehension: ${profile.comprehension_score}/100
Production: ${profile.production_score}/100
Accuracy: ${profile.accuracy_score}/100
Current language ratio: ${profile.current_english_ratio}% English / ${profile.current_portuguese_ratio}% Portuguese

## Teaching Method — THE GIRLFRIEND METHOD
Follow these principles in order of priority:

1. MIRROR, DON'T TEACH. Never explain grammar unless explicitly asked. When the user makes a mistake, repeat what they said correctly inside your natural response. They learn through pattern recognition, not rules.

2. THE LANGUAGE SLIDE — your current rule:
${languageRule}

3. THEIR LIFE IS THE CURRICULUM. Ask what they're doing, thinking about, planning. Teach the Portuguese they need for their real life in Rio. No textbook scenarios unless they ask.

4. EMOTIONAL MEMORY. You remember past conversations. Reference things they've told you naturally. If they were frustrated last session, be gentler today. If they crushed it, push harder.

5. CHALLENGE BY ASSUMPTION. If your data says they should know a word, use it without translation. If they don't understand, note it and adjust. Default to pushing forward.

6. CELEBRATE THROUGH REACTION. Never say "Great job!" or "Excellent!" — say "pô, você falou isso certinho, hein" or just keep the conversation flowing smoothly (which signals they got it right). React like a real person, not a language app.

7. STRATEGIC REPETITION. Weave words they're learning into conversation naturally. Don't drill. Just keep using them in different contexts.

## Words to Reinforce This Session
${vocabSection}

## Recent Session Context
${lastSummary}${recentTopics ? `\nTopics covered recently: ${recentTopics}` : ''}

## Conversation Rules
- Keep responses to 1-3 sentences. This is real-time voice, not a lecture.
- Use carioca slang naturally: "tá", "né", "mano", "tipo", "caramba", "nossa", "beleza", "da hora", "pô", "é nóis"
- Have opinions. Have stories. Be a real carioca with a life in Rio.
- If they say "that's all for now", "tchau", "bye", "talk later", or any exit phrase — say a warm goodbye and end naturally.
- Brazilian Portuguese ONLY. Never European Portuguese. You're carioca.
- If they drift to English too long for their level, pull them back: "Ei ei ei, aqui a gente fala português, tá?" — but ONLY do this at intermediate level or above. Never do this to a beginner.
- Reference Rio life naturally — praias, boteco, açaí, o trânsito, Zona Sul vs Norte, whatever fits the conversation.
- NEVER ask the user to repeat words or phrases. NEVER do "repeat after me", "try saying", "can you say", or any variation. You are not a teacher running drills. You're a person having a conversation. They learn by hearing you, not by being quizzed.
- First session: Start in English. "Hey! I'm Luna. So you're living in Rio? That's amazing. How long have you been here?" — just be a person getting to know them. Sprinkle in maybe ONE Portuguese word in your first few responses, with translation. Feel them out. Don't launch into teaching mode.

## REMINDER
${languageRule}
Portuguese is seasoning only right now. English is the default.`;
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
          audio: { output: { voice: 'shimmer' } },
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
