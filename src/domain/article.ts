import { z } from "zod";

export const VisualSchema = z.object({
  token: z.string().min(1),
  kind: z.enum(["svg", "image"]),
  code: z.string().optional(),
  url: z.string().url().optional(),
  alt: z.string().min(1),
});

export const FaqSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

export const ArticleSchema = z.object({
  title: z.string().min(50).max(65),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  excerpt: z.string().min(120).max(155),
  category: z.string().min(1),
  tags: z.array(z.string()).default([]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  publishDate: z.string().optional(),
  bodyMarkdown: z.string().min(1),
  tldr: z.string().min(1),
  faqs: z.array(FaqSchema).min(3),
  takeaways: z.array(z.string().min(1)).min(4).max(6),
  relatedSlugs: z.array(z.string()).default([]),
  visuals: z.array(VisualSchema).default([]),
  seoHints: z.object({
    jsonldType: z.enum(["Article", "HowTo", "DefinedTerm"]),
    mentions: z.array(z.string()).default([]),
    speakableSelectors: z.array(z.string()).default([]),
  }),
});

export type Article = z.infer<typeof ArticleSchema>;
export type Visual = z.infer<typeof VisualSchema>;
export type Faq = z.infer<typeof FaqSchema>;
