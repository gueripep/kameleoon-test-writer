import js from "@eslint/js";
import globals from "globals";

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
        rules: {
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
