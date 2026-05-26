import { useState } from "react";

export default function ObjectInspector({ value }) {
  const [expanded, setExpanded] = useState(false);

  const safeStr = (v) => {
    try {
      return JSON.stringify(v, null, 2);
    } catch (e) {
      void e;
      return "[Circular]";
    }
  };

  const isArray = Array.isArray(value);
  const isEmpty = isArray
    ? value.length === 0
    : Object.keys(value).length === 0;

  if (isEmpty) {
    return (
      <span className="text-gray-500 italic">{isArray ? "[]" : "{}"}</span>
    );
  }

  const preview = isArray
    ? `Array(${value.length})`
    : `{ ${Object.keys(value).slice(0, 3).join(", ")}${Object.keys(value).length > 3 ? "..." : ""} }`;

  return (
    <div className="inline-block align-top">
      {!expanded ? (
        <span
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
          className="cursor-pointer text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 px-1 rounded transition-colors flex items-center gap-1"
        >
          <ChevronRight className="w-3 h-3" />
          <span className="italic">{preview}</span>
        </span>
      ) : (
        <div className="relative group">
          <div
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(false);
            }}
            className="absolute -left-4 top-1 cursor-pointer text-gray-500 hover:text-white"
          >
            <ChevronRight className="w-3 h-3 rotate-90" />
          </div>
          <pre className="text-xs text-green-300/90 bg-[#161b22] p-2 rounded border border-gray-700/50 overflow-x-auto mt-1 ml-1 shadow-xl">
            {safeStr(value)}
          </pre>
        </div>
      )}
    </div>
  );
}
