// Order links for special orders (TireConnect and other distributor portals).
// A link is a URL template with the size slots marked: {size} 225%2F65R17, {size_plain} 225/65R17, {raw} 2256517,
// {w} 225, {a} 65, {r} 17. Staff don't write templates: they paste the address bar from a portal search for
// 225/65R17 and exampleToTemplate() marks where the size went. A URL with no slots still works: the counter
// opens it and copies the size, so it's one paste into the portal's search box.

export const EXAMPLE = { w: 225, a: 65, r: 17 };
const SLOT = /\{(size|size_plain|raw|w|a|r)\}/;

/** Turns a pasted search address for 225/65R17 into a template. Returns the input unchanged if it has no 225/65/17. */
export function exampleToTemplate(url: string): string {
  let t = String(url || '').trim();
  if (!t || SLOT.test(t)) return t;
  t = t.replace(/225(%2F|%2f)65R17/g, '{size}').replace(/225\/65R17/g, '{size_plain}').replace(/(^|[^\d])2256517(?!\d)/g, '$1{raw}');
  // Separate fields: ?width=225&profile=65&rim=17, or path segments /225/65/17.
  // Only used when all three are found: a lone "17" could be anything, and half a size would order the wrong tire.
  const sep = t.replace(/([=\/:])225(?=[&\/#;]|$)/g, '$1{w}').replace(/([=\/:])65(?=[&\/#;]|$)/g, '$1{a}')
    .replace(/([=\/:])(R|r)?17(?=[&\/#;]|$)/g, '$1$2{r}');
  return ['{w}', '{a}', '{r}'].every(x => sep.includes(x)) ? sep : t;
}

export const hasSlots = (tpl: string) => SLOT.test(String(tpl || ''));

/** Fills a template for one size ({w, a, r, key}). */
export function fillTemplate(tpl: string, s: { w: number; a: number; r: number; key: string }): string {
  return String(tpl)
    .replace(/\{size\}/g, encodeURIComponent(s.key))
    .replace(/\{size_plain\}/g, s.key)
    .replace(/\{raw\}/g, `${s.w}${s.a}${s.r}`)
    .replace(/\{w\}/g, String(s.w)).replace(/\{a\}/g, String(s.a)).replace(/\{r\}/g, String(s.r));
}

export const isHttpUrl = (u: string) => /^https?:\/\/[^\s]+$/i.test(String(u || '').trim());
