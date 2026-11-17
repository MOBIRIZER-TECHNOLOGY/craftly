/**
 * "Move N designs into your account?" (docs/ACCOUNTS.md), with Move all, Choose and Not now: asked after signing in on a device that
 * has designs of its own, and from the account menu. Moving keeps the designs here too; they are sent with the next sync.
 */
import { useEffect, useState } from "react";
import { localOnlyDesigns, moveIntoAccount } from "@/cloud/account";
import type { DesignSummary } from "@/core/types";
import { m } from "@/i18n";
import { Button, Checkbox, Modal, toast } from "@/ui";
import "./account.css";

export function MoveDesignsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [designs, setDesigns] = useState<DesignSummary[] | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setChoosing(false);
    void localOnlyDesigns().then((found) => {
      setDesigns(found);
      setChosen(new Set(found.map((d) => d.id)));
    });
  }, [open]);

  const move = async (ids: string[]) => {
    await moveIntoAccount(ids);
    toast.success(m.cloud.move.moved(ids.length));
    onClose();
  };

  const count = designs?.length ?? 0;
  return (
    <Modal
      open={open && count > 0}
      onClose={onClose}
      title={m.cloud.move.title(count)}
      size="md"
      footer={
        choosing ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              {m.cloud.move.notNow}
            </Button>
            <Button variant="primary" disabled={!chosen.size} onClick={() => void move([...chosen])}>
              {m.cloud.move.moveChosen(chosen.size)}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {m.cloud.move.notNow}
            </Button>
            <Button variant="secondary" onClick={() => setChoosing(true)}>
              {m.cloud.move.choose}
            </Button>
            <Button variant="primary" onClick={() => void move((designs ?? []).map((d) => d.id))}>
              {m.cloud.move.moveAll}
            </Button>
          </>
        )
      }
    >
      <div className="cf-acct__form">
        <p className="cf-acct__text">{m.cloud.move.body}</p>
        {choosing ? (
          <fieldset className="cf-acct__choices">
            <legend className="cf-acct__label">{m.cloud.move.chooseLabel}</legend>
            {(designs ?? []).map((design) => (
              <Checkbox
                key={design.id}
                checked={chosen.has(design.id)}
                label={design.title}
                onChange={(on) =>
                  setChosen((before) => {
                    const next = new Set(before);
                    if (on) next.add(design.id);
                    else next.delete(design.id);
                    return next;
                  })
                }
              />
            ))}
          </fieldset>
        ) : null}
      </div>
    </Modal>
  );
}
