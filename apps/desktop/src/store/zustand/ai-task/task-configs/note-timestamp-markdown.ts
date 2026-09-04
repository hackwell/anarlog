import {
  json2md,
  markdownSchema,
  parseJsonContent,
  type JSONContent,
} from "@anlg/editor/markdown";

import { formatRecordingPosition } from "~/session/components/note-input/use-note-timestamp-config";
import type { NoteContentFormat } from "~/session/content-queries";

// The markdown schema has no anchor attribute, so a whole-document json2md call
// drops the positions, and embedding a "[12:04] " label into a text node would
// come back escaped by the serializer's markdown-special-char handling. So each
// top-level node is serialized on its own and the label is prefixed onto the
// resulting markdown block, never through a ProseMirror text node.
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
    if (!content || !content.some(hasAnchor)) {
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

function serializeBlock(node: JSONContent): string {
  const block = json2md({ type: "doc", content: [node] }).trim();
  // A known-type node can still legitimately serialize to "" — an empty
  // paragraph, whitespace-only text, a hardBreak-only paragraph — and that is
  // the honest rendering, not a failure. Only a node that actually holds real
  // text and still came out empty (e.g. a malformed nested child the schema
  // rejects) lost content and must trigger the fallback.
  if (block === "" && hasNonWhitespaceText(node)) {
    throw new Error(`failed to serialize note block of type "${node.type}"`);
  }
  return hasAnchor(node)
    ? `[${formatRecordingPosition(node.attrs?.recordedAtMs as number)}] ${block}`
    : block;
}

function hasNonWhitespaceText(node: JSONContent): boolean {
  if (node.type === "text") {
    return typeof node.text === "string" && node.text.trim() !== "";
  }
  return Boolean(node.content?.some(hasNonWhitespaceText));
}
