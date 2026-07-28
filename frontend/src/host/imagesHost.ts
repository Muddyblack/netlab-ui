import type { ClabUiImageHost } from "@srl-labs/clab-ui/host";

export function createImagesHost(safeFetch: typeof fetch, base: string): ClabUiImageHost {
  return {
    async listImages(_options?: Parameters<ClabUiImageHost["listImages"]>[0]) {
      const res = await safeFetch(`${base}/api/lab/images`);
      if (!res.ok) throw new Error("Failed to list images");
      return res.json();
    },
    async listImageReferences(_options?: Parameters<ClabUiImageHost["listImageReferences"]>[0]) {
      const res = await safeFetch(`${base}/api/lab/images/kind-references`);
      if (!res.ok) throw new Error("Failed to list image references");
      return res.json();
    },
    async pullImage(request: Parameters<ClabUiImageHost["pullImage"]>[0]) {
      const res = await safeFetch(`${base}/api/lab/images/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!res.ok) throw new Error("Failed to pull image");
      return res.json();
    },
    async removeImage(request: Parameters<ClabUiImageHost["removeImage"]>[0]) {
      const res = await safeFetch(`${base}/api/lab/images/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!res.ok) throw new Error("Failed to remove image");
      return res.json();
    },
  };
}
