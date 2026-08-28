/**
 * Credential-free. These are the tests that matter most in this feature: the
 * allowlist is the only thing standing between a test deployment and a
 * customer's Facebook Page, and it has to be provably fail-closed rather than
 * fail-closed-looking.
 *
 * The terminal-row test is the bug #47 guard: a wrong column name on
 * .insert() does not throw and does not fail `deno check`, so the row's key
 * set is asserted against the actual published_assets columns here, where it
 * costs nothing, instead of being discovered later as an empty table.
 */
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  parseAllowlist,
  checkPublishTarget,
  validatePublishInput,
  buildFacebookPayload,
  buildInstagramContainerPayload,
  facebookPermalink,
  buildPublishedAssetRow,
  resolveDeploymentMode,
  resolvePublishMode,
  withDraftFlag,
  resolvePageToken,
} from './meta-publish.ts'

const TEST_PAGE = '111111111111111'
const CUSTOMER_PAGE = '1189217514471176' // a real customer Page this token reaches — must never be reachable

Deno.test('parseAllowlist: trims, drops blanks, tolerates trailing commas', () => {
  assertEquals(parseAllowlist(' 123 , 456 ,'), ['123', '456'])
  assertEquals(parseAllowlist(''), [])
  assertEquals(parseAllowlist(undefined), [])
  assertEquals(parseAllowlist(null), [])
  assertEquals(parseAllowlist('   '), [])
})

Deno.test('FAIL-CLOSED: an unset allowlist refuses every publish, even a correctly configured org', () => {
  for (const raw of [undefined, null, '', '  ', ',,']) {
    const res = checkPublishTarget(TEST_PAGE, raw)
    assertEquals(res.ok, false)
    if (!res.ok) assertEquals(res.reason, 'unconfigured')
  }
})

Deno.test('the unconfigured error names the missing config, so the right person goes looking', () => {
  const res = checkPublishTarget(TEST_PAGE, '')
  assertEquals(res.ok, false)
  if (!res.ok) assertEquals(res.error.includes('PUBLISH_ALLOWED_PAGE_IDS'), true)
})

Deno.test('an org row pointing at a NON-LISTED page is rejected regardless of the row', () => {
  // The scenario this whole gate exists for: org_integrations.publish_page_id
  // has been set — by an admin, by a bad migration, by anything — to a Page
  // this deployment is not permitted to touch. The row is not consulted for
  // permission; the env allowlist is.
  const res = checkPublishTarget(CUSTOMER_PAGE, TEST_PAGE)
  assertEquals(res.ok, false)
  if (!res.ok) {
    assertEquals(res.reason, 'not_allowed')
    assertEquals(res.error.includes(CUSTOMER_PAGE), true)
  }
})

Deno.test('no target chosen is distinguished from a target that is not allowed', () => {
  const res = checkPublishTarget(null, TEST_PAGE)
  assertEquals(res.ok, false)
  if (!res.ok) assertEquals(res.reason, 'no_target')
})

Deno.test('an allowlisted page passes, including as one entry among several', () => {
  assertEquals(checkPublishTarget(TEST_PAGE, TEST_PAGE), { ok: true, pageId: TEST_PAGE })
  assertEquals(checkPublishTarget(TEST_PAGE, `999, ${TEST_PAGE} ,888`), { ok: true, pageId: TEST_PAGE })
})

Deno.test('allowlist matching is exact — no prefix or substring match', () => {
  // '11111111111111' (one digit short) must not open '111111111111111'.
  const res = checkPublishTarget(TEST_PAGE, TEST_PAGE.slice(0, -1))
  assertEquals(res.ok, false)
})

Deno.test('validatePublishInput: empty and whitespace-only captions are refused', () => {
  assertEquals(validatePublishInput({ target: 'facebook', message: '' }).ok, false)
  assertEquals(validatePublishInput({ target: 'facebook', message: '   \n ' }).ok, false)
})

Deno.test('validatePublishInput: instagram requires an image, facebook does not', () => {
  assertEquals(validatePublishInput({ target: 'instagram', message: 'hi' }).ok, false)
  assertEquals(validatePublishInput({ target: 'facebook', message: 'hi' }).ok, true)
  assertEquals(
    validatePublishInput({ target: 'instagram', message: 'hi', imageUrl: 'https://x/y.jpg' }).ok,
    true,
  )
})

Deno.test('validatePublishInput: the image must be a public https URL Meta can fetch', () => {
  for (const url of ['blob:http://localhost/abc', 'data:image/png;base64,AAA', 'http://x/y.jpg']) {
    assertEquals(validatePublishInput({ target: 'facebook', message: 'hi', imageUrl: url }).ok, false)
  }
})

Deno.test('validatePublishInput: caption cap is enforced before the Graph call, not by it', () => {
  assertEquals(validatePublishInput({ target: 'facebook', message: 'a'.repeat(2200) }).ok, true)
  assertEquals(validatePublishInput({ target: 'facebook', message: 'a'.repeat(2201) }).ok, false)
})

Deno.test('buildFacebookPayload: photo when there is an image, feed when there is not', () => {
  assertEquals(buildFacebookPayload(TEST_PAGE, ' hello ', 'https://x/y.jpg'), {
    endpoint: `/${TEST_PAGE}/photos`,
    fields: { url: 'https://x/y.jpg', caption: 'hello' },
  })
  assertEquals(buildFacebookPayload(TEST_PAGE, 'hello'), {
    endpoint: `/${TEST_PAGE}/feed`,
    fields: { message: 'hello' },
  })
})

Deno.test('payloads never contain an access token', () => {
  const fb = buildFacebookPayload(TEST_PAGE, 'hello', 'https://x/y.jpg')
  const ig = buildInstagramContainerPayload('17841', 'hello', 'https://x/y.jpg')
  for (const p of [fb, ig]) {
    assertEquals(Object.keys(p.fields).some((k) => k.toLowerCase().includes('token')), false)
  }
})

Deno.test('buildInstagramContainerPayload: container first, publish is a separate call', () => {
  assertEquals(buildInstagramContainerPayload('17841', 'hi', 'https://x/y.jpg'), {
    endpoint: '/17841/media',
    fields: { image_url: 'https://x/y.jpg', caption: 'hi' },
  })
})

Deno.test('facebookPermalink', () => {
  assertEquals(facebookPermalink('123_456'), 'https://www.facebook.com/123_456')
})

Deno.test('TERMINAL ROW (bug #47): keys match published_assets columns exactly', () => {
  const row = buildPublishedAssetRow({
    orgId: 'org-1',
    userId: 'user-1',
    target: 'facebook',
    pageId: TEST_PAGE,
    message: '  hello  ',
    mode: 'dry_run',
  })
  // Exactly the writable columns of published_assets (id/posted_at are defaulted).
  assertEquals(Object.keys(row).sort(), [
    'creative_asset_id',
    'dry_run',
    'ig_user_id',
    'message',
    'meta_post_id',
    'org_id',
    'page_id',
    'permalink',
    'platform',
    'posted_by',
    'project_id',
    'published',
    'tool_output_id',
  ])
})

Deno.test('TERMINAL ROW: a dry run records the target but no post id', () => {
  const row = buildPublishedAssetRow({
    orgId: 'org-1',
    userId: 'user-1',
    target: 'instagram',
    pageId: TEST_PAGE,
    igUserId: '17841',
    message: 'hello',
    mode: 'dry_run',
  })
  assertEquals(row.dry_run, true)
  assertEquals(row.meta_post_id, null)
  assertEquals(row.permalink, null)
  assertEquals(row.page_id, TEST_PAGE)
  assertEquals(row.ig_user_id, '17841')
  assertEquals(row.platform, 'instagram')
})

Deno.test('TERMINAL ROW: a live run carries the post id and permalink', () => {
  const row = buildPublishedAssetRow({
    orgId: 'org-1',
    userId: 'user-1',
    target: 'facebook',
    pageId: TEST_PAGE,
    message: 'hello',
    mode: 'live',
    metaPostId: '123_456',
    permalink: 'https://www.facebook.com/123_456',
    creativeAssetId: 'ca-1',
    projectId: 'p-1',
  })
  assertEquals(row.dry_run, false)
  assertEquals(row.meta_post_id, '123_456')
  assertEquals(row.creative_asset_id, 'ca-1')
  assertEquals(row.project_id, 'p-1')
  assertEquals(row.tool_output_id, null)
})

// ---------------------------------------------------------------------------
// DRAFT TIER (RB-PUB STEP 2)
// ---------------------------------------------------------------------------

Deno.test('FAIL-CLOSED: an unset or unrecognised META_PUBLISH_MODE means draft', () => {
  for (const raw of [undefined, null, '', '  ', 'LIVEISH', 'true', 'production']) {
    assertEquals(resolveDeploymentMode(raw), 'draft')
  }
})

Deno.test('only the exact word "live" opens the live tier (case/space tolerant)', () => {
  assertEquals(resolveDeploymentMode('live'), 'live')
  assertEquals(resolveDeploymentMode(' LIVE '), 'live')
})

Deno.test('a public post needs BOTH gates — deployment mode and per-call confirmation', () => {
  // live deployment + confirmed call: the only combination that goes public.
  assertEquals(
    resolvePublishMode({ deployment: 'live', dryRun: false, confirmLive: true }).mode,
    'live',
  )
  // Each gate alone is not enough.
  assertEquals(resolvePublishMode({ deployment: 'live', dryRun: false, confirmLive: false }).mode, 'draft')
  assertEquals(resolvePublishMode({ deployment: 'draft', dryRun: false, confirmLive: true }).mode, 'draft')
  assertEquals(resolvePublishMode({ deployment: 'draft', dryRun: false, confirmLive: false }).mode, 'draft')
})

Deno.test('dry_run outranks everything — it never becomes a Graph call', () => {
  for (const deployment of ['draft', 'live'] as const) {
    for (const confirmLive of [true, false]) {
      assertEquals(resolvePublishMode({ deployment, dryRun: true, confirmLive }).mode, 'dry_run')
    }
  }
})

Deno.test('a live request under a draft deployment DOWNGRADES with a warning, never errors', () => {
  const d = resolvePublishMode({ deployment: 'draft', dryRun: false, confirmLive: true })
  assertEquals(d.mode, 'draft')
  assertEquals(d.downgraded, true)
  assertEquals(d.warning !== null, true)
  assertEquals(d.warning!.includes('META_PUBLISH_MODE'), true)
})

Deno.test('an unconfirmed call under a live deployment is a plain draft, not a downgrade', () => {
  // Nothing was overridden — the caller simply did not ask to go live.
  const d = resolvePublishMode({ deployment: 'live', dryRun: false, confirmLive: false })
  assertEquals(d.mode, 'draft')
  assertEquals(d.downgraded, false)
  assertEquals(d.warning !== null, true)
})

Deno.test('withDraftFlag: draft adds published=false and changes NOTHING else', () => {
  const base = buildFacebookPayload(TEST_PAGE, 'hello', 'https://x/y.jpg')
  const draft = withDraftFlag(base, 'draft')
  // Same endpoint — a draft that took a different code path would prove
  // nothing about the live one.
  assertEquals(draft.endpoint, base.endpoint)
  assertEquals(draft.fields, { ...base.fields, published: 'false' })
})

Deno.test('withDraftFlag: live and dry_run payloads are untouched', () => {
  const base = buildFacebookPayload(TEST_PAGE, 'hello', 'https://x/y.jpg')
  assertEquals(withDraftFlag(base, 'live'), base)
  assertEquals(withDraftFlag(base, 'dry_run'), base)
})

Deno.test('TERMINAL ROW: draft is dry_run=false + published=false', () => {
  const row = buildPublishedAssetRow({
    orgId: 'org-1', userId: 'u', target: 'facebook', pageId: TEST_PAGE,
    message: 'hello', mode: 'draft', metaPostId: '123_456',
  })
  assertEquals(row.dry_run, false)
  assertEquals(row.published, false)
  assertEquals(row.meta_post_id, '123_456')
})

Deno.test('TERMINAL ROW: the schema-forbidden pair can never be built', () => {
  // published_assets CHECK forbids (dry_run AND published). Both flags derive
  // from one `mode`, so the impossible combination has no way to be expressed.
  for (const mode of ['dry_run', 'draft', 'live'] as const) {
    const row = buildPublishedAssetRow({
      orgId: 'o', userId: null, target: 'facebook', pageId: TEST_PAGE, message: 'm', mode,
    })
    assertEquals(row.dry_run && row.published, false)
  }
})

// ---------------------------------------------------------------------------
// PAGE TOKEN + CAPABILITY (RB-PUB STEP 3)
// ---------------------------------------------------------------------------

const PAGES = [
  { id: TEST_PAGE, name: 'AWAAS Sandbox', access_token: 'PAGE_TOKEN', tasks: ['ANALYZE', 'CREATE_CONTENT'] },
  { id: '222', name: 'Read Only Page', access_token: 'OTHER_TOKEN', tasks: ['ANALYZE'] },
  { id: '333', name: 'No Token Page', tasks: ['ANALYZE', 'CREATE_CONTENT'] },
]

Deno.test('resolvePageToken: returns the token for a page with CREATE_CONTENT', () => {
  const res = resolvePageToken(PAGES, TEST_PAGE)
  assertEquals(res.ok, true)
  if (res.ok) {
    assertEquals(res.token, 'PAGE_TOKEN')
    assertEquals(res.pageName, 'AWAAS Sandbox')
  }
})

Deno.test('resolvePageToken: ANALYZE-only is refused BEFORE anything is posted', () => {
  // The whole point of reading tasks: a token exists for this Page, so the old
  // GET /{page}?fields=access_token check would have passed and the failure
  // would have arrived from the POST instead.
  const res = resolvePageToken(PAGES, '222')
  assertEquals(res.ok, false)
  if (!res.ok) {
    assertEquals(res.reason, 'page_missing_create_content')
    assertEquals(res.error.includes('Read Only Page'), true)
    assertEquals(res.error.includes('ANALYZE'), true)
  }
})

Deno.test('resolvePageToken: a page absent from the token is named as such', () => {
  const res = resolvePageToken(PAGES, '999')
  assertEquals(res.ok, false)
  if (!res.ok) assertEquals(res.reason, 'page_not_on_token')
})

Deno.test('resolvePageToken: permitted but tokenless is its own distinct failure', () => {
  const res = resolvePageToken(PAGES, '333')
  assertEquals(res.ok, false)
  if (!res.ok) assertEquals(res.reason, 'page_no_token')
})

Deno.test('resolvePageToken: missing tasks array is treated as no permission', () => {
  const res = resolvePageToken([{ id: TEST_PAGE, access_token: 'T' }], TEST_PAGE)
  assertEquals(res.ok, false)
  if (!res.ok) assertEquals(res.reason, 'page_missing_create_content')
})
