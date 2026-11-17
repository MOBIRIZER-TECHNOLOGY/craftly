/**
 * The account server, wherever a person signs in, signs up or resets a password: the host shown plainly ("Server: host"), so that
 * nobody types a password into a server they did not mean, and a field to type another one. The server comes from the build
 * (`VITE_CRAFTLY_ACCOUNT_SERVER`) or from what was typed last on this device.
 */
import { useState } from "react";
import { hostOf, normalizeAccountServer } from "@/cloud/api";
import { CONFIGURED_SERVER } from "@/cloud/state";
import { m } from "@/i18n";
import { Button, TextField } from "@/ui";
import { rememberTypedServer, typedServer } from "./dialogState";

/** The server a form starts with. */
export const startingServer = () => CONFIGURED_SERVER || typedServer();

/** The server as it is sent to, or null with the words of the problem shown by the field. */
export function checkedServer(typed: string): string | null {
  const server = normalizeAccountServer(typed);
  if (server && !CONFIGURED_SERVER) rememberTypedServer(server);
  return server;
}

export function ServerField({ value, onChange, error }: { value: string; onChange: (value: string) => void; error?: string }) {
  const [editing, setEditing] = useState(() => !value);
  const server = normalizeAccountServer(value);
  if (!editing && server) {
    return (
      <div className="cf-acct__server">
        <span>
          {m.cloud.server.host("")}
          <span className="cf-acct__host">{hostOf(server)}</span>
        </span>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          {m.cloud.server.change}
        </Button>
      </div>
    );
  }
  return (
    <TextField
      label={m.cloud.server.label}
      hint={value ? m.cloud.server.hint : m.cloud.server.none}
      error={error}
      value={value}
      inputMode="url"
      autoComplete="url"
      spellCheck={false}
      autoCapitalize="off"
      placeholder="accounts.example.org"
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
