import { parse, parseDocument } from "yaml";
import { detectPreferredPluginListStyle, setTopLevelKey } from "./yamlHelpers";

/** Toggle a plugin's enabled state in the `plugin:` key of a netlab topology
 * YAML document, preserving the document's existing formatting/comments. */
export function togglePluginInYaml(yaml: string, pluginId: string, enabled: boolean): string {
  const doc = parseDocument(yaml || "");
  const parsed = parse(yaml) || {};
  let plugins: string[] = [];

  if (!doc.contents || !("items" in doc.contents)) {
    doc.contents = doc.createNode({}) as never;
  }

  if (Array.isArray(parsed.plugin)) {
    plugins = [...parsed.plugin];
  } else if (typeof parsed.plugin === "string") {
    plugins = [parsed.plugin];
  }

  if (enabled) {
    if (!plugins.includes(pluginId)) {
      plugins.push(pluginId);
    }
  } else {
    plugins = plugins.filter((p: string) => p !== pluginId);
  }

  if (plugins.length > 0) {
    const pluginNode = doc.createNode(plugins) as { flow?: boolean };
    pluginNode.flow = detectPreferredPluginListStyle(yaml) === "flow";
    setTopLevelKey(doc as never, "plugin", pluginNode, ["name", "provider"]);
  } else {
    doc.delete("plugin");
  }

  return String(doc);
}

/** Rewrite relative doc-image references in plugin markdown to the local
 * backend, which serves them straight from the netlab install so plugin docs
 * render offline. */
export function rewritePluginImageLinks(markdown: string, base: string): string {
  return markdown.replace(
    /!\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g,
    (match, alt, url) => {
      if (url.startsWith("http://") || url.startsWith("https://")) {
        return match;
      }
      const imageName = url.split("/").pop();
      return `![${alt}](${base}/api/plugins/images/${imageName})`;
    }
  );
}
