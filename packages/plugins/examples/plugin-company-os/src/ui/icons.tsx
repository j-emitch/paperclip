import type { ReactElement, ReactNode } from "react";
import type { CompanyOsTabKey } from "./tabs.js";

interface IconProps {
  size?: number;
  strokeWidth?: number;
}

/**
 * Small, dependency-free stroke icons for the cockpit tabs. Inline SVG (rather
 * than a Lucide dependency) keeps the scaffold self-contained; `currentColor`
 * lets each call site theme them. Decorative — call sites add aria-labels.
 */
function svg(size: number, strokeWidth: number, children: ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function AtlasIcon({ size = 16, strokeWidth = 1.8 }: IconProps) {
  // Stacked map sheets — the Build Atlas: many spec-prefix families layered into
  // domains. Distinct from the Board's columns and the Agents constellation, so
  // the tab icon reads as "the atlas of what we've built".
  return svg(size, strokeWidth, (
    <>
      <path d="M12 3 3 7.5 12 12l9-4.5z" />
      <path d="M3 12l9 4.5 9-4.5" />
      <path d="M3 16.5 12 21l9-4.5" />
    </>
  ));
}

export function DocsIcon({ size = 16, strokeWidth = 1.8 }: IconProps) {
  return svg(size, strokeWidth, (
    <>
      <path d="M6 2.5h8l4 4V21a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 21z" />
      <path d="M14 2.5V6.5h4" />
      <path d="M9 12h6M9 15.5h6M9 8.5h2" />
    </>
  ));
}

export function AgentsIcon({ size = 16, strokeWidth = 1.8 }: IconProps) {
  // An org constellation — a CEO apex fanning to three reports (COO / CTO /
  // Librarian). Echoes the Agents cockpit's signature AgentConstellation, so the
  // tab icon is a synecdoche of the surface it opens.
  return svg(size, strokeWidth, (
    <>
      <circle cx="12" cy="5" r="2.3" />
      <circle cx="5.5" cy="18" r="2" />
      <circle cx="12" cy="18" r="2" />
      <circle cx="18.5" cy="18" r="2" />
      <path d="M12 7.3 6.6 16.1M12 7.3V16M12 7.3 17.4 16.1" />
    </>
  ));
}

export function TeachingIcon({ size = 16, strokeWidth = 1.8 }: IconProps) {
  return svg(size, strokeWidth, (
    <>
      <path d="M12 3 2.5 8 12 13l9.5-5z" />
      <path d="M6 10v5c0 1.2 2.7 2.5 6 2.5s6-1.3 6-2.5v-5" />
    </>
  ));
}

export function KnowledgeIcon({ size = 16, strokeWidth = 1.8 }: IconProps) {
  return svg(size, strokeWidth, (
    <>
      <circle cx="12" cy="6" r="2.4" />
      <circle cx="5.5" cy="17.5" r="2.4" />
      <circle cx="18.5" cy="17.5" r="2.4" />
      <path d="M11 8 6.7 15.4M13 8l4.3 7.4M7.7 17.5h8.6" />
    </>
  ));
}

export function HygieneIcon({ size = 16, strokeWidth = 1.8 }: IconProps) {
  // "Sparkle" — tidy/hygiene: the write-authority audit surface (PWA-01 / COS-3).
  return svg(size, strokeWidth, (
    <>
      <path d="M11 3l1.7 4.3L17 9l-4.3 1.7L11 15l-1.7-4.3L5 9l4.3-1.7z" />
      <path d="M17.5 14l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z" />
    </>
  ));
}

export function CompanyOsGlyph({ size = 18, strokeWidth = 1.8 }: IconProps) {
  return svg(size, strokeWidth, (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4.5" />
      <path d="M8 12h8M12 8v8" />
    </>
  ));
}

// --- Board glyphs (COS-0e) ---------------------------------------------------

export function CaretIcon({ size = 14, strokeWidth = 2 }: IconProps) {
  return svg(size, strokeWidth, <path d="M6 9l6 6 6-6" />);
}

export function ExternalLinkIcon({ size = 12, strokeWidth = 1.8 }: IconProps) {
  return svg(size, strokeWidth, (
    <>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </>
  ));
}

export function CheckIcon({ size = 12, strokeWidth = 2.2 }: IconProps) {
  return svg(size, strokeWidth, <path d="M4 12.5l5 5 11-12" />);
}

export function AlertIcon({ size = 14, strokeWidth = 1.9 }: IconProps) {
  return svg(size, strokeWidth, (
    <>
      <path d="M12 3.5 1.8 20.5h20.4z" />
      <path d="M12 10v4.5M12 17.6v.1" />
    </>
  ));
}

export function RefreshIcon({ size = 14, strokeWidth = 1.9 }: IconProps) {
  return svg(size, strokeWidth, (
    <>
      <path d="M20 11a8 8 0 0 0-14.3-4.6M4 5v3.5h3.5" />
      <path d="M4 13a8 8 0 0 0 14.3 4.6M20 19v-3.5h-3.5" />
    </>
  ));
}

export function InboxIcon({ size = 28, strokeWidth = 1.6 }: IconProps) {
  return svg(size, strokeWidth, (
    <>
      <path d="M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <path d="M3 13h5l1.5 2.5h5L16 13h5" />
    </>
  ));
}

export function PlugOffIcon({ size = 28, strokeWidth = 1.6 }: IconProps) {
  return svg(size, strokeWidth, (
    <>
      <path d="M9 7V4M15 7V4" />
      <path d="M7 7h10v4a5 5 0 0 1-10 0z" />
      <path d="M12 16v4" />
      <path d="M4 4l16 16" />
    </>
  ));
}

export function SearchIcon({ size = 14, strokeWidth = 1.9 }: IconProps) {
  return svg(size, strokeWidth, (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-4.7-4.7" />
    </>
  ));
}

export function ClockIcon({ size = 13, strokeWidth = 1.8 }: IconProps) {
  return svg(size, strokeWidth, (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ));
}

export function DocIcon({ size = 26, strokeWidth = 1.6 }: IconProps) {
  return svg(size, strokeWidth, (
    <>
      <path d="M6 2.5h8l4 4V21a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 21z" />
      <path d="M14 2.5V6.5h4" />
      <path d="M9 12h6M9 15.5h6" />
    </>
  ));
}

export function FileWarningIcon({ size = 26, strokeWidth = 1.6 }: IconProps) {
  return svg(size, strokeWidth, (
    <>
      <path d="M6 2.5h8l4 4V21a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 21z" />
      <path d="M14 2.5V6.5h4" />
      <path d="M12 11v4M12 17.6v.1" />
    </>
  ));
}

export function CloseIcon({ size = 14, strokeWidth = 2 }: IconProps) {
  return svg(size, strokeWidth, <path d="M6 6l12 12M18 6 6 18" />);
}

// --- COS-1 daily-driver glyphs ----------------------------------------------

export function HomeIcon({ size = 16, strokeWidth = 1.8 }: IconProps) {
  // The orientation hero — a house: "where I land, what needs me."
  return svg(size, strokeWidth, (
    <>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10.5V20h12v-9.5" />
      <path d="M10 20v-5h4v5" />
    </>
  ));
}

export function SourceIcon({ size = 16, strokeWidth = 1.8 }: IconProps) {
  // A git-branch glyph — the working-tree-vs-main source surface.
  return svg(size, strokeWidth, (
    <>
      <circle cx="6.5" cy="5" r="2.2" />
      <circle cx="6.5" cy="19" r="2.2" />
      <circle cx="17.5" cy="8" r="2.2" />
      <path d="M6.5 7.2v9.6" />
      <path d="M17.5 10.2c0 4-3.5 4.3-6.5 5.4" />
    </>
  ));
}

export function SkillsIcon({ size = 16, strokeWidth = 1.8 }: IconProps) {
  // Stacked "cards" — the skills catalog: many composable skills, one shelf.
  return svg(size, strokeWidth, (
    <>
      <rect x="3" y="4" width="13" height="16" rx="2" />
      <path d="M19 7v11a2 2 0 0 1-2 2H8" />
      <path d="M6.5 8.5h6M6.5 12h6M6.5 15.5h3.5" />
    </>
  ));
}

export const TAB_ICONS: Record<CompanyOsTabKey, (props: IconProps) => ReactElement> = {
  home: HomeIcon,
  atlas: AtlasIcon,
  source: SourceIcon,
  docs: DocsIcon,
  agents: AgentsIcon,
  skills: SkillsIcon,
  teaching: TeachingIcon,
  knowledge: KnowledgeIcon,
  hygiene: HygieneIcon,
};
