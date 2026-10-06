import js from "@eslint/js";
import globals from "globals";

// The archive namer and the VS Code panel take the client from line 1, so it must be `// Site: <host>`.
const siteLine = {
    meta: { type: "problem", messages: { missing: "Line 1 must be `// Site: <hostname>`, the host of the CRO target tab." } },
    create: (context) => ({
        Program: () => {
            const { lines, text } = context.sourceCode;
            if (text.trim() && !/^\/\/ Site: [\w.-]+$/.test(lines[0])) {
                context.report({ loc: { line: 1, column: 0 }, messageId: "missing" });
            }
        },
    }),
};

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.browser,
                Kameleoon: "readonly",
                setTargeting: "readonly",
                triggerGoal: "readonly",
            },
        },
        plugins: { cro: { rules: { "site-line": siteLine } } },
        rules: {
            "cro/site-line": "error",
            "no-unused-vars": "warn",
            "no-console": "off",
            "no-undef": "warn",
            "no-var": "error",
            "prefer-const": "error",
            "prefer-arrow-callback": "error",
            "prefer-template": "error",
            "object-shorthand": "error",
            "arrow-body-style": ["error", "as-needed"],
            "no-restricted-syntax": [
                "error",
                {
                    "selector": "FunctionDeclaration",
                    "message": "Use arrow functions instead of function declarations."
                }
            ],
            "func-style": ["error", "expression"]
        }
    },
];
