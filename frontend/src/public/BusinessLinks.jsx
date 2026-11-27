/* What a guest may want besides booking, on both booking pages: call the place, find it on the map, read or leave a Google review. */
import { MapPin, Phone, Star } from 'lucide-react';

const style = 'inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3.5 py-2 text-small font-medium text-ink-900 hover:border-brand-500';

export default function BusinessLinks({ info, className = '' }) {
  const review = /^https:\/\//.test(info.google_review_link || '') ? info.google_review_link : null;
  if (!info.phone && !info.address && !review) return null;
  return (
    <nav aria-label={`Contact ${info.name}`} className={`flex flex-wrap gap-2 ${className}`}>
      {review && <a className={style} href={review} target="_blank" rel="noreferrer"><Star aria-hidden="true" className="h-4 w-4 text-warning" />Google reviews</a>}
      {info.address && <a className={style} href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${info.name}, ${info.address}`)}`} target="_blank" rel="noreferrer"><MapPin aria-hidden="true" className="h-4 w-4" />Directions</a>}
      {info.phone && <a className={style} href={`tel:${info.phone.replace(/[^+\d]/g, '')}`}><Phone aria-hidden="true" className="h-4 w-4" />Call</a>}
    </nav>
  );
}
