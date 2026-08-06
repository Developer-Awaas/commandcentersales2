import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks via vi.hoisted so they exist before the hoisted vi.mock factories run.
// renderMock: assert the compositor gets the CLEAN template, never the final.
const { renderMock, uploadMock, updateEqMock, updateMock, getPublicUrlMock } = vi.hoisted(() => ({
  renderMock: vi.fn(async () => 'data:image/jpeg;base64,COMPOSED'),
  uploadMock: vi.fn(async () => ({ error: null })),
  updateEqMock: vi.fn(async () => ({ error: null })),
  updateMock: vi.fn(),
  getPublicUrlMock: vi.fn(() => ({ data: { publicUrl: 'https://cdn/x/final.jpg' } })),
}));
updateMock.mockImplementation(() => ({ eq: updateEqMock }));
vi.mock('./text-layers', () => ({ renderTextLayers: renderMock }));
vi.mock('./supabase', () => ({
  supabase: {
    storage: { from: () => ({ upload: uploadMock, getPublicUrl: getPublicUrlMock }) },
    from: () => ({ update: updateMock }),
  },
}));

import { recompositeOverlay, saveOverlayEdit } from './overlay-recompose';
import type { TextLayer } from './text-layers';
import type { ReferenceZone } from './reference-style';

const layers: TextLayer[] = [
  { id: 'l1', text: 'New price', xPct: 60, yPct: 60, fontSizePx: 40, fontWeight: 'bold', color: '#fff', align: 'center' },
];
const zones: ReferenceZone[] = [
  { role: 'logo', bbox: [0.7, 0.08, 0.25, 0.1], align: 'left', fontScale: 0, weight: 'bold', color: '#fff' },
  { role: 'price', bbox: [0.6, 0.6, 0.3, 0.09], align: 'center', fontScale: 0.05, weight: 'bold', color: '#fff' },
];

beforeEach(() => {
  vi.clearAllMocks();
  // Stub Image so imageDims resolves with the clean template's natural size.
  class FakeImage {
    naturalWidth = 1080; naturalHeight = 1350; crossOrigin = '';
    set src(_v: string) { setTimeout(() => (this as unknown as { onload: () => void }).onload?.(), 0); }
    onload: (() => void) | null = null; onerror: (() => void) | null = null;
  }
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['x']) })) as unknown as typeof fetch);
});

describe('recompositeOverlay', () => {
  it('renders over the CLEAN template at its natural dims, with the derived logo', async () => {
    const out = await recompositeOverlay({ cleanTemplateUrl: 'https://cdn/x/final.clean.jpg', layers, zones, logoUrl: 'https://cdn/logo.png' });
    expect(out).toBe('data:image/jpeg;base64,COMPOSED');
    const [src, gotLayers, w, h, logo] = renderMock.mock.calls[0] as unknown as [string, unknown, number, number, unknown];
    expect(src).toBe('https://cdn/x/final.clean.jpg'); // never the composited final
    expect(gotLayers).toBe(layers);
    expect([w, h]).toEqual([1080, 1350]);              // from the clean template
    expect(logo).toEqual({ src: 'https://cdn/logo.png', bbox: zones[0].bbox });
    // No patching args any more — the compositor is template + logo + text only.
    expect(renderMock.mock.calls[0].length).toBe(5);
  });

  it('omits the logo when no logo zone / no logo url', async () => {
    await recompositeOverlay({ cleanTemplateUrl: 'c.jpg', layers, zones: [zones[1]] });
    expect((renderMock.mock.calls[0] as unknown[])[4]).toBeUndefined();
  });
});

describe('saveOverlayEdit', () => {
  it('overwrites the SAME storage path (upsert), persists layers, returns a cache-busted url', async () => {
    const url = await saveOverlayEdit({
      assetId: 'asset-1', storagePath: 'generated-creatives/o/s/price.jpg',
      cleanTemplateUrl: 'c.jpg', layers, zones, logoUrl: 'logo.png',
    });
    expect(uploadMock).toHaveBeenCalledWith('generated-creatives/o/s/price.jpg', expect.any(Blob), { upsert: true, contentType: 'image/jpeg' });
    expect(updateMock).toHaveBeenCalledWith({ text_layers: layers });
    expect(updateEqMock).toHaveBeenCalledWith('id', 'asset-1');
    expect(url).toMatch(/^https:\/\/cdn\/x\/final\.jpg\?t=\d+$/);
  });

  it('throws (no DB write) if the storage overwrite fails', async () => {
    uploadMock.mockResolvedValueOnce({ error: { message: 'storage denied' } } as never);
    await expect(saveOverlayEdit({
      assetId: 'a', storagePath: 'p.jpg', cleanTemplateUrl: 'c.jpg', layers,
    })).rejects.toBeTruthy();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
