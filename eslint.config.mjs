import path from "node:path";
import { builtinModules } from "node:module";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const commonPatterns = [
  {
    group: ["@anonlimit/testing", "@anonlimit/testing/*", "**/packages/testing/**"],
    message: "Production code cannot import test helpers.",
  },
  {
    group: ["@anonlimit/*/src", "@anonlimit/*/src/**"],
    message: "Use declared workspace exports.",
  },
];
function boundary(files, prohibited) {
  return {
    files,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...commonPatterns,
            ...prohibited.map((group) => ({
              group,
              message: "This import crosses a trust boundary.",
            })),
          ],
        },
      ],
    },
  };
}
const crossPackageRule = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      boundary: "This relative import crosses a workspace or browser trust boundary.",
      dynamic: "Use static imports for external modules so dependency boundaries can be checked.",
    },
  },
  create(context) {
    const filename = context.filename.replaceAll("\\", "/");
    const owner = filename.match(/\/(apps|packages)\/([^/]+)\//)?.[0];
    function check(node) {
      const value = node.source?.value;
      if (!owner) return;
      if (
        node.type === "ImportExpression" &&
        (typeof value !== "string" || !value.startsWith("."))
      ) {
        context.report({ node, messageId: "dynamic" });
        return;
      }
      if (typeof value !== "string" || !value.startsWith(".")) return;
      const resolved = path.resolve(path.dirname(context.filename), value).replaceAll("\\", "/");
      const holderEscape =
        filename.includes("/packages/crypto/src/holder/") &&
        !resolved.includes("/packages/crypto/src/holder/");
      const clientEscape =
        filename.endsWith("/packages/config/src/client-env.ts") &&
        resolved.includes("/packages/config/src/server");
      if (!resolved.includes(owner) || holderEscape || clientEscape)
        context.report({ node, messageId: "boundary" });
    }
    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
    };
  },
};
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      ".cache/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  {
    ...js.configs.recommended,
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: globals.node },
  },
  ...tseslint.configs.strict.map((config) => ({ ...config, files: ["**/*.{ts,tsx}"] })),
  ...tseslint.configs.stylistic.map((config) => ({ ...config, files: ["**/*.{ts,tsx}"] })),
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: globals.node, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { boundaries: { rules: { "workspace-imports": crossPackageRule } } },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "boundaries/workspace-imports": "error",
      "no-console": "error",
    },
  },
  boundary(
    [
      "apps/*/src/**/*.{ts,tsx}",
      "packages/{config,contracts,crypto,db,domain,observability}/src/**/*.ts",
    ],
    []
  ),
  boundary(
    ["apps/web/**/*.{ts,tsx}"],
    [
      [
        "@anonlimit/db",
        "@anonlimit/db/*",
        "@anonlimit/crypto/issuer*",
        "@anonlimit/crypto/verifier*",
        "@anonlimit/crypto/audit*",
        "@anonlimit/config/server",
        "@anonlimit/observability",
        "node:*",
        ...builtinModules.map((name) => "/" + name),
        "pg",
        "pg/*",
        "fastify",
        "pino",
      ],
    ]
  ),
  boundary(["apps/api/**/*.{ts,tsx}"], [["@anonlimit/db/action", "@anonlimit/crypto/holder"]]),
  boundary(["apps/worker/**/*.{ts,tsx}"], [["@anonlimit/db/action", "@anonlimit/crypto/*"]]),
  boundary(
    ["apps/action-simulator/**/*.{ts,tsx}"],
    [["@anonlimit/db/verifier", "@anonlimit/crypto/*"]]
  ),
  boundary(
    ["packages/domain/**/*.ts"],
    [
      [
        "@anonlimit/*",
        "node:*",
        "react",
        "react/*",
        "fastify",
        "pg",
        "drizzle-orm",
        "drizzle-orm/*",
      ],
    ]
  ),
  boundary(
    [
      "packages/config/src/client-env.ts",
      "packages/contracts/src/**/*.ts",
      "packages/crypto/src/holder/**/*.ts",
    ],
    [
      [
        "node:*",
        "@anonlimit/db/*",
        "@anonlimit/config/server",
        "@anonlimit/crypto/issuer*",
        "@anonlimit/crypto/verifier*",
        "@anonlimit/crypto/audit*",
        "@anonlimit/observability",
        ...builtinModules.map((name) => "/" + name),
      ],
    ]
  ),
  {
    files: ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.ts"],
    ignores: ["packages/config/src/server-env.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "Read environment variables through typed configuration.",
        },
      ],
    },
  }
);
