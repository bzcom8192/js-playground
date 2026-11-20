import { Linter } from "eslint-linter-browserify";
import { eslintConfig } from "./eslintConfig";

const linter = new Linter();

// Configs with extra globals (e.g. the Farmer API) are cached per globals object.
const configCache = new WeakMap();

function configFor(extraGlobals) {
  if (!extraGlobals) return eslintConfig;
  let config = configCache.get(extraGlobals);
  if (!config) {
    config = {
      ...eslintConfig,
      languageOptions: {
        ...eslintConfig.languageOptions,
        globals: { ...eslintConfig.languageOptions.globals, ...extraGlobals },
      },
    };
    configCache.set(extraGlobals, config);
  }
  return config;
}

export function lintCode(code, extraGlobals) {
  try {
    const messages = linter.verify(code, configFor(extraGlobals));
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
