/*
 * Per-page title, description, canonical address and social preview tags for the public site. index.html carries
 * the home page's tags for the first paint and for crawlers that don't run scripts; this keeps them right as a
 * visitor moves between pages. Descriptions are written for what an owner would search for (billing software,
 * restaurant POS, GST billing, pharmacy billing...), in a sentence a person would also want to read.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { ALIASES, READY } from './industries/data.js';

const ORIGIN = 'https://flowxp.in';
const BRAND = 'FlowXP';

/* Page titles and search phrases per industry. */
const INDUSTRY_TITLE = {
  restaurant: 'Restaurant billing software', cafe: 'Café and bakery billing software', 'cloud-kitchen': 'Cloud kitchen software', wholesale: 'Wholesale billing software',
  distributor: 'Distribution and field sales software', salon: 'Salon billing software', pharmacy: 'Pharmacy billing software'
};
const INDUSTRY_SEARCH = {
  restaurant: 'Restaurant billing software with POS, table QR ordering, kitchen display, recipes and GST.',
  cafe: 'Café and bakery billing software with a fast counter, size, milk and sugar options, a barista screen, recipes, a visit card and GST.',
  'cloud-kitchen': 'Cloud kitchen software for delivery orders, several brands, recipes, payouts and GST.',
  wholesale: 'Wholesale billing and inventory software with credit limits, batches, purchase orders and GST.',
  distributor: 'Distribution software for field sales, beats, schemes, van stock and collections.',
  salon: 'Salon billing software with appointments, staff commission, memberships and product stock.',
  pharmacy: 'Pharmacy billing software with batch and expiry tracking, purchase entry and GST.'
};

const PAGES = {
  '/': ['AI billing, inventory and GST software for Indian businesses', 'FlowXP is billing and POS software for shops, restaurants, salons, pharmacies and wholesalers. Billing, stock and GST in one place, with a daily note on what is selling and what needs you.'],
  '/features': ['Billing, inventory, GST and reports in one place', 'GST billing, payments, stock, purchases, customers, reports and roles in one system. See every FlowXP feature with real screens.'],
  '/industries': ['Billing software for your kind of business', 'FlowXP for restaurants, cloud kitchens, wholesalers, distributors, salons and pharmacies, each with the tools that trade needs.'],
  '/industries/coming-soon': ['What is not built yet', 'The businesses and features FlowXP does not support yet, listed plainly.'],
  '/ai': ['Flow AI, the AI manager in your billing software', 'Ask your business a question in plain words. Flow AI answers from your own sales, stock and payments, and says when a figure is an estimate.'],
  '/integrations': ['Printers, scanners and GST integrations', 'FlowXP works with receipt printers, barcode scanners, cash drawers and GST portal files. WhatsApp and SMS are coming soon. None are needed to start billing.'],
  '/pricing': ['Pricing and plans', 'FlowXP plans for single shops and multi-branch businesses. Every plan starts with a 7-day free trial, no card needed.'],
  '/about': ['About FlowXP and ManagerXP', 'FlowXP is made by ManagerXP, building billing and business software for Indian shops, restaurants and distributors.'],
  '/contact': ['Contact sales and support', 'Talk to the FlowXP team about sales, setup or support.'],
  '/delete-account': ['Delete your account', 'How to delete your FlowXP account, and what happens to your information.'],
  '/privacy': ['Privacy policy', 'How FlowXP collects, uses and protects your data.'],
  '/terms': ['Terms of service', 'The terms for using FlowXP.'],
  '/cookies': ['Cookie policy', 'FlowXP uses no advertising or tracking cookies. What it keeps in your browser, and why.']
};

const pageFor = (pathname) => {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (PAGES[path]) return { path, title: PAGES[path][0], description: PAGES[path][1] };
  const slug = path.match(/^\/industries\/([^/]+)$/)?.[1];
  const industry = slug && READY.find((i) => i.slug === (ALIASES[slug] || slug));
  if (industry) {
    return {
      path: `/industries/${industry.slug}`,
      title: INDUSTRY_TITLE[industry.slug] || `${industry.label} software`,
      description: `${INDUSTRY_SEARCH[industry.slug] || industry.blurb} Real screens, everything included, and what is not built yet.`
    };
  }
  return { path, notFound: true, title: 'Page not found', description: 'This page does not exist on FlowXP.' };
};

const setMeta = (attr, key, content) => {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.setAttribute('content', content);
};

const setCanonical = (href) => {
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) { el = document.createElement('link'); el.setAttribute('rel', 'canonical'); document.head.appendChild(el); }
  el.setAttribute('href', href);
};

export const useSeo = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    const page = pageFor(pathname);
    // A 404 keeps its title and says noindex, so search engines drop the address instead of indexing it.
    const title = page.path === '/' ? `${BRAND} | ${page.title}` : `${page.title} | ${BRAND}`;
    const url = `${ORIGIN}${page.path === '/' ? '/' : page.path}`;
    document.title = title;
    setMeta('name', 'description', page.description);
    if (page.notFound) document.head.querySelector('link[rel="canonical"]')?.remove();
    else setCanonical(url);
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', page.description);
    setMeta('property', 'og:url', url);
    setMeta('name', 'twitter:title', title);
    setMeta('name', 'twitter:description', page.description);
    setMeta('name', 'robots', page.notFound ? 'noindex, follow' : 'index, follow');
  }, [pathname]);
};
