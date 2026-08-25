import * as React from 'react';

const RETURN_DURATION_MS = 180;
const CLOSE_DURATION_MS = 150;

interface DragGesture {
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
  offset: number;
  maxMovement: number;
}

/** Настоящая ручка нижней мобильной панели: тянется вниз и закрывает её. */
export function BottomSheetHandle({
  sheetRef,
  onClose,
}: {
  sheetRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}): React.ReactElement {
  const gestureRef = React.useRef<DragGesture | null>(null);
  const timerRef = React.useRef<number | null>(null);
  const suppressClickRef = React.useRef(false);

  const clearTimer = React.useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const clearInlineMotion = React.useCallback(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.style.removeProperty('transition');
    sheet.style.removeProperty('transform');
    sheet.style.removeProperty('will-change');
    sheet.style.removeProperty('animation');
  }, [sheetRef]);

  const returnToPlace = React.useCallback(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    clearTimer();
    sheet.style.transition = `transform ${RETURN_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    sheet.style.transform = 'translate3d(0, 0, 0)';
    timerRef.current = window.setTimeout(clearInlineMotion, RETURN_DURATION_MS);
  }, [clearInlineMotion, clearTimer, sheetRef]);

  React.useEffect(
    () => () => {
      clearTimer();
      clearInlineMotion();
    },
    [clearInlineMotion, clearTimer],
  );

  const finishGesture = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;

    const sheet = sheetRef.current;
    if (!sheet) return;

    const elapsed = Math.max(performance.now() - gesture.startedAt, 1);
    const velocity = gesture.offset / elapsed;
    const distanceThreshold = Math.min(140, sheet.getBoundingClientRect().height * 0.2);
    const shouldClose =
      gesture.offset >= distanceThreshold || (gesture.offset >= 44 && velocity >= 0.55);

    // Любой свайп не должен превращаться в последующий клик по ручке.
    suppressClickRef.current = gesture.maxMovement > 4;
    if (!shouldClose) {
      returnToPlace();
      return;
    }

    clearTimer();
    sheet.style.transition = `transform ${CLOSE_DURATION_MS}ms cubic-bezier(0.4, 0, 1, 1)`;
    sheet.style.transform = 'translate3d(0, 100dvh, 0)';
    timerRef.current = window.setTimeout(onClose, CLOSE_DURATION_MS);
  };

  return (
    <button
      type="button"
      className="group flex h-9 w-full shrink-0 cursor-grab touch-none items-center justify-center rounded-t-2xl active:cursor-grabbing focus-visible:ring-inset focus-visible:ring-offset-0"
      aria-label="Потяните вниз или нажмите, чтобы закрыть"
      title="Потяните вниз, чтобы закрыть"
      onClick={(event) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          event.preventDefault();
          return;
        }
        onClose();
      }}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (gestureRef.current) return;
        const sheet = sheetRef.current;
        if (!sheet) return;

        clearTimer();
        event.currentTarget.setPointerCapture(event.pointerId);
        gestureRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          startedAt: performance.now(),
          offset: 0,
          maxMovement: 0,
        };
        sheet.style.animation = 'none';
        sheet.style.transition = 'none';
        sheet.style.willChange = 'transform';
      }}
      onPointerMove={(event) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        const sheet = sheetRef.current;
        if (!sheet) return;

        const deltaX = event.clientX - gesture.startX;
        const deltaY = event.clientY - gesture.startY;
        gesture.offset = Math.max(0, deltaY);
        gesture.maxMovement = Math.max(gesture.maxMovement, Math.hypot(deltaX, deltaY));
        sheet.style.transform = `translate3d(0, ${gesture.offset}px, 0)`;
      }}
      onPointerUp={finishGesture}
      onPointerCancel={(event) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        gestureRef.current = null;
        suppressClickRef.current = gesture.maxMovement > 4;
        returnToPlace();
      }}
      onLostPointerCapture={(event) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        gestureRef.current = null;
        suppressClickRef.current = gesture.maxMovement > 4;
        returnToPlace();
      }}
    >
      <span className="h-1 w-11 rounded-full bg-border transition-colors group-active:bg-muted-foreground" />
    </button>
  );
}
