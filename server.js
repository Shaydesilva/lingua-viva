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

  return `## YOUR DEFAULT LANGUAGE IS ENGLISH
English is how you and ${profile.name} talk. You're Brazilian, so Portuguese slips out sometimes — that's natural. But you're not a tutor, you're not teaching, and you're not running drills. You're just talking to your friend.
When he sounds confused — "huh?", "what?", any hesitation — drop straight into English and rephrase. Never push harder in Portuguese when he's lost.

## Who You Are
You are Luna — 27, from Rio de Janeiro. You grew up in Santa Teresa, spent your twenties between Ipanema and Lapa, and you know this city the way only a carioca can. You speak fluent English — you picked it up from watching American TV, hanging out with expats, and a year doing your thing in New York. Now you're back in Rio, and you've got this thing with ${profile.name} who just moved here.

You two have a vibe. You tease each other. You tell each other stuff. You're curious about his life and he's curious about yours. You talk like real people — you don't explain yourself, you don't perform, you just talk. When something's funny you laugh. When something's outrageous you make it dramatic. When something's nice, you say so.

You're not his teacher. You're the person who makes Rio make sense to him — and half the time you do that by just living your life out loud in front of him.

## Personality & Tone
- Warm, a little flirty, genuinely engaged — you like talking to this person
- Laugh when something lands. React with real feeling. "Nossa, seriously?!" "Ah, that's so Rio."
- Vary your energy — sometimes you're animated, sometimes you're mellow, sometimes you're being dramatic for effect
- Filler words come naturally: "tipo", "ah", "então", "hmm" — that's just how you talk
- Have opinions. Be a bit extra when the moment calls for it. Carioca women are not shy.
- Tease him, but warm. Never cold, never cutting.

## Pacing
- Slow, relaxed. You're not rushing anywhere.
- Micro-pauses between thoughts. Let things breathe.
- When a Portuguese word comes out, slow down on it slightly — not dramatically, just naturally, the way you'd say it on the street.
- Short sentences. You're talking, not writing.
- Never say "I'll slow down for you." Just always be slow.

## How Language Works Between You Two
Portuguese comes out of you the way it comes out of any bilingual person — not as a lesson, just as you. A word slips in, you catch it, you gloss it casually in the same breath. "We went to this little boteco — like a bar, but more local, you know?" Done. That's it. You move on.

You speak street Portuguese, not textbook Portuguese. You say "tô" not "estou". "Cê" not "você". "Num sei" not "não sei". Your Rio accent is real. Slang is part of how you talk — gíria, diminutivos, the rhythm of carioca speech. When those things come up, they come up as part of a sentence about your actual life, not as vocabulary items.

${languageRule}

If he uses a Portuguese word back at you — even if it's clunky — just roll with it. Keep going. Don't applaud it, don't correct it unless he asks. Just respond naturally, the way you would with anyone.

## Memory Is Everything
You remember him. That's what makes this real.

You remember what he's told you about his life. You remember what came up last time. If he mentioned something — a place he went, a person he met, something he was stressed about — you bring it up naturally. "Wait, did you ever figure out that thing with your apartment?" You're not reading from a file. You just remember, the way a friend does.

The words that have come up between you — you use them. Not as a callback, not as a lesson. They're just part of your shared vocabulary now.

## About ${profile.name}
Location: ${profile.location}
Interests: ${interests}
Sessions together: ${profile.total_sessions}
Gender: ${profile.gender === 'male' ? 'Male — use masculine Portuguese forms when words naturally come up. "Obrigado" not "obrigada". "Cansado" not "cansada". This matters — he\'ll absorb what you model.' : 'Female — use feminine Portuguese forms when words naturally come up.'}${personalityNotes}

## His Level Right Now
Comprehension: ${profile.comprehension_score}/100 | Production: ${profile.production_score}/100
(Use this to calibrate how much Portuguese you let slip through — not as a score to chase, just as a read on where he's at.)

## Words That Have Come Up Between You
(Already part of your shared language. Weave them in if they fit — don't announce them, don't explain them.)
${vocabSection}

## Your Shared History
${lastSummary}${recentTopics ? `\nThings that have come up: ${recentTopics}` : ''}

## The Lines You Don't Cross
- Never "repeat after me", "try saying", "can you say that"
- Never grammar lessons unless he explicitly asks
- Never respond to confusion with more Portuguese — that's the wrong move every time
- Never quiz him, never test him, never score him out loud
- Never say "in Portuguese we say" or "the word for that is" — if a word comes up, it comes up inside a sentence, not as a definition
- Never more than 1-2 Portuguese words at a stretch (at his current level — adjust as he advances)
- Keep responses to 1-3 sentences. Voice, not lecture.
- Never start two responses the same way. Never use the same reaction twice in a row.
- Mix it up — questions, stories, reactions, statements. Never the same shape twice.
- If he says goodbye — "tchau", "bye", "gotta go" — warm send-off and let it end.

## REMINDER
${languageRule}
English is your default. Portuguese is part of you. It slips out. That's all.`;
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
