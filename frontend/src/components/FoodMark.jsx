/*
 * The mark Indian menus carry next to a dish: a green square with a dot for
 * veg, red for non-veg, yellow for egg. Nothing is drawn when a dish has none.
 */
const MARKS = {
  VEG: ['Veg', '#16a34a'],
  NON_VEG: ['Non-veg', '#b91c1c'],
  EGG: ['Contains egg', '#ca8a04']
};

export const FOOD_TYPES = [['VEG', 'Veg'], ['NON_VEG', 'Non-veg'], ['EGG', 'Egg'], ['', 'Not marked']];

const FoodMark = ({ type, size = 14 }) => {
  const mark = MARKS[type];
  if (!mark) return null;
  const [label, color] = mark;
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex shrink-0 items-center justify-center rounded-[3px] border-[1.5px] bg-white"
          style={{ width: size, height: size, borderColor: color }}>
      {type === 'NON_VEG'
        ? <span style={{ width: 0, height: 0, borderLeft: `${size * 0.26}px solid transparent`, borderRight: `${size * 0.26}px solid transparent`, borderBottom: `${size * 0.44}px solid ${color}` }} />
        : <span className="rounded-full" style={{ width: size * 0.46, height: size * 0.46, background: color }} />}
    </span>
  );
};

export default FoodMark;
