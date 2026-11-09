import { useState } from "react";
import { PROBLEM_TITLES, clearProblems, listProblems } from "@/core/problems";
import { Button, Modal, cx } from "@/ui";
import { ReportPanel } from "./ReportPanel";
import "./problemsDialog.css";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

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
      title="Report a problem"
      footer={
        <>
          <Button variant="secondary" disabled={problems.length === 0} onClick={clear}>
            Clear the list
          </Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {selected ? (
        <div className="cf-problems">
          <ul className="cf-problems__list" role="listbox" aria-label="Problems on this device">
            {problems.map((p) => (
              <li key={p.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={p.id === selected.id}
                  className={cx("cf-problems__row", p.id === selected.id && "is-selected")}
                  onClick={() => setChosen(p.id)}
                >
                  <span className="cf-problems__title">
                    {PROBLEM_TITLES[p.kind]}
                    {p.count > 1 ? <span className="cf-problems__count"> ×{p.count}</span> : null}
                    {p.sent ? <span className="cf-problems__sent"> Sent</span> : null}
                  </span>
                  <span className="cf-problems__when">{when.format(p.at)}</span>
                  <span className="cf-problems__message">{p.message}</span>
                </button>
              </li>
            ))}
          </ul>
          <ReportPanel key={selected.id} problem={selected} onSent={refresh} />
        </div>
      ) : (
        <div className="cf-problems__empty">
          <p>No problems have been recorded on this device.</p>
          <p className="cf-problems__hint">
            If something does not work, reload the page and try again. When Craftly notices a problem it writes it down here, on this device only.
          </p>
        </div>
      )}
    </Modal>
  );
}
