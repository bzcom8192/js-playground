import { useState } from "react";

export default function NumberToggle({ value }) {
  const [isHex, setIsHex] = useState(false);
  if (isNaN(value) || !isFinite(value))
    return <span className="text-purple-400 font-bold">{String(value)}</span>;

  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        setIsHex(!isHex);
      }}
      className="cursor-pointer text-blue-400 hover:text-blue-300 border-b border-dotted border-blue-500/50 hover:border-blue-300 font-bold transition-colors"
      title="Toggle Decimal / Hex"
    >
      {isHex ? `0x${value.toString(16).toUpperCase()}` : value}
    </span>
  );
}
