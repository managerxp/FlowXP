/* FlowBook's screens live under /app/books in the FlowXP app, but they are written with plain paths ("/sales", "/payments/new").
   This is react-router with that prefix added and removed, so none of those screens needs to know where it is mounted. */
import { Link as RLink, NavLink as RNavLink, Navigate as RNavigate, useLocation as useRLocation, useNavigate as useRNavigate } from 'react-router-dom';

export { Route, Routes, useParams, useSearchParams } from 'react-router-dom';

export const BASE = '/app/books';
const within = (to) => (typeof to === 'string' && to.startsWith('/') && !to.startsWith(`${BASE}/`) && to !== BASE ? (to === '/' ? BASE : `${BASE}${to}`) : to);
const under = (to) => (to && typeof to === 'object' && to.pathname ? { ...to, pathname: within(to.pathname) } : within(to));

export const Link = ({ to, ...rest }) => <RLink to={under(to)} {...rest} />;
export const NavLink = ({ to, ...rest }) => <RNavLink to={under(to)} {...rest} />;
export const Navigate = ({ to, ...rest }) => <RNavigate to={under(to)} {...rest} />;
export const useNavigate = () => { const go = useRNavigate(); return (to, options) => go(typeof to === 'number' ? to : under(to), options); };
/** The location as FlowBook's screens see it: the path without /app/books. */
export const useLocation = () => {
  const l = useRLocation();
  return { ...l, pathname: l.pathname.startsWith(BASE) ? l.pathname.slice(BASE.length) || '/' : l.pathname };
};
