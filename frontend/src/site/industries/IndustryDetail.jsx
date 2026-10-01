/*
 * /industries/:slug — one built vertical in detail. Content lives in
 * data.js so this file is just the template; an unknown slug (or one of
 * the not-yet-built trades) sends the visitor back to the hub rather than
 * showing an empty page.
 */
import { Navigate, useParams } from 'react-router-dom';
import { Section } from '../../components/ui.jsx';
import { FeatureRow, FinalCta, PageHero, Shot } from '../parts.jsx';
import { READY } from './data.js';

const IndustryDetail = () => {
  const { slug } = useParams();
  const industry = READY.find((i) => i.slug === slug);
  if (!industry) return <Navigate to="/industries" replace />;

  return (
    <>
      <PageHero
        eyebrow={industry.eyebrow}
        title={industry.title}
        lead={industry.lead}
        points={['Choose this when you sign up and FlowXP switches these tools on', 'The same billing, stock and GST underneath every other vertical', '7-day free trial, no card']}
        visual={<Shot src={industry.heroSrc} eager alt={industry.heroAlt} />}
      />

      <Section>
        <div className="space-y-24 lg:space-y-32">
          {industry.rows.map((row, i) => (
            <FeatureRow key={row.title} eyebrow={row.eyebrow} title={row.title} body={row.body} points={row.points} src={row.src} alt={row.alt} flip={i % 2 === 1} />
          ))}
        </div>
      </Section>

      <FinalCta title={`Set up FlowXP for ${industry.label.toLowerCase()}.`} lead="Seven days free, no card. Choose this kind of business when you sign up and these tools switch on." />
    </>
  );
};

export default IndustryDetail;
