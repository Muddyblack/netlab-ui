export type CustomIconListItem = {
  name: string;
  source: "workspace" | "global";
  dataUri: string;
  format: "svg" | "png";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCustomIconListItem(value: unknown): value is CustomIconListItem {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    (value.source === "workspace" || value.source === "global") &&
    typeof value.dataUri === "string" &&
    (value.format === "svg" || value.format === "png")
  );
}

export function parseIconListResponse(value: unknown): CustomIconListItem[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return [];
  }
  return value.items.filter(isCustomIconListItem);
}

export function parseIconNamesResponse(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.icons)) {
    return parseIconListResponse(value).map((icon) => icon.name);
  }
  return value.icons.filter((icon): icon is string => typeof icon === "string" && icon.length > 0);
}

export function selectIconFile(): Promise<File | null> {
  return selectFile("image/svg+xml,image/png,.svg,.png");
}

/** Node templates exported by the palette: `{templates: [...]}` or a bare array. */
export function parseTemplatesFile(text: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("File is not valid JSON");
  }
  let entries: unknown[] | null = null;
  if (Array.isArray(parsed)) entries = parsed;
  else if (isRecord(parsed) && Array.isArray(parsed.templates)) entries = parsed.templates;
  if (!entries?.length) throw new Error("File contains no node templates");
  entries.forEach((entry, index) => {
    if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.kind !== "string") {
      throw new Error(`Template ${index + 1} needs a "name" and a "kind"`);
    }
  });
  return entries as Record<string, unknown>[];
}

export function selectFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    let settled = false;

    const cleanup = () => {
      input.remove();
      window.removeEventListener("focus", handleFocus);
    };
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(file);
    };
    const handleFocus = () => {
      window.setTimeout(() => finish(input.files?.[0] ?? null), 0);
    };

    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    input.addEventListener("change", () => finish(input.files?.[0] ?? null), { once: true });
    document.body.appendChild(input);

    window.setTimeout(() => {
      if (settled) return;
      window.addEventListener("focus", handleFocus, { once: true });
    }, 0);
    input.click();
  });
}
