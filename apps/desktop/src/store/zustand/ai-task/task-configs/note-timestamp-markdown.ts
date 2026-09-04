import {
  json2md,
  parseJsonContent,
  type JSONContent,
} from "@anlg/editor/markdown";

import { formatRecordingPosition } from "~/session/components/note-input/use-note-timestamp-config";

// The markdown schema has no anchor attribute, so a whole-document json2md call
// drops the positions, and embedding a "[12:04] " label into a text node would
// come back escaped by the serializer's markdown-special-char handling. So each
// top-level node is serialized on its own and the label is prefixed onto the
// resulting markdown block, never through a ProseMirror text node.
export function annotateNoteMarkdown(snapshot: {
  rawContent: string;
  rawContentFormat: string;
  rawMarkdown: string;
}): string {
  if (snapshot.rawContentFormat !== "json") {
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

    return content.map(serializeBlock).join("\n\n");
  } catch (error) {
    console.warn("[enhance] failed to annotate note positions", error);
    return snapshot.rawMarkdown;
  }
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
  // json2md swallows its own errors and returns "" rather than throwing, so a
  // node the serializer can't handle would otherwise contribute a silent hole
  // to the joined output instead of triggering the fallback. A node that has
  // no content of its own producing "" is normal (an empty paragraph); one
  // that has content but serialized to nothing did not survive conversion.
  if (block === "" && node.content && node.content.length > 0) {
    throw new Error(`failed to serialize note block of type "${node.type}"`);
  }
  return hasAnchor(node)
    ? `[${formatRecordingPosition(node.attrs?.recordedAtMs as number)}] ${block}`
    : block;
}
