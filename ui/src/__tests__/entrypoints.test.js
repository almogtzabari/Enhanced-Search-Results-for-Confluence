import { describe, expect, it, vi } from 'vitest';

describe('entrypoints', () => {
  it('main mounts App into #app', async () => {
    vi.resetModules();
    const renderMock = vi.fn();
    const App = vi.fn(() => null);

    vi.doMock('preact', () => ({
      render: renderMock,
    }));
    vi.doMock('../App.jsx', () => ({
      App,
    }));

    document.body.innerHTML = '<div id="app"></div>';
    await import('../main.jsx');

    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(renderMock.mock.calls[0][1]).toBe(document.getElementById('app'));
    expect(renderMock.mock.calls[0][0]?.type).toBe(App);
  });

  it('optionsMain mounts OptionsApp into #app', async () => {
    vi.resetModules();
    const renderMock = vi.fn();
    const OptionsApp = vi.fn(() => null);

    vi.doMock('preact', () => ({
      render: renderMock,
    }));
    vi.doMock('../optionsApp.jsx', () => ({
      OptionsApp,
    }));

    document.body.innerHTML = '<div id="app"></div>';
    await import('../optionsMain.jsx');

    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(renderMock.mock.calls[0][1]).toBe(document.getElementById('app'));
    expect(renderMock.mock.calls[0][0]?.type).toBe(OptionsApp);
  });

  it('contentMain re-exports bootstrapContentApp', async () => {
    vi.resetModules();
    const contentMain = await import('../contentMain.jsx');
    const contentApp = await import('../contentApp.jsx');
    expect(contentMain.bootstrapContentApp).toBe(contentApp.bootstrapContentApp);
  });
});
