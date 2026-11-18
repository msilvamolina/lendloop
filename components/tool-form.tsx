"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { CATEGORY_LABELS, CONDITION_LABELS, errorMessage } from "@/lib/ui";

type Tool = Pick<Doc<"tools">, "name" | "category" | "condition" | "description">;

// One form for both "list a tool" (no toolId) and "edit listing".
export function ToolForm({ toolId, initial, onDone }: { toolId?: Id<"tools">; initial?: Tool; onDone?: () => void }) {
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const tool = {
      name: String(data.get("name")),
      category: data.get("category") as Tool["category"],
      condition: data.get("condition") as Tool["condition"],
      description: String(data.get("description")),
    };
    setSaving(true);
    setError(null);
    try {
      if (toolId) await update({ toolId, ...tool });
      else {
        await create(tool);
        form.reset();
      }
      onDone?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const prefix = toolId ?? "new";
  return (
    <form className="form" onSubmit={onSubmit}>
      <label className="field" htmlFor={`${prefix}-name`}>
        Name
        <input id={`${prefix}-name`} name="name" required maxLength={80} defaultValue={initial?.name} placeholder="Cordless drill" />
      </label>
      <div className="form-row">
        <label className="field" htmlFor={`${prefix}-category`}>
          Category
          <select id={`${prefix}-category`} name="category" required defaultValue={initial?.category ?? ""}>
            <option value="" disabled>
              Choose…
            </option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor={`${prefix}-condition`}>
          Condition
          <select id={`${prefix}-condition`} name="condition" required defaultValue={initial?.condition ?? ""}>
            <option value="" disabled>
              Choose…
            </option>
            {Object.entries(CONDITION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field" htmlFor={`${prefix}-description`}>
        Short description <span className="hint">Optional, up to 500 characters</span>
        <textarea id={`${prefix}-description`} name="description" maxLength={500} defaultValue={initial?.description} />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button className="button" disabled={saving}>
          {saving ? "Saving…" : toolId ? "Save changes" : "List tool"}
        </button>
      </div>
    </form>
  );
}
