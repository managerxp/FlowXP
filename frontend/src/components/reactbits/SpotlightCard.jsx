/*
 * SpotlightCard, from React Bits (github.com/DavidHDev/react-bits), JS + CSS variant. A soft light follows the pointer
 * across the card. Change from the original: the CSS no longer sets its own dark surface, border, radius or padding,
 * so the card takes FlowXP's tokens from className; only the spotlight itself comes from SpotlightCard.css.
 */
import { useRef } from 'react';
import './SpotlightCard.css';

const SpotlightCard = ({ as: Tag = 'div', children, className = '', spotlightColor = 'rgba(255, 255, 255, 0.25)' }) => {
  const divRef = useRef(null);

  const handleMouseMove = e => {
    const rect = divRef.current.getBoundingClientRect();
    divRef.current.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    divRef.current.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
    divRef.current.style.setProperty('--spotlight-color', spotlightColor);
  };

  return (
    <Tag ref={divRef} onMouseMove={handleMouseMove} className={`card-spotlight ${className}`}>
      {children}
    </Tag>
  );
};

export default SpotlightCard;
