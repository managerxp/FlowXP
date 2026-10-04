/*
 * BlurText, from React Bits (github.com/DavidHDev/react-bits), JS variant. Words rise out of a blur, one after another.
 * Changes from the original, to keep it quiet: an `as` prop (the hero needs an <h1>, not a <p>), a 12px travel instead
 * of 50px, the sentence read once by screen readers (aria-label) rather than word by word, and with reduced motion
 * the text is simply there.
 */
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';

const buildKeyframes = (from, steps) => {
  const keys = new Set([...Object.keys(from), ...steps.flatMap(s => Object.keys(s))]);
  const keyframes = {};
  keys.forEach(k => {
    keyframes[k] = [from[k], ...steps.map(s => s[k])];
  });
  return keyframes;
};

const BlurText = ({
  as: Tag = 'p',
  text = '',
  delay = 90,
  className = '',
  animateBy = 'words',
  direction = 'bottom',
  threshold = 0.1,
  rootMargin = '0px',
  animationFrom,
  animationTo,
  easing = t => t,
  onAnimationComplete,
  stepDuration = 0.3
}) => {
  const reduce = useReducedMotion();
  const elements = animateBy === 'words' ? text.split(' ') : text.split('');
  const [inView, setInView] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return undefined;
    const el = ref.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.unobserve(el);
        }
      },
      { threshold, rootMargin }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, rootMargin]);

  const defaultFrom = useMemo(
    () => ({ filter: 'blur(8px)', opacity: 0, y: direction === 'top' ? -12 : 12 }),
    [direction]
  );
  const defaultTo = useMemo(
    () => [
      { filter: 'blur(4px)', opacity: 0.5, y: direction === 'top' ? 2 : -2 },
      { filter: 'blur(0px)', opacity: 1, y: 0 }
    ],
    [direction]
  );

  if (reduce) return <Tag className={className}>{text}</Tag>;

  const fromSnapshot = animationFrom ?? defaultFrom;
  const toSnapshots = animationTo ?? defaultTo;
  const stepCount = toSnapshots.length + 1;
  const totalDuration = stepDuration * (stepCount - 1);
  const times = Array.from({ length: stepCount }, (_, i) => (stepCount === 1 ? 0 : i / (stepCount - 1)));
  const animateKeyframes = buildKeyframes(fromSnapshot, toSnapshots);

  return (
    <Tag ref={ref} className={className} aria-label={text}>
      {elements.map((segment, index) => (
        <motion.span
          aria-hidden="true"
          className="inline-block will-change-[transform,filter,opacity]"
          key={index}
          initial={fromSnapshot}
          animate={inView ? animateKeyframes : fromSnapshot}
          transition={{ duration: totalDuration, times, delay: (index * delay) / 1000, ease: easing }}
          onAnimationComplete={index === elements.length - 1 ? onAnimationComplete : undefined}
        >
          {segment === ' ' ? ' ' : segment}
          {animateBy === 'words' && index < elements.length - 1 && ' '}
        </motion.span>
      ))}
    </Tag>
  );
};

export default BlurText;
