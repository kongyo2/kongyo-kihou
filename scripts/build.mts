/**
 * 拡張の束ね。
 *
 * VS Code の拡張ホストは `main` を CommonJS として読む。ソースは ESM で書き、
 * ここで CJS へ落とす（tsconfig スキル §6 の「Author ESM, ship CJS」）。
 * tsc は型検査だけを担い、JS は一切出さない。
 */

import { build, context, type BuildOptions } from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const options: BuildOptions = {
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  format: "cjs",
  platform: "node",
  // 下限ランタイム：VS Code 1.96 の拡張ホスト。
  target: "node20",
  // 拡張ホストが自前で解決する唯一のモジュール。束ねてはならない。
  external: ["vscode"],
  sourcemap: production ? false : "linked",
  minify: production,
  treeShaking: true,
  logLevel: "info",
  legalComments: "none",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("[kongyo] watching src/**");
} else {
  await build(options);
  console.log(`[kongyo] built dist/extension.js (${production ? "production" : "development"})`);
}
