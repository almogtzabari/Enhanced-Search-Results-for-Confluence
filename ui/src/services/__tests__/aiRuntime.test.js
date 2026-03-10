import { beforeEach, describe, expect, it, vi } from 'vitest';

const permissionsMocks = vi.hoisted(() => ({
  ensureApiOriginPermission: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  getSync: vi.fn(),
  getLocal: vi.fn(),
}));

vi.mock('../permissions.js', () => ({
  ensureApiOriginPermission: permissionsMocks.ensureApiOriginPermission,
}));

vi.mock('../storage.js', () => ({
  getSync: storageMocks.getSync,
  getLocal: storageMocks.getLocal,
}));

import {
  getAiRuntimeSettings,
  resolveReasoningEffort,
  sendOpenAIRequest,
  withTimeout,
} from '../aiRuntime.js';

function createMockPort() {
  const onMessageListeners = [];
  const onDisconnectListeners = [];
  const port = {
    onMessage: {
      addListener: vi.fn((listener) => onMessageListeners.push(listener)),
      removeListener: vi.fn((listener) => {
        const idx = onMessageListeners.indexOf(listener);
        if (idx >= 0) onMessageListeners.splice(idx, 1);
      }),
    },
    onDisconnect: {
      addListener: vi.fn((listener) => onDisconnectListeners.push(listener)),
      removeListener: vi.fn((listener) => {
        const idx = onDisconnectListeners.indexOf(listener);
        if (idx >= 0) onDisconnectListeners.splice(idx, 1);
      }),
    },
    postMessage: vi.fn(),
    disconnect: vi.fn(() => {
      onDisconnectListeners.forEach((listener) => listener());
    }),
    __emitMessage(payload) {
      onMessageListeners.forEach((listener) => listener(payload));
    },
    __emitDisconnect() {
      onDisconnectListeners.forEach((listener) => listener());
    },
  };
  return port;
}

describe('aiRuntime service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    permissionsMocks.ensureApiOriginPermission.mockReset();
    storageMocks.getSync.mockReset();
    storageMocks.getLocal.mockReset();
    permissionsMocks.ensureApiOriginPermission.mockResolvedValue({ granted: true, reason: '' });
    storageMocks.getSync.mockResolvedValue({});
    storageMocks.getLocal.mockResolvedValue({});
  });

  it('normalizes reasoning effort values', () => {
    expect(resolveReasoningEffort('high', false)).toBe('high');
    expect(resolveReasoningEffort('invalid', true)).toBe('high');
    expect(resolveReasoningEffort('', false)).toBeUndefined();
  });

  it('times out unresolved promises and calls timeout callback', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const pending = new Promise(() => {});

    const promise = withTimeout(pending, 250, 'Timed out', onTimeout).catch((error) => error);
    await vi.advanceTimersByTimeAsync(251);

    const error = await promise;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Timed out');
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('resolves OpenAI responses via runtime port and extracts output_text', async () => {
    const port = createMockPort();
    global.chrome = {
      runtime: {
        connect: vi.fn(() => port),
        lastError: null,
      },
    };

    const promise = sendOpenAIRequest({
      apiKey: 'k',
      apiUrl: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'hello' }],
      reasoningEffort: 'high',
    });

    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      apiUrl: 'https://api.openai.com/v1/responses',
      model: 'gpt-5',
    }));

    port.__emitMessage({
      success: true,
      data: {
        output: [{ content: [{ type: 'output_text', text: 'Hello from model' }] }],
      },
    });

    await expect(promise).resolves.toMatchObject({
      output_text: 'Hello from model',
    });
  });

  it('rejects with AbortError when request signal aborts', async () => {
    const port = createMockPort();
    global.chrome = {
      runtime: {
        connect: vi.fn(() => port),
        lastError: null,
      },
    };
    const controller = new AbortController();

    const promise = sendOpenAIRequest({
      apiKey: 'k',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'hello' }],
      signal: controller.signal,
    });

    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(port.disconnect).toHaveBeenCalledTimes(1);
  });

  it('rejects when port disconnects with runtime error', async () => {
    const port = createMockPort();
    global.chrome = {
      runtime: {
        connect: vi.fn(() => port),
        lastError: { message: 'Port closed unexpectedly' },
      },
    };

    const promise = sendOpenAIRequest({
      apiKey: 'k',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'hello' }],
    });
    port.__emitDisconnect();

    await expect(promise).rejects.toThrow('Port closed unexpectedly');
  });

  it('loads runtime settings, preferring local API key and enforcing origin permission', async () => {
    storageMocks.getSync.mockResolvedValue({
      openaiApiKey: 'legacy-sync',
      customApiEndpoint: 'https://api.example.com/v1',
      selectedAiModel: 'gpt-5-mini',
      reasoningEffort: 'medium',
    });
    storageMocks.getLocal.mockResolvedValue({
      openaiApiKey: 'local-key',
    });
    permissionsMocks.ensureApiOriginPermission.mockResolvedValue({ granted: true, reason: '' });

    const settings = await getAiRuntimeSettings({ requireApiKey: true, requestEndpointPermission: true });
    expect(settings).toMatchObject({
      apiKey: 'local-key',
      apiUrl: 'https://api.example.com/v1',
      model: 'gpt-5-mini',
      reasoningEffort: 'medium',
    });
    expect(permissionsMocks.ensureApiOriginPermission).toHaveBeenCalledWith(
      'https://api.example.com',
      { requestIfMissing: true },
    );
  });

  it('throws a specific error when endpoint permission is missing', async () => {
    storageMocks.getSync.mockResolvedValue({ openaiApiKey: 'k', customApiEndpoint: 'https://api.example.com/v1' });
    permissionsMocks.ensureApiOriginPermission.mockResolvedValue({ granted: false, reason: 'missing_permission' });

    await expect(
      getAiRuntimeSettings({ requireApiKey: true, requestEndpointPermission: false }),
    ).rejects.toThrow('OpenAI endpoint permission is missing');
  });

  it('throws on invalid endpoint URL', async () => {
    storageMocks.getSync.mockResolvedValue({ openaiApiKey: 'k', customApiEndpoint: 'not-a-url' });

    await expect(
      getAiRuntimeSettings({ requireApiKey: true, requestEndpointPermission: false }),
    ).rejects.toThrow('Invalid OpenAI API endpoint URL');
  });
});
