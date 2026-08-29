import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";

const repo = process.cwd();
const golden = join(repo, ".golden");
const web = join(repo, "apps/web");
const src = join(web, "src");

if (!existsSync(join(golden, "src/app/page.tsx"))) {
  throw new Error("Golden-master checkout is missing src/app/page.tsx");
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function copyDir(from, to) {
  rmSync(to, { recursive: true, force: true });
  ensureDir(dirname(to));
  cpSync(from, to, { recursive: true });
}

function listCodeFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) out.push(...listCodeFiles(path));
    else if ([".ts", ".tsx", ".js", ".jsx"].includes(extname(path))) out.push(path);
  }
  return out;
}

function copyGoldenLibClosure() {
  const libSource = join(golden, "src/lib");
  const libTarget = join(src, "lib");
  rmSync(libTarget, { recursive: true, force: true });
  ensureDir(libTarget);

  const roots = [
    join(src, "BoardOpsApp.tsx"),
    join(src, "components"),
    join(src, "hooks"),
    join(src, "providers"),
    join(src, "stores"),
  ];
  const pending = new Set(["api-client", "utils"]);
  const scanned = new Set();

  const scanFile = (file) => {
    if (!existsSync(file) || scanned.has(file)) return;
    scanned.add(file);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/@\/lib\/([A-Za-z0-9_./-]+)/g)) {
      pending.add(match[1]);
    }
  };

  for (const root of roots) {
    if (!existsSync(root)) continue;
    if (statSync(root).isDirectory()) listCodeFiles(root).forEach(scanFile);
    else scanFile(root);
  }

  let copied = true;
  while (copied) {
    copied = false;
    for (const spec of [...pending]) {
      if (scanned.has(`lib:${spec}`)) continue;
      scanned.add(`lib:${spec}`);
      const candidates = [
        join(libSource, `${spec}.ts`),
        join(libSource, `${spec}.tsx`),
        join(libSource, spec, "index.ts"),
        join(libSource, spec, "index.tsx"),
      ];
      const from = candidates.find(existsSync);
      if (!from) continue;
      const rel = relative(libSource, from);
      const to = join(libTarget, rel);
      ensureDir(dirname(to));
      cpSync(from, to);
      scanFile(to);
      copied = true;
    }
  }
}

// Copy the audited client-side golden master without touching its repository.
for (const dir of ["components", "hooks", "providers", "stores"]) {
  copyDir(join(golden, "src", dir), join(src, dir));
}

copyDir(join(golden, "public"), join(web, "public"));

let page = readFileSync(join(golden, "src/app/page.tsx"), "utf8");
page = page.replace("export default function Page()", "export default function BoardOpsApp()");
writeFileSync(join(src, "BoardOpsApp.tsx"), page);

ensureDir(join(src, "styles"));
cpSync(join(golden, "src/app/globals.css"), join(src, "styles/golden.css"));
copyGoldenLibClosure();

// Replace Next-only browser helpers with small Vite compatibility adapters.
for (const file of listCodeFiles(src)) {
  let text = readFileSync(file, "utf8");
  text = text
    .replaceAll('from "next/link"', 'from "@/compat/next-link"')
    .replaceAll("from 'next/link'", "from '@/compat/next-link'")
    .replaceAll('from "next/navigation"', 'from "@/compat/next-navigation"')
    .replaceAll("from 'next/navigation'", "from '@/compat/next-navigation'")
    .replaceAll('from "next/image"', 'from "@/compat/next-image"')
    .replaceAll("from 'next/image'", "from '@/compat/next-image'")
    .replaceAll('from "next/dynamic"', 'from "@/compat/next-dynamic"')
    .replaceAll("from 'next/dynamic'", "from '@/compat/next-dynamic'");
  writeFileSync(file, text);
}

ensureDir(join(src, "compat"));
writeFileSync(join(src, "compat/next-link.tsx"), `import type { AnchorHTMLAttributes, ReactNode } from "react";\n\ntype Href = string | { pathname?: string; query?: Record<string, string | number | boolean | undefined> };\n\nfunction hrefToString(href: Href) {\n  if (typeof href === "string") return href;\n  const pathname = href.pathname ?? "/";\n  const qs = new URLSearchParams();\n  for (const [key, value] of Object.entries(href.query ?? {})) {\n    if (value !== undefined) qs.set(key, String(value));\n  }\n  const query = qs.toString();\n  return query ? pathname + "?" + query : pathname;\n}\n\nexport default function Link({ href, children, ...props }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: Href; children?: ReactNode }) {\n  return <a href={hrefToString(href)} {...props}>{children}</a>;\n}\n`);

writeFileSync(join(src, "compat/next-navigation.ts"), `import { useMemo } from "react";\n\nexport function useRouter() {\n  return useMemo(() => ({\n    push: (href: string) => { window.location.href = href; },\n    replace: (href: string) => { window.location.replace(href); },\n    back: () => window.history.back(),\n    forward: () => window.history.forward(),\n    refresh: () => window.location.reload(),\n    prefetch: async (_href: string) => undefined,\n  }), []);\n}\n\nexport function usePathname() { return window.location.pathname; }\nexport function useSearchParams() { return new URLSearchParams(window.location.search); }\nexport function redirect(href: string): never { window.location.replace(href); throw new Error("Redirecting to " + href); }\n`);

writeFileSync(join(src, "compat/next-image.tsx"), `import type { CSSProperties, ImgHTMLAttributes } from "react";\n\ntype Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {\n  src: string | { src: string };\n  fill?: boolean;\n  priority?: boolean;\n  quality?: number;\n};\n\nexport default function Image({ src, fill, priority, quality: _quality, style, ...props }: Props) {\n  const mergedStyle: CSSProperties = fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", ...style } : (style ?? {});\n  return <img src={typeof src === "string" ? src : src.src} loading={priority ? "eager" : props.loading} style={mergedStyle} {...props} />;\n}\n`);

writeFileSync(join(src, "compat/next-dynamic.tsx"), `import { lazy, Suspense, type ComponentType } from "react";\n\ntype Loader<P> = () => Promise<{ default: ComponentType<P> } | ComponentType<P>>;\n\nexport default function dynamic<P extends object>(loader: Loader<P>, options?: { loading?: ComponentType; ssr?: boolean }) {\n  const Lazy = lazy(async () => {\n    const mod = await loader();\n    return typeof mod === "function" ? { default: mod } : mod;\n  });\n  const Loading = options?.loading;\n  return function DynamicComponent(props: P) {\n    return <Suspense fallback={Loading ? <Loading /> : null}><Lazy {...props} /></Suspense>;\n  };\n}\n`);

writeFileSync(join(src, "main.tsx"), `import { createRoot } from "react-dom/client";\nimport "./styles/golden.css";\nimport BoardOpsApp from "./BoardOpsApp";\nimport { Toaster } from "@/components/ui/toaster";\nimport { Toaster as SonnerToaster } from "@/components/ui/sonner";\nimport { ThemeProvider } from "@/providers/theme-provider";\nimport { QueryProvider } from "@/providers/query-provider";\nimport { ThemeConfigProvider } from "@/providers/theme-config-provider";\n\nconst root = document.getElementById("root");\nif (!root) throw new Error("Missing #root element");\n\ncreateRoot(root).render(\n  <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange={false}>\n    <QueryProvider>\n      <ThemeConfigProvider>\n        <BoardOpsApp />\n        <Toaster />\n        <SonnerToaster position="top-center" />\n      </ThemeConfigProvider>\n    </QueryProvider>\n  </ThemeProvider>,\n);\n`);

writeFileSync(join(src, "vite-env.d.ts"), `/// <reference types="vite/client" />\n\ndeclare const process: { env: Record<string, string | undefined> };\n`);

writeFileSync(join(web, "vite.config.ts"), `import { fileURLToPath, URL } from "node:url";\nimport { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\nimport tailwindcss from "@tailwindcss/vite";\n\nexport default defineConfig({\n  plugins: [react(), tailwindcss()],\n  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },\n  define: { "process.env": {} },\n  server: {\n    port: 5173,\n    strictPort: true,\n    host: "127.0.0.1",\n    proxy: { "/api": "http://127.0.0.1:8787" },\n  },\n});\n`);

writeFileSync(join(web, "index.html"), `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />\n    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#f5f3ff" />\n    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a0a0f" />\n    <meta name="description" content="BoardOps — Configurable Operations Platform" />\n    <link rel="icon" href="/logo.svg" />\n    <link rel="manifest" href="/manifest.json" />\n    <title>BoardOps — Configurable Operations Platform</title>\n  </head>\n  <body class="bg-background text-foreground">\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n`);

const packageJson = JSON.parse(readFileSync(join(web, "package.json"), "utf8"));
packageJson.dependencies = {
  ...packageJson.dependencies,
  "@dnd-kit/core": "6.3.1",
  "@dnd-kit/sortable": "10.0.0",
  "@dnd-kit/utilities": "3.2.2",
  "@hookform/resolvers": "5.2.2",
  "@mdxeditor/editor": "3.39.1",
  "@radix-ui/react-accordion": "1.2.11",
  "@radix-ui/react-alert-dialog": "1.1.14",
  "@radix-ui/react-aspect-ratio": "1.1.7",
  "@radix-ui/react-avatar": "1.1.10",
  "@radix-ui/react-checkbox": "1.3.2",
  "@radix-ui/react-collapsible": "1.1.11",
  "@radix-ui/react-context-menu": "2.2.15",
  "@radix-ui/react-dialog": "1.1.14",
  "@radix-ui/react-dropdown-menu": "2.1.15",
  "@radix-ui/react-hover-card": "1.1.14",
  "@radix-ui/react-label": "2.1.7",
  "@radix-ui/react-menubar": "1.1.15",
  "@radix-ui/react-navigation-menu": "1.2.13",
  "@radix-ui/react-popover": "1.1.14",
  "@radix-ui/react-progress": "1.1.7",
  "@radix-ui/react-radio-group": "1.3.7",
  "@radix-ui/react-scroll-area": "1.2.9",
  "@radix-ui/react-select": "2.2.5",
  "@radix-ui/react-separator": "1.1.7",
  "@radix-ui/react-slider": "1.3.5",
  "@radix-ui/react-slot": "1.2.3",
  "@radix-ui/react-switch": "1.2.5",
  "@radix-ui/react-tabs": "1.1.12",
  "@radix-ui/react-toast": "1.2.14",
  "@radix-ui/react-toggle": "1.1.9",
  "@radix-ui/react-toggle-group": "1.1.10",
  "@radix-ui/react-tooltip": "1.2.7",
  "@reactuses/core": "6.0.5",
  "@tanstack/react-table": "8.21.3",
  "class-variance-authority": "0.7.1",
  "clsx": "2.1.1",
  "cmdk": "1.1.1",
  "date-fns": "4.1.0",
  "embla-carousel-react": "8.6.0",
  "framer-motion": "12.23.2",
  "input-otp": "1.4.2",
  "next-themes": "0.4.6",
  "qrcode": "1.5.4",
  "react-day-picker": "9.8.0",
  "react-markdown": "10.1.0",
  "react-resizable-panels": "3.0.3",
  "react-syntax-highlighter": "15.6.1",
  "recharts": "2.15.4",
  "tailwind-merge": "3.3.1",
  "tw-animate-css": "1.3.5",
  "uuid": "11.1.0",
  "vaul": "1.1.2"
};
packageJson.devDependencies = {
  ...packageJson.devDependencies,
  "@types/node": "24.10.0",
  "@types/qrcode": "1.5.6",
  "@types/react-syntax-highlighter": "15.5.13"
};
writeFileSync(join(web, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);

// Preserve strict mode while relaxing only two source-incompatible optional/index flags during the visual port.
const tsconfig = JSON.parse(readFileSync(join(web, "tsconfig.json"), "utf8"));
tsconfig.compilerOptions = {
  ...tsconfig.compilerOptions,
  baseUrl: ".",
  paths: { "@/*": ["src/*"] },
  exactOptionalPropertyTypes: false,
  noUncheckedIndexedAccess: false,
  verbatimModuleSyntax: false,
};
writeFileSync(join(web, "tsconfig.json"), `${JSON.stringify(tsconfig, null, 2)}\n`);

const unknownNext = [];
for (const file of listCodeFiles(src)) {
  const text = readFileSync(file, "utf8");
  if (/from ["']next\//.test(text)) unknownNext.push(relative(src, file));
}
if (unknownNext.length) {
  console.warn("Unadapted Next imports remain in:", unknownNext.join(", "));
}

console.log("Phase 02 client port staged from audited golden master.");
