import { useEffect, useMemo, useState } from "react";
import { contrastRatio } from "@/core/color";
import { createGraphic, createImage } from "@/core/factory";
import { getActions } from "@/core/store";
import { isAcceptedImage, prepareAssetFromFile } from "@/core/assets";
import { blobToDataUrl } from "@/export/encoding";
import { m } from "@/i18n";
import { Button, IconAlert, IconPlus, IconWarning, Segmented, Select, TextField } from "@/ui";
import { designMin } from "../../shared/panelActions";
import { AppField, AppPage, ColorButton } from "./appKit";
import { qrSvg, type QrLevel } from "./qrSvg";
import { rasterizeQrWithLogo, type QrLogo } from "./qrLogo";
import "./QrApp.css";

type Level = QrLevel;
type Kind = "link" | "text" | "wifi" | "email";

const KINDS: Array<{ value: Kind; label: string }> = [
  { value: "link", label: m.panelsTabs.qr.kinds.link },
  { value: "text", label: m.panelsTabs.qr.kinds.text },
  { value: "wifi", label: m.panelsTabs.qr.kinds.wifi },
  { value: "email", label: m.panelsTabs.qr.kinds.email },
];

const LEVELS: Array<{ value: Level; label: string }> = [
  { value: "L", label: m.panelsTabs.qr.levels.L },
  { value: "M", label: m.panelsTabs.qr.levels.M },
  { value: "Q", label: m.panelsTabs.qr.levels.Q },
  { value: "H", label: m.panelsTabs.qr.levels.H },
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
  const [logo, setLogo] = useState<QrLogo | undefined>();
  const [logoError, setLogoError] = useState(false);
  const [rendered, setRendered] = useState<string | null>(null);

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
      return { svg: null, error: m.panelsTabs.qr.tooLong };
    }
  }, [payload, level, fg, bg]);

  const contrast = contrastRatio(fg, bg);
  const inverted = contrastRatio(fg, "#ffffff") < contrastRatio(bg, "#ffffff");

  useEffect(() => {
    let alive = true;
    setRendered(null);
    if (!result.svg) return;
    void rasterizeQrWithLogo(result.svg, logo)
      .then((url) => {
        if (alive) setRendered(url);
      })
      .catch(() => {
        if (alive) setRendered(null);
      });
    return () => {
      alive = false;
    };
  }, [result.svg, logo]);

  const chooseLogo = async (file: File | undefined) => {
    if (!file) return;
    if (!isAcceptedImage(file)) {
      setLogo(undefined);
      setLogoError(true);
      return;
    }
    try {
      const asset = await prepareAssetFromFile(file);
      setLogo({ url: await blobToDataUrl(asset.blob), width: asset.width, height: asset.height });
      setLogoError(false);
    } catch {
      setLogo(undefined);
      setLogoError(true);
    }
  };

  const add = () => {
    if (!rendered) return;
    const size = Math.round(designMin() * 0.28);
    if (logo) {
      getActions().addElement(createImage({ src: rendered, naturalWidth: size, naturalHeight: size, width: size, height: size, name: "QR code" }));
    } else {
      getActions().addElement(createGraphic({ svg: result.svg!, width: size, height: size, source: { kind: "qr" }, name: "QR code" }));
    }
  };

  return (
    <AppPage
      title={m.panelsTabs.qr.title}
      subtitle={m.panelsTabs.qr.subtitle}
      footer={
        <Button variant="primary" size="lg" block icon={<IconPlus />} disabled={!rendered} onClick={add}>
          {m.panelsTabs.shared.addToDesign}
        </Button>
      }
    >
      <div className="cf-qr__stage cf-app__stage">
        {result.svg ? (
          <img className="cf-qr__img" src={rendered!} alt={m.panelsTabs.qr.alt(payload.length > 60 ? `${payload.slice(0, 60)}...` : payload)} />
        ) : (
          <div className="cf-qr__empty">{result.error ? m.panelsTabs.qr.tooMuch : m.panelsTabs.qr.empty}</div>
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
            {contrast < 3 ? m.panelsTabs.qr.lowContrast : m.panelsTabs.qr.inverted}
          </p>
        ) : null}

        <AppField label={m.panelsTabs.qr.whatOpens}>
          <Segmented<Kind> value={kind} onChange={setKind} options={KINDS} size="sm" fullWidth aria-label={m.panelsTabs.qr.codeContent} />
        </AppField>

        {kind === "link" ? (
          <TextField label={m.panelsTabs.qr.webAddress} placeholder="https://example.com" value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" />
        ) : null}
        {kind === "text" ? <TextField label={m.panelsTabs.qr.text} placeholder={m.panelsTabs.qr.textPlaceholder} value={text} onChange={(e) => setText(e.target.value)} /> : null}
        {kind === "email" ? (
          <TextField label={m.panelsTabs.qr.emailAddress} placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" />
        ) : null}
        {kind === "wifi" ? (
          <div className="cf-qr__wifi">
            <TextField label={m.panelsTabs.qr.networkName} value={ssid} onChange={(e) => setSsid(e.target.value)} placeholder={m.panelsTabs.qr.networkPlaceholder} />
            <AppField label={m.panelsTabs.qr.security}>
              <Select<"WPA" | "WEP" | "nopass">
                value={security}
                onChange={setSecurity}
                aria-label={m.panelsTabs.qr.wifiSecurity}
                options={[
                  { value: "WPA", label: "WPA / WPA2 / WPA3" },
                  { value: "WEP", label: "WEP" },
                  { value: "nopass", label: m.panelsTabs.qr.noPassword },
                ]}
              />
            </AppField>
            {security !== "nopass" ? (
              <TextField label={m.panelsTabs.qr.password} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={m.panelsTabs.qr.passwordPlaceholder} />
            ) : null}
          </div>
        ) : null}

        <AppField label={m.panelsTabs.qr.logo}>
          <input type="file" accept="image/*,.svg" aria-label={m.panelsTabs.qr.logo} onChange={(e) => void chooseLogo(e.currentTarget.files?.[0])} />
          {logo ? (
            <Button variant="ghost" size="sm" onClick={() => setLogo(undefined)}>
              {m.panelsTabs.qr.removeLogo}
            </Button>
          ) : null}
        </AppField>
        {logoError ? <p role="alert">{m.panelsTabs.qr.logoError}</p> : null}

        <div className="cf-app__row cf-qr__colors">
          <AppField label={m.panelsTabs.qr.squares}>
            <ColorButton label={m.panelsTabs.qr.squareColour} value={fg} onChange={setFg} presets={PRESETS} />
          </AppField>
          <AppField label={m.panelsTabs.qr.background}>
            <ColorButton label={m.panelsTabs.qr.backgroundColour} value={bg} onChange={setBg} presets={PRESETS} />
          </AppField>
        </div>

        <AppField label={m.panelsTabs.qr.errorCorrection} hint={m.panelsTabs.qr.errorCorrectionHint}>
          <Select<Level> value={level} onChange={setLevel} options={LEVELS} aria-label={m.panelsTabs.qr.errorCorrection} />
        </AppField>
      </div>
    </AppPage>
  );
}
