import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { classifyImageError, formatClassifiedError } from './image-error.ts'

Deno.test('provider_5xx: extracts the raw status code from the existing message shape', () => {
  const c = classifyImageError(new Error('OpenAI API error 429: {"error":{"message":"Rate limit"}}'))
  assertEquals(c.class, 'provider_5xx')
  assertEquals(c.statusCode, 429)
  assertEquals(formatClassifiedError(c), '[provider_5xx:429] OpenAI API error 429: {"error":{"message":"Rate limit"}}')
})

Deno.test('provider_5xx: Gemini errors classify the same way', () => {
  const c = classifyImageError(new Error('Gemini API error 503: Service unavailable'))
  assertEquals(c.class, 'provider_5xx')
  assertEquals(c.statusCode, 503)
})

Deno.test('provider_timeout: the exact live TEST message ("Signal timed out.") classifies correctly', () => {
  const c = classifyImageError(new Error('Signal timed out.'))
  assertEquals(c.class, 'provider_timeout')
  assertEquals(c.statusCode, undefined)
  assertEquals(formatClassifiedError(c), '[provider_timeout] Signal timed out.')
})

Deno.test('provider_timeout: an AbortSignal-style "aborted" message also classifies as timeout', () => {
  const c = classifyImageError(new Error('The signal has been aborted'))
  assertEquals(c.class, 'provider_timeout')
})

Deno.test('unknown: everything else, e.g. a storage upload failure', () => {
  const c = classifyImageError(new Error('Storage upload failed: bucket not found'))
  assertEquals(c.class, 'unknown')
  assertEquals(formatClassifiedError(c), '[unknown] Storage upload failed: bucket not found')
})

Deno.test('unknown: a non-Error thrown value still classifies without throwing', () => {
  const c = classifyImageError('plain string failure')
  assertEquals(c.class, 'unknown')
  assertEquals(c.message, 'plain string failure')
})

Deno.test('wall_clock and reaper are never produced by the classifier — reaper-SQL-only', () => {
  const classes = new Set(
    [
      'OpenAI API error 500: x', 'Gemini API error 502: x', 'Signal timed out.',
      'aborted', 'Storage upload failed: x', 'review budget reached', '',
    ].map((m) => classifyImageError(new Error(m)).class),
  )
  assertEquals(classes.has('wall_clock'), false)
  assertEquals(classes.has('reaper'), false)
})
