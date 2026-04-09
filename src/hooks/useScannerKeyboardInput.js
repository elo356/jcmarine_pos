import { useEffect, useRef } from 'react';

const isPrintableKey = (event) => event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;

function useScannerKeyboardInput({
  enabled,
  onScan,
  onBufferChange,
  shouldIgnoreEvent,
  minLength = 4,
  idleTimeoutMs = 120,
  maxDurationMs = 600,
  keepLastBufferedValue = false
}) {
  const bufferRef = useRef('');
  const startedAtRef = useRef(0);
  const lastKeyAtRef = useRef(0);
  const idleTimerRef = useRef(null);
  const onScanRef = useRef(onScan);
  const onBufferChangeRef = useRef(onBufferChange);
  const shouldIgnoreEventRef = useRef(shouldIgnoreEvent);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    onBufferChangeRef.current = onBufferChange;
  }, [onBufferChange]);

  useEffect(() => {
    shouldIgnoreEventRef.current = shouldIgnoreEvent;
  }, [shouldIgnoreEvent]);

  useEffect(() => {
    const clearBuffer = (resetVisibleValue = true) => {
      bufferRef.current = '';
      startedAtRef.current = 0;
      lastKeyAtRef.current = 0;
      if (resetVisibleValue) {
        onBufferChangeRef.current?.('');
      }
    };

    if (!enabled) {
      clearBuffer(!keepLastBufferedValue);
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      return undefined;
    }

    const flushBuffer = () => {
      const value = bufferRef.current.trim();
      const looksLikeScanner = value.length >= minLength
        && startedAtRef.current > 0
        && lastKeyAtRef.current - startedAtRef.current <= maxDurationMs;

      clearBuffer(!keepLastBufferedValue);

      if (looksLikeScanner) {
        onScanRef.current?.(value);
      }
    };

    const scheduleFlush = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        flushBuffer();
        idleTimerRef.current = null;
      }, idleTimeoutMs);
    };

    const handleKeyDown = (event) => {
      const now = Date.now();

      if (shouldIgnoreEventRef.current?.(event)) return;

      if (event.key === 'Enter' || event.key === 'Tab') {
        if (bufferRef.current) {
          event.preventDefault();
          flushBuffer();
        }
        return;
      }

      if (!isPrintableKey(event)) return;

      if (!startedAtRef.current || now - lastKeyAtRef.current > maxDurationMs) {
        clearBuffer();
        startedAtRef.current = now;
      }

      bufferRef.current += event.key;
      lastKeyAtRef.current = now;
      onBufferChangeRef.current?.(bufferRef.current);
      scheduleFlush();
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      clearBuffer();
    };
  }, [enabled, idleTimeoutMs, keepLastBufferedValue, maxDurationMs, minLength]);
}

export default useScannerKeyboardInput;
