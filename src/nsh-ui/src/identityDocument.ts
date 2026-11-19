// IDENTITY.md frontmatter edits shared by the assistant store and its tests.
// Pure text functions: no host access, so a test can import them directly.

export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Serializes a short single-line string as a YAML scalar (plain when safe, else double-quoted). */
export function yamlScalar(value: string): string {
  const plainSafe =
    /^[^\s\-?:,\[\]{}#&*!|>'"%@`][^:#]*$/.test(value) &&
    !/\s$/.test(value) &&
    !/^(true|false|yes|no|on|off|null|~|[-+]?[0-9.]+(e[-+]?[0-9]+)?)$/i.test(value);
  return plainSafe ? value : JSON.stringify(value);
}

export type IdentityField = "name" | "avatar" | "emoji";

/**
 * Rewrites one frontmatter field of an IDENTITY.md, keeping every other field
 * (including ones this surface does not draw) and the body as written. A field
 * that is not there yet is added; a document without frontmatter gains one that
 * carries just that field. An empty value is kept as `field:`, the way the
 * desktop's identity document writes a cleared field.
 */
export function setIdentityField(content: string, field: IdentityField, value: string): string {
  const normalized = normalizeLineEndings(content || "");
  const clean = value.replace(/\s+/g, " ").trim();
  const line = clean ? `${field}: ${yamlScalar(clean)}` : `${field}:`;
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    const body = normalized.replace(/^\n+/, "").trimEnd();
    return body ? `---\n${line}\n---\n\n${body}\n` : `---\n${line}\n---\n`;
  }
  const lines = (match[1] ?? "").split("\n");
  const pattern = new RegExp(`^${field}\\s*:`);
  const index = lines.findIndex(item => pattern.test(item));
  if (index >= 0) {
    // Drop continuation lines of a multi-line value that belonged to the field.
    let end = index + 1;
    while (end < lines.length && /^\s+\S/.test(lines[end] ?? "")) end += 1;
    lines.splice(index, end - index, line);
  } else if (field === "name") {
    lines.unshift(line);
  } else {
    lines.push(line);
  }
  return `---\n${lines.join("\n")}\n---\n${match[2] ?? ""}`;
}

/** Rewrites only the `name:` field of an IDENTITY.md (see `setIdentityField`). */
export function setIdentityName(content: string, name: string): string {
  return setIdentityField(content, "name", name);
}

