module.exports = {
    env: {
        browser: true, // Enables browser global variables like `window` and `document`.
        es2021: true,  // Enables ECMAScript 2021 syntax.
    },
    globals: {
        chrome: 'readonly', // Adds Chrome Extension APIs as global variables.
    },
    extends: [
        'eslint:recommended', // Use recommended ESLint rules.
    ],
    parserOptions: {
        ecmaVersion: 12, // Use the latest ECMAScript features.
        sourceType: 'module', // Support for ES modules.
    },
    rules: {
        // Customize the rules as per your preference.
        'no-unused-vars': 'warn', // Warn on unused variables.
        'no-console': 'off', // Allow use of `console.log`.
        'semi': ['error', 'always'], // Enforce semicolons.
        'quotes': ['error', 'single'], // Enforce single quotes.
    },
};