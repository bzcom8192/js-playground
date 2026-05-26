export default function SmartString({ value }) {
  const isColor = /^(#[0-9a-f]{3,8}|rgba?\s*\(|hsla?\s*\()/i.test(value);
  const isUrl = /^(https?:\/\/[^\s]+)/i.test(value);

  if (isColor) {
    return (
      <span className="inline-flex items-center gap-1.5 bg-gray-800/50 px-1.5 rounded border border-gray-700/50 align-middle mx-1">
        <span
          className="w-3 h-3 rounded-xs border border-white/20 shadow-sm"
          style={{ backgroundColor: value }}
        />
        <span className="text-[#ce9178] font-mono">"{value}"</span>
      </span>
    );
  }

  if (isUrl) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-400 underline hover:text-blue-300 break-all decoration-dotted underline-offset-4"
        onClick={(e) => e.stopPropagation()}
      >
        "{value}"
      </a>
    );
  }

  return <span className="text-[#ce9178] whitespace-pre-wrap">"{value}"</span>;
}
