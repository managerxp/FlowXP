/*
 * /industries/coming-soon — trades FlowXP does not fully fit yet. Each
 * card names the real, specific gap rather than a vague "coming soon",
 * matching how the rest of the site is honest about what is not built.
 */
import { Section } from '../../components/ui.jsx';
import { CellGrid, FinalCta, PageHero, Shot } from '../parts.jsx';
import { SOON } from './data.js';

const ComingSoonPage = () => (
  <>
    <PageHero
      eyebrow="Not yet, but named"
      title="What is not built yet, said plainly."
      lead="These trades can run on FlowXP's core billing, stock and GST today, but each is missing one thing built specifically for how that trade works. Here is exactly what, so you are not guessing."
      visual={<Shot src="/product/inventory-main.webp" eager alt="FlowXP inventory screen with stock value, low-stock items and the product list." />}
    />

    <Section eyebrow="Named gaps" title="One missing piece each, not a vague roadmap.">
      <CellGrid items={SOON} cols="sm:grid-cols-2" />
    </Section>

    <FinalCta title="Want to be first when one of these ships?" lead="Tell us which trade you run. We will let you know the moment it is ready, not before." />
  </>
);

export default ComingSoonPage;
