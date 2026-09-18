import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { prioritizeConstraints } from './image-prompt-order.ts'

const nineSection = [
  'SECTION 1: SCENE NARRATIVE',
  'A premium graphic composition.',
  '',
  'SECTION 6: TYPOGRAPHY LAYER',
  'Headline in Bebas Neue.',
  '',
  'SECTION 7: BRAND & PROJECT ELEMENTS',
  'Colours #6A1B9A and #F9A825. Logo space top-left, left clean.',
  '',
  'SECTION 8: NEGATIVE PROMPTS',
  'DO NOT invent colours.',
  '',
  'SECTION 9: TECHNICAL SPECS',
  'Aspect Ratio: 1:1',
].join('\n')

Deno.test('constraints (7-9) move ahead of prose (1-6)', () => {
  const out = prioritizeConstraints(nineSection)
  assert(out.search(/^SECTION 7:/m) < out.search(/^SECTION 1:/m), 'section 7 must precede section 1')
  assert(out.search(/^SECTION 9:/m) < out.search(/^SECTION 1:/m), 'section 9 must precede section 1')
  for (const marker of ['SCENE NARRATIVE', 'TYPOGRAPHY LAYER', '#6A1B9A', 'DO NOT invent colours', 'Aspect Ratio: 1:1']) {
    assert(out.includes(marker), `lost content: ${marker}`)
  }
})

Deno.test('a truncating cut now keeps the constraints, not the prose', () => {
  const bulky = nineSection.replace('A premium graphic composition.', 'x'.repeat(500))
  const cut = prioritizeConstraints(bulky).slice(0, 200)
  assert(cut.includes('#6A1B9A'), 'brand colours must survive the cut')
  assert(!cut.includes('xxxx'), 'prose must be what gets cut')
})

Deno.test('hero preamble stays at the very front', () => {
  const withPreamble = 'HERO EDIT: keep the attached photo.\nDo not add logos.\n\n' + nineSection
  const out = prioritizeConstraints(withPreamble)
  assert(out.startsWith('HERO EDIT: keep the attached photo.'), out.slice(0, 60))
  assert(out.indexOf('Do not add logos.') < out.search(/^SECTION 7:/m))
})

Deno.test('idempotent', () => {
  const once = prioritizeConstraints(nineSection)
  assertEquals(prioritizeConstraints(once), once)
})

Deno.test('no-op on prompts that are not nine-section shaped', () => {
  const smm = 'Create a 1080x1080 luxury festive post. EXACT COLOUR PALETTE: #1A1033.'
  assertEquals(prioritizeConstraints(smm), smm)
  const partial = 'SECTION 1: SCENE NARRATIVE\nOnly prose here.'
  assertEquals(prioritizeConstraints(partial), partial)
})
