// Wraps every Arabic string in the UI's source with t(...) at build time, so screens stay written in
// Arabic (the app's first language) and English lives in one dictionary: src/i18n/en.json.
//
// `node i18n-plugin.ts --check` (via `pnpm i18n:check`) lists strings that have no English yet.

import { parse } from "@babel/parser";
import _traverse, { type NodePath } from "@babel/traverse";
import _generate from "@babel/generator";
import * as T from "@babel/types";
import type { Plugin } from "vite";

const traverse = ((_traverse as unknown as { default?: typeof _traverse }).default ?? _traverse) as typeof _traverse;
const generate = ((_generate as unknown as { default?: typeof _generate }).default ?? _generate) as typeof _generate;

const ARABIC = /[؀-ۿ]/;

function call(s: string): T.CallExpression {
  return T.callExpression(T.identifier("__t"), [T.stringLiteral(s)]);
}

/** Attributes whose value is never shown as text. */
const SKIP_ATTRS = new Set(["id", "key", "className", "href", "role", "dir", "lang"]);

/** Rewrites source. `seen` collects each piece of text found. */
export function transform(code: string, id: string, seen?: Set<string>): string | null {
  if (!ARABIC.test(code)) return null;
  const ast = parse(code, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const add = (s: string) => seen?.add(s.trim());
  let touched = false;

  traverse(ast, {
    JSXText(p: NodePath<T.JSXText>) {
      const v = p.node.value;
      if (!ARABIC.test(v)) return;
      // JSX folds line breaks and the spaces around them; keep real spaces at the ends of a line.
      const folded = v.replace(/\s*\n\s*/g, " ");
      const text = /\n/.test(v) ? folded.replace(/^ /, /^\s*\n/.test(v) ? "" : " ").replace(/ $/, /\n\s*$/.test(v) ? "" : " ") : folded;
      add(text);
      p.replaceWith(T.jsxExpressionContainer(call(text)));
      touched = true;
      p.skip();
    },
    StringLiteral(p: NodePath<T.StringLiteral>) {
      const v = p.node.value;
      if (!ARABIC.test(v)) return;
      const parent = p.parent;
      if (T.isCallExpression(parent) && T.isIdentifier(parent.callee) && (parent.callee.name === "__t" || parent.callee.name === "t")) {
        add(v);
        return;
      }
      if (T.isJSXAttribute(parent)) {
        if (T.isJSXIdentifier(parent.name) && SKIP_ATTRS.has(parent.name.name)) return;
        add(v);
        p.replaceWith(T.jsxExpressionContainer(call(v)));
        touched = true;
        p.skip();
        return;
      }
      // A word the user types to confirm stays what it is, in comparisons.
      if (T.isBinaryExpression(parent)) return;
      if (T.isObjectProperty(parent) && parent.key === p.node) return;
      if (T.isTSLiteralType(parent)) return;
      add(v);
      p.replaceWith(call(v));
      touched = true;
      p.skip();
    },
    TemplateLiteral(p: NodePath<T.TemplateLiteral>) {
      if (T.isTaggedTemplateExpression(p.parent)) return;
      const { quasis, expressions } = p.node;
      if (!quasis.some((q) => ARABIC.test(q.value.cooked ?? ""))) return;
      const parts: T.Expression[] = [];
      quasis.forEach((q, i) => {
        const text = q.value.cooked ?? "";
        if (text) {
          if (ARABIC.test(text)) add(text);
          parts.push(ARABIC.test(text) ? call(text) : T.stringLiteral(text));
        }
        const e = expressions[i];
        if (e) parts.push(T.callExpression(T.identifier("String"), [e as T.Expression]));
      });
      const joined = parts.reduce((a, b) => T.binaryExpression("+", a, b));
      p.replaceWith(T.parenthesizedExpression(joined));
      touched = true;
      p.skip();
    },
  });

  if (!touched) return null;
  const out = generate(ast, { retainLines: true, sourceFileName: id }, code);
  return `import { t as __t } from "/src/i18n/index.ts";\n${out.code}`;
}

export function i18nPlugin(): Plugin {
  return {
    name: "jard-i18n",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0]!;
      if (!/\/src\/.*\.(tsx|ts)$/.test(file.replace(/\\/g, "/")) || /\/src\/i18n\//.test(file.replace(/\\/g, "/"))) return null;
      const out = transform(code, file);
      return out ? { code: out, map: null } : null;
    },
  };
}
