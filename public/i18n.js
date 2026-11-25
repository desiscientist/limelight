// Interface text helper. The site is English-only; t() fills in {placeholders}.
function t(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
}
