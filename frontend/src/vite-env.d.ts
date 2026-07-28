/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_PACKETFLIX_HOST?: string;
  readonly VITE_PACKETFLIX_PORT?: string;
  readonly VITE_TOPOLOGY_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;

interface Window {
  // Locally available docker image references, consumed by clab-ui's
  // useDockerImages hook for the node-template Image/Version autocomplete.
  __DOCKER_IMAGES__?: string[];
}
