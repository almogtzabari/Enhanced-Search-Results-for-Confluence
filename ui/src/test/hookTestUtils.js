import { h, render } from 'preact';
import { act } from 'preact/test-utils';

export function mountHook(useHook, initialProps) {
  let hookResult;
  let latestProps = initialProps;
  const container = document.createElement('div');
  document.body.appendChild(container);

  function TestHarness() {
    hookResult = useHook(latestProps);
    return null;
  }

  act(() => {
    render(h(TestHarness, {}), container);
  });

  return {
    get result() {
      return hookResult;
    },
    rerender(nextProps) {
      latestProps = nextProps;
      act(() => {
        render(h(TestHarness, {}), container);
      });
    },
    async flush() {
      await act(async () => {
        await Promise.resolve();
      });
    },
    unmount() {
      act(() => {
        render(null, container);
      });
      container.remove();
    },
  };
}
