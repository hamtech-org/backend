import { formatCallMessagePreview } from '../call-message-preview.js';

describe('formatCallMessagePreview', () => {
  it('formats rejected call payload without leaking JSON', () => {
    expect(
      formatCallMessagePreview(
        JSON.stringify({ kind: 'rejected', callType: 'audio', durationSec: 0 }),
      ),
    ).toBe('Cuộc gọi bị từ chối');
  });

  it('formats missed and cancelled call payloads', () => {
    expect(formatCallMessagePreview(JSON.stringify({ kind: 'missed', callType: 'video' }))).toBe(
      'Cuộc gọi nhỡ',
    );
    expect(formatCallMessagePreview(JSON.stringify({ kind: 'cancelled', callType: 'audio' }))).toBe(
      'Cuộc gọi đã hủy',
    );
  });

  it('formats completed calls with call type and duration', () => {
    expect(
      formatCallMessagePreview(
        JSON.stringify({ kind: 'completed', callType: 'audio', durationSec: 65 }),
      ),
    ).toBe('Cuộc gọi thoại - 1 phút 5 giây');
    expect(
      formatCallMessagePreview(
        JSON.stringify({ kind: 'completed', callType: 'video', durationSec: 0 }),
      ),
    ).toBe('Cuộc gọi video');
  });

  it('falls back safely for malformed payloads', () => {
    expect(formatCallMessagePreview('{bad json')).toBe('Cuộc gọi');
    expect(formatCallMessagePreview('')).toBe('Cuộc gọi');
  });
});
