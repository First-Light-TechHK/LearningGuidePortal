import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const cssPlugin: Plugin = {
  name: "css-stub",
  setup(build) {
    build.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: "css-stub" }));
    build.onLoad({ filter: /.*/, namespace: "css-stub" }, () => ({
      contents: "export default new Proxy({}, { get: (_, prop) => String(prop) });",
      loader: "js",
    }));
  },
};

function signingStubPlugin(stub: boolean): Plugin {
  return {
    name: "signing-stub",
    setup(build) {
      if (!stub) return;
      const stubFile = path.join(root, "tests/unit/helpers/sign-course-media-stub.ts");
      build.onResolve({ filter: /\/persistence\/s3(\.ts)?$/ }, () => ({ path: stubFile }));
    },
  };
}

export async function loadPortalPage(entry: string, options: { stubSigning?: boolean } = {}) {
  const cacheDir = path.join(root, "node_modules/.cache/portal-bug-locks");
  await mkdir(cacheDir, { recursive: true });
  const outfile = path.join(cacheDir, `${entry.replace(/[^\w]+/g, "_")}${options.stubSigning ? "-stub" : ""}.mjs`);
  await build({
    absWorkingDir: root,
    entryPoints: [path.join(root, entry)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    packages: "external",
    logLevel: "silent",
    plugins: [signingStubPlugin(Boolean(options.stubSigning)), cssPlugin],
    alias: {
      "@": root,
      "next/headers": path.join(root, "tests/unit/helpers/next-headers-stub.ts"),
    },
  });
  return import(pathToFileURL(outfile).href) as Promise<{ default: (props: never) => Promise<unknown> }>;
}

export function textContent(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (typeof node === "object" && node && "props" in node) {
    return textContent((node as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

export function elementsByType(node: unknown, type: string, found: string[] = []): string[] {
  if (node == null || typeof node === "boolean") return found;
  if (Array.isArray(node)) {
    for (const child of node) elementsByType(child, type, found);
    return found;
  }
  if (typeof node === "object" && node && "props" in node) {
    const element = node as { type?: unknown; props?: { children?: unknown } };
    if (element.type === type) found.push(textContent(element.props?.children).trim());
    elementsByType(element.props?.children, type, found);
  }
  return found;
}

export function elementsByClass(node: unknown, className: string, found: unknown[] = []): unknown[] {
  if (node == null || typeof node === "boolean") return found;
  if (Array.isArray(node)) {
    for (const child of node) elementsByClass(child, className, found);
    return found;
  }
  if (typeof node === "object" && node && "props" in node) {
    const element = node as { props?: { className?: unknown; children?: unknown } };
    const classes = typeof element.props?.className === "string" ? element.props.className.split(/\s+/) : [];
    if (classes.includes(className)) found.push(node);
    elementsByClass(element.props?.children, className, found);
  }
  return found;
}

export function redirectDigest(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const digest = "digest" in error ? String((error as { digest?: unknown }).digest ?? "") : "";
  const message = error instanceof Error ? error.message : "";
  return `${digest} ${message}`;
}

const AWS_ENV = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_PROFILE",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_ROLE_ARN",
  "AWS_SDK_LOAD_CONFIG",
];

export function hideAwsCredentials() {
  for (const key of AWS_ENV) delete process.env[key];
  process.env.AWS_EC2_METADATA_DISABLED = "true";
  process.env.AWS_SHARED_CREDENTIALS_FILE = "/dev/null";
  process.env.AWS_CONFIG_FILE = "/dev/null";
  process.env.STORAGE_BACKEND = "local";
  process.env.APP_ENV = "test";
}

export const MIGRATED_COVER = "https://aitutor-data-851987565851.s3.ap-southeast-1.amazonaws.com/learning-guide/dev/documents/mvp/image/Horatius.jpg";
