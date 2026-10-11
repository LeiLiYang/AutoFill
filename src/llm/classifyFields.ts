import type { FieldKind, ProfileKey } from '../adapters/types';
import { normalize } from '../detect/normalize';
import type { KeyValueStore } from '../profile/storage';
import type { LlmConfig } from './config';
import type { LlmClient } from './providers/types';

/** What the form shows for one field no rule recognised. Never the applicant's data. */
export interface FieldToClassify {
  id: string;
  label: string;
  kind: FieldKind;
  options?: string[];
}

/** A profile field, an open question that needs a written answer, or nothing we can fill. */
export type FieldClass = ProfileKey | 'freeText' | 'none';

/** The profile fields the model may choose from, described by what they hold. */
const KEYS: Partial<Record<ProfileKey, string>> = {
  firstName: 'given name',
  lastName: 'family name',
  fullName: 'full name in one box',
  preferredName: 'preferred name or nickname',
  pronouns: 'pronouns',
  email: "the applicant's own email address",
  phone: "the applicant's own phone number",
  linkedin: 'LinkedIn profile URL',
  github: 'GitHub profile URL',
  portfolio: 'personal website or portfolio URL',
  addressLine1: 'street address',
  addressLine2: 'apartment, suite or unit',
  city: 'city of residence',
  region: 'state or province of residence',
  postalCode: 'postal or ZIP code',
  country: 'country of residence',
  location: 'current location as one line (city, region, country)',
  authorizedToWork: 'legally authorized to work in the country of the job (yes/no)',
  requiresSponsorship: 'needs visa or work-permit sponsorship now or later (yes/no)',
  willingToRelocate: 'willing to relocate (yes/no)',
  startDate: 'earliest start date or availability',
  salary: 'salary expectation',
  noticePeriod: 'notice period',
  currentCompany: 'current or most recent employer',
  currentTitle: 'current or most recent job title',
  school: 'school or university attended',
  degree: 'degree or level of education',
  field: 'field of study or major',
  gpa: 'grade point average',
  gender: 'gender (voluntary self-identification)',
  race: 'race or ethnicity (voluntary self-identification)',
  hispanicLatino: 'Hispanic or Latino (voluntary self-identification)',
  veteran: 'veteran status (voluntary self-identification)',
  disability: 'disability status (voluntary self-identification)',
  resume: 'resume or CV upload',
  coverLetter: 'cover letter upload',
};
const FILE_KEYS = new Set<FieldClass>(['resume', 'coverLetter']);

const SYSTEM = [
  'You label fields of a job application form. For each field you are given the text the form shows for it (its label, in any language), the kind of control, and its options if it has any. Decide what the form is asking the applicant for.',
  '',
  'Reply with one JSON object and nothing else, mapping every field id to exactly one of these values:',
  ...Object.entries(KEYS).map(([key, help]) => `- "${key}": ${help}`),
  '- "freeText": an open question about the applicant that needs a sentence or more written for it (motivation, experience with something, how they heard about the role). Only for kind "text" or "textarea".',
  '- "none": anything else. This includes details about another person (a referee, an emergency contact, a recruiter), consent and terms checkboxes, account passwords, search or filter boxes, date-of-birth and government ID numbers, and any field you are not sure about.',
  '',
  'Rules:',
  '- Choose a profile field only when the label clearly asks for that exact thing. A wrong value typed into a form is worse than an empty field, so when in doubt answer "none".',
  '- "resume" and "coverLetter" are only for kind "file"; a file field can only be one of those two or "none".',
  '- Use the options to check your reading: a yes/no question about work permits is "authorizedToWork" or "requiresSponsorship" depending on which it asks.',
].join('\n');

const MAX_FIELDS = 60;
const MAX_LABEL_CHARS = 200;
const MAX_OPTIONS = 30;

export function buildClassifyPrompt(fields: FieldToClassify[]): { system: string; user: string } {
  const rows = fields.map((f) => ({
    id: f.id,
    label: f.label.slice(0, MAX_LABEL_CHARS),
    kind: f.kind,
    ...(f.options?.length ? { options: f.options.slice(0, MAX_OPTIONS).map((o) => o.slice(0, 60)) } : {}),
  }));
  return { system: SYSTEM, user: `<fields>\n${JSON.stringify(rows, null, 1)}\n</fields>` };
}

/** Read the model's reply defensively: anything that is not a known value for a known id is dropped. */
export function parseClassification(text: string, fields: FieldToClassify[]): Record<string, FieldClass> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return {};
  }
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, FieldClass> = {};
  for (const f of fields) {
    const value = (raw as Record<string, unknown>)[f.id];
    if (typeof value !== 'string') continue;
    const known = value === 'none' || value === 'freeText' || value in KEYS;
    if (!known) continue;
    const isFile = f.kind === 'file';
    // A file can only be a resume or cover letter, and those can only be files; free text needs a text box.
    if (value !== 'none' && isFile !== FILE_KEYS.has(value as FieldClass)) continue;
    if (value === 'freeText' && f.kind !== 'text' && f.kind !== 'textarea') continue;
    out[f.id] = value as FieldClass;
  }
  return out;
}

const KEY = 'fieldMapCache';
const MAX_ENTRIES = 2000;
type Cache = Record<string, { c: FieldClass; t: number }>;

/** The same label on the same site means the same thing next time: remembered so it is asked once. */
const cacheKey = (host: string, f: FieldToClassify) => `${host}|${f.kind}|${normalize(f.label)}|${(f.options ?? []).length}`;

export interface ClassifyDeps {
  llm(config: LlmConfig): LlmClient;
  kv: KeyValueStore;
  now?: () => number;
}

/**
 * Work out what the fields no rule recognised are asking for: one request for the whole page, sent
 * to the small "recognising fields" model, with answers remembered per site. Only labels and
 * options are sent. Fails soft: on any error the fields simply stay unrecognised.
 */
export async function classifyFields(deps: ClassifyDeps, config: LlmConfig, host: string, fields: FieldToClassify[]): Promise<Record<string, FieldClass>> {
  const now = deps.now ?? Date.now;
  const cache = ((await deps.kv.get(KEY)) as Cache | undefined) ?? {};
  const out: Record<string, FieldClass> = {};
  const unknown: FieldToClassify[] = [];
  for (const f of fields.filter((x) => x.label.trim())) {
    const hit = cache[cacheKey(host, f)];
    if (hit) out[f.id] = hit.c;
    else unknown.push(f);
  }
  const ask = unknown.slice(0, MAX_FIELDS);
  if (!ask.length || !config.ready) return out;

  let fresh: Record<string, FieldClass>;
  try {
    const { system, user } = buildClassifyPrompt(ask);
    const reply = await deps.llm(config).complete({ model: config.mappingModel, system, user, maxTokens: 4000 });
    fresh = parseClassification(reply.text, ask);
  } catch {
    return out;
  }
  for (const f of ask) {
    const c = fresh[f.id];
    if (!c) continue;
    out[f.id] = c;
    cache[cacheKey(host, f)] = { c, t: now() };
  }
  const keep = Object.entries(cache).sort((a, b) => b[1].t - a[1].t).slice(0, MAX_ENTRIES);
  await deps.kv.set(KEY, Object.fromEntries(keep));
  return out;
}
