import { describe, expect, it } from 'vitest';
import { sanitizeHtmlFragment } from '../utils/htmlUtils.js';
import { resolveConfluenceIconUrl } from '../utils/urlUtils.js';
import { clampNumber, loadStoredAiQuestionHeight } from '../utils/uiStorage.js';

describe('html/url/storage utils', () => {
  it('sanitizes unsafe tags and attributes', () => {
    const out = sanitizeHtmlFragment('<p onclick="x()">Safe <script>alert(1)</script><a href="javascript:bad">x</a></p>');
    expect(out).toContain('<p>Safe <a');
    expect(out).not.toContain('script');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('javascript:');
  });

  it('resolves confluence icon url and falls back when path is missing', () => {
    const base = 'https://example.atlassian.net/wiki';
    const fallback = 'data:image/png;base64,aaa';

    expect(resolveConfluenceIconUrl(base, '/images/icon.png', fallback)).toBe('https://example.atlassian.net/images/icon.png');
    expect(resolveConfluenceIconUrl(base, '', fallback)).toBe(fallback);
  });

  it('clamps values and loads question height from storage', () => {
    expect(clampNumber(40, 10, 30)).toBe(30);
    sessionStorage.setItem('aiQuestionInputHeight', '999');
    expect(loadStoredAiQuestionHeight()).toBe(260);
  });
});
