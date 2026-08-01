import { useEffect, useRef, useState } from "react";
import { useHorizontalWheelScroll } from "@/hooks/useHorizontalWheelScroll";

interface TabsScrollbarProps {
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

export function TabsScrollbar({ scrollRef }: TabsScrollbarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ left: 0, width: 0, visible: false });
  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startScroll: number;
  }>({ active: false, startX: 0, startScroll: 0 });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      const maxScroll = scrollWidth - clientWidth;
      if (maxScroll <= 1) {
        setState({ left: 0, width: 0, visible: false });
        return;
      }
      const thumbWidth = Math.max((clientWidth / scrollWidth) * clientWidth, 32);
      const trackSpace = clientWidth - thumbWidth;
      const thumbLeft = (scrollLeft / maxScroll) * trackSpace;
      setState({ left: thumbLeft, width: thumbWidth, visible: true });
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    Array.from(el.children).forEach((child) => ro.observe(child));

    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [scrollRef]);

  useHorizontalWheelScroll(trackRef, state.visible);

  if (!state.visible) return null;

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== trackRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(
      0,
      Math.min(1, (e.clientX - rect.left) / rect.width),
    );
    el.scrollLeft = ratio * (el.scrollWidth - el.clientWidth);
  };

  const handleThumbMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = scrollRef.current;
    if (!el) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startScroll: el.scrollLeft,
    };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current.active) return;
      const target = scrollRef.current;
      if (!target) return;
      const trackWidth = target.clientWidth;
      const maxScroll = target.scrollWidth - trackWidth;
      const usableTrack = trackWidth - state.width;
      if (usableTrack <= 0) return;
      const delta = ev.clientX - dragRef.current.startX;
      const scrollDelta = (delta / usableTrack) * maxScroll;
      target.scrollLeft = dragRef.current.startScroll + scrollDelta;
    };

    const onUp = () => {
      dragRef.current.active = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <div
      ref={trackRef}
      onClick={handleTrackClick}
      className="absolute right-0 bottom-0 left-0 z-10 h-1 shrink-0 cursor-pointer bg-border/30 opacity-0 transition-opacity duration-150 group-hover/tabs:opacity-100"
    >
      <div
        onMouseDown={handleThumbMouseDown}
        className="absolute top-0 h-full cursor-grab rounded-full bg-muted-foreground/30 transition-colors hover:bg-muted-foreground/60 active:cursor-grabbing"
        style={{ left: state.left, width: state.width }}
      />
    </div>
  );
}