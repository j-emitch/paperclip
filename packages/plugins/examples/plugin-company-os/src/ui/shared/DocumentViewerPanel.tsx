/**
 * `DocumentViewerPanel` — the shared detail pane for a selected document, reused
 * by Docs, Skills, Home (briefing), and the Reports artifact browser. Renders the
 * header (title, type, repo, prefix, status, mtime, size) + the body, which is one
 * of: an `ok` markdown/plaintext render, a typed safety notice (too-large /
 * unsupported / not-indexed / not-found / denied), a loading spinner, a bridge
 * error, or the "nothing selected" placeholder.
 *
 * The markdown body is a render-PROP slot (`renderMarkdown`) so this component
 * stays bridge-free + SSR/Playwright-screenshottable: production injects the host
 * `<MarkdownBlock>` (sanitized via react-markdown — no raw HTML), the harness
 * injects a `<pre>`. Plaintext (`renderMode: "text"`) always renders as a `<pre>`.
 */

import type { ReactNode } from "react";
import type { ReportContentStatus, ReportContentV1 } from "../../contracts/index.js";
import { statusColors, tokens } from "../tokens.js";
import { Frame, Glyph, LocalSpinner, ghostButtonStyle } from "./feedback.js";
import { Pill, RepoBadge } from "./badges.js";
import { AlertIcon, ClockIcon, CloseIcon, DocIcon, FileWarningIcon, RefreshIcon } from "../icons.js";
import { relativeTime, formatBytes } from "./time.js";
import { baseName, stripFrontmatter } from "./document-text.js";
import { ARTIFACT_TYPE_LABELS } from "./document-labels.js";

export interface DocumentViewerPanelProps {
  /** The selected document payload, or null when nothing is selected. */
  content: ReportContentV1 | null;
  loading: boolean;
  /** Bridge-level error message (worker unreachable), distinct from a typed refusal. */
  error: string | null;
  now: number;
  isMobile?: boolean;
  /** Render the markdown body. Production: host `<MarkdownBlock>`; harness: `<pre>`. */
  renderMarkdown: (markdown: string) => ReactNode;
  onRetry?: () => void;
  /** Mobile: a back control to return to the list. */
  onClose?: () => void;
  /**
   * Override the type pill label. The Docs tab passes the INDEX-derived doc type
   * (`DocEntryV1.type`) because `ReportContentV1.artifactType` is null for
   * plan/backlog; Reports omits it and falls back to the artifact-type label.
   */
  typeLabel?: string;
  /**
   * Copy overrides so a non-Reports consumer (e.g. the Skills tab) doesn't leak
   * "report"/"document" wording. Each defaults to the Reports copy, so Reports +
   * Docs are byte-unchanged.
   */
  loadingLabel?: string;
  errorTitle?: string;
  emptyTitle?: string;
  emptyBody?: string;
  backLabel?: string;
}

export function DocumentViewerPanel({
  content,
  loading,
  error,
  now,
  isMobile = false,
  renderMarkdown,
  onRetry,
  onClose,
  typeLabel,
  loadingLabel = "Opening the document…",
  errorTitle = "Couldn’t load the document",
  emptyTitle = "Pick a report to read",
  emptyBody = "Specs, handoffs, and review reports render here in place — filter the list and choose one.",
  backLabel = "Back to the report list",
}: DocumentViewerPanelProps) {
  if (!content && loading) {
    return (
      <Frame minHeight={isMobile ? 200 : 320}>
        <LocalSpinner />
        <p style={{ margin: 0, fontSize: 13, color: tokens.muted }} aria-live="polite">
          {loadingLabel}
        </p>
      </Frame>
    );
  }

  if (!content && error) {
    return (
      <Frame minHeight={isMobile ? 200 : 320}>
        <Glyph tone={statusColors.danger}>
          <AlertIcon size={24} />
        </Glyph>
        <div>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 650, color: tokens.fg }}>{errorTitle}</p>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: tokens.muted, maxWidth: 380 }}>{error}</p>
        </div>
        {onRetry ? <RetryButton onClick={onRetry} /> : null}
      </Frame>
    );
  }

  if (!content) {
    return (
      <Frame minHeight={isMobile ? 180 : 320}>
        <Glyph tone={tokens.accent}>
          <DocIcon size={24} />
        </Glyph>
        <div>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 650, color: tokens.fg }}>{emptyTitle}</p>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: tokens.muted, maxWidth: 360, lineHeight: 1.5 }}>
            {emptyBody}
          </p>
        </div>
      </Frame>
    );
  }

  const title = content.title ?? baseName(content.relPath);
  const mtimeLabel = relativeTime(content.mtime, now);

  return (
    <article style={{ display: "flex", flexDirection: "column", gap: isMobile ? 12 : 16, minWidth: 0 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0 }}>
          <h2
            title={title}
            style={{
              margin: 0,
              flex: 1,
              minWidth: 0,
              fontSize: isMobile ? 17 : 19,
              fontWeight: 700,
              letterSpacing: -0.3,
              color: tokens.fg,
              lineHeight: 1.3,
            }}
          >
            {title}
          </h2>
          {onClose ? (
            <button type="button" onClick={onClose} aria-label={backLabel} style={iconButtonStyle}>
              <CloseIcon size={14} />
            </button>
          ) : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {typeLabel ? (
            <Pill label={typeLabel} tone={tokens.accent} soft />
          ) : content.artifactType ? (
            <Pill label={ARTIFACT_TYPE_LABELS[content.artifactType]} tone={tokens.accent} soft />
          ) : null}
          {content.docStatus ? <Pill label={content.docStatus} tone={tokens.muted} /> : null}
          <RepoBadge repo={content.repo} />
          {content.relPath ? (
            <code
              title={content.relPath}
              style={{
                fontFamily: tokens.mono,
                fontSize: 11,
                color: tokens.muted,
                maxWidth: isMobile ? 200 : 360,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {content.relPath}
            </code>
          ) : null}
          {mtimeLabel ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: tokens.muted }}>
              <span aria-hidden="true" style={{ display: "inline-flex" }}>
                <ClockIcon size={12} />
              </span>
              {mtimeLabel}
            </span>
          ) : null}
          {content.status === "ok" && content.sizeBytes > 0 ? (
            <span style={{ fontSize: 11.5, color: tokens.muted }}>{formatBytes(content.sizeBytes)}</span>
          ) : null}
        </div>
      </header>

      <div style={{ height: 1, background: tokens.border, width: "100%" }} aria-hidden="true" />

      {content.status === "ok" && content.content !== null ? (
        <Body renderMode={content.renderMode} content={content.content} renderMarkdown={renderMarkdown} isMobile={isMobile} />
      ) : (
        <Notice status={content.status} message={content.message} />
      )}
    </article>
  );
}

function Body({
  renderMode,
  content,
  renderMarkdown,
  isMobile,
}: {
  renderMode: ReportContentV1["renderMode"];
  content: string;
  renderMarkdown: (markdown: string) => ReactNode;
  isMobile: boolean;
}) {
  if (renderMode === "markdown") {
    return (
      <div style={{ minWidth: 0, fontSize: isMobile ? 13 : 13.5, lineHeight: 1.65, color: tokens.fg }} className="cos-report-body">
        {renderMarkdown(stripFrontmatter(content))}
      </div>
    );
  }
  return (
    <pre
      style={{
        margin: 0,
        padding: "14px 16px",
        background: tokens.bg,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radiusSm,
        fontFamily: tokens.mono,
        fontSize: 12.5,
        lineHeight: 1.6,
        color: tokens.fg,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        overflowX: "auto",
      }}
    >
      {content}
    </pre>
  );
}

const NOTICE_GLYPH: Record<Exclude<ReportContentStatus, "ok">, { icon: ReactNode; tone: string; title: string }> = {
  too_large: { icon: <FileWarningIcon size={24} />, tone: statusColors.cached, title: "This file is too large to render" },
  unsupported_type: { icon: <DocIcon size={24} />, tone: tokens.muted, title: "Not rendered inline" },
  not_indexed: { icon: <AlertIcon size={24} />, tone: statusColors.cached, title: "Not in the index" },
  not_found: { icon: <FileWarningIcon size={24} />, tone: tokens.muted, title: "File not found" },
  denied: { icon: <AlertIcon size={24} />, tone: statusColors.danger, title: "Access denied" },
};

function Notice({ status, message }: { status: ReportContentStatus; message: string | null }) {
  if (status === "ok") return null;
  const g = NOTICE_GLYPH[status];
  return (
    <Frame minHeight={180}>
      <Glyph tone={g.tone}>{g.icon}</Glyph>
      <div>
        <p style={{ margin: 0, fontSize: 14.5, fontWeight: 650, color: tokens.fg }}>{g.title}</p>
        {message ? (
          <p style={{ margin: "4px 0 0", fontSize: 13, color: tokens.muted, maxWidth: 400, lineHeight: 1.5 }}>{message}</p>
        ) : null}
      </div>
    </Frame>
  );
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={ghostButtonStyle}>
      <span aria-hidden="true" style={{ display: "inline-flex" }}>
        <RefreshIcon size={14} />
      </span>
      Try again
    </button>
  );
}

const iconButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  flex: "0 0 auto",
  borderRadius: tokens.radiusSm,
  background: tokens.secondary,
  border: `1px solid ${tokens.border}`,
  color: tokens.muted,
  cursor: "pointer",
} as const;
