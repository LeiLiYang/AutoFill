import type { Answer, Profile } from '../profile/schema';

/** The model replies with exactly this when the provided facts cannot answer the question honestly. */
export const INSUFFICIENT = 'INSUFFICIENT_INFO';

const MAX_POSTING_CHARS = 6000;
const DEFAULT_WORDS = 150;
const MAX_WORDS = 180;

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
}

/**
 * Only what the answer needs is sent: name, links, education and work history. Contact details,
 * address, salary and demographic answers never leave the browser.
 */
export function profileSummary(p: Profile): string {
  const name = [p.contact.firstName, p.contact.lastName].filter(Boolean).join(' ');
  const lines: string[] = [];
  if (name) lines.push(`Name: ${name}`);
  const links = [p.links.linkedin, p.links.github, p.links.portfolio].filter(Boolean);
  if (links.length) lines.push(`Links: ${links.join(', ')}`);
  if (p.education.length) {
    lines.push('Education:');
    for (const e of p.education) {
      lines.push(`- ${[e.degree, e.field].filter(Boolean).join(' in ')} at ${e.school} (${e.startDate || '?'} to ${e.current ? 'present' : e.endDate || '?'})${e.gpa ? `, GPA ${e.gpa}` : ''}`);
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

export function buildPrompt(i: PromptInput): { system: string; user: string } {
  // A form's character limit can only shorten the answer, never lengthen it past the concise default.
  const words = i.maxChars ? Math.max(20, Math.min(MAX_WORDS, Math.floor(i.maxChars / 7))) : DEFAULT_WORDS;
  const system = [
    'You write answers to job application questions on behalf of the applicant, in the first person, in their own voice.',
    '',
    'Rules:',
    `- Length: one or two short paragraphs, about ${words} words or fewer, never more than two paragraphs. A narrow question ("expected salary", "earliest start date") gets a sentence or two. Plain prose: no headings and no bullet or numbered lists, even if the samples use them.${i.maxChars ? ` The form accepts at most ${i.maxChars} characters; stay well under that.` : ''}`,
    '- Write ONE coherent answer to THIS question with a single through-line. Never list, stack or summarise several past answers one after another. Use the past answers and samples as raw material: choose the one or two experiences or interests that fit this question best, and work them into the answer naturally. Several samples may inform your sense of what the applicant cares about, but only the best-fitting details should appear.',
    "- Use ONLY facts from the applicant's profile, past answers and writing samples below (all written by the applicant). Never invent employers, projects, skills, numbers, awards, or experience.",
    '- The writing samples and past answers reveal what the applicant cares about, what they have built, and how they write. Draw on them for content and interests when relevant to the question; most of them will not be relevant to any one question.',
    '- Use the job posting only to tailor emphasis and to name the company or role correctly. Do not claim the applicant has experience the posting asks for unless their profile or samples show it.',
    "- Match the tone and style of the applicant's writing; do not copy sentences from the samples verbatim, and do not mention the samples.",
    `- If the question cannot be answered honestly from the information given (for example it asks for a specific fact that is not provided), reply with exactly ${INSUFFICIENT} and nothing else.`,
    '- Output only the answer text: no preamble, no quotation marks, no sign-off.',
  ].join('\n');

  const parts: string[] = [];
  if (i.posting?.company || i.posting?.title) {
    parts.push(`<job>\nCompany: ${i.posting.company ?? 'unknown'}\nRole: ${i.posting.title ?? 'unknown'}\n</job>`);
  }
  if (i.posting?.descriptionMd?.trim()) {
    parts.push(`<job_posting>\n${i.posting.descriptionMd.slice(0, MAX_POSTING_CHARS)}\n</job_posting>`);
  }
  parts.push(`<applicant_profile>\n${profileSummary(i.profile) || '(no profile details provided)'}\n</applicant_profile>`);
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
  return { system, user: parts.join('\n\n') };
}
