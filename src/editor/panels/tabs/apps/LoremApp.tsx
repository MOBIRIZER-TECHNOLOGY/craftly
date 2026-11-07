import { useMemo, useState } from "react";
import { createText } from "@/core/factory";
import { getActions, useEditor } from "@/core/store";
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
      title="Lorem ipsum"
      subtitle="Placeholder text for your layouts"
      footer={
        <Button variant="primary" size="lg" block icon={<IconPlus />} onClick={add}>
          Add to design
        </Button>
      }
    >
      <AppField label="How much?">
        <Segmented<Unit>
          value={unit}
          onChange={changeUnit}
          fullWidth
          size="sm"
          aria-label="Unit"
          options={[
            { value: "paragraphs", label: "Paragraphs" },
            { value: "sentences", label: "Sentences" },
            { value: "words", label: "Words" },
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
            label={`Number of ${unit}`}
            width={150}
          />
          <Button variant="ghost" size="sm" icon={<IconDice />} onClick={() => setSeed((s) => s + 1)}>
            Shuffle
          </Button>
        </div>
      </AppField>

      <Switch checked={classic} onChange={setClassic} label='Start with "Lorem ipsum dolor sit amet"' />

      <AppField label="Preview" className="cf-lorem__preview-field">
        <div className="cf-lorem__preview" role="region" aria-label="Preview of the text" tabIndex={0}>
          {text.split("\n\n").map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        <p className="cf-app__hint">{text.split(/\s+/).filter(Boolean).length} words</p>
      </AppField>
    </AppPage>
  );
}
