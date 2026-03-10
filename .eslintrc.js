module.exports = {
    root: true,
    env: {
        browser: true, // Enables browser global variables like `window` and `document`.
        node: true,    // Enables Node.js global variables like `module` and `require`.
        es2021: true,  // Enables ECMAScript 2021 syntax.
    },
    globals: {
        chrome: 'readonly', // Adds Chrome Extension APIs as global variables.
    },
    extends: [
        'eslint:recommended', // Use recommended ESLint rules.
    ],
    parserOptions: {
        ecmaVersion: 12, // Use ECMAScript 2021 features.
        sourceType: 'module', // Support for ES modules.
        ecmaFeatures: {
            jsx: true, // Allow parsing JSX in Preact components.
        },
    },
    ignorePatterns: [
        '.build/**',
        'dist/**',
        'ui/node_modules/**',
    ],
    rules: {
        // Customize the rules as per your preference.
        // In this Preact setup, component identifiers are used via JSX tags.
        'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z][A-Za-z0-9]+$' }],
        'no-console': 'off', // Allow use of `console.log`.
        'semi': ['error', 'always'], // Enforce semicolons.
        'quotes': ['error', 'single'], // Enforce single quotes.
    },
};
