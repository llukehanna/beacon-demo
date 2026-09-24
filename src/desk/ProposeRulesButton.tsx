import React from "react";
import { useOsdkAction } from "@/data/hooks";
import { clusterRejectionsAction } from "@/data/ontology";

/** Runs the learning loop on demand: cluster rejections into proposed screening rules. */
export function ProposeRulesButton(): React.ReactElement {
  const cluster = useOsdkAction(clusterRejectionsAction);
  const [note, setNote] = React.useState<string | null>(null);

  const onClick = (): void => {
    setNote(null);
    cluster
      .applyAction({})
      .then((r) => setNote(r.note ?? "Done."))
      .catch(() => undefined); // surfaced via cluster.error
  };

  return (
    <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 6 }}>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={onClick}
        disabled={cluster.isPending}
      >
        {cluster.isPending ? "Reading rejections…" : "Propose rules from rejections"}
      </button>
      {note !== null && <span style={{ fontSize: 12, opacity: 0.8 }}>{note}</span>}
      {cluster.error !== undefined && (
        <span style={{ fontSize: 12, color: "#f4abab" }}>{cluster.error.message}</span>
      )}
    </div>
  );
}
