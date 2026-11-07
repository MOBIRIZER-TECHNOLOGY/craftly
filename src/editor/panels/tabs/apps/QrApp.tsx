import { useMemo, useState } from "react";
import { contrastRatio } from "@/core/color";
import { createGraphic } from "@/core/factory";
import { getActions } from "@/core/store";
import { svgToDataUrl } from "@/core/svg";
import { Button, IconAlert, IconPlus, IconWarning, Segmented, Select, TextField } from "@/ui";
import { designMin } from "../../shared/panelActions";
import { AppField, AppPage, ColorButton } from "./appKit";
import { qrSvg, type QrLevel } from "./qrSvg";
import "./QrApp.css";

type Level = QrLevel;
type Kind = "link" | "text" | "wifi" | "email";

const KINDS = [
  { value: "link", label: "Link" },
  { value: "text", label: "Text" },
  { value: "wifi", label: "Wi-Fi" },
  { value: "email", label: "Email" },
] as const;

const LEVELS: Array<{ value: Level; label: string }> = [
  { value: "L", label: "Low - 7% can be damaged" },
  { value: "M", label: "Medium - 15%" },
  { value: "Q", label: "Quartile - 25%" },
  { value: "H", label: "High - 30%" },
];

const PRESETS = ["#0e1318", "#7c3aed", "#1d4ed8", "#0f766e", "#be123c", "#ffffff"];

/** Escapes the characters that are special inside a Wi-Fi QR payload. */
const wifiEscape = (s: string) => s.replace(/([\\;,:"])/g, "\\$1");

/**
 * QR code: type a link, some text, Wi-Fi details or an email address, pick colours and the amount of error
 * correction, and add the code to the page as a recolourable graphic. Everything is generated in the browser.
 */
export function QrApp() {
  const [kind, setKind] = useState<Kind>("link");
  const [link, setLink] = useState("https://example.com");
  const [text, setText] = useState("Hello from Craftly");
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [security, setSecurity] = useState<"WPA" | "WEP" | "nopass">("WPA");
  const [email, setEmail] = useState("");
  const [fg, setFg] = useState("#0e1318");
  const [bg, setBg] = useState("#ffffff");
  const [level, setLevel] = useState<Level>("M");

  const payload = useMemo(() => {
    switch (kind) {
      case "link":
        return link.trim();
      case "text":
        return text;
      case "wifi":
        return ssid.trim() ? `WIFI:T:${security};S:${wifiEscape(ssid.trim())};P:${security === "nopass" ? "" : wifiEscape(password)};;` : "";
      case "email":
        return email.trim() ? `mailto:${email.trim()}` : "";
    }
  }, [kind, link, text, ssid, password, security, email]);

  const result = useMemo(() => {
    if (!payload) return { svg: null as string | null, error: null as string | null };
    try {
      return { svg: qrSvg(payload, level, fg, bg), error: null };
    } catch {
      return { svg: null, error: "That is too long for a QR code at this error-correction level. Shorten it or choose a lower level." };
    }
  }, [payload, level, fg, bg]);

  const contrast = contrastRatio(fg, bg);
  const inverted = contrastRatio(fg, "#ffffff") < contrastRatio(bg, "#ffffff");

  const add = () => {
    if (!result.svg) return;
    const size = Math.round(designMin() * 0.28);
    getActions().addElement(createGraphic({ svg: result.svg, width: size, height: size, source: { kind: "qr" }, name: "QR code" }));
  };

  return (
    <AppPage
      title="QR code"
      subtitle="Scannable codes for links, text and Wi-Fi"
      footer={
        <Button variant="primary" size="lg" block icon={<IconPlus />} disabled={!result.svg} onClick={add}>
          Add to design
        </Button>
      }
    >
      <div className="cf-qr__stage cf-app__stage">
        {result.svg ? (
          <img className="cf-qr__img" src={svgToDataUrl(result.svg)} alt={`QR code for ${payload.length > 60 ? `${payload.slice(0, 60)}...` : payload}`} />
        ) : (
          <div className="cf-qr__empty">{result.error ? "Too much data" : "Your code appears here"}</div>
        )}
      </div>

      <div className="cf-qr__body">
        {result.error ? (
          <p className="cf-app__error" role="alert">
            <IconAlert aria-hidden="true" />
            {result.error}
          </p>
        ) : null}
        {result.svg && (contrast < 3 || inverted) ? (
          <p className="cf-app__warn">
            <IconWarning aria-hidden="true" />
            {contrast < 3
              ? "The two colours are too close: some phones will not scan this code."
              : "Light-on-dark codes are not read by every scanner. Dark squares on a light background are safest."}
          </p>
        ) : null}

        <AppField label="What should it open?">
          <Segmented<Kind> value={kind} onChange={setKind} options={[...KINDS]} size="sm" fullWidth aria-label="Code content" />
        </AppField>

        {kind === "link" ? <TextField label="Web address" placeholder="https://example.com" value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" /> : null}
        {kind === "text" ? <TextField label="Text" placeholder="Anything you want people to read" value={text} onChange={(e) => setText(e.target.value)} /> : null}
        {kind === "email" ? <TextField label="Email address" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" /> : null}
        {kind === "wifi" ? (
          <div className="cf-qr__wifi">
            <TextField label="Network name" value={ssid} onChange={(e) => setSsid(e.target.value)} placeholder="My Wi-Fi" />
            <AppField label="Security">
              <Select<"WPA" | "WEP" | "nopass">
                value={security}
                onChange={setSecurity}
                aria-label="Wi-Fi security"
                options={[
                  { value: "WPA", label: "WPA / WPA2 / WPA3" },
                  { value: "WEP", label: "WEP" },
                  { value: "nopass", label: "No password" },
                ]}
              />
            </AppField>
            {security !== "nopass" ? <TextField label="Password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Network password" /> : null}
          </div>
        ) : null}

        <div className="cf-app__row cf-qr__colors">
          <AppField label="Squares">
            <ColorButton label="Square colour" value={fg} onChange={setFg} presets={PRESETS} />
          </AppField>
          <AppField label="Background">
            <ColorButton label="Background colour" value={bg} onChange={setBg} presets={PRESETS} />
          </AppField>
        </div>

        <AppField label="Error correction" hint="Higher levels still scan when part of the code is covered or printed badly, but make the pattern denser.">
          <Select<Level> value={level} onChange={setLevel} options={LEVELS} aria-label="Error correction" />
        </AppField>
      </div>
    </AppPage>
  );
}
