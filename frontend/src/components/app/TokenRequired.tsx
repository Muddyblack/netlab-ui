import { useState } from "react";
import { setApiToken } from "../../api/endpoint";

/** Shown instead of the app when the backend only accepts its API token and this browser has none. */
export function TokenRequired() {
  const [token, setToken] = useState("");
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!token.trim()) return;
    setApiToken(token.trim());
    window.location.reload();
  };
  return (
    <form
      onSubmit={submit}
      style={{
        maxWidth: 520,
        margin: "15vh auto",
        padding: "0 16px",
        fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
        color: "var(--vscode-foreground, #ccc)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <h2 style={{ margin: 0 }}>Sign in to netlab-ui</h2>
      <p style={{ margin: 0, lineHeight: 1.5 }}>
        This server requires its API token. On the server, run <code>netlab-ui token</code> and open the link it
        prints, or paste the token here.
      </p>
      <input
        type="password"
        autoFocus
        value={token}
        onChange={(event) => setToken(event.target.value)}
        placeholder="API token"
        aria-label="API token"
        style={{ padding: "8px 10px", font: "inherit" }}
      />
      <button type="submit" style={{ padding: "8px 10px", font: "inherit", alignSelf: "flex-start" }}>
        Sign in
      </button>
    </form>
  );
}
