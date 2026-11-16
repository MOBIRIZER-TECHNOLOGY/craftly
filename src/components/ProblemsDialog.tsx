import { useState } from "react";
import { PROBLEM_TITLES, clearProblems, listProblems } from "@/core/problems";
import { date, m } from "@/i18n";
import { Button, Modal, cx } from "@/ui";
import { ReportPanel } from "./ReportPanel";
import "./problemsDialog.css";

interface Props {
  open: boolean;
  /** the problem to start on; the newest when there is none (or it is gone) */
  problemId: string | null;
  onClose: () => void;
}

/** What Craftly wrote down when something went wrong, on this device only, and the report of each problem. */
export function ProblemsDialog({ open, problemId, onClose }: Props) {
  const [problems, setProblems] = useState(listProblems);
  const [chosen, setChosen] = useState<string | null>(problemId);
  const selected = problems.find((p) => p.id === chosen) ?? problems[0] ?? null;

  const refresh = () => setProblems(listProblems());
  const clear = () => {
    clearProblems();
    refresh();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={m.app.problems.title}
      footer={
        <>
          <Button variant="secondary" disabled={problems.length === 0} onClick={clear}>
            {m.app.problems.clear}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {m.common.close}
          </Button>
        </>
      }
    >
      {selected ? (
        <div className="cf-problems">
          <ul className="cf-problems__list" aria-label={m.app.problems.listLabel}>
            {problems.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  aria-current={p.id === selected.id ? "true" : undefined}
                  className={cx("cf-problems__row", p.id === selected.id && "is-selected")}
                  onClick={() => setChosen(p.id)}
                >
                  <span className="cf-problems__title">
                    {PROBLEM_TITLES[p.kind]}
                    {p.count > 1 ? <span className="cf-problems__count"> {m.app.problems.count(p.count)}</span> : null}
                    {p.sent ? <span className="cf-problems__sent"> {m.app.problems.sent}</span> : null}
                  </span>
                  <span className="cf-problems__when">{date(p.at, { dateStyle: "medium", timeStyle: "short" })}</span>
                  <span className="cf-problems__message">{p.message}</span>
                </button>
              </li>
            ))}
          </ul>
          <ReportPanel key={selected.id} problem={selected} onSent={refresh} />
        </div>
      ) : (
        <div className="cf-problems__empty">
          <p>{m.app.problems.empty}</p>
          <p className="cf-problems__hint">{m.app.problems.emptyHint}</p>
        </div>
      )}
    </Modal>
  );
}
