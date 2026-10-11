import type { Answer, Profile } from '../profile/schema';

/** The model replies with exactly this when the provided facts cannot answer the question honestly. */
export const INSUFFICIENT = 'INSUFFICIENT_INFO';

const MAX_POSTING_CHARS = 6000;

export interface PromptInput {
  question: string;
  profile: Profile;
  /** Related past Q&A pairs (style and content examples). */
  samples: Answer[];
  /** Answers saved without a question: background on the applicant's interests and voice. */
  background?: Answer[];
  posting?: { title?: string; company?: string; descriptionMd?: string } | null;
  /** The field's character limit, when the form sets one. */
  maxChars?: number;
  /** The applicant's own description of how they write (settings). */
  voiceNotes?: string;
}

/** Says outright whether a degree is finished: dates alone let the model assume the applicant is still a student. */
function educationStatus(e: Profile['education'][number], now: Date): string {
  if (e.current) return ', currently enrolled';
  if (!/^\d{4}-\d{2}/.test(e.endDate ?? '')) return '';
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return e.endDate.slice(0, 7) <= today ? ', COMPLETED: graduated, not a student' : ', expected graduation, not yet completed';
}

/**
 * Only what the answer needs is sent: name, links, education and work history. Contact details,
 * address, salary and demographic answers never leave the browser.
 */
export function profileSummary(p: Profile, now: Date = new Date()): string {
  const name = [p.contact.firstName, p.contact.lastName].filter(Boolean).join(' ');
  const lines: string[] = [];
  if (name) lines.push(`Name: ${name}`);
  const links = [p.links.linkedin, p.links.github, p.links.portfolio].filter(Boolean);
  if (links.length) lines.push(`Links: ${links.join(', ')}`);
  if (p.education.length) {
    lines.push('Education:');
    for (const e of p.education) {
      lines.push(`- ${[e.degree, e.field].filter(Boolean).join(' in ')} at ${e.school} (${e.startDate || '?'} to ${e.current ? 'present' : e.endDate || '?'}${educationStatus(e, now)})${e.gpa ? `, GPA ${e.gpa}` : ''}`);
    }
  }
  if (p.experience.length) {
    lines.push('Experience:');
    for (const x of p.experience) {
      lines.push(`- ${x.title} at ${x.company} (${x.startDate || '?'} to ${x.current ? 'present' : x.endDate || '?'})${x.description ? `: ${x.description}` : ''}`);
    }
  }
  return lines.join('\n');
}

export type AnswerShape = 'fact' | 'paragraph' | 'essay';

export interface AnswerLength {
  shape: AnswerShape;
  /** Ceiling in words. */
  words: number;
}

/** Questions answered by a fact, not a story: a sentence is the whole answer. */
const FACT_QUESTION =
  /salary|compensation|pay (range|expectation)|expected pay|start date|when (can|could|would) you (start|join)|earliest .*start|notice period|how did you (hear|find|learn)|where did you (hear|find|see)|how many years|years of experience|are you (currently|legally|able|willing|authori[sz]ed|eligible)|do you (have|require|need|hold)|will you (now|require|need)|citizenship|work permit|visa|sponsor|relocat|current (location|city|employer|title)|where are you (located|based)|pronoun|availability|available to|preferred (name|location)|graduation (date|year)|\bgpa\b/i;
/** The form explicitly asks for something long. */
const ESSAY_QUESTION = /cover letter|personal statement|\bessay\b|in detail|at length|elaborate|\b(2\d\d|[3-9]\d\d|\d{4}) words\b|several paragraphs|two paragraphs/i;

const WORDS: Record<AnswerShape, number> = { fact: 25, paragraph: 110, essay: 220 };

/**
 * How long an answer this question deserves. Most application questions want one paragraph; a
 * factual one wants a sentence; only an explicit request earns two paragraphs. A form's character
 * limit can shorten the answer but never lengthens it.
 */
export function answerLength(question: string, maxChars?: number): AnswerLength {
  const q = question.trim();
  const shape: AnswerShape = ESSAY_QUESTION.test(q) ? 'essay' : q.length <= 140 && FACT_QUESTION.test(q) ? 'fact' : 'paragraph';
  const fits = maxChars ? Math.max(12, Math.floor(maxChars / 7)) : Infinity;
  return { shape, words: Math.min(WORDS[shape], fits) };
}

function lengthInstruction(l: AnswerLength, maxChars?: number): string {
  const shape =
    l.shape === 'fact'
      ? `One sentence, or just the fact itself if that answers it. At most ${l.words} words.`
      : l.shape === 'essay'
        ? `Up to two paragraphs, at most ${l.words} words in total.`
        : `One paragraph, at most ${l.words} words. Shorter is fine if the question is answered.`;
  return `${shape}${maxChars ? ` The form accepts at most ${maxChars} characters; stay well under that.` : ''}`;
}

/** Sections of a posting that never help answer a question about the applicant. */
const BOILERPLATE_HEADING =
  /benefits|perks|what we offer|compensation|salary|pay range|equal (employment )?opportunit|\beeo\b|diversity|inclusion|accommodat|privacy|how to apply|application process|background check|e-verify|disclaimer/i;

/**
 * Drop benefits, pay, EEO and how-to-apply sections so the character budget goes to the role
 * itself. A section runs from a heading (a `#` line or a line that is entirely bold) to the next one.
 */
export function trimPosting(md: string): string {
  const isHeading = (line: string) => /^\s{0,3}#{1,6}\s+\S/.test(line) || /^\s*(\*\*|__)[^*_]+(\*\*|__):?\s*$/.test(line);
  const kept: string[] = [];
  let skipping = false;
  for (const line of md.split('\n')) {
    if (isHeading(line)) skipping = BOILERPLATE_HEADING.test(line);
    if (!skipping) kept.push(line);
  }
  const out = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // A posting with no recognisable headings, or one we would empty out, is sent as it is.
  return out.length >= 200 ? out : md.trim();
}

/** The instructions. Constant on purpose: nothing per question belongs here, so providers can cache it. */
const SYSTEM = [
  'You draft answers to job application questions for the applicant, in the first person. The applicant submits your draft under their own name, so it has to read like something they wrote themselves on an ordinary day: direct, specific and a little plain. Recruiters read hundreds of these and discount anything that sounds padded or machine-written.',
  '',
  'Facts',
  "- Use only facts from the applicant's profile, past answers and writing samples (all written by the applicant). Never invent employers, projects, skills, numbers, awards or experience.",
  '- Use the job posting only to tailor emphasis and to name the company or role correctly. Do not claim the applicant has experience the posting asks for unless their own material shows it.',
  `- If the question cannot be answered honestly from the information given (for example it asks for a specific fact that is not provided), reply with exactly ${INSUFFICIENT} and nothing else.`,
  "- Today's date is given after the profile. Describe the applicant's education as the profile states it: if a degree is marked COMPLETED, they have graduated and are not a student, so never call them a student or say they are graduating. Say \"I graduated from…\" or \"my degree in…\". Mention a GPA only when the question asks about grades or academics.",
  '',
  'Content',
  '- Answer the question that was asked, and start with the answer. Do not restate the question, do not open by announcing enthusiasm, and do not close with a summary sentence or a line about looking forward to contributing.',
  '- Write ONE coherent answer with a single through-line. Choose the one experience or interest that fits this question best (two at most) and say something concrete about it: what it was, what the applicant did, what came of it. Never list, stack or summarise several past answers one after another. Most of the samples will not be relevant to any one question; leave those out.',
  '- A specific detail from the material beats a general claim about the applicant. If the material has no fitting detail, say less rather than filling the space with adjectives.',
  '',
  'Voice',
  "- Write the way the applicant's own samples read: their vocabulary, their sentence lengths, their level of formality, their use of contractions. Do not copy sentences from the samples verbatim, and do not mention the samples. If voice notes are given, they take priority over everything in this section.",
  '- Use plain words. Leave out stock application language such as: passionate, thrilled, excited to, leverage, utilize, dynamic, fast-paced, cutting-edge, innovative, synergy, honed, spearheaded, delve, "aligns with", "resonates with", "I am confident that", "unique blend", "proven track record".',
  '- Avoid the habits that mark text as machine-written: lists of three, "not only X but also Y", "it is not just X, it is Y", rhetorical questions, a final sentence that states a moral, exclamation marks, and em dashes (use a comma or a full stop).',
  '- Let sentence length vary the way it does in speech. A short sentence is fine.',
  '',
  'Length and format',
  '- Each question comes with a length. Treat it as a ceiling, not a target: stop when the question is answered. If the question itself states a length (a word count, "2-3 sentences"), follow that instead.',
  '- Plain prose only: no headings, no bullet or numbered lists, no bold, even if the samples use them. More than one paragraph only when the length given allows it.',
  '- Output only the answer text: no preamble, no quotation marks, no sign-off.',
].join('\n');

export interface BuiltPrompt {
  /** Instructions: identical for every question, so a provider can cache them. */
  system: string;
  /** Job posting, profile and voice notes: identical for every question on one page. Sent first, cached. */
  stable: string;
  /** Writing samples, related past answers and the question itself. */
  user: string;
}

export function buildPrompt(i: PromptInput, now: Date = new Date()): BuiltPrompt {
  const shared: string[] = [];
  if (i.posting?.company || i.posting?.title) {
    shared.push(`<job>\nCompany: ${i.posting.company ?? 'unknown'}\nRole: ${i.posting.title ?? 'unknown'}\n</job>`);
  }
  if (i.posting?.descriptionMd?.trim()) {
    shared.push(`<job_posting>\n${trimPosting(i.posting.descriptionMd).slice(0, MAX_POSTING_CHARS)}\n</job_posting>`);
  }
  shared.push(`<applicant_profile>\n${profileSummary(i.profile, now) || '(no profile details provided)'}
Today's date: ${now.toISOString().slice(0, 10)}\n</applicant_profile>`);
  if (i.voiceNotes?.trim()) {
    shared.push(`<voice_notes note="The applicant's own description of how they write. Follow it.">\n${i.voiceNotes.trim()}\n</voice_notes>`);
  }

  const parts: string[] = [];
  if (i.background?.length) {
    parts.push(
      `<writing_samples note="Things the applicant has written, without the original question. Background on their interests, experience and voice.">\n${i.background
        .map((s) => `- ${s.answer}`)
        .join('\n\n')}\n</writing_samples>`,
    );
  }
  if (i.samples.length) {
    parts.push(
      `<past_answers note="The applicant's earlier answers to similar questions: voice and content.">\n${i.samples
        .map((s) => `Q: ${s.question}\nA: ${s.answer}`)
        .join('\n\n')}\n</past_answers>`,
    );
  }
  parts.push(`<question>\n${i.question}\n</question>`);
  // The length varies per question and field, so it lives here and not in the (cached) instructions.
  parts.push(`<length>\n${lengthInstruction(answerLength(i.question, i.maxChars), i.maxChars)}\n</length>`);
  return { system: SYSTEM, stable: `${shared.join('\n\n')}\n\n`, user: parts.join('\n\n') };
}
