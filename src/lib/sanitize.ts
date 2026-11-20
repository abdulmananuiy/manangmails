// HTML sanitization for message bodies (guide sections 8 & 15).
// Scripts, event handlers, forms, iframes and remote images are removed so a
// malicious email can never execute code or phone home when viewed.
import sanitizeHtml from "sanitize-html";

export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "div", "span", "a", "b", "strong", "i", "em", "u",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "ul", "ol", "li", "blockquote", "pre", "code",
      "table", "thead", "tbody", "tr", "th", "td",
      "hr", "small", "sub", "sup",
    ],
    allowedAttributes: {
      a: ["href", "title"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {},
    // No <img> at all: remote images must never auto-load (tracking pixels).
    // No <form>, <iframe>, <object>, <embed>, <script>, <style>, <link>.
    disallowedTagsMode: "discard",
    // Strip any attribute starting with "on" (event handlers) — sanitize-html
    // already drops non-allowed attributes, this is defence in depth.
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          rel: "noopener noreferrer nofollow",
          target: "_blank",
        },
      }),
    },
  });
}

/** Plain-text fallback: strip all tags and collapse whitespace. */
export function htmlToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [] })
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
