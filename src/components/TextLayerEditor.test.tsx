import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TextLayer } from '../lib/text-layers';

// Mock the Supabase persist chain (.from().update().eq()) → { error: null }.
const updateEq = vi.fn(() => Promise.resolve({ error: null }));
const update = vi.fn(() => ({ eq: updateEq }));
// from() serves both the persist chain (.update().eq()) and the brand-kit palette
// fetch (.select().maybeSingle()) the editor runs on mount.
vi.mock('../lib/supabase', () => ({ supabase: { from: () => ({ update, select: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) } }));
// Force a measured width so the layer overlays actually render (no ResizeObserver in jsdom).
vi.mock('../hooks/useMeasuredWidth', () => ({ useMeasuredWidth: () => [{ current: document.createElement('div') }, 500] }));

import { TextLayerEditor } from './TextLayerEditor';

const layers: TextLayer[] = [
  { id: 'l1', text: 'Old Headline', xPct: 10, yPct: 10, fontSizePx: 54, fontWeight: 'bold', color: '#ffffff', align: 'left' },
];

beforeEach(() => {
  // jsdom lacks pointer capture; the editor calls it on layer select.
  (Element.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture = vi.fn();
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe('TextLayerEditor — edit-text interaction', () => {
  it('selects a layer, edits its text, and Save persists + returns the updated layers', async () => {
    const onSave = vi.fn();
    render(<TextLayerEditor assetId="asset-1" imageUrl="data:image/png;base64,AAAA" layers={layers} onSave={onSave} onClose={vi.fn()} />);

    // Select the layer by pointer-down on its overlay, then the text field appears.
    // 'Old Headline' now appears in both the canvas preview AND the layer list
    // (RB-P5); the canvas element is first in DOM order — select that one.
    fireEvent.pointerDown(screen.getAllByText('Old Headline')[0]);
    const input = screen.getByPlaceholderText('Layer text') as HTMLInputElement;
    expect(input.value).toBe('Old Headline');

    fireEvent.change(input, { target: { value: 'New Headline' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0] as TextLayer[];
    expect(saved.find((l) => l.id === 'l1')?.text).toBe('New Headline');
    // Persisted to the right creative_assets row.
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ text_layers: expect.any(Array) }));
    expect(updateEq).toHaveBeenCalledWith('id', 'asset-1');
  });

  it('does not call onSave if the persist errors', async () => {
    updateEq.mockResolvedValueOnce({ error: { message: 'RLS denied' } } as never);
    const onSave = vi.fn();
    render(<TextLayerEditor assetId="asset-2" imageUrl="data:image/png;base64,AAAA" layers={layers} onSave={onSave} onClose={vi.fn()} />);
    // 'Old Headline' now appears in both the canvas preview AND the layer list
    // (RB-P5); the canvas element is first in DOM order — select that one.
    fireEvent.pointerDown(screen.getAllByText('Old Headline')[0]);
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.getByText(/RLS denied/)).toBeTruthy());
    expect(onSave).not.toHaveBeenCalled();
  });
});
