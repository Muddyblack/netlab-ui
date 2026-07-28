import type { Element, ElementContent, Root, RootContent } from "hast";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import django from "highlight.js/lib/languages/django";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { createLowlight } from "lowlight";

const lowlight = createLowlight({
  bash,
  css,
  diff,
  django,
  dockerfile,
  ini,
  javascript,
  json,
  markdown,
  python,
  typescript,
  xml,
  yaml
});

lowlight.registerAlias({
  bash: ["console", "sh", "shell"],
  django: ["jinja", "jinja2"],
  ini: ["toml"],
  javascript: ["js", "jsx"],
  markdown: ["md"],
  python: ["py"],
  typescript: ["ts", "tsx"],
  xml: ["html"],
  yaml: ["yml"]
});

function textContent(node: Root | Element): string {
  return node.children
    .map((child) => {
      if (child.type === "text") return child.value;
      if (child.type === "element") return textContent(child);
      return "";
    })
    .join("");
}

function languageName(node: Element): string | undefined {
  const classes = node.properties.className;
  if (!Array.isArray(classes)) return undefined;
  for (const entry of classes) {
    const value = String(entry);
    if (value === "no-highlight" || value === "nohighlight") return "";
    if (value.startsWith("language-")) return value.slice("language-".length);
    if (value.startsWith("lang-")) return value.slice("lang-".length);
  }
  return undefined;
}

function highlightCode(node: Element): void {
  const language = languageName(node);
  if (language === "") return;

  try {
    const result = language && lowlight.registered(language)
      ? lowlight.highlight(language, textContent(node))
      : lowlight.highlightAuto(textContent(node));
    node.properties.className = [
      "hljs",
      ...(language ? [`language-${language}`] : [])
    ];
    node.children = result.children as ElementContent[];
  } catch {
    // Unknown or malformed language hints remain readable as plain code.
  }
}

function visit(node: Root | Element): void {
  for (const child of node.children as RootContent[]) {
    if (child.type !== "element") continue;
    if (child.tagName === "pre") {
      const code = child.children.find(
        (entry): entry is Element => entry.type === "element" && entry.tagName === "code"
      );
      if (code) highlightCode(code);
    }
    visit(child);
  }
}

/** Highlight fenced code by adding safe HAST span nodes, never HTML strings. */
export function rehypeMarkdownHighlight() {
  return (tree: Root): void => visit(tree);
}
