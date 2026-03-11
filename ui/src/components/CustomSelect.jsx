import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

let customSelectSeed = 0;

function nextId(prefix = 'custom-select') {
  customSelectSeed += 1;
  return `${prefix}-${Date.now()}-${customSelectSeed}`;
}

export function CustomSelect({
  id = '',
  ariaLabel = '',
  value,
  options = [],
  onChange,
  className = '',
  triggerClassName = '',
  panelClassName = '',
  optionClassName = '',
  disabled = false,
}) {
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const instanceIdRef = useRef(id || nextId());

  const normalizedOptions = useMemo(
    () => (Array.isArray(options) ? options.filter((opt) => opt && typeof opt.value === 'string') : []),
    [options],
  );
  const selectedIndex = normalizedOptions.findIndex((opt) => opt.value === value);
  const selectedOption = selectedIndex >= 0 ? normalizedOptions[selectedIndex] : normalizedOptions[0];
  const selectedValue = selectedOption?.value || '';
  const selectedLabel = selectedOption?.label || selectedValue || '';
  const panelId = `${instanceIdRef.current}-listbox`;
  const triggerId = id || `${instanceIdRef.current}-trigger`;

  const close = () => setOpen(false);

  const openWithIndex = (index) => {
    if (disabled || normalizedOptions.length === 0) return;
    setActiveIndex(Math.max(0, Math.min(index, normalizedOptions.length - 1)));
    setOpen(true);
  };

  const commitIndex = (index) => {
    const next = normalizedOptions[index];
    if (!next) return;
    if (next.value !== value && typeof onChange === 'function') {
      onChange(next.value);
    }
    close();
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;

    const onDocumentMouseDown = (event) => {
      if (!rootRef.current?.contains(event.target)) close();
    };

    const onDocumentKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        triggerRef.current?.focus();
        return;
      }
      if (event.key === 'Tab') {
        close();
      }
    };

    document.addEventListener('mousedown', onDocumentMouseDown);
    document.addEventListener('touchstart', onDocumentMouseDown, { passive: true });
    document.addEventListener('keydown', onDocumentKeyDown);

    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
      document.removeEventListener('touchstart', onDocumentMouseDown);
      document.removeEventListener('keydown', onDocumentKeyDown);
    };
  }, [open]);

  const handleTriggerClick = () => {
    if (open) {
      close();
      return;
    }
    openWithIndex(Math.max(selectedIndex, 0));
  };

  const handleTriggerKeyDown = (event) => {
    if (disabled) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      openWithIndex(
        open
          ? Math.min((activeIndex >= 0 ? activeIndex : Math.max(selectedIndex, 0)) + 1, normalizedOptions.length - 1)
          : Math.max(selectedIndex, 0),
      );
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      openWithIndex(
        open
          ? Math.max((activeIndex >= 0 ? activeIndex : Math.max(selectedIndex, 0)) - 1, 0)
          : Math.max(selectedIndex, 0),
      );
      return;
    }
    if (event.key === 'Home') {
      if (!open) return;
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex(0);
      return;
    }
    if (event.key === 'End') {
      if (!open) return;
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex(Math.max(0, normalizedOptions.length - 1));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      if (open) {
        const nextIndex = activeIndex >= 0 ? activeIndex : Math.max(selectedIndex, 0);
        commitIndex(nextIndex);
      } else {
        openWithIndex(Math.max(selectedIndex, 0));
      }
    }
  };

  return (
    <div
      ref={rootRef}
      class={`custom-select ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''} ${className}`.trim()}
    >
      <button
        id={triggerId}
        ref={triggerRef}
        type="button"
        class={`custom-select-trigger ${triggerClassName}`.trim()}
        aria-label={ariaLabel || undefined}
        aria-haspopup="listbox"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={panelId}
        data-value={selectedValue}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        disabled={disabled}
      >
        <span class="custom-select-trigger-label">{selectedLabel}</span>
        <span class="custom-select-trigger-caret" aria-hidden="true" />
      </button>
      {open && (
        <div id={panelId} class={`custom-select-panel ${panelClassName}`.trim()} role="listbox" aria-labelledby={triggerId}>
          {normalizedOptions.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isActive = idx === activeIndex;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected ? 'true' : 'false'}
                class={`custom-select-option ${isSelected ? 'is-selected' : ''} ${isActive ? 'is-active' : ''} ${optionClassName}`.trim()}
                data-value={opt.value}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => commitIndex(idx)}
              >
                <span class="custom-select-option-label">{opt.label || opt.value}</span>
                <span class="custom-select-option-mark" aria-hidden="true">{isSelected ? '✓' : ''}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
