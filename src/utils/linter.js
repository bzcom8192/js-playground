import { Linter } from "eslint-linter-browserify";
import { eslintConfig } from "./eslintConfig";

const linter = new Linter();

export function lintCode(code) {
  try {
    const messages = linter.verify(code, eslintConfig);
    return messages;
  } catch (error) {
    console.error("Linting error:", error);
    return [];
  }
}

export function convertToMonacoMarkers(lintMessages) {
  return lintMessages.map((msg) => {
    let severity;
    if (msg.severity === 2) {
      severity = 8; // monaco.MarkerSeverity.Error
    } else if (msg.severity === 1) {
      severity = 4; // monaco.MarkerSeverity.Warning
    } else {
      severity = 1; // monaco.MarkerSeverity.Hint
    }

    return {
      severity,
      startLineNumber: msg.line,
      startColumn: msg.column,
      endLineNumber: msg.endLine || msg.line,
      endColumn: msg.endColumn || msg.column,
      message: msg.message,
      source: msg.ruleId || "eslint",
    };
  });
}
