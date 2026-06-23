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

export function BoardIcon({ size = 16, strokeWidth = 1.8 }: IconProps) {
  return svg(size, strokeWidth, (
    <>
      <rect x="3" y="3" width="6" height="14" rx="1.4" />
      <rect x="9.5" y="3" width="6" height="9" rx="1.4" transform="translate(0.5 0)" />
      <rect x="16" y="3" width="5" height="11" rx="1.4" />
    </>
  ));
}

export function ReportsIcon({ size = 16, strokeWidth = 1.8 }: IconProps) {
  return svg(size, strokeWidth, (
    <>
      <path d="M6 2.5h8l4 4V21a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 21z" />
      <path d="M14 2.5V6.5h4" />
      <path d="M9 12h6M9 15.5h6M9 8.5h2" />
    </>
  ));
}

export function RoutinesIcon({ size = 16, strokeWidth = 1.8 }: IconProps) {
  return svg(size, strokeWidth, (
    <>
      <path d="M3 12h4l2.5 6 5-12L17 12h4" />
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

export function CompanyOsGlyph({ size = 18, strokeWidth = 1.8 }: IconProps) {
  return svg(size, strokeWidth, (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4.5" />
      <path d="M8 12h8M12 8v8" />
    </>
  ));
}

export const TAB_ICONS: Record<CompanyOsTabKey, (props: IconProps) => ReactElement> = {
  board: BoardIcon,
  reports: ReportsIcon,
  routines: RoutinesIcon,
  teaching: TeachingIcon,
  knowledge: KnowledgeIcon,
};
