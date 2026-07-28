import { parseDocument } from "yaml";

/**
 * Netlab plugin settings are documented as Markdown rather than a shared
 * machine-readable schema. Extract complete attribute bullets (including their
 * wrapped continuation lines) so users can see accepted values and defaults
 * without opening a separate manual.
 */
export function documentedPluginArguments(markdown: string): string[] {
  const bullets: string[] = [];
  let currentBullet = "";
  let inCodeBlock = false;

  const finishBullet = () => {
    if (!currentBullet) return;

    // Netlab identifies plugin settings with dotted attributes in either code
    // or bold Markdown (for example, `bgp.role` or **bgp.role**). Keep the
    // whole description: values and defaults often follow on the next line.
    if (
      /(?:`|\*\*)[a-z][\w-]*(?:\.[\w-]+)+(?:`|\*\*)/i.test(currentBullet) &&
      /\b(?:attribute|parameter|option|argument|default|takes|valid|integer|boolean|bool|dictionary|list|string|value|keyword|set)\b/i.test(currentBullet)
    ) {
      bullets.push(
        currentBullet
          .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
          .replace(/[*_`]/g, "")
          .replace(/\s+/g, " ")
          .trim()
      );
    }
    currentBullet = "";
  };

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      finishBullet();
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const bullet = line.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      finishBullet();
      currentBullet = bullet[1];
    } else if (currentBullet && line && !line.startsWith("#")) {
      currentBullet += ` ${line}`;
    } else if (!line) {
      finishBullet();
    }
  }
  finishBullet();

  return [...new Set(bullets)];
}

export function detectPreferredPluginListStyle(yaml: string): "flow" | "block" {
  try {
    const doc = parseDocument(yaml);
    const pluginNode = doc.get("plugin", true) as { flow?: boolean; items?: unknown[] } | null;
    if (pluginNode && typeof pluginNode === "object" && "items" in pluginNode) {
      return pluginNode.flow ? "flow" : "block";
    }

    const moduleNode = doc.get("module", true) as { flow?: boolean; items?: unknown[] } | null;
    if (moduleNode && typeof moduleNode === "object" && "items" in moduleNode) {
      return moduleNode.flow ? "flow" : "block";
    }
  } catch {
    // Fall back to the documented compact style if the draft is temporarily invalid.
  }

  return "flow";
}

export function setTopLevelKey(
  doc: { contents?: { items?: Array<{ key?: { value?: unknown } }> }; createPair?: (key: string, value: unknown) => unknown },
  key: string,
  value: unknown,
  insertAfterKeys: string[]
) {
  const items = doc.contents?.items;
  const createPair = doc.createPair;
  if (!items || !createPair) {
    return;
  }

  const existingIndex = items.findIndex((item) => item.key?.value === key);
  if (existingIndex >= 0) {
    items.splice(existingIndex, 1);
  }

  let insertAt = 0;
  for (const afterKey of insertAfterKeys) {
    const index = items.findIndex((item) => item.key?.value === afterKey);
    if (index >= 0) {
      insertAt = index + 1;
    }
  }

  items.splice(insertAt, 0, createPair.call(doc, key, value) as { key?: { value?: unknown } });
}
