import type { OwnerAgent } from "../contracts/vocab.js";

/**
 * Normalize routine-output frontmatter `created_by` into the closed owner-agent
 * vocabulary used by routines. Foreign automation slugs and non-owner personas
 * intentionally return null; the SLO join then falls back to the routine's
 * selector/exclude filters rather than trusting unrelated provenance text.
 */
export function normalizeProvenance(createdBy: string | null | undefined): OwnerAgent | null {
  if (!createdBy) return null;
  const normalized = createdBy
    .trim()
    .toLowerCase()
    .replace(/\(paperclip\)/g, " ")
    .replace(/\bagent\b/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized === "") return null;
  if (/librarian/.test(normalized)) return "Librarian";
  if (/\bcto\b/.test(normalized)) return "CTO";
  if (/\bcoo\b|\bpm\b/.test(normalized)) return "COO";
  if (/\bceo\b/.test(normalized)) return "CEO";
  return null;
}
