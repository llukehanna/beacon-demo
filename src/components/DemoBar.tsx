import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { resetDemo } from "@/data/api";

/** Always-visible notice that this is a shared demo on synthetic data, with a throttled reset. */
export default function DemoBar(): React.ReactElement {
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");

  const onReset = async (): Promise<void> => {
    setBusy(true);
    setMessage("");
    try {
      await resetDemo();
      await qc.invalidateQueries();
      setMessage("Demo data restored.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      aria-label="Demo notice"
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        zIndex: 1000,
        display: "flex",
        flexWrap: "wrap",
        maxWidth: "calc(100vw - 24px)",
        boxSizing: "border-box",
        gap: 10,
        alignItems: "center",
        padding: "6px 10px",
        borderRadius: 8,
        background: "rgba(22, 24, 38, 0.94)",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        color: "#c9cdd8",
        font: "12px/1.4 system-ui, sans-serif",
      }}
    >
      <span>Demo · synthetic data · resets daily</span>
      <button
        type="button"
        onClick={() => void onReset()}
        disabled={busy}
        style={{
          font: "inherit",
          color: "inherit",
          background: "transparent",
          border: "1px solid rgba(255, 255, 255, 0.25)",
          borderRadius: 6,
          padding: "2px 8px",
          cursor: busy ? "progress" : "pointer",
        }}
      >
        {busy ? "Resetting…" : "Reset"}
      </button>
      {/* Always mounted so screen readers announce changes; display: contents adds no flex gap while empty. */}
      <span role="status" style={{ display: "contents" }}>
        {message}
      </span>
    </div>
  );
}
