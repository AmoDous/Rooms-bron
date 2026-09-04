import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const openApiPath = fileURLToPath(new URL("../../docs/openapi.yaml", import.meta.url));
const source = await readFile(openApiPath, "utf8");
const document = parseDocument(source, { prettyErrors: true, strict: true });
if (document.errors.length) {
  throw new Error(`OpenAPI YAML is invalid:\n${document.errors.map((error) => error.message).join("\n")}`);
}
const contract = document.toJS() as Record<string, unknown>;
if (typeof contract.openapi !== "string" || !contract.openapi.startsWith("3.1.")) {
  throw new Error("OpenAPI contract must use version 3.1.x.");
}

function resolvePointer(pointer: string): unknown {
  return pointer.slice(2).split("/").reduce<unknown>((current, token) => {
    if (!current || typeof current !== "object") return undefined;
    const key = token.replace(/~1/gu, "/").replace(/~0/gu, "~");
    return (current as Record<string, unknown>)[key];
  }, contract);
}

const references = new Set<string>();
const operationIds = new Set<string>();
const duplicateOperationIds = new Set<string>();
function inspect(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(inspect);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "$ref" && typeof item === "string" && item.startsWith("#/")) references.add(item);
    if (key === "operationId" && typeof item === "string") {
      if (operationIds.has(item)) duplicateOperationIds.add(item);
      operationIds.add(item);
    }
    inspect(item);
  }
}
inspect(contract);
const unresolved = [...references].filter((reference) => resolvePointer(reference) === undefined);
if (unresolved.length) throw new Error(`Unresolved OpenAPI references:\n${unresolved.join("\n")}`);
if (duplicateOperationIds.size) throw new Error(`Duplicate operationId values:\n${[...duplicateOperationIds].join("\n")}`);
const paths = contract.paths as Record<string, unknown> | undefined;
if (!paths || Object.keys(paths).some((path) => !path.startsWith("/"))) throw new Error("OpenAPI paths must start with /.");

console.log(`OpenAPI ${String((contract.info as Record<string, unknown> | undefined)?.version ?? "unknown")}: ${Object.keys(paths).length} paths, ${operationIds.size} operations, ${references.size} local references.`);
