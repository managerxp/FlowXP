/*
 * Fades and lifts its content in the first time it scrolls into view.
 *
 * One IntersectionObserver per element, disconnected after the first reveal,
 * so nothing keeps running once the page has been seen. `index` staggers
 * siblings (60ms apart, capped so a long list never waits). With reduced
 * motion, or without IntersectionObserver, content is simply shown.
 */
import { useEffect, useRef } from 'react';

const Reveal = ({ as: Tag = 'div', index = 0, className = '', style, children, ...rest }) => {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.dataset.shown = '';
      return undefined;
    }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { el.dataset.shown = ''; io.disconnect(); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag ref={ref} className={`reveal ${className}`} style={{ '--i': Math.min(index, 6), ...style }} {...rest}>
      {children}
    </Tag>
  );
};

export default Reveal;
