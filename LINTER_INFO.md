# ESLint Client-Side Linter

## Overview
This Monaco Editor instance now includes **real-time ESLint linting** that runs entirely in the browser. Errors and warnings appear as you type, similar to VS Code.

## Features

### Visual Indicators
- **Red squiggly underlines**: Errors (severity: error)
- **Yellow/Orange squiggly underlines**: Warnings (severity: warning)
- **Hover tooltips**: Show error/warning messages when you hover over highlighted code

### Linting Rules Enabled

#### Error Rules
- `no-undef`: Using undefined variables
- `no-redeclare`: Redeclaring variables
- `no-dupe-args`: Duplicate function arguments
- `no-dupe-keys`: Duplicate object keys
- `no-func-assign`: Reassigning functions
- `no-eval`: Using eval()
- `semi`: Missing semicolons (required)
- Many more standard ESLint rules

#### Warning Rules
- `no-unused-vars`: Unused variables
- `no-debugger`: Debugger statements
- `no-var`: Using `var` instead of `const`/`let`
- `prefer-const`: Variables that should be const
- Style rules (spacing, formatting, etc.)

### How It Works

1. **Debounced Linting**: The linter runs 500ms after you stop typing (for performance)
2. **Browser-Based**: Uses `eslint-linter-browserify` - no server required
3. **Monaco Integration**: Lint results are displayed as Monaco editor markers
4. **Custom Configuration**: Rules configured in `src/utils/eslintConfig.js`

### Example Errors

Try typing these examples to see the linter in action:

```javascript
// Error: no-undef (using undefined variable)
console.log(undefinedVar);

// Error: no-redeclare (redeclaring variable)
const x = 1;
const x = 2;

// Warning: no-unused-vars (unused variable)
const unusedVariable = "hello";

// Warning: prefer-const (should use const)
let y = 10; // never reassigned

// Error: missing semicolon
const z = 5

// Error: no-dupe-keys
const obj = { a: 1, a: 2 };
```

### Configuration

To customize linting rules, edit `src/utils/eslintConfig.js`:

```javascript
export const eslintConfig = {
  rules: {
    "semi": ["error", "always"],  // Require semicolons
    "no-console": "off",          // Allow console.log
    "no-unused-vars": "warn",     // Warn on unused vars
    // Add more rules...
  }
};
```

### Benefits

- **Learn Best Practices**: See errors and warnings as you code
- **Catch Bugs Early**: Find issues before running code
- **Consistent Style**: Enforce coding standards
- **No Setup Required**: Works out of the box in the browser

### Performance

- Linting is debounced (500ms) to avoid performance issues
- Only the current code is linted (no file system access needed)
- Runs in the main thread but optimized for quick execution

## Future Enhancements

Potential improvements:
- Add more specific rules for common JavaScript patterns
- Custom rule presets (strict, recommended, relaxed)
- Toggle linting on/off via UI
- Display error/warning count in the UI
- Quick-fix suggestions for common issues
