/*
 * The public site's 404: any address the site doesn't have (and an industry page that doesn't exist). It used to
 * redirect to the home page, which search engines count as a "soft 404" and which leaves a person who followed an
 * old link wondering where they are. Now it says so, offers the likely destinations, and seo.js marks it noindex.
 */
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, BadgeIndianRupee, Blocks, LayoutGrid, MessageCircle, Sparkles } from 'lucide-react';
import { Button, Container } from '../components/ui.jsx';

const PLACES = [
  { to: '/features', icon: LayoutGrid, title: 'Product', body: 'Billing, stock, GST and reports' },
  { to: '/industries', icon: Blocks, title: 'Industries', body: 'Restaurants, pharmacies, salons and more' },
  { to: '/ai', icon: Sparkles, title: 'Flow AI', body: 'Ask your business a question' },
  { to: '/pricing', icon: BadgeIndianRupee, title: 'Pricing', body: 'Plans and the free trial' },
  { to: '/contact', icon: MessageCircle, title: 'Contact', body: 'Talk to the FlowXP team' }
];

const NotFoundPage = () => {
  const { pathname } = useLocation();
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden="true" className="hero-stage absolute inset-x-2 bottom-1/3 top-2 rounded-[2rem] sm:inset-x-3 sm:top-3" />
      <Container className="relative pb-20 pt-16 text-center sm:pb-28 sm:pt-24">
        <p aria-hidden="true" className="rise tabular select-none text-[clamp(5rem,18vw,10rem)] font-semibold leading-none tracking-tighter text-brand-500/90">404</p>
        <h1 className="rise mt-4 text-h2 font-semibold text-ink-900" style={{ '--i': 1 }}>This page isn't here.</h1>
        <p className="rise mx-auto mt-4 max-w-md text-lead text-ink-500" style={{ '--i': 2 }}>
          The link may be old or mistyped. This address doesn't exist on FlowXP:
          <span className="mt-2 block font-medium text-ink-700 [overflow-wrap:anywhere]">{pathname}</span>
        </p>
        <div className="rise mt-8 flex flex-wrap justify-center gap-3" style={{ '--i': 3 }}>
          <Button to="/" size="lg">Go to the home page</Button>
          <Button to="/signup" size="lg" variant="secondary">Start free trial</Button>
        </div>

        <nav aria-label="Popular pages" className="rise mx-auto mt-14 max-w-4xl text-left" style={{ '--i': 4 }}>
          <p className="text-center text-small font-medium text-ink-500">Or go straight to</p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {PLACES.map(({ to, icon: Icon, title, body }) => (
              <li key={to}>
                <Link to={to} className="lift group flex h-full flex-col rounded-(--radius-card) border border-line bg-surface p-4">
                  <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Icon className="h-[18px] w-[18px]" strokeWidth={2} /></span>
                  <span className="mt-3 flex items-center gap-1 text-body font-semibold text-ink-900">
                    {title}<ArrowRight aria-hidden="true" className="h-4 w-4 text-ink-400 transition-transform duration-(--duration-normal) group-hover:translate-x-0.5" />
                  </span>
                  <span className="mt-1 text-small text-ink-500">{body}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Container>
    </section>
  );
};

export default NotFoundPage;
