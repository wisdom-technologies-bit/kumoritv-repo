import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { test } from "node:test";
import * as ts from "typescript";
import { getAnimeWithEpisodesFromClient } from "../anime-db/queries";
import { getWatchEpisodeResult } from "../watch/episode-data";

const frontendRoot = process.cwd();
const sourceExtensions = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const skippedDirectories = new Set([".git", ".next", ".turbo", ".vercel", "coverage", "dist", "node_modules"]);

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      if (skippedDirectories.has(entry.name)) return [];
      return collectSourceFiles(resolve(directory, entry.name));
    }

    return sourceExtensions.has(extname(entry.name))
      ? [resolve(directory, entry.name)]
      : [];
  });
}

function parseSourceFile(filePath: string) {
  const extension = extname(filePath);
  const scriptKind = extension === ".tsx" || extension === ".jsx"
    ? ts.ScriptKind.TSX
    : extension === ".js" || extension === ".mjs" || extension === ".cjs"
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind) {
  return ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false);
}

function isPromiseReturning(node: ts.SignatureDeclaration, sourceFile: ts.SourceFile) {
  const returnType = node.type?.getText(sourceFile) ?? "";
  return hasModifier(node, ts.SyntaxKind.AsyncKeyword) ||
    /\b(?:Promise|PromiseLike)\s*</.test(returnType);
}

function getExportedPromiseFunctions(sourceFile: ts.SourceFile) {
  const names = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword) &&
      isPromiseReturning(statement, sourceFile)) {
      names.add(statement.name.text);
    }

    if (!ts.isVariableStatement(statement) ||
      !hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;

    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (!initializer || !ts.isIdentifier(declaration.name)) continue;
      if ((ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) &&
        isPromiseReturning(initializer, sourceFile)) {
        names.add(declaration.name.text);
      }
    }
  }

  return names;
}

function resolveLocalModule(importerPath: string, moduleName: string) {
  const basePath = moduleName.startsWith("@/")
    ? resolve(frontendRoot, moduleName.slice(2))
    : moduleName.startsWith(".")
      ? resolve(dirname(importerPath), moduleName)
      : null;
  if (!basePath) return null;

  const candidates = [
    basePath,
    ...[".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"].map((extension) => `${basePath}${extension}`),
    ...[".ts", ".tsx", ".js", ".jsx"].map((extension) => resolve(basePath, `index${extension}`)),
  ];

  return candidates.find((candidate) =>
    existsSync(candidate) && statSync(candidate).isFile(),
  ) ?? null;
}

function isAwaited(call: ts.CallExpression) {
  let parent = call.parent;
  while (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isTypeAssertionExpression(parent) ||
    ts.isNonNullExpression(parent) ||
    ts.isSatisfiesExpression(parent)
  ) {
    parent = parent.parent;
  }
  return ts.isAwaitExpression(parent);
}

function findUnawaitedSupabaseHelpers() {
  const helperRoot = resolve(frontendRoot, "app/lib/supabase");
  const helperFiles = collectSourceFiles(helperRoot).filter((file) => !file.endsWith(".test.ts"));
  const asyncHelpers = new Map<string, Set<string>>();

  for (const helperFile of helperFiles) {
    const sourceFile = parseSourceFile(helperFile);
    const exports = getExportedPromiseFunctions(sourceFile);
    if (exports.size) asyncHelpers.set(helperFile, exports);
  }

  const violations: string[] = [];
  for (const filePath of collectSourceFiles(frontendRoot).filter((file) => !file.endsWith(".test.ts"))) {
    const sourceFile = parseSourceFile(filePath);
    const awaitedBindings = new Map<string, string>();

    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const resolvedModule = resolveLocalModule(filePath, statement.moduleSpecifier.text);
      const helperExports = resolvedModule ? asyncHelpers.get(resolvedModule) : undefined;
      if (!helperExports || !statement.importClause?.namedBindings ||
        !ts.isNamedImports(statement.importClause.namedBindings)) continue;

      for (const element of statement.importClause.namedBindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text;
        if (helperExports.has(importedName)) {
          awaitedBindings.set(element.name.text, importedName);
        }
      }
    }

    const localHelpers = asyncHelpers.get(filePath);
    localHelpers?.forEach((name) => awaitedBindings.set(name, name));
    if (!awaitedBindings.size) continue;

    const inspect = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const helperName = awaitedBindings.get(node.expression.text);
        if (helperName && !isAwaited(node)) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          violations.push(`${filePath}:${line} calls ${helperName} without await`);
        }
      }
      ts.forEachChild(node, inspect);
    };
    inspect(sourceFile);
  }

  return violations;
}

function createMockSupabaseClient(responses: Record<string, unknown>) {
  const calls: Array<{ method: string; table?: string; column?: string; value?: unknown }> = [];

  return {
    calls,
    client: {
      from(table: string) {
        calls.push({ method: "from", table });
        const query = {
          select() {
            calls.push({ method: "select", table });
            return query;
          },
          eq(column: string, value: unknown) {
            calls.push({ method: "eq", table, column, value });
            return query;
          },
          order(column: string) {
            calls.push({ method: "order", table, column });
            return Promise.resolve({ data: responses[table], error: null });
          },
          maybeSingle() {
            calls.push({ method: "maybeSingle", table });
            return Promise.resolve({ data: responses[table], error: null });
          },
        };
        return query;
      },
    },
  };
}

test("media episode data path queries through a Supabase client", async () => {
  const anime = { anilist_id: 21, title: "Example anime" };
  const episodes = [{ play_id: "21-1", episode_number: 1 }];
  const { client, calls } = createMockSupabaseClient({ anime, episodes });

  const result = await getAnimeWithEpisodesFromClient(client, 21);

  assert.deepEqual(result, { anime, episodes });
  assert.deepEqual(calls.filter((call) => call.method === "from").map((call) => call.table), [
    "anime",
    "episodes",
  ]);
});

test("watch API episode lookup queries through a Supabase client", async () => {
  const episode = { play_id: "21-1", episode_number: 1 };
  const { client, calls } = createMockSupabaseClient({ episodes: episode });

  const result = await getWatchEpisodeResult(client, "21", "1");

  assert.deepEqual(result, { data: episode, error: null });
  assert.deepEqual(calls.filter((call) => call.method === "from").map((call) => call.table), [
    "episodes",
  ]);
});

test("async Supabase helper calls are awaited across the frontend", () => {
  assert.deepEqual(findUnawaitedSupabaseHelpers(), []);
});
