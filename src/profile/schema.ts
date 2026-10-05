import { z } from 'zod';

export const SCHEMA_VERSION = 1;

export const EEO_DECLINE = 'Decline to self-identify';
const eeoField = z.string().default(EEO_DECLINE);

const str = z.string().default('');

export const EducationSchema = z.object({
  school: str,
  degree: str,
  field: str,
  startDate: str,
  endDate: str,
  gpa: str,
  current: z.boolean().default(false),
});

export const ExperienceSchema = z.object({
  company: str,
  title: str,
  location: str,
  startDate: str,
  endDate: str,
  current: z.boolean().default(false),
  description: str,
});

export const AnswerSchema = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
  tags: z.array(z.string()).default([]),
  updatedAt: z.string(),
});

export const ProfileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  contact: z
    .object({
      firstName: str,
      lastName: str,
      preferredName: str,
      email: str,
      phone: str,
      pronouns: str,
    })
    .default({}),
  links: z
    .object({
      linkedin: str,
      github: str,
      portfolio: str,
      other: z.array(z.string()).default([]),
    })
    .default({}),
  address: z
    .object({
      line1: str,
      line2: str,
      city: str,
      region: str,
      postalCode: str,
      country: str,
    })
    .default({}),
  work: z
    .object({
      authorizedCountries: z.array(z.string()).default([]),
      requiresSponsorship: z.boolean().default(false),
      willingToRelocate: z.boolean().default(false),
      startDate: str,
      salaryExpectation: z
        .object({
          amount: str,
          currency: z.string().default('CAD'),
          period: z.enum(['year', 'month', 'hour']).default('year'),
        })
        .default({}),
      noticePeriod: str,
    })
    .default({}),
  education: z.array(EducationSchema).default([]),
  experience: z.array(ExperienceSchema).default([]),
  eeo: z
    .object({
      gender: eeoField,
      race: eeoField,
      hispanicLatino: eeoField,
      veteran: eeoField,
      disability: eeoField,
    })
    .default({}),
  answerBank: z.array(AnswerSchema).default([]),
});
export type Profile = z.infer<typeof ProfileSchema>;
export type Education = z.infer<typeof EducationSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;
export type Answer = z.infer<typeof AnswerSchema>;

export const SettingsSchema = z.object({
  sheetId: str,
  tabName: z.string().default('Sheet1'),
  anthropicApiKey: str,
  model: z.string().default('claude-opus-5-5'),
  overwrite: z.boolean().default(false),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const defaultProfile = (): Profile => ProfileSchema.parse({});
export const defaultSettings = (): Settings => SettingsSchema.parse({});

export const FileKindSchema = z.enum(['resume', 'coverLetter']);
export type FileKind = z.infer<typeof FileKindSchema>;
