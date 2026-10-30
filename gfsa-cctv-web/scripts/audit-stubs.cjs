// Lists interactive JSX that does nothing useful: buttons without handlers, dead links, toast-only handlers, always-disabled controls.
// Run from the project root: node scripts/audit-stubs.cjs [path-filter]
const ts = require(process.cwd() + '/node_modules/typescript');
const fs = require('fs'); const path = require('path');
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith('.tsx')) files.push(p); } })('src');
const out = { noHandler: [], toastOnly: [], deadLink: [], disabledAlways: [] };
const filter = process.argv[2];
for (const file of files.filter((f) => !filter || f.includes(filter))) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const text = (n) => n.getText().replace(/\s+/g, ' ').slice(0, 110);
  const visit = (n) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = n.tagName.getText();
      const attrs = {};
      for (const a of n.attributes.properties) if (ts.isJsxAttribute(a)) attrs[a.name.getText()] = a.initializer ? a.initializer.getText() : 'true';
      const spread = n.attributes.properties.some((a) => ts.isJsxSpreadAttribute(a));
      if (tag === 'button' && !spread && !attrs.onClick && !(attrs.type || '').includes('submit') && attrs.role !== '"tab"' && !attrs.onMouseDown && !attrs.onPointerDown) out.noHandler.push(`${file}:${line(n)}  ${text(n)}`);
      if (tag === 'a' && (!attrs.href || attrs.href === '"#"' || /#/.test(attrs.href || '') && !/tel:|mailto:/.test(attrs.href))) out.deadLink.push(`${file}:${line(n)}  ${text(n)}`);
      if (attrs.disabled === 'true' || attrs.disabled === '{true}') out.disabledAlways.push(`${file}:${line(n)}  ${text(n)}`);
      if (attrs.onClick) {
        const h = attrs.onClick;
        // handler body that only toasts and/or logs
        const body = h.replace(/^\{\s*\(\)\s*=>\s*\{?/, '').replace(/\}?\s*\}$/, '');
        const stmts = body.split(/;\s*/).map((s) => s.trim()).filter(Boolean);
        if (stmts.length && stmts.every((s) => /^(toast|log)\(/.test(s) || /^\{?\s*(toast|log)\(/.test(s) || s === '}')) out.toastOnly.push(`${file}:${line(n)}  ${tag} ${h.replace(/\s+/g, ' ').slice(0, 140)}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
for (const [k, v] of Object.entries(out)) { console.log(`\n=== ${k} (${v.length})`); v.forEach((x) => console.log(x)); }
