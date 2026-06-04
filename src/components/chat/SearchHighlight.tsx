import React, { useMemo } from "react";

interface HighlightedTextProps {
  text: string;
  query: string;
  className?: string;
  as?: "span" | "div";
}

/**
 * Renders text with search query matches wrapped in <mark> tags.
 * For plain text content (user messages, labels, etc.).
 */
export function HighlightedText({
  text,
  query,
  className,
  as: Tag = "span",
}: HighlightedTextProps) {
  const parts = useMemo(
    () => splitByQuery(text, query),
    [text, query]
  );

  if (!query || parts.length <= 1) {
    return <Tag className={className}>{text}</Tag>;
  }

  return (
    <Tag className={className}>
      {parts.map((part, i) =>
        part.highlight ? (
          <mark key={i} className="search-highlight">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </Tag>
  );
}

/**
 * Returns an array of { text, highlight } segments.
 * Used by HighlightedText but also exportable for custom usage.
 */
export function splitByQuery(
  text: string,
  query: string
): { text: string; highlight: boolean }[] {
  if (!query || !text) return [{ text, highlight: false }];

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const result: { text: string; highlight: boolean }[] = [];
  let lastIndex = 0;
  let index = lowerText.indexOf(lowerQuery);

  while (index !== -1) {
    if (index > lastIndex) {
      result.push({ text: text.slice(lastIndex, index), highlight: false });
    }
    result.push({
      text: text.slice(index, index + query.length),
      highlight: true,
    });
    lastIndex = index + query.length;
    index = lowerText.indexOf(lowerQuery, lastIndex);
  }

  if (lastIndex < text.length) {
    result.push({ text: text.slice(lastIndex), highlight: false });
  }

  return result;
}

/**
 * Processes React children to apply search highlighting on text nodes.
 * Designed for use inside ReactMarkdown component overrides.
 *
 * Usage in markdown component overrides:
 *   p({ children }) {
 *     return <p>{highlightChildren(children, searchQuery)}</p>;
 *   }
 */
export function highlightChildren(
  children: React.ReactNode,
  query: string
): React.ReactNode {
  if (!query) return children;

  // Helper: split a text string into highlighted segments
  const processText = (text: string, keyPrefix: string): React.ReactNode => {
    const segments = splitByQuery(text, query);
    if (segments.length <= 1) return text;
    return segments.map((seg, i) =>
      seg.highlight ? (
        <mark key={`${keyPrefix}-${i}`} className="search-highlight">
          {seg.text}
        </mark>
      ) : (
        <span key={`${keyPrefix}-${i}`}>{seg.text}</span>
      )
    );
  };

  const processNode = (node: React.ReactNode, depth: number): React.ReactNode => {
    if (typeof node === "string") {
      return processText(node, `hl-${depth}`);
    }

    if (Array.isArray(node)) {
      return node.map((child, i) => processNode(child, depth + i));
    }

    if (React.isValidElement(node)) {
      // Preserve code blocks as-is (no highlighting inside <pre>)
      if (
        node.type === "pre" ||
        (typeof node.type === "string" && node.type === "pre")
      ) {
        return node;
      }

      const childProps = node.props as { children?: React.ReactNode } | null;
      if (childProps?.children) {
        const newChildren = processNode(childProps.children, depth + 1);
        return React.cloneElement(node, { ...(node.props as Record<string, unknown>) }, newChildren);
      }
      return node;
    }

    return node;
  };

  return processNode(children, 0);
}
