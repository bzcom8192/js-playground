import { useState } from "react";

export default function BooleanToggle({ value }) {
  const [mode, setMode] = useState(0);
  const display = [
    { t: "true", f: "false" },
    { t: "Yes", f: "No" },
    { t: "1", f: "0" },
  ];

  const text = value ? display[mode].t : display[mode].f;
  const color = value ? "text-green-400" : "text-red-400";

  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        setMode((m) => (m + 1) % 3);
      }}
      className={`cursor-pointer ${color} hover:underline decoration-dotted underline-offset-4 font-bold transition-all`}
      title="Toggle format (True/Yes/1)"
    >
      {text}
    </span>
  );
}
