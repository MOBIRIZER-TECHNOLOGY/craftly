/**
 * Who is in the shared design, in the top bar beside the "Live" mark: a short row of initials, each in the colour that person
 * has on the page, with a count. It is a plain list with a name ("3 people here") and the names in it, which a screen reader
 * reads when its user goes there. It is deliberately not a live region: people come, go and move all the time, and saying so
 * each time would talk over the work.
 *
 * And the field in which a person gives the name the others see, which is kept on this device (presence.ts).
 */
import { useState } from "react";
import { PRESENCE_NAME_MAX } from "@/collab/presence";
import { m } from "@/i18n";
import { TextField } from "@/ui";
import { colorOf, saveName, shownName, usePresence } from "./presence";
import "./live.css";

/** How many people are shown by their initials before the rest are summed up. */
const SHOWN = 4;

/** One or two letters for a name: the first of its first two words. */
export function initials(name: string): string {
  const words = name.split(" ").filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => String.fromCodePoint(word.codePointAt(0) as number).toUpperCase())
    .join("");
}

export function LivePeople() {
  const me = usePresence((s) => s.me);
  const myName = usePresence((s) => s.name);
  const others = usePresence((s) => s.people);
  if (me === null) return null;
  const all = [{ peer: me, name: m.editor.live.me(shownName(myName, me)), short: initials(shownName(myName, me)), color: colorOf(me) }].concat(
    others.map((p) => ({ peer: p.peer, name: p.name, short: initials(p.name), color: p.color })),
  );
  const shown = all.length > SHOWN + 1 ? all.slice(0, SHOWN) : all;
  const rest = all.slice(shown.length);
  const restNames = rest.map((p) => p.name).join(", ");
  return (
    <ul className="cf-live-people" aria-label={m.editor.live.people(all.length)}>
      {shown.map((person) => (
        <li key={person.peer} className="cf-live-people__one" style={{ backgroundColor: person.color }} title={person.name}>
          <span className="cf-live-people__initials" aria-hidden="true">
            {person.short}
          </span>
          <span className="cf-sr-only">{person.name}</span>
        </li>
      ))}
      {rest.length ? (
        <li className="cf-live-people__one cf-live-people__one--more" title={restNames}>
          <span aria-hidden="true">+{rest.length}</span>
          <span className="cf-sr-only">{m.editor.live.andRest(restNames)}</span>
        </li>
      ) : null}
      <li className="cf-live-people__count" aria-hidden="true">
        {all.length}
      </li>
    </ul>
  );
}

/** The name the others see beside this person's pointer. What is typed is kept at once; nothing has to be confirmed. */
export function NameField() {
  const me = usePresence((s) => s.me);
  const [typed, setTyped] = useState(() => usePresence.getState().name);
  return (
    <TextField
      label={m.editor.live.nameLabel}
      value={typed}
      onChange={(e) => {
        setTyped(e.target.value);
        saveName(e.target.value);
      }}
      placeholder={me === null ? m.editor.live.guestPlaceholder : shownName("", me)}
      hint={m.editor.live.nameHint}
      maxLength={PRESENCE_NAME_MAX}
      autoComplete="nickname"
      spellCheck={false}
    />
  );
}
