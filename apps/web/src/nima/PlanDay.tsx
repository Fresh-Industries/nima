import { NimaDialog } from "./NimaDialog";
import { randomUUID } from "../lib/utils";
import styles from "./nima.module.css";
import { useState } from "react";
import { ArrowUp, ArrowDown, Plus, Trash2, X } from "lucide-react";
import { EMPTY_PLAN, moveTask, useNimaStore } from "./store";
import { useDay } from "./useDay";

export function PlanDay({ onClose }: { onClose: () => void }) {
  const today = useDay();
  const [day, setDay] = useState(today);
  const [text, setText] = useState("");
  const plan = useNimaStore((state) => state.plans[day] ?? EMPTY_PLAN);
  const plans = useNimaStore((state) => state.plans);
  const save = useNimaStore((state) => state.savePlan);
  const [error, setError] = useState("");
  const update = (next: typeof plan) => {
    try {
      save(day, next);
      setError("");
    } catch {
      setError(
        "Your plan could not be saved. Browser storage may be full or unavailable. Keep a copy before closing.",
      );
    }
  };
  return (
    <NimaDialog titleId="plan-title" onClose={onClose}>
      <section className={styles["nima-notepad"]}>
        <header>
          <span className={styles["nima-eyebrow"]}>A little space to think</span>
          <button aria-label="Close daily plan" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <h1 id="plan-title">Plan your day.</h1>
        <div className={styles["nima-plan-date"]}>
          <input
            aria-label="Plan date"
            type="date"
            value={day}
            onChange={(event) => {
              if (event.target.value) setDay(event.target.value);
            }}
          />
          <select
            aria-label="Previous daily plans"
            value={day}
            onChange={(event) => setDay(event.target.value)}
          >
            {[...new Set([today, day, ...Object.keys(plans)])]
              .sort()
              .reverse()
              .map((date) => (
                <option key={date} value={date}>
                  {date === today ? "Today" : date}
                </option>
              ))}
          </select>
        </div>
        <textarea
          autoFocus
          aria-label="Daily notes and priorities"
          className={styles["nima-plan-notes"]}
          placeholder="What’s on your mind? What matters today?"
          value={plan.notes}
          onChange={(event) => update({ ...plan, notes: event.target.value })}
        />
        <div className={styles["nima-plan-label"]}>
          Priorities{" "}
          <span>
            {plan.tasks.filter((task) => task.done).length} / {plan.tasks.length}
          </span>
        </div>
        <div className={styles["nima-tasks"]}>
          {plan.tasks.map((task, index) => (
            <div className={styles["nima-task"]} key={task.id}>
              <input
                aria-label={`Complete ${task.text}`}
                type="checkbox"
                checked={task.done}
                onChange={(event) =>
                  update({
                    ...plan,
                    tasks: plan.tasks.map((item) =>
                      item.id === task.id ? { ...item, done: event.target.checked } : item,
                    ),
                  })
                }
              />
              <input
                className={task.done ? styles["is-done"] : ""}
                aria-label={`Task ${index + 1}`}
                value={task.text}
                onChange={(event) =>
                  update({
                    ...plan,
                    tasks: plan.tasks.map((item) =>
                      item.id === task.id ? { ...item, text: event.target.value } : item,
                    ),
                  })
                }
              />
              <button
                aria-label={`Move task ${index + 1} up`}
                disabled={index === 0}
                onClick={() => update({ ...plan, tasks: moveTask(plan.tasks, task.id, -1) })}
              >
                <ArrowUp size={14} />
              </button>
              <button
                aria-label={`Move task ${index + 1} down`}
                disabled={index === plan.tasks.length - 1}
                onClick={() => update({ ...plan, tasks: moveTask(plan.tasks, task.id, 1) })}
              >
                <ArrowDown size={14} />
              </button>
              <button
                aria-label={`Delete task ${index + 1}`}
                onClick={() =>
                  update({ ...plan, tasks: plan.tasks.filter((item) => item.id !== task.id) })
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <form
          className={styles["nima-add-task"]}
          onSubmit={(event) => {
            event.preventDefault();
            if (!text.trim()) return;
            update({
              ...plan,
              tasks: [...plan.tasks, { id: randomUUID(), text: text.trim(), done: false }],
            });
            setText("");
          }}
        >
          <Plus size={16} />
          <input
            aria-label="New task"
            placeholder="Add a priority…"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="submit">Add</button>
        </form>
        <footer>
          {error ? <p role="alert">{error}</p> : "Saved in this browser · One day at a time"}
        </footer>
      </section>
    </NimaDialog>
  );
}
