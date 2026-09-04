import {
  json2md,
  markdownSchema,
  parseJsonContent,
  type JSONContent,
} from "@anlg/editor/markdown";

import { formatRecordingPosition } from "~/session/components/note-input/use-note-timestamp-config";
import type { NoteContentFormat } from "~/session/content-queries";

// A NUL-delimited marker: the markdown serializer escapes only "`*\~[]_" plus a
// few start-of-line characters, so NUL survives serialization verbatim, and no
// note ever contains one.
const SENTINEL_PREFIX = "\u0000note-recorded-at:";
const SENTINEL_PATTERN = /\u0000note-recorded-at:(\d+)\u0000/g;

// The markdown schema has no anchor attribute, so a whole-document json2md call
// drops the positions, and embedding a "[12:04] " label into a text node would
// come back escaped by the serializer's markdown-special-char handling. So each
// top-level node is serialized on its own and a top-level label is prefixed
// onto the resulting markdown block; a label for a paragraph nested inside a
// list item or blockquote rides along as an unescapable sentinel instead.
export function annotateNoteMarkdown(snapshot: {
  rawContent: string;
  rawContentFormat: NoteContentFormat;
  rawMarkdown: string;
}): string {
  if (snapshot.rawContentFormat === "markdown") {
    return snapshot.rawMarkdown;
  }

  // Everything downstream of parsing — including the anchor scan — must stay
  // inside the try: parseJsonContent only checks that content is an array,
  // not that its elements are well-formed nodes, so a malformed element can
  // throw while hasAnchor walks it.
  try {
    const content = parseJsonContent(snapshot.rawContent).content;
    if (!content || !content.some(hasAnchorAnywhere)) {
      return snapshot.rawMarkdown;
    }

    // Validate every top-level element before serializing any of them. A
    // primitive, a typeless object, or a type the schema doesn't know would
    // otherwise reach json2md, which swallows the failure and returns "",
    // silently dropping that block from the joined output instead of
    // falling back.
    if (!content.every(isKnownNode)) {
      throw new Error(
        "note contains a top-level element the markdown schema does not recognize",
      );
    }

    return content.map(serializeBlock).join("\n\n");
  } catch (error) {
    console.warn("[enhance] failed to annotate note positions", error);
    return snapshot.rawMarkdown;
  }
}

function isKnownNode(node: unknown): node is JSONContent {
  return (
    typeof node === "object" &&
    node !== null &&
    !Array.isArray(node) &&
    typeof (node as JSONContent).type === "string" &&
    Boolean(markdownSchema.nodes[(node as JSONContent).type as string])
  );
}

function hasAnchor(node: JSONContent): boolean {
  return (
    node.type === "paragraph" &&
    typeof node.attrs?.recordedAtMs === "number" &&
    Boolean(node.content?.length)
  );
}

function hasAnchorAnywhere(node: JSONContent): boolean {
  return hasAnchor(node) || Boolean(node.content?.some(hasAnchorAnywhere));
}

function serializeBlock(node: JSONContent): string {
  const { node: marked, count } = markNestedAnchors(node);
  const block = json2md({ type: "doc", content: [marked] }).trim();
  // A known-type node can still legitimately serialize to "" — an empty
  // paragraph, whitespace-only text, a hardBreak-only paragraph — and that is
  // the honest rendering, not a failure. Only a node that actually holds real
  // text and still came out empty (e.g. a malformed nested child the schema
  // rejects) lost content and must trigger the fallback.
  if (block === "" && hasNonWhitespaceText(node)) {
    throw new Error(`failed to serialize note block of type "${node.type}"`);
  }

  const labeled = replaceSentinels(block, count, node.type);
  return hasAnchor(node)
    ? `[${formatRecordingPosition(node.attrs?.recordedAtMs as number)}] ${labeled}`
    : labeled;
}

// A nested anchored paragraph — the common case, since notes are mostly bullet
// lists — is one line inside its block's serialized output, so it cannot be
// labeled by prefixing the block. Injecting a sentinel as that paragraph's
// first inline node makes the serializer place the label exactly where the
// paragraph's own line begins, after the list marker and its indentation.
function markNestedAnchors(node: JSONContent): {
  node: JSONContent;
  count: number;
} {
  if (!node.content) {
    return { node, count: 0 };
  }

  let count = 0;
  const content = node.content.map((child) => {
    if (hasAnchor(child)) {
      count += 1;
      return {
        ...child,
        content: [
          {
            type: "text",
            text: `${SENTINEL_PREFIX}${child.attrs?.recordedAtMs as number}\u0000`,
          },
          ...(child.content ?? []),
        ],
      };
    }
    const marked = markNestedAnchors(child);
    count += marked.count;
    return marked.node;
  });

  return { node: { ...node, content }, count };
}

// If the serializer dropped or duplicated a sentinel, the rendered block no
// longer matches the note, so the caller must fall back to the stored markdown
// rather than emit a block whose labels have drifted off their lines.
function replaceSentinels(
  block: string,
  expected: number,
  nodeType: string | undefined,
): string {
  let replaced = 0;
  const labeled = block.replace(SENTINEL_PATTERN, (_match, recordedAtMs) => {
    replaced += 1;
    return `[${formatRecordingPosition(Number(recordedAtMs))}] `;
  });

  if (replaced !== expected || labeled.includes("\u0000")) {
    throw new Error(
      `failed to place note positions inside block of type "${nodeType}"`,
    );
  }

  return labeled;
}

function hasNonWhitespaceText(node: JSONContent): boolean {
  if (node.type === "text") {
    return typeof node.text === "string" && node.text.trim() !== "";
  }
  return Boolean(node.content?.some(hasNonWhitespaceText));
}
