// @vitest-environment node
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { flowPages, summary } from "./render-pdf.ts";

/** A small PDF as Chromium writes one: plain objects, and more of them packed in a deflated object stream. */
function pdf(): Buffer {
  const packed = ["10 0", "11 0"];
  const bodies = ["<< /Title (Core) /Parent 9 0 R /Dest [4 0 R /XYZ 0 0 0] >>", "<< /Title <FEFF0049> /Parent 10 0 R /Dest [5 0 R /XYZ 0 0 0] >>"];
  let offsets = "";
  let data = "";
  bodies.forEach((b, i) => {
    offsets += `${packed[i]?.split(" ")[0]} ${data.length} `;
    data += `${b}\n`;
  });
  const stream = deflateSync(Buffer.from(offsets + data, "latin1"));
  const head = [
    "%PDF-1.7",
    "1 0 obj << /Type /Catalog /Pages 2 0 R /Outlines 9 0 R /Dests 6 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R >> endobj",
    "4 0 obj << /Type /Page /Parent 2 0 R >> endobj",
    "5 0 obj << /Type /Page /Parent 2 0 R >> endobj",
    "6 0 obj << /flow-ID-01 [4 0 R /XYZ 0 0 0] /flow-APP-12 7 0 R >> endobj",
    "7 0 obj [5 0 R /XYZ 0 0 0] endobj",
    "9 0 obj << /Type /Outlines /First 10 0 R /Count 2 >> endobj",
    `12 0 obj << /Type /ObjStm /N 2 /First ${offsets.length} /Filter /FlateDecode /Length ${stream.length} >>\nstream\n`,
  ].join("\n");
  return Buffer.concat([Buffer.from(head, "latin1"), stream, Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1")]);
}

describe("reading a rendered PDF", () => {
  it("counts its pages and its bookmarks, packed or not", () => {
    expect(summary(pdf())).toEqual({ pages: 3, bookmarks: 2 });
  });

  it("finds the page each flow's anchor landed on", () => {
    expect(flowPages(pdf())).toEqual({ "ID-01": 2, "APP-12": 3 });
  });
});
