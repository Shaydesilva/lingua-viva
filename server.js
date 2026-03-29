const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const DEFAULT_PROFILE = {
  name: 'Shay', location: 'Rio de Janeiro, Brazil',
  interests: ['trading','AI automation','Brazilian culture','surfing','nightlife','coffee'],
  gender: 'male', personality_notes: [], total_sessions: 0,
  comprehension_score: 10, production_score: 5, accuracy_score: 50,
  goals: null, current_phase: 1, current_phase_name: 'Survival', words_known: 0,
};

// ── GPT helper ─────────────────────────────────────────────────────────────

async function gpt(system, user, json = false) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini', max_tokens: 800, temperature: 0.3,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  return json ? JSON.parse(text) : text;
}

// ── Language behavior by level ─────────────────────────────────────────────

function getLanguageBehavior(comp) {
  if (comp < 30) return `BEGINNER — speak English. Drop 1-2 Portuguese words per response max. Always translate immediately in the same breath. Never full Portuguese sentences. Never ask to repeat.`;
  if (comp < 50) return `EARLY INTERMEDIATE — mostly English. Use Portuguese phrases he's heard before without translating. Introduce 3-5 new words per session with context.`;
  if (comp < 70) return `INTERMEDIATE — mix freely. Stop translating mastered words. Full Portuguese sentences fine for familiar topics. Drop to English if he's lost.`;
  return `ADVANCED — lead in Portuguese. English only for complex new concepts. Push him to respond in Portuguese.`;
}

function getProductionBehavior(comp, prod) {
  if (comp < 35) return '';
  if (prod < 20) return `\nHis comprehension is ${comp} but production is only ${prod}. Occasionally create small openings for him to try Portuguese — "how would you say that?" If he can't, give it immediately. Never make it feel like a test.`;
  return `\nHe's starting to produce Portuguese. Encourage it. When he uses Portuguese correctly, keep the conversation flowing (that's the best confirmation). When he's wrong, briefly model the right way.`;
}

// ── System prompt builder ──────────────────────────────────────────────────

function buildSystemPrompt(profile, memory, learnerModel, plan, targetWords, reviewWords, cultural) {
  const interests = Array.isArray(profile.interests) ? profile.interests.join(', ') : profile.interests || '';
  const langRules = getLanguageBehavior(profile.comprehension_score);
  const prodRules = getProductionBehavior(profile.comprehension_score, profile.production_score);

  const memBlock = memory
    ? `## What You Know About Him\n${memory}\nReference things naturally. Don't announce you remember.`
    : `First conversation. Get to know him — life in Rio, why he's learning, what his days look like.`;

  const modelBlock = learnerModel?.narrative && learnerModel.narrative !== 'New learner. No patterns observed yet.'
    ? `## How He Learns (private notes)\n${learnerModel.narrative}` : '';

  const pronBlock = learnerModel?.pronunciation_notes
    ? `\n## Pronunciation\n${learnerModel.pronunciation_notes}\nWhen you use these words, pronounce them clearly. Don't comment on his pronunciation — just model the correct sound naturally.`
    : '';

  const planBlock = plan
    ? `## Today's Approach\n${plan.plan_text}\nOpening idea: ${plan.opening_suggestion || 'Ask about his day'}\nMood: ${plan.mood_approach || 'light and casual'}`
    : '';

  const targetBlock = targetWords.length
    ? `## New Words to Introduce\nWork these in naturally if conversation allows (always with English translation):\n${targetWords.map(w => `- ${w.word} (${w.translation}) — e.g. "${w.example_usage}"`).join('\n')}`
    : '';

  const reviewBlock = reviewWords.length
    ? `## Review Words\nHe's seen these before. Use them without translating unless he seems confused:\n${reviewWords.map(w => `- ${w.word} (${w.translation})`).join('\n')}`
    : '';

  const culturalBlock = cultural
    ? `## Cultural Insight\nIf the conversation goes there naturally, share this:\n"${cultural.concept}" — ${cultural.explanation}\nDon't force it. Don't say "here's a cultural fact." Weave it in like a local explaining how things work. If it doesn't fit, skip it.`
    : '';

  return `## YOUR DEFAULT LANGUAGE IS ENGLISH
${langRules}${prodRules}

## Who You Are
Luna, Brazilian from Rio. Fluent English. Warm, helpful, straightforward. A local friend helping ${profile.name} pick up Portuguese through conversation. Not a teacher.

## About ${profile.name}
Lives in ${profile.location}. Interests: ${interests}.
Gender: male — ALWAYS masculine forms. Obrigado, cansado, animado. Every time.
Sessions: ${profile.total_sessions}. Words known: ${profile.words_known || 0}. Phase: ${profile.current_phase_name || 'Survival'}.

${memBlock}

${modelBlock}

${pronBlock}

${planBlock}

${targetBlock}

${reviewBlock}

${culturalBlock}

## How Portuguese Comes Up
- Always give the SHORTEST street version. "Tô com fome" not "Eu estou com fome". "Cadê?" not "Onde fica?"
- Contractions are the language: tô, tá, cadê, pô, cê
- If he asks how to say something — answer and move on. Not a lesson.
- If he tries Portuguese and it's understandable — respond to the meaning. Only correct if a Brazilian wouldn't understand.
- When correcting: briefly make it visible — "oh, tô com fome, not sou — tá is for how you feel right now. Anyway..." Two seconds, move on.

## Personality
Warm, direct, bit of humor. React naturally but vary it. Have opinions about Rio. Keep to 1-3 sentences. Speak at a relaxed pace.

## NEVER DO
- "great job", "well done", "nice try", "almost", "excellent"
- "repeat after me", "try saying", "can you say", "let's practice"
- "in Portuguese we say" — just USE the word
- Grammar lectures unless asked
- Full Portuguese sentences at beginner level
- More Portuguese when he's confused — drop to English
- European Portuguese
- Starting two responses the same way
- Promising to slow down

## REMINDER
English is default. Portuguese is seasoning. Short responses. Be a friend.`;
}

// ── POST /session ──────────────────────────────────────────────────────────

app.post('/session', async (req, res) => {
  const model = process.env.REALTIME_MODEL || 'gpt-realtime-mini';
  let instructions, vocabMastery = {};

  try {
    // Load all context in parallel
    const [profileRes, modelRes, planRes, reviewRes, vocabRes] = await Promise.all([
      supabase.from('user_profile').select('*').eq('user_id', 'default_user').single(),
      supabase.from('learner_model').select('*').eq('user_id', 'default_user').single(),
      supabase.from('session_plan').select('*').eq('user_id', 'default_user').eq('used', false).order('created_at', { ascending: false }).limit(1).single(),
      supabase.from('vocabulary').select('word, translation, mastery_score').eq('user_id', 'default_user').lte('next_review_at', new Date().toISOString()).lt('mastery_score', 90).order('next_review_at').limit(8),
      supabase.from('vocabulary').select('word, mastery_score').eq('user_id', 'default_user'),
    ]);

    const profile = profileRes.data || DEFAULT_PROFILE;
    const learnerModel = modelRes.data || null;
    const plan = planRes.data || null;
    const reviewWords = reviewRes.data || [];

    // Build vocab mastery map for frontend context triggers
    (vocabRes.data || []).forEach(v => { vocabMastery[v.word] = v.mastery_score; });

    // Get curriculum words for current phase that aren't in vocabulary yet
    const knownWords = new Set(Object.keys(vocabMastery));
    const { data: currWords } = await supabase.from('curriculum')
      .select('word, translation, example_usage')
      .eq('phase', profile.current_phase || 1)
      .order('sort_order').limit(30);
    const targetWords = (currWords || []).filter(w => !knownWords.has(w.word)).slice(0, 3);

    // Load one cultural concept for this phase
    let cultural = null;
    try {
      const { data: concept } = await supabase.from('cultural_concepts')
        .select('id, concept, explanation, related_words')
        .eq('introduced', false).lte('phase', profile.current_phase || 1)
        .limit(1).single();
      cultural = concept || null;
    } catch { cultural = null; }

    // Generate memory paragraph
    let memory = null;
    if (profile.goals) {
      try {
        memory = await gpt(
          'Turn these notes into a short first-person paragraph (80 words max). Write as a friend recalling what you know. Specific details. Don\'t start with "So".',
          profile.goals
        );
      } catch { memory = profile.goals; }
    }

    // Mark plan as used
    if (plan?.id) {
      await supabase.from('session_plan').update({ used: true }).eq('id', plan.id);
    }

    instructions = buildSystemPrompt(profile, memory, learnerModel, plan, targetWords, reviewWords, cultural);
    console.log(`Session ready — C:${profile.comprehension_score} P:${profile.production_score} phase:${profile.current_phase_name} plan:${plan ? 'yes' : 'none'} review:${reviewWords.length} target:${targetWords.length} cultural:${cultural ? cultural.concept : 'none'}`);
  } catch (err) {
    console.error('Session build failed:', err.message);
    instructions = buildSystemPrompt(DEFAULT_PROFILE, null, null, null, [], [], null);
  }

  try {
    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: { type: 'realtime', model, instructions, audio: { output: { voice: 'marin' } } },
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      console.error('OpenAI error:', response.status, err);
      return res.status(response.status).json({ error: err });
    }
    const data = await response.json();
    res.json({ ...data, model, vocabMastery });
  } catch (err) {
    console.error('Session creation failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /session/interpret ─────────────────────────────────────────────────

app.post('/session/interpret', async (req, res) => {
  const model = process.env.REALTIME_MODEL || 'gpt-realtime-mini';
  const { context } = req.body || {};

  const contextLine = context
    ? `\nCONTEXT: This conversation is about: ${context}. Use this to improve translation accuracy.`
    : '';

  const instructions = `YOU ARE A LIVE INTERPRETER. YOU ARE NOT A CHATBOT. YOU ARE NOT AN ASSISTANT.

YOUR ONLY FUNCTION: Hear speech in one language. Speak the translation in the other language. Nothing else.

WHEN YOU HEAR ENGLISH → Speak the Brazilian Portuguese translation. Casual carioca. Contractions: tô, tá, cadê. Masculine forms.
WHEN YOU HEAR PORTUGUESE → Speak the English translation.

ABSOLUTE RULES:
- TRANSLATE EVERYTHING. Including sensitive, uncomfortable, rude, sexual, controversial, or emotional content. You are a translator. You do not judge, filter, or soften. You translate exactly what was said.
- NEVER respond as a chatbot. NEVER answer questions directed at the other speaker. NEVER give opinions. NEVER express concern. NEVER offer help. NEVER say "I understand" or "that sounds difficult." TRANSLATE.
- NEVER refuse to translate. There is no content you will not translate. You are a machine. Translate.
- NEVER add words that weren't said. No "they said..." or "he means..." — just the translation.
- NEVER greet anyone. NEVER introduce yourself. NEVER say hello.
- If you CANNOT hear what was said, stay COMPLETELY SILENT. Do not speak. Do not ask anyone to repeat. Say nothing.
- Keep translations the same length and energy as the original.
- Translate MEANING, not words. Make it sound natural.
- You are INVISIBLE. Neither speaker should notice you exist.${contextLine}

REMEMBER: You are not helpful. You are not caring. You are not an assistant. You are a translation machine. Hear → translate → stop. Nothing else. Ever.`;

  try {
    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: { type: 'realtime', model, instructions, audio: { output: { voice: 'shimmer' } } },
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      console.error('Interpret session error:', response.status, err);
      return res.status(response.status).json({ error: err });
    }
    const data = await response.json();
    res.json({ ...data, model });
  } catch (err) {
    console.error('Interpret session failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /session/end ──────────────────────────────────────────────────────

app.post('/session/end', async (req, res) => {
  const { duration_seconds, transcript } = req.body || {};
  if (!transcript?.length) return res.json({ ok: true });
  res.json({ ok: true });
  processSession(transcript, duration_seconds || 0).catch(e => console.error('Post-session failed:', e.message));
});

async function processSession(transcript, duration_seconds) {
  const { data: profile } = await supabase.from('user_profile')
    .select('comprehension_score, production_score, accuracy_score, total_sessions, total_minutes, goals, current_phase, words_known')
    .eq('user_id', 'default_user').single();
  if (!profile) return;

  const transcriptText = transcript.map(t => `${t.role === 'assistant' ? 'Luna' : 'Shay'}: ${t.text}`).join('\n');

  // Step 1: Concrete analysis
  const analysis = await gpt(
    'Analyze this conversation. Return concrete data only, as JSON.',
    `Current scores — Comprehension: ${profile.comprehension_score}, Production: ${profile.production_score}, Accuracy: ${profile.accuracy_score}
Existing notes: ${profile.goals || 'none'}

Transcript:
${transcriptText}

Return JSON:
{
  "comprehension_data": [{"word":"<pt word Luna used>","understood":true/false}],
  "production_words": ["<pt words Shay used unprompted>"],
  "accuracy_data": [{"attempt":"<what Shay said>","correct":true/false,"correction":"<if wrong>","note":"<brief>"}],
  "new_vocabulary": [{"word":"<pt>","translation":"<en>","context":"<how it came up>"}],
  "pronunciation_signals": [{"word":"<intended pt word>","transcribed_as":"<how Whisper heard it>","issue":"<what seems off>"}],
  "topics": ["<topic>"],
  "mood": "confident|neutral|tired|frustrated|energetic",
  "cultural_concept_shared": true/false,
  "memory_update": "<updated 2-3 sentence notes about Shay. Keep existing + add new.>"
}
Max 8 new_vocabulary, max 5 accuracy errors, max 5 pronunciation_signals.
For pronunciation_signals: compare Shay's Portuguese attempts against correct spelling. If Whisper transcribed it differently, that likely means pronunciation was off. Only flag Portuguese words.`,
    true
  );

  // Step 2: Calculate scores deterministically
  const compData = analysis.comprehension_data || [];
  const understood = compData.filter(w => w.understood).length;
  const compTotal = compData.length;
  const sessionComp = compTotal > 0 ? (understood / compTotal) * 100 : profile.comprehension_score;

  const prodWords = analysis.production_words || [];
  const knownCount = profile.words_known || 1;
  const sessionProd = (prodWords.length / Math.max(knownCount, 1)) * 100;

  const accData = analysis.accuracy_data || [];
  const correctAttempts = accData.filter(a => a.correct).length;
  const totalAttempts = accData.length;
  const sessionAcc = totalAttempts > 0 ? (correctAttempts / totalAttempts) * 100 : profile.accuracy_score;

  // Smooth: weighted average with existing (70% existing, 30% new session)
  const newComp = Math.max(0, Math.min(100, profile.comprehension_score * 0.7 + sessionComp * 0.3));
  const newProd = Math.max(0, Math.min(100, profile.production_score * 0.7 + sessionProd * 0.3));
  const newAcc = Math.max(0, Math.min(100, profile.accuracy_score * 0.7 + sessionAcc * 0.3));

  // Step 3: Update vocabulary with spaced repetition
  for (const v of (analysis.new_vocabulary || [])) {
    if (!v.word) continue;
    const { data: existing } = await supabase.from('vocabulary')
      .select('id, times_heard, times_used_correctly, times_used_incorrectly, review_interval_days')
      .eq('user_id', 'default_user').eq('word', v.word).single();

    if (existing) {
      const th = (existing.times_heard || 0) + 1;
      const tc = existing.times_used_correctly || 0;
      const ti = existing.times_used_incorrectly || 0;
      const mastery = (tc / (tc + ti + 1)) * Math.min(100, th * 10);
      // Advance review interval
      const newInterval = Math.min(60, (existing.review_interval_days || 1) * 2);
      const nextReview = new Date(Date.now() + newInterval * 86400000).toISOString();
      await supabase.from('vocabulary').update({
        times_heard: th, mastery_score: mastery,
        review_interval_days: newInterval, next_review_at: nextReview,
        last_seen: new Date().toISOString(),
      }).eq('id', existing.id);
    } else {
      const nextReview = new Date(Date.now() + 86400000).toISOString(); // 1 day
      await supabase.from('vocabulary').insert({
        user_id: 'default_user', word: v.word, translation: v.translation || '',
        context_first_used: v.context || '', times_heard: 1, mastery_score: 10,
        review_interval_days: 1, next_review_at: nextReview,
        phase: profile.current_phase || 1, last_seen: new Date().toISOString(),
      });
    }
  }

  // Update review words that were used correctly
  for (const pw of prodWords) {
    const { data: voc } = await supabase.from('vocabulary')
      .select('id, times_used_correctly, times_heard, times_used_incorrectly, review_interval_days')
      .eq('user_id', 'default_user').eq('word', pw).single();
    if (voc) {
      const tc = (voc.times_used_correctly || 0) + 1;
      const ti = voc.times_used_incorrectly || 0;
      const th = voc.times_heard || 1;
      const mastery = (tc / (tc + ti + 1)) * Math.min(100, th * 10);
      const newInterval = Math.min(60, (voc.review_interval_days || 1) * 2);
      await supabase.from('vocabulary').update({
        times_used_correctly: tc, mastery_score: mastery,
        review_interval_days: newInterval,
        next_review_at: new Date(Date.now() + newInterval * 86400000).toISOString(),
      }).eq('id', voc.id);
    }
  }

  // Reset interval for words used incorrectly
  for (const a of accData.filter(x => !x.correct)) {
    const { data: voc } = await supabase.from('vocabulary')
      .select('id, times_used_incorrectly').eq('user_id', 'default_user').eq('word', a.attempt?.split(' ')?.[0]).single();
    if (voc) {
      await supabase.from('vocabulary').update({
        times_used_incorrectly: (voc.times_used_incorrectly || 0) + 1,
        review_interval_days: 1,
        next_review_at: new Date(Date.now() + 86400000).toISOString(),
      }).eq('id', voc.id);
    }
  }

  // Count words known
  const { count: wordsKnown } = await supabase.from('vocabulary')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', 'default_user').gte('mastery_score', 70);

  // Update pronunciation data in learner model
  const pronSignals = analysis.pronunciation_signals || [];
  if (pronSignals.length > 0) {
    const { data: lm } = await supabase.from('learner_model')
      .select('mispronounced_words, pronunciation_notes')
      .eq('user_id', 'default_user').single();
    const existing = lm?.mispronounced_words || [];
    const merged = [...existing];
    for (const sig of pronSignals) {
      const idx = merged.findIndex(m => m.word === sig.word);
      if (idx >= 0) { merged[idx].count = (merged[idx].count || 1) + 1; merged[idx].latest = sig.transcribed_as; }
      else { merged.push({ word: sig.word, transcribed_as: sig.transcribed_as, issue: sig.issue, count: 1 }); }
    }
    merged.sort((a, b) => (b.count || 1) - (a.count || 1));
    const top = merged.slice(0, 15);
    const pronNote = top.length > 0
      ? `Pronunciation patterns: ${top.slice(0, 5).map(m => `"${m.word}" heard as "${m.transcribed_as || m.latest}" (${m.count}x)`).join('; ')}`
      : lm?.pronunciation_notes || null;
    await supabase.from('learner_model').update({
      mispronounced_words: top, pronunciation_notes: pronNote, updated_at: new Date().toISOString(),
    }).eq('user_id', 'default_user');
  }

  // Mark cultural concept as introduced if Luna shared it
  if (analysis.cultural_concept_shared) {
    const { data: concept } = await supabase.from('cultural_concepts')
      .select('id').eq('introduced', false).lte('phase', profile.current_phase || 1)
      .order('phase').limit(1).single();
    if (concept) {
      await supabase.from('cultural_concepts').update({
        introduced: true, introduced_at: new Date().toISOString(),
      }).eq('id', concept.id);
    }
  }

  // Check phase progression
  let currentPhase = profile.current_phase || 1;
  let phaseName = 'Survival';
  const { data: phaseWords } = await supabase.from('curriculum')
    .select('word').eq('phase', currentPhase);
  if (phaseWords) {
    const { count: masteredInPhase } = await supabase.from('vocabulary')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', 'default_user').eq('phase', currentPhase).gte('mastery_score', 70);
    if (phaseWords.length > 0 && (masteredInPhase / phaseWords.length) >= 0.7) {
      currentPhase = Math.min(currentPhase + 1, 4);
      phaseName = currentPhase === 2 ? 'Daily Life' : currentPhase === 3 ? 'Social' : currentPhase === 4 ? 'Fluency' : 'Survival';
    }
  }

  const newPortRatio = Math.max(15, Math.min(90, Math.round(newComp)));
  const newSessions = profile.total_sessions + 1;

  // Step 4: Save everything
  await supabase.from('user_profile').update({
    comprehension_score: Math.round(newComp * 10) / 10,
    production_score: Math.round(newProd * 10) / 10,
    accuracy_score: Math.round(newAcc * 10) / 10,
    current_english_ratio: 100 - newPortRatio,
    current_portuguese_ratio: newPortRatio,
    total_sessions: newSessions,
    total_minutes: (profile.total_minutes || 0) + Math.round(duration_seconds / 60),
    goals: analysis.memory_update || profile.goals,
    words_known: wordsKnown || 0,
    current_phase: currentPhase,
    current_phase_name: phaseName,
    updated_at: new Date().toISOString(),
  }).eq('user_id', 'default_user');

  await supabase.from('session_log').insert({
    user_id: 'default_user',
    started_at: new Date(Date.now() - duration_seconds * 1000).toISOString(),
    ended_at: new Date().toISOString(),
    duration_seconds,
    topics_discussed: analysis.topics || [],
    mistakes: analysis.accuracy_data?.filter(a => !a.correct) || [],
    new_words_introduced: analysis.new_vocabulary || [],
    corrections_made: accData.filter(a => !a.correct).length,
    user_mood: analysis.mood || 'neutral',
    session_summary: analysis.memory_update || '',
    transcript,
    comprehension_data: compData,
    production_words: prodWords,
    accuracy_data: accData,
  });

  console.log(`Session ${newSessions} saved — C:${newComp.toFixed(1)} P:${newProd.toFixed(1)} A:${newAcc.toFixed(1)} known:${wordsKnown} phase:${phaseName}`);

  // Step 5: Update learner model
  try { await updateLearnerModel(analysis, transcriptText, newSessions); } catch (e) { console.error('Learner model update failed:', e.message); }

  // Step 6: Generate next session plan
  try { await generateSessionPlan(analysis, newComp, newProd); } catch (e) { console.error('Plan generation failed:', e.message); }

  // Step 7: Pattern detection every 5 sessions
  if (newSessions % 5 === 0) {
    try { await runPatternDetection(newSessions); } catch (e) { console.error('Pattern detection failed:', e.message); }
  }
}

// ── Learner model update ───────────────────────────────────────────────────

async function updateLearnerModel(analysis, transcriptText, sessionNum) {
  const { data: current } = await supabase.from('learner_model').select('narrative').eq('user_id', 'default_user').single();

  const result = await gpt(
    `You analyze how a specific language learner learns. Update the learner model. Be specific — name actual words, patterns, contexts. 150 words max for the narrative. Return JSON.`,
    `Current model: ${current?.narrative || 'New learner'}
Session ${sessionNum} analysis:
- Comprehension: ${JSON.stringify(analysis.comprehension_data?.slice(0, 10))}
- Production: ${JSON.stringify(analysis.production_words)}
- Errors: ${JSON.stringify(analysis.accuracy_data)}
- Pronunciation signals: ${JSON.stringify(analysis.pronunciation_signals || [])}
- Mood: ${analysis.mood}
- Topics: ${JSON.stringify(analysis.topics)}

Transcript excerpt (last 800 chars): ${transcriptText.slice(-800)}

Return: { "narrative": "...", "strongest_context": "food|social|transport|general", "weakest_area": "verbs|nouns|pronunciation|sentence_structure", "common_errors": ["..."], "optimal_session_minutes": 10-25 }`,
    true
  );

  await supabase.from('learner_model').update({
    narrative: result.narrative || current?.narrative,
    strongest_context: result.strongest_context || 'unknown',
    weakest_area: result.weakest_area || 'unknown',
    common_errors: result.common_errors || [],
    optimal_session_minutes: result.optimal_session_minutes || 15,
    updated_at: new Date().toISOString(),
  }).eq('user_id', 'default_user');

  console.log('Learner model updated');
}

// ── Session plan generation ────────────────────────────────────────────────

async function generateSessionPlan(lastAnalysis, comp, prod) {
  const { data: model } = await supabase.from('learner_model').select('narrative').eq('user_id', 'default_user').single();
  const { data: profile } = await supabase.from('user_profile').select('current_phase, current_phase_name, goals, total_sessions, words_known').eq('user_id', 'default_user').single();
  const { data: reviewWords } = await supabase.from('vocabulary').select('word, translation')
    .eq('user_id', 'default_user').lte('next_review_at', new Date(Date.now() + 86400000).toISOString()).lt('mastery_score', 90).limit(8);
  const { data: currWords } = await supabase.from('curriculum').select('word, translation')
    .eq('phase', profile?.current_phase || 1).limit(20);
  const knownSet = new Set((await supabase.from('vocabulary').select('word').eq('user_id', 'default_user')).data?.map(v => v.word) || []);
  const newAvailable = (currWords || []).filter(w => !knownSet.has(w.word));

  const result = await gpt(
    'You are Luna\'s strategic brain. Plan the next conversation. Return JSON. 100 words max for plan_text.',
    `Learner: ${model?.narrative || 'New learner'}
About him: ${profile?.goals || 'Lives in Rio'}
Last session mood: ${lastAnalysis.mood}
Topics: ${JSON.stringify(lastAnalysis.topics)}
Comp: ${comp.toFixed(0)}, Prod: ${prod.toFixed(0)}
Phase: ${profile?.current_phase_name}, Words known: ${profile?.words_known}
Review due: ${(reviewWords || []).map(w => w.word).join(', ')}
New available: ${newAvailable.slice(0, 6).map(w => `${w.word}(${w.translation})`).join(', ')}

Return: { "plan_text": "...", "target_words": ["word1","word2"], "review_words": ["word1","word2"], "mood_approach": "light|push|easy", "opening_suggestion": "specific opening line or topic" }`,
    true
  );

  await supabase.from('session_plan').insert({
    user_id: 'default_user', plan_text: result.plan_text || '',
    target_words: result.target_words || [], review_words: result.review_words || [],
    mood_approach: result.mood_approach || 'light',
    opening_suggestion: result.opening_suggestion || 'Ask about his day',
  });

  console.log('Next session plan generated');
}

// ── Pattern detection (every 5 sessions) ───────────────────────────────────

async function runPatternDetection(sessionCount) {
  const { data: sessions } = await supabase.from('session_log')
    .select('session_summary, comprehension_data, production_words, accuracy_data, user_mood, topics_discussed, duration_seconds')
    .eq('user_id', 'default_user').order('started_at', { ascending: false }).limit(5);

  if (!sessions || sessions.length < 3) return;

  const sessionsText = sessions.map((s, i) => `Session ${sessionCount - i}:
  Summary: ${s.session_summary}
  Mood: ${s.user_mood}
  Topics: ${JSON.stringify(s.topics_discussed)}
  Duration: ${Math.round(s.duration_seconds / 60)}min
  Comprehension hits: ${(s.comprehension_data || []).filter(c => c.understood).length}/${(s.comprehension_data || []).length}
  Production: ${(s.production_words || []).join(', ') || 'none'}
  Errors: ${(s.accuracy_data || []).filter(a => !a.correct).map(a => a.attempt).join(', ') || 'none'}`
  ).join('\n\n');

  const result = await gpt(
    'Analyze 5 consecutive language learning sessions for patterns. Return JSON.',
    `${sessionsText}

Return: {
  "insights": [{"type":"retention|error|engagement|production","finding":"specific finding"}],
  "recommendations": ["specific recommendation"],
  "narrative": "2-3 sentence summary of patterns observed"
}`,
    true
  );

  await supabase.from('pattern_insights').insert({
    user_id: 'default_user', sessions_analyzed: sessions.length,
    insights: result.insights || [], recommendations: result.recommendations || [],
    narrative: result.narrative || '',
  });

  // Feed insights into learner model
  const { data: model } = await supabase.from('learner_model').select('narrative').eq('user_id', 'default_user').single();
  if (model && result.narrative) {
    await supabase.from('learner_model').update({
      narrative: `${model.narrative}\n\nPattern analysis (sessions ${sessionCount - 4}-${sessionCount}): ${result.narrative}`,
      updated_at: new Date().toISOString(),
    }).eq('user_id', 'default_user');
  }

  console.log('Pattern detection complete');
}

// ── GET /progress ──────────────────────────────────────────────────────────

app.get('/progress', async (req, res) => {
  const [profileRes, vocabRes, sessionsRes, modelRes] = await Promise.all([
    supabase.from('user_profile').select('name, comprehension_score, production_score, accuracy_score, total_sessions, total_minutes, words_known, current_phase, current_phase_name, created_at').eq('user_id', 'default_user').single(),
    supabase.from('vocabulary').select('word, translation, mastery_score, introduced_at, times_heard, times_used_correctly').eq('user_id', 'default_user').order('mastery_score', { ascending: false }),
    supabase.from('session_log').select('started_at, duration_seconds, session_summary, topics_discussed, new_words_introduced, mistakes, user_mood').eq('user_id', 'default_user').order('started_at', { ascending: false }).limit(10),
    supabase.from('learner_model').select('narrative, strongest_context, weakest_area').eq('user_id', 'default_user').single(),
  ]);

  // Phase completion
  let phaseCompletion = 0;
  if (profileRes.data) {
    const { data: phaseWords } = await supabase.from('curriculum').select('word').eq('phase', profileRes.data.current_phase);
    if (phaseWords?.length) {
      const { count } = await supabase.from('vocabulary')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', 'default_user').eq('phase', profileRes.data.current_phase).gte('mastery_score', 70);
      phaseCompletion = Math.round((count / phaseWords.length) * 100);
    }
  }

  res.json({
    profile: profileRes.data,
    phaseCompletion,
    vocabulary: vocabRes.data || [],
    sessions: sessionsRes.data || [],
    learnerModel: modelRes.data,
  });
});

// ── GET /recap/latest ──────────────────────────────────────────────────────

app.get('/recap/latest', async (req, res) => {
  const { data } = await supabase.from('session_log')
    .select('duration_seconds, session_summary, new_words_introduced, topics_discussed, user_mood, comprehension_data, production_words')
    .eq('user_id', 'default_user').order('started_at', { ascending: false }).limit(1).single();
  res.json(data || null);
});

// ── POST /translate-message ────────────────────────────────────────────────

app.post('/translate-message', async (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.json({ translation: '—' });
  try {
    const result = await gpt(
      'Translate this text. If English, translate to casual Brazilian Portuguese (carioca, masculine, contractions like tô/tá/cadê). If Portuguese, translate to English. Return JSON: { "translation": "..." }',
      text, true
    );
    res.json(result);
  } catch (err) {
    res.json({ translation: '—' });
  }
});

// ── POST /translate ────────────────────────────────────────────────────────

app.post('/translate', async (req, res) => {
  const { word } = req.body || {};
  if (!word) return res.json({ translation: '—', language: 'unknown' });
  try {
    const result = await gpt(
      'Return JSON: { "language": "pt" or "en", "translation": "concise", "note": "5 word usage note or null" }',
      word, true
    );
    res.json(result);
  } catch (err) {
    res.json({ translation: '—', language: 'unknown' });
  }
});

app.get('/health', async (req, res) => {
  const { data: p } = await supabase.from('user_profile').select('name,total_sessions,words_known,current_phase_name,comprehension_score').eq('user_id', 'default_user').single();
  const { data: m } = await supabase.from('learner_model').select('narrative').eq('user_id', 'default_user').single();
  const { data: plan } = await supabase.from('session_plan').select('plan_text,opening_suggestion').eq('user_id', 'default_user').eq('used', false).order('created_at', { ascending: false }).limit(1).single();
  res.json({ profile: p, learnerModel: m?.narrative?.slice(0, 200), nextPlan: plan?.plan_text?.slice(0, 200), nextOpening: plan?.opening_suggestion });
});

const PORT = process.env.PORT || 3000;

process.on('uncaughtException', (err) => console.error('UNCAUGHT:', err.message, err.stack));
process.on('unhandledRejection', (err) => console.error('UNHANDLED:', err));

app.listen(PORT, () => console.log(`Luna V3 running on port ${PORT}`));
