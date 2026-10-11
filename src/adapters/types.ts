import type { FileKind, Profile, Settings } from '../profile/schema';

export type ProfileKey =
  | 'firstName' | 'lastName' | 'fullName' | 'preferredName' | 'pronouns'
  | 'email' | 'phone'
  | 'linkedin' | 'github' | 'portfolio'
  | 'addressLine1' | 'addressLine2' | 'city' | 'region' | 'postalCode' | 'country' | 'location'
  | 'authorizedToWork' | 'requiresSponsorship' | 'willingToRelocate'
  | 'startDate' | 'salary' | 'noticePeriod'
  | 'currentCompany' | 'currentTitle'
  | 'school' | 'degree' | 'field' | 'gpa'
  | 'gender' | 'race' | 'hispanicLatino' | 'veteran' | 'disability'
  | 'resume' | 'coverLetter'
  | 'phoneType'
  // Repeated work-history / education sections. The generic start/end keys use the field's `section`
  // (education vs experience); the explicit ones are for adapters that know which they mean.
  | 'startMonth' | 'startYear' | 'endMonth' | 'endYear'
  | 'expLocation' | 'expDescription' | 'expCurrent'
  | 'expStartMonth' | 'expStartYear' | 'expEndMonth' | 'expEndYear'
  | 'eduStartYear' | 'eduEndYear';

/** Which repeating part of an application a field sits in. */
export type Section = 'education' | 'experience';

export type FieldKind =
  | 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'combobox' | 'file' | 'date';

export interface FieldOption {
  text: string;
  value: string;
  element?: HTMLElement;
}

export interface FieldDescriptor {
  id: string;
  element: HTMLElement;
  kind: FieldKind;
  label: string;
  ariaLabel?: string;
  placeholder?: string;
  name?: string;
  htmlId?: string;
  autocomplete?: string;
  automationId?: string;
  /** data-testid / data-qa: often the only readable name on in-house forms. */
  testId?: string;
  nearbyText?: string;
  options?: FieldOption[];
  required: boolean;
  currentValue: string;
  /** Adapter-provided hint that skips rule matching. */
  hintedKey?: ProfileKey;
  /** Which work-experience / education entry this field belongs to (0-based), when the form repeats sections. */
  entryIndex?: number;
  /** Education or work-experience part of the form, read from ids/classes/headings around the field. */
  section?: Section;
}

export interface Match {
  key: ProfileKey | 'freeText';
  confidence: number;
  rule: string;
}

export type FillValue =
  | { type: 'text'; text: string }
  | { type: 'bool'; value: boolean }
  | { type: 'choice'; text: string; targets: string[] }
  | { type: 'file'; fileKind: FileKind };

export type FillStatus =
  | 'filled'          // filled, high confidence
  | 'low-confidence'  // filled, needs review
  | 'ai'              // AI-generated, needs review
  | 'skipped-existing'
  | 'no-data'         // matched a key but the profile has nothing for it
  | 'unmatched'
  | 'failed';

/** How a free-text question gets answered, when it can be. */
export type FreeTextResult =
  | { kind: 'bank'; text: string; score: number }
  | { kind: 'ai'; text: string }
  | { kind: 'none'; reason: string };

export interface FillOptions {
  overwrite: boolean;
  getFile: (kind: FileKind) => Promise<File | null>;
  /** Answers open-ended questions (answer bank first, then the optional LLM). Absent = leave them empty. */
  freeText?: (d: FieldDescriptor) => Promise<FreeTextResult>;
  /** A saved answer for a question no rule recognises (dropdowns, radios and short text boxes too). */
  bankAnswer?: (d: FieldDescriptor) => { text: string; score: number } | null;
  /**
   * Second opinion on fields no rule recognised (the optional LLM, labels only): field id → what
   * it asks for. Absent or failing = those fields stay unrecognised.
   */
  classify?: (fields: FieldDescriptor[]) => Promise<Record<string, ProfileKey | 'freeText' | 'none'>>;
  /** Pause before looking for fields that a filled answer revealed. 0 turns the second look off. */
  rescanDelayMs?: number;
}

export interface FillResult {
  status: FillStatus;
  detail?: string;
}

export interface AdapterContext {
  doc: Document;
  url: URL;
  isTopFrame: boolean;
}

export interface PostingInfo {
  company?: string;
  title?: string;
  location?: string;
  description?: string;
  /** True when this page is only the application form and the description lives elsewhere. */
  formOnly?: boolean;
}

export interface PlatformAdapter {
  id: 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'generic';
  /** 0 = not this platform; the highest score wins. */
  detect(ctx: AdapterContext): number;
  getFields(ctx: AdapterContext): FieldDescriptor[];
  fill(field: FieldDescriptor, value: FillValue, opts: FillOptions): Promise<FillResult>;
  getPosting?(ctx: AdapterContext): PostingInfo | null;
}

/** One row of the report shown in the popup and the review panel. */
export interface FieldReport {
  id: string;
  label: string;
  kind: FieldKind;
  key?: Match['key'];
  confidence: number;
  status: FillStatus;
  required: boolean;
  /** Required and still empty after the run. */
  emptyRequired: boolean;
  valuePreview?: string;
  detail?: string;
}

export interface FillContext {
  profile: Profile;
  settings: Settings;
}
