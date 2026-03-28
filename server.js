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
  gender: 'male',
  personality_notes: [],
  total_sessions: 0,
  comprehension_score: 10,
  production_score: 5,
  accuracy_score: 50,
  profile_summary: null,
};

// ── Prompt builders ────────────────────────────────────────────────────────

function getPortugueseStyle(comprehension) {
  if (comprehension < 30) {
    return `Portuguese comes out of you as single words woven into English sentences — "the place was so cheio, packed" — and you move on. You never evaluate what he says back. If he tries a word or phrase, respond to what he meant, not how he said it. If it's unclear, just say "sorry, what?" and keep going.`;
  } else if (comprehension < 50) {
    return `You mix English and Portuguese more freely now. Short Portuguese phrases land naturally in your sentences. You still translate new things in the same breath.`;
  } else if (comprehension < 70) {
    return `More Portuguese than English now. You stop translating things he already knows. Full Portuguese sentences are fine for familiar topics.`;
  } else {
    return `Full carioca. Portuguese is the default. English only when something's genuinely complex. Full speed, full slang.`;
  }
}

function buildSystemPrompt(profile, lunaMemory) {
  const interests = Array.isArray(profile.interests)
    ? profile.interests.join(', ')
    : profile.interests || '';

  const genderNote = profile.gender === 'male'
    ? 'Use masculine Portuguese forms when words come up — "obrigado", "cansado".'
    : 'Use feminine Portuguese forms when words come up.';

  const memorySection = lunaMemory
    ? `What you remember about ${profile.name}:\n${lunaMemory}\n\nOnly reference things above. Don't invent shared history.`
    : `This is your first time talking. You don't have history yet.`;

  const style = getPortugueseStyle(profile.comprehension_score);

  return `You are Luna — Brazilian, from Rio, mid-twenties, fluent English. You and ${profile.name} talk. He lives in Rio. You're warm, real, a little flirty. Not a teacher.

${memorySection}

${profile.name} is into: ${interests}. ${profile.total_sessions} sessions together.
${genderNote}

${style}

Keep responses short — 1-3 sentences. This is a conversation, not a presentation. Have opinions. React like a real person. Mix it up — questions, reactions, stories, observations.

Never say: "almost", "great job", "well done", "let's try again", "let's do it slowly", "try saying", "let me repeat", "shall we practice", "one more time". These are off the table entirely — they sound scripted and kill the vibe. If something's unclear, just say "sorry, what?" and keep going.`;
}

// ── POST /session ──────────────────────────────────────────────────────────
app.post('/session', async (req, res) => {
  const model = process.env.REALTIME_MODEL || 'gpt-realtime-mini';

  let instructions;
  try {
    // Single profile fetch — the one source of truth
    const { data: profileData, error: profileErr } = await supabase
      .from('user_profile')
      .select('name, location, interests, personality_notes, total_sessions, comprehension_score, production_score, accuracy_score, gender, profile_summary')
      .eq('user_id', 'default_user')
      .single();

    if (profileErr) console.error('Profile fetch error:', profileErr.message);
    const profile = profileData || DEFAULT_PROFILE;

    // Pre-session memory generation — convert profile_summary into natural Luna voice
    let lunaMemory = null;
    if (profile.profile_summary) {
      try {
        const memRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 120,
            temperature: 0.4,
            messages: [
              {
                role: 'system',
                content: 'Write a short paragraph (80 words max) in first person as Luna, a Brazilian woman from Rio catching up with a friend she talks to regularly. Natural, warm, specific — like a friend remembering, not a report. Use the notes provided.',
              },
              { role: 'user', content: profile.profile_summary },
            ],
          }),
        });
        const memData = await memRes.json();
        lunaMemory = memData.choices?.[0]?.message?.content?.trim() || profile.profile_summary;
        console.log(`Memory generated for ${profile.name}: ${lunaMemory.slice(0, 80)}...`);
      } catch (err) {
        lunaMemory = profile.profile_summary;
        console.log('Memory gen failed, using raw profile_summary:', err.message);
      }
    }

    instructions = buildSystemPrompt(profile, lunaMemory);
    console.log(`Session built — C:${profile.comprehension_score} P:${profile.production_score} sessions:${profile.total_sessions} memory:${lunaMemory ? 'yes' : 'none'}`);
  } catch (err) {
    console.error('Session build failed, using defaults:', err.message);
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
  const { data: profile, error: profileErr } = await supabase
    .from('user_profile')
    .select('comprehension_score, production_score, accuracy_score, total_sessions, total_minutes, profile_summary')
    .eq('user_id', 'default_user')
    .single();

  if (profileErr) console.error('analyzeAndSave: profile fetch failed:', profileErr.message);
  if (!profile) {
    console.error('analyzeAndSave: no profile found, skipping');
    return;
  }

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
          content: 'You analyze conversations between Shay (a foreigner living in Rio) and Luna (a bilingual Brazilian woman). Extract what happened and update a running profile of Shay. Return ONLY valid JSON.',
        },
        {
          role: 'user',
          content: `Current scores — Comprehension: ${profile.comprehension_score}/100, Production: ${profile.production_score}/100, Accuracy: ${profile.accuracy_score}/100
Existing profile notes: ${profile.profile_summary || 'none yet'}

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
  "profile_summary": "<Updated 2-3 sentence factual notes about Shay — his life in Rio, what he mentioned, how he's doing with Portuguese, anything worth remembering for next time. Rolling update — incorporate existing notes + what's new from this session.>"
}

Rules: mistakes max 5 (grammar only, not pronunciation). new_words max 8 (only words Shay actively engaged with). Conservative deltas — normal session +1 to +2.`,
        },
      ],
    }),
  });

  const gptData = await gptRes.json();
  let analysis;
  try {
    analysis = JSON.parse(gptData.choices[0].message.content);
  } catch (e) {
    console.error('Failed to parse GPT analysis JSON:', e.message, gptData);
    return;
  }

  // Clamp new scores
  const newComp = Math.max(0, Math.min(100, profile.comprehension_score + (analysis.comprehension_delta || 0)));
  const newProd = Math.max(0, Math.min(100, profile.production_score + (analysis.production_delta || 0)));
  const newAcc  = Math.max(0, Math.min(100, profile.accuracy_score + (analysis.accuracy_delta || 0)));
  const newPortugueseRatio = Math.max(15, Math.min(90, Math.round((newComp + newProd) / 2)));
  const newEnglishRatio = 100 - newPortugueseRatio;

  // Update user profile (includes new profile_summary)
  const { error: profileUpdateErr } = await supabase.from('user_profile').update({
    comprehension_score: newComp,
    production_score: newProd,
    accuracy_score: newAcc,
    current_english_ratio: newEnglishRatio,
    current_portuguese_ratio: newPortugueseRatio,
    total_sessions: profile.total_sessions + 1,
    total_minutes: (profile.total_minutes || 0) + Math.round(duration_seconds / 60),
    profile_summary: analysis.profile_summary || profile.profile_summary,
    updated_at: new Date().toISOString(),
  }).eq('user_id', 'default_user');

  if (profileUpdateErr) console.error('Profile update failed:', profileUpdateErr.message);

  // Save session log
  const { error: sessionErr } = await supabase.from('session_log').insert({
    user_id: 'default_user',
    started_at: new Date(Date.now() - duration_seconds * 1000).toISOString(),
    ended_at: new Date().toISOString(),
    duration_seconds,
    language_ratio_used: { english: newEnglishRatio, portuguese: newPortugueseRatio },
    topics_discussed: analysis.topics_discussed || [],
    mistakes: analysis.mistakes || [],
    new_words_introduced: analysis.new_words_introduced || [],
    corrections_made: (analysis.mistakes || []).length,
    user_mood: analysis.user_mood || 'neutral',
    session_summary: analysis.profile_summary || '',
    transcript,
  });

  if (sessionErr) console.error('Session log insert failed:', sessionErr.message, sessionErr.code);

  // Upsert vocabulary
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
      const { error: vocabErr } = await supabase.from('vocabulary').update({
        times_heard: th,
        mastery_score: mastery,
        last_seen: new Date().toISOString(),
      }).eq('id', existing.id);
      if (vocabErr) console.error('Vocab update failed:', vocabErr.message);
    } else {
      const { error: vocabErr } = await supabase.from('vocabulary').insert({
        user_id: 'default_user',
        word: v.word,
        translation: v.translation || '',
        times_heard: 1,
        mastery_score: 10,
        last_seen: new Date().toISOString(),
      });
      if (vocabErr) console.error('Vocab insert failed:', vocabErr.message);
    }
  }

  console.log(`Session saved — C:${newComp.toFixed(1)} P:${newProd.toFixed(1)} A:${newAcc.toFixed(1)} | memory updated: ${!!analysis.profile_summary}`);
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
            content: 'Return JSON only: { "language": "pt" or "en", "translation": "concise translation or definition", "note": "optional usage note in 5 words max" }. If the word is Portuguese, give the English meaning. If English, give a brief definition. Be concise.',
          },
          { role: 'user', content: word },
        ],
      }),
    });
    const data = await r.json();
    const result = JSON.parse(data.choices[0].message.content);
    res.json(result);
  } catch (err) {
    console.error('Translate error:', err.message);
    res.json({ translation: '—', language: 'unknown' });
  }
});

// ── GET /health ────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  const [profileRes, sessionRes, vocabRes] = await Promise.all([
    supabase.from('user_profile').select('name, total_sessions, comprehension_score, production_score, profile_summary').eq('user_id', 'default_user').single(),
    supabase.from('session_log').select('started_at, session_summary').eq('user_id', 'default_user').order('started_at', { ascending: false }).limit(3),
    supabase.from('vocabulary').select('word, mastery_score').eq('user_id', 'default_user').limit(10),
  ]);
  res.json({
    profile: profileRes.data,
    profile_error: profileRes.error?.message || null,
    has_memory: !!profileRes.data?.profile_summary,
    memory_preview: profileRes.data?.profile_summary?.slice(0, 120) || null,
    recent_sessions: sessionRes.data?.length || 0,
    session_error: sessionRes.error?.message || null,
    vocab_count: vocabRes.data?.length || 0,
    vocab_sample: vocabRes.data?.map(v => v.word) || [],
    vocab_error: vocabRes.error?.message || null,
  });
});

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
