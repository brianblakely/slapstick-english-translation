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

  assert.equal(
    reflow("[DEF]A huge light fell toward[N]the riverbank! It had to[N]be a UFO! I want to go see[FIN]it![END]").text,
    "[DEF]A huge light fell toward[N]the riverbank! It had to[N]be a UFO! I want to go see[N]it![END]",
  );
});

test("pulls a preceding line forward to avoid one- or two-word page widows", () => {
  const input = "[DF2]...and that is the[N]situation. We regret the[N]inconvenience, but[N]children's lives are at[FIN]stake.[END]";
  const expected = "[DF2]...and that is the[N]situation. We regret the[N]inconvenience, but[FIN]children's lives are at[N]stake.[END]";

  assert.equal(reflow(input).text, expected);
  assert.equal(reflow(expected).text, expected);

  assert.equal(
    reflow("[DF2][TPL:9]Perhaps you too will[N]become a fine inventor[N]like Dr.[FIN]Pepper.[END]").text,
    "[DF2][TPL:9]Perhaps you too will[N]become a fine inventor[N]like Dr. Pepper.[END]",
  );
});

test("removes unnecessary sentence newlines but retains structural boundaries", () => {
  assert.equal(reflow("[DEF]Stop.[N]Go now.[END]").text, "[DEF]Stop. Go now.[END]");
  assert.equal(reflow("[DEF]Stop.[FIN]Go now.[END]").text, "[DEF]Stop.[FIN]Go now.[END]");
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

test("reserves the five-character maximum player name width", () => {
  assert.equal(
    reflow("[DEF]12345678901234567890[N][NAM:0][END]").text,
    "[DEF]12345678901234567890 [NAM:0][END]",
  );
  assert.equal(
    reflow("[DEF]123456789012345678901[N][NAM:0][END]").text,
    "[DEF]123456789012345678901[N][NAM:0][END]",
  );
});

test("reflow output is idempotent", () => {
  const first = reflow("[DEF]Thanks to you, my plan[N]should[N]go smoothly.[END]").text;

  assert.equal(reflow(first).text, first);
});
