import assert from "node:assert/strict";
import test from "node:test";

import { reflow } from "./reflow-dialog.mjs";

test("reflows stale mid-sentence line breaks as soft whitespace", () => {
  const input = "[DEF]Thanks to you, my plan[N]should[N]go smoothly.[END]";
  const expected = "[DEF]Thanks to you, my plan[N]should go smoothly.[END]";

  assert.equal(reflow(input).text, expected);
});

test("repaginates stale mid-sentence page breaks", () => {
  const input = "[DEF]It reaches lands that[N]cannot[FIN]be reached on foot.[END]";
  const expected = "[DEF]It reaches lands that[N]cannot be reached on foot.[END]";

  assert.equal(reflow(input).text, expected);
});

test("retains deliberate sentence, speaker, and choice boundaries", () => {
  assert.equal(reflow("[DEF]Stop.[N]Go now.[END]").text, "[DEF]Stop.[N]Go now.[END]");
  assert.equal(
    reflow("[DEF][TPL:1]Hello.[FIN][TPL:2]Hi.[END]").text,
    "[DEF][TPL:1]Hello.[FIN][TPL:2]Hi.[END]",
  );
  assert.equal(reflow("[DEF]Choose.[N] Yes[N] No").text, "[DEF]Choose.[N] Yes[N] No");
});

test("preserves spacing around dynamic text and punctuation", () => {
  assert.equal(
    reflow("[CLR]This is[N][TBL:&string_list_01DB1F,0B80].[END]").text,
    "[CLR]This is [TBL:&string_list_01DB1F,0B80].[END]",
  );
  assert.equal(
    reflow("[CLR][TBL:&string_list_01E23C,0B80][N]cannot be discarded.[WAI]").text,
    "[CLR][TBL:&string_list_01E23C,0B80] cannot[N]be discarded.[WAI]",
  );
  assert.equal(reflow("[DEF]Wait[N]![END]").text, "[DEF]Wait![END]");
});

test("reflow output is idempotent", () => {
  const first = reflow("[DEF]Thanks to you, my plan[N]should[N]go smoothly.[END]").text;

  assert.equal(reflow(first).text, first);
});
