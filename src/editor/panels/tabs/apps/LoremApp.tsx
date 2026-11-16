import { useMemo, useState } from "react";
import { createText } from "@/core/factory";
import { getActions, useEditor } from "@/core/store";
import { m } from "@/i18n";
import { Button, IconPlus, NumberField, Segmented, Switch } from "@/ui";
import { IconDice } from "../../shared/icons";
import { AppField, AppPage } from "./appKit";
import { generateLorem, LOREM_LIMITS as LIMITS, type Unit } from "./lorem";
import "./LoremApp.css";

/**
 * Lorem ipsum: choose how much placeholder text you need, preview it, shuffle it and add it to the page as a text
 * box that wraps at 60% of the page width.
 */
export function LoremApp() {
  const [unit, setUnit] = useState<Unit>("paragraphs");
  const [count, setCount] = useState(LIMITS.paragraphs.default);
  const [classic, setClassic] = useState(true);
  const [seed, setSeed] = useState(7);

  const text = useMemo(() => generateLorem(unit, count, seed, classic), [unit, count, seed, classic]);

  const changeUnit = (next: Unit) => {
    setUnit(next);
    setCount(LIMITS[next].default);
  };

  const add = () => {
    const d = useEditor.getState().design;
    if (!d) return;
    const min = Math.min(d.width, d.height);
    getActions().addElement(createText({ text, fontSize: Math.round(min * 0.028), width: Math.round(d.width * 0.6), autoWidth: false, lineHeight: 1.5 }));
  };

  return (
    <AppPage
      title={m.panelsTabs.lorem.title}
      subtitle={m.panelsTabs.lorem.subtitle}
      footer={
        <Button variant="primary" size="lg" block icon={<IconPlus />} onClick={add}>
          {m.panelsTabs.shared.addToDesign}
        </Button>
      }
    >
      <AppField label={m.panelsTabs.lorem.howMuch}>
        <Segmented<Unit>
          value={unit}
          onChange={changeUnit}
          fullWidth
          size="sm"
          aria-label={m.panelsTabs.lorem.unit}
          options={[
            { value: "paragraphs", label: m.panelsTabs.lorem.units.paragraphs },
            { value: "sentences", label: m.panelsTabs.lorem.units.sentences },
            { value: "words", label: m.panelsTabs.lorem.units.words },
          ]}
        />
        <div className="cf-lorem__count">
          <NumberField
            value={count}
            onChange={(v) => setCount(Math.min(LIMITS[unit].max, Math.max(1, Math.round(v))))}
            min={1}
            max={LIMITS[unit].max}
            step={1}
            precision={0}
            stepper
            label={m.panelsTabs.lorem.numberOf[unit]}
            width={150}
          />
          <Button variant="ghost" size="sm" icon={<IconDice />} onClick={() => setSeed((s) => s + 1)}>
            {m.panelsTabs.lorem.shuffle}
          </Button>
        </div>
      </AppField>

      <Switch checked={classic} onChange={setClassic} label={m.panelsTabs.lorem.classic} />

      <AppField label={m.panelsTabs.lorem.preview} className="cf-lorem__preview-field">
        <div className="cf-lorem__preview" role="region" aria-label={m.panelsTabs.lorem.previewLabel} tabIndex={0}>
          {text.split("\n\n").map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        <p className="cf-app__hint">{m.panelsTabs.lorem.wordCount(text.split(/\s+/).filter(Boolean).length)}</p>
      </AppField>
    </AppPage>
  );
}
