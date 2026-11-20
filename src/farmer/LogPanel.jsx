import { useEffect, useRef } from "react";

const KIND_CLASS = {
  print: "text-gray-300",
  info: "text-sky-400/80",
  warn: "text-yellow-300",
  error: "text-red-300 bg-red-950/30",
};

export default function LogPanel({ logs }) {
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [logs]);

  if (logs.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-700 italic text-sm select-none">
        print() output and errors appear here…
      </div>
    );
  }
  return (
    <div className="p-2 font-mono text-xs space-y-0.5">
      {logs.map((l) => (
        <div key={l.id} className={`px-1.5 py-0.5 rounded whitespace-pre-wrap break-words ${KIND_CLASS[l.kind] || ""}`}>
          {l.text}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
